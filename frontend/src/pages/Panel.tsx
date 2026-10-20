import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { formatearClp, formatearDecimal, formatearEntero, formatearFechaHora, mesCorto } from '../lib/formato';
import { Aviso, Boton, Cargando, EncabezadoPagina } from '../components/ui';

// Forma del JSON que devuelve public.dashboard_indicadores()
export type Indicadores = {
  generado_en: string;
  clientes: { vigentes: number; activos: number; suspendidos: number; pendientes: number; retirados_mes: number };
  ingreso_mensual_clp: number;
  solicitudes: { pendientes: number; en_factibilidad: number };
  ordenes: { abiertas: number; instalaciones_mes: number };
  nap: { total: number; sobre_alerta: number; umbral_alerta_pct: number };
  puertos: {
    total: number;
    libres: number;
    reservados: number;
    ocupados: number;
    averiados: number;
    ocupacion_pct: number;
  };
  km_cable: Partial<Record<'troncal' | 'distribucion' | 'derivacion' | 'acometida', number>>;
  materiales_stock_bajo: number;
  serie_mensual: { mes: string; altas: number; instalaciones: number }[];
};

const NOMBRE_CABLE: Record<string, string> = {
  troncal: 'Troncal',
  distribucion: 'Distribución',
  derivacion: 'Derivación',
  acometida: 'Acometida',
};

export function Panel() {
  const { roles } = useAuth();
  const enlaces = tieneRol(roles, 'supervisor_red', 'atencion_cliente');
  const consulta = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_indicadores');
      if (error) throw error;
      return data as Indicadores;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const d = consulta.data;

  return (
    <>
      <EncabezadoPagina
        titulo="Panel"
        detalle={d ? `Actualizado ${formatearFechaHora(d.generado_en)}` : undefined}
        acciones={
          <Boton variante="secundario" onClick={() => void consulta.refetch()} cargando={consulta.isFetching}>
            {!consulta.isFetching && <RefreshCw className="size-4" aria-hidden />}
            Actualizar
          </Boton>
        }
      />

      {consulta.isPending && <Cargando texto="Calculando indicadores…" />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}

      {d && (
        <div className="grid gap-x-10 gap-y-9 md:grid-cols-2">
          <Grupo titulo="Clientes" hilo="var(--color-f-azul)">
            <Cifra valor={formatearEntero(d.clientes.activos)} texto="activos" grande a={enlaces ? '/clientes?estado=activo' : undefined} />
            <Fila>
              <Dato valor={formatearEntero(d.clientes.suspendidos)} texto="suspendidos" a={enlaces ? '/clientes?estado=suspendido' : undefined} />
              <Dato valor={formatearEntero(d.clientes.pendientes)} texto="por instalar" a={enlaces ? '/clientes?estado=pendiente' : undefined} />
              <Dato valor={formatearEntero(d.clientes.retirados_mes)} texto="retirados este mes" />
            </Fila>
            <p className="mt-4 text-tenue">
              Ingreso mensual estimado{' '}
              <span className="cifra text-lg font-semibold text-tinta">{formatearClp(d.ingreso_mensual_clp)}</span>
            </p>
          </Grupo>

          <Grupo titulo="Instalaciones y órdenes" hilo="var(--color-f-verde)">
            <Cifra valor={formatearEntero(d.ordenes.instalaciones_mes)} texto="instalaciones completadas este mes" grande
              a={enlaces ? '/ordenes?estado=completada&tipo=instalacion' : undefined} />
            <Fila>
              <Dato valor={formatearEntero(d.solicitudes.pendientes)} texto="solicitudes en curso" a={enlaces ? '/solicitudes' : undefined} />
              <Dato valor={formatearEntero(d.solicitudes.en_factibilidad)} texto="en factibilidad" a={enlaces ? '/solicitudes?estado=en_factibilidad' : undefined} />
              <Dato valor={formatearEntero(d.ordenes.abiertas)} texto="órdenes abiertas" a={enlaces ? '/ordenes' : undefined} />
            </Fila>
          </Grupo>

          <Grupo titulo="Red de acceso" hilo="var(--color-f-naranjo)">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Cifra valor={`${formatearDecimal(d.puertos.ocupacion_pct)} %`} texto="ocupación de puertos" grande />
              <Cifra valor={formatearEntero(d.nap.total)} texto="NAP registradas" a="/topologia" />
            </div>
            <BarraPuertos p={d.puertos} />
            {d.nap.sobre_alerta > 0 ? (
              <p className="mt-3 text-alerta">
                {d.nap.sobre_alerta === 1 ? '1 NAP supera' : `${d.nap.sobre_alerta} NAP superan`} el{' '}
                {formatearEntero(d.nap.umbral_alerta_pct)} % de ocupación.
              </p>
            ) : (
              <p className="mt-3 text-tenue">Ninguna NAP supera el {formatearEntero(d.nap.umbral_alerta_pct)} % de ocupación.</p>
            )}
          </Grupo>

          <Grupo titulo="Cable e inventario" hilo="var(--color-f-cafe)">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {(['troncal', 'distribucion', 'derivacion', 'acometida'] as const).map((t) => (
                <div key={t}>
                  <dt className="text-sm text-tenue">{NOMBRE_CABLE[t]}</dt>
                  <dd className="cifra text-xl font-semibold">{formatearDecimal(d.km_cable[t] ?? 0)} km</dd>
                </div>
              ))}
            </dl>
            <p className={`mt-5 ${d.materiales_stock_bajo > 0 ? 'text-alerta' : 'text-tenue'}`}>
              {d.materiales_stock_bajo === 0
                ? 'Todos los materiales están sobre su stock mínimo.'
                : d.materiales_stock_bajo === 1
                  ? '1 material está bajo su stock mínimo.'
                  : `${d.materiales_stock_bajo} materiales están bajo su stock mínimo.`}
            </p>
          </Grupo>

          <div className="md:col-span-2">
            <Grupo titulo="Últimos 12 meses" hilo="var(--color-f-gris)">
              <SerieMensual serie={d.serie_mensual} />
            </Grupo>
          </div>
        </div>
      )}
    </>
  );
}

function Grupo({ titulo, hilo, children }: { titulo: string; hilo: string; children: ReactNode }) {
  return (
    <section className="relative pl-5">
      <span className="absolute inset-y-0 left-0 w-[3px] rounded-full" style={{ background: hilo }} aria-hidden />
      <h2 className="mb-3 font-cond text-xl font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Cifra({ valor, texto, grande = false, a }: { valor: string; texto: string; grande?: boolean; a?: string }) {
  const contenido = (
    <>
      <span className={`cifra font-semibold leading-none ${grande ? 'text-[56px]' : 'text-[32px]'}`}>{valor}</span>
      <span className={`mt-1 ${a ? 'text-acento group-hover:underline' : 'text-tenue'}`}>{texto}</span>
    </>
  );
  return a ? (
    <Link to={a} className="group flex flex-col">{contenido}</Link>
  ) : (
    <p className="flex flex-col">{contenido}</p>
  );
}

function Fila({ children }: { children: ReactNode }) {
  return <div className="mt-5 grid grid-cols-3 gap-4 border-t border-linea pt-4">{children}</div>;
}

function Dato({ valor, texto, a }: { valor: string; texto: string; a?: string }) {
  const contenido = (
    <>
      <span className="cifra text-2xl font-semibold">{valor}</span>
      <span className={`text-sm ${a ? 'text-acento group-hover:underline' : 'text-tenue'}`}>{texto}</span>
    </>
  );
  return a ? (
    <Link to={a} className="group flex flex-col">{contenido}</Link>
  ) : (
    <p className="flex flex-col">{contenido}</p>
  );
}

const ESTADOS_PUERTO = [
  { clave: 'ocupados', texto: 'ocupados', color: 'var(--color-f-azul)' },
  { clave: 'reservados', texto: 'reservados', color: 'var(--color-f-amarillo)' },
  { clave: 'averiados', texto: 'averiados', color: 'var(--color-f-rojo)' },
  { clave: 'libres', texto: 'libres', color: '#cfd7dc' },
] as const;

function BarraPuertos({ p }: { p: Indicadores['puertos'] }) {
  if (p.total === 0) {
    return <p className="mt-4 text-tenue">Aún no hay NAP registradas.</p>;
  }
  return (
    <div className="mt-5">
      <div
        className="flex h-4 w-full overflow-hidden rounded-sm bg-linea"
        role="img"
        aria-label={`${p.ocupados} ocupados, ${p.reservados} reservados, ${p.averiados} averiados y ${p.libres} libres de ${p.total} puertos`}
      >
        {ESTADOS_PUERTO.map((e) => (
          <span key={e.clave} style={{ width: `${(p[e.clave] / p.total) * 100}%`, background: e.color }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {ESTADOS_PUERTO.map((e) => (
          <li key={e.clave} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: e.color }} aria-hidden />
            <span className="cifra font-semibold">{formatearEntero(p[e.clave])}</span>
            <span className="text-tenue">{e.texto}</span>
          </li>
        ))}
        <li className="text-tenue">
          de <span className="cifra font-semibold text-tinta">{formatearEntero(p.total)}</span> puertos
        </li>
      </ul>
    </div>
  );
}

function SerieMensual({ serie }: { serie: Indicadores['serie_mensual'] }) {
  const maximo = Math.max(1, ...serie.flatMap((s) => [s.altas, s.instalaciones]));
  const total = serie.reduce((a, s) => a + s.altas + s.instalaciones, 0);
  if (total === 0) {
    return <p className="text-tenue">Todavía no hay altas de clientes ni instalaciones completadas en el período.</p>;
  }
  return (
    <figure>
      <div className="flex h-40 items-end gap-1.5 sm:gap-3" role="img" aria-label="Altas de clientes e instalaciones por mes">
        {serie.map((s) => (
          <div key={s.mes} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex min-h-0 flex-1 items-end justify-center gap-[3px]">
              <span
                className="w-full max-w-[14px] rounded-t-sm"
                style={{ height: `${(s.altas / maximo) * 100}%`, background: 'var(--color-f-azul)' }}
                title={`${s.altas} altas`}
              />
              <span
                className="w-full max-w-[14px] rounded-t-sm"
                style={{ height: `${(s.instalaciones / maximo) * 100}%`, background: 'var(--color-f-verde)' }}
                title={`${s.instalaciones} instalaciones`}
              />
            </div>
            <span className="mt-1 text-center text-xs text-tenue">{mesCorto(s.mes)}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex gap-5 text-sm text-tenue">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-f-azul" aria-hidden /> Altas de clientes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-f-verde" aria-hidden /> Instalaciones completadas
        </span>
      </figcaption>
    </figure>
  );
}

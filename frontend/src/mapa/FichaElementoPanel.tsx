import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Move, Navigation, Pencil, Trash2 } from 'lucide-react';
import { cambiarEstadoPuerto, fichaElemento } from './api';
import { COLOR_HILO, COLOR_PUERTO, NOMBRE_PUERTO, nombreEstado, type FichaElemento, type PuertoFicha } from './tipos';
import { mensajeError } from '../lib/errores';
import { formatearFecha, formatearFechaHora } from '../lib/formato';
import { Aviso, Boton, Cargando, DatoFicha } from '../components/ui';

const NOMBRES_DETALLE: Record<string, string> = {
  marca: 'Marca',
  modelo: 'Modelo',
  tecnologia: 'Tecnología',
  numero_serie: 'N.º de serie',
  ip_gestion: 'IP de gestión',
  capacidad_puertos: 'Puertos',
  material: 'Material',
  altura_m: 'Altura (m)',
  propietario: 'Propietario',
  numero_placa: 'N.º de placa',
  tipo: 'Tipo',
  dimensiones: 'Dimensiones',
  capacidad_empalmes: 'Capacidad de empalmes',
  descripcion: 'Descripción',
  edificio: 'Edificio',
  pisos: 'Pisos',
  contacto_administracion: 'Contacto de administración',
};
const OCULTOS_DETALLE = new Set(['ratio_splitter_id', 'tecnico_responsable_id']);

export function FichaElementoPanel({
  id,
  puedeEditar,
  alEditar,
  alMover,
  alEliminar,
  alVerCable,
  eliminando,
}: {
  id: string;
  puedeEditar: boolean;
  alEditar: (f: FichaElemento) => void;
  alMover: (f: FichaElemento) => void;
  alEliminar: (f: FichaElemento) => void;
  alVerCable: (id: string) => void;
  eliminando: boolean;
}) {
  const ficha = useQuery({ queryKey: ['mapa', 'ficha-elemento', id], queryFn: () => fichaElemento(id) });

  if (ficha.isPending) return <Cargando />;
  if (ficha.isError) return <Aviso tipo="error">{mensajeError(ficha.error)}</Aviso>;
  const f = ficha.data;
  if (!f) return <p className="text-tenue">Este elemento ya no existe.</p>;

  const detalle = Object.entries(f.detalle).filter(([k, v]) => !OCULTOS_DETALLE.has(k) && v != null && v !== '');

  return (
    <article>
      <header>
        <p className="text-sm text-tenue">{f.tipo_nombre}</p>
        <h2 className="font-cond text-2xl font-semibold leading-tight">{f.codigo}</h2>
        {f.nombre && <p className="mt-0.5">{f.nombre}</p>}
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <InsigniaEstado estado={f.estado} />
          {f.es_demo && <span className="rounded bg-f-amarillo/25 px-2 py-0.5">Dato de demostración</span>}
        </p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-linea px-3 py-1.5 text-sm font-medium hover:border-tenue"
        >
          <Navigation className="size-4" aria-hidden /> Cómo llegar
        </a>
        {puedeEditar && (
          <>
            <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={() => alEditar(f)}>
              <Pencil className="size-4" aria-hidden /> Editar
            </Boton>
            <Boton variante="secundario" className="px-3 py-1.5 text-sm" onClick={() => alMover(f)}>
              <Move className="size-4" aria-hidden /> Mover
            </Boton>
            <Boton variante="peligro" className="px-3 py-1.5 text-sm" cargando={eliminando} onClick={() => alEliminar(f)}>
              {!eliminando && <Trash2 className="size-4" aria-hidden />} Eliminar
            </Boton>
          </>
        )}
      </div>

      {f.clase === 'nap' && f.puertos && <SeccionNap f={f} puedeEditar={puedeEditar} />}

      {f.clase === 'olt' && f.puertos_pon && (
        <section className="mt-6">
          <h3 className="mb-2 font-cond text-lg font-semibold">Puertos PON</h3>
          {f.puertos_pon.length === 0 ? (
            <p className="text-tenue">Sin puertos PON registrados.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-3">
              {f.puertos_pon.map((p) => (
                <li key={p.id} className="rounded border border-linea px-2 py-1">
                  <span className="font-medium">{p.etiqueta ?? `${p.slot}/${p.puerto}`}</span>
                  <span className="block text-tenue">{p.hilos === 0 ? 'Sin hilos' : `${p.hilos} hilo${p.hilos > 1 ? 's' : ''}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-6">
        <h3 className="mb-1 font-cond text-lg font-semibold">Datos</h3>
        <dl>
          <DatoFicha etiqueta="Dirección">{f.direccion}</DatoFicha>
          <DatoFicha etiqueta="Comuna">{f.comuna}</DatoFicha>
          <DatoFicha etiqueta="Sector">{f.sector}</DatoFicha>
          <DatoFicha etiqueta="Instalación">{f.fecha_instalacion ? formatearFecha(f.fecha_instalacion) : null}</DatoFicha>
          {detalle.map(([k, v]) => (
            <DatoFicha key={k} etiqueta={NOMBRES_DETALLE[k] ?? k}>
              {String(v)}
            </DatoFicha>
          ))}
          <DatoFicha etiqueta="Coordenadas">
            <span className="cifra">
              {f.lat.toFixed(6)}, {f.lng.toFixed(6)}
            </span>
          </DatoFicha>
          <DatoFicha etiqueta="Observaciones">{f.observaciones}</DatoFicha>
          <DatoFicha etiqueta="Actualizado">{formatearFechaHora(f.actualizado_en)}</DatoFicha>
        </dl>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-cond text-lg font-semibold">Cables conectados</h3>
        {f.cables.length === 0 ? (
          <p className="text-tenue">Ningún cable nace ni termina en este elemento.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {f.cables.map((c) => (
              <li key={c.id}>
                <button type="button" className="text-acento hover:underline" onClick={() => alVerCable(c.id)}>
                  {c.codigo}
                </button>{' '}
                <span className="text-sm text-tenue">
                  {c.tipo}, {c.extremo === 'origen' ? 'sale de aquí' : 'llega aquí'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function InsigniaEstado({ estado }: { estado: FichaElemento['estado'] }) {
  const color =
    estado === 'operativo' ? 'var(--color-ok)'
    : estado === 'fuera_servicio' ? 'var(--color-error)'
    : estado === 'retirado' ? 'var(--color-f-gris)'
    : 'var(--color-alerta)';
  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-fondo px-2 py-0.5">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {nombreEstado(estado)}
    </span>
  );
}

function SeccionNap({ f, puedeEditar }: { f: FichaElemento; puedeEditar: boolean }) {
  const puertos = f.puertos ?? [];
  const cuenta = (e: PuertoFicha['estado']) => puertos.filter((p) => p.estado === e).length;
  const ocupacion = puertos.length ? ((cuenta('ocupado') + cuenta('reservado')) / puertos.length) * 100 : 0;
  const [elegido, setElegido] = useState<PuertoFicha | null>(null);
  const a = f.alimentacion;

  return (
    <section className="mt-6">
      <h3 className="font-cond text-lg font-semibold">
        Puertos <span className="cifra font-medium text-tenue">· splitter {f.ratio}</span>
      </h3>
      <p className="mb-3 text-sm text-tenue">
        <span className="cifra font-semibold text-tinta">{ocupacion.toLocaleString('es-CL', { maximumFractionDigits: 0 })} %</span>{' '}
        ocupada · {cuenta('libre')} libres · {cuenta('ocupado')} ocupados · {cuenta('reservado')} reservados ·{' '}
        {cuenta('averiado')} averiados
      </p>

      <GrillaPuertos puertos={puertos} elegido={elegido?.id ?? null} alElegir={setElegido} />
      {elegido && (
        <DetallePuerto
          key={elegido.id}
          puerto={puertos.find((p) => p.id === elegido.id) ?? elegido}
          napId={f.id}
          puedeEditar={puedeEditar}
          alCerrar={() => setElegido(null)}
        />
      )}

      <h3 className="mb-1 mt-6 font-cond text-lg font-semibold">Alimentación</h3>
      {a ? (
        <dl>
          <DatoFicha etiqueta="Cable">{a.cable_codigo}</DatoFicha>
          <DatoFicha etiqueta="Hilo">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-3 rounded-full border border-linea"
                style={{ background: COLOR_HILO[a.color] ?? a.color }}
                aria-hidden
              />
              N.º {a.hilo} ({a.color}, tubo {a.tubo})
            </span>
          </DatoFicha>
          <DatoFicha etiqueta="OLT / PON">{a.olt_codigo ? `${a.olt_codigo} · ${a.puerto_pon}` : 'Sin inyección registrada'}</DatoFicha>
          <DatoFicha etiqueta="Verificada">{a.confirmada ? 'Sí, en terreno' : 'No, solo registrada'}</DatoFicha>
        </dl>
      ) : (
        <p className="text-tenue">Aún no hay una conexión registrada desde el troncal hacia esta NAP.</p>
      )}
    </section>
  );
}

/** Grilla de puertos con la distribución física de la caja: filas de 8. */
function GrillaPuertos({
  puertos,
  elegido,
  alElegir,
}: {
  puertos: PuertoFicha[];
  elegido: string | null;
  alElegir: (p: PuertoFicha) => void;
}) {
  return (
    <div>
      <ul className="grid grid-cols-8 gap-1.5" aria-label="Puertos de la NAP">
        {puertos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => alElegir(p)}
              aria-pressed={elegido === p.id}
              aria-label={`Puerto ${p.numero}: ${NOMBRE_PUERTO[p.estado]}${p.cliente ? `, ${p.cliente.nombre}` : ''}`}
              title={`Puerto ${p.numero}: ${NOMBRE_PUERTO[p.estado]}`}
              className={`cifra grid aspect-square w-full place-items-center rounded text-sm font-semibold
                ${elegido === p.id ? 'ring-2 ring-tinta ring-offset-1' : ''}`}
              style={{
                background: COLOR_PUERTO[p.estado],
                color: p.estado === 'libre' || p.estado === 'reservado' ? 'var(--color-tinta)' : '#fff',
              }}
            >
              {p.numero}
            </button>
          </li>
        ))}
      </ul>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-tenue">
        {(Object.keys(COLOR_PUERTO) as PuertoFicha['estado'][]).map((e) => (
          <li key={e} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: COLOR_PUERTO[e] }} aria-hidden />
            {NOMBRE_PUERTO[e]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetallePuerto({
  puerto,
  napId,
  puedeEditar,
  alCerrar,
}: {
  puerto: PuertoFicha;
  napId: string;
  puedeEditar: boolean;
  alCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [obs, setObs] = useState(puerto.observaciones ?? '');
  const cambiar = useMutation({
    mutationFn: (estado: 'libre' | 'averiado') => cambiarEstadoPuerto(puerto.id, estado, obs.trim() || null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['mapa', 'ficha-elemento', napId] });
      await qc.invalidateQueries({ queryKey: ['mapa', 'elementos'] });
    },
  });
  const editable = puedeEditar && (puerto.estado === 'libre' || puerto.estado === 'averiado');

  return (
    <div className="mt-3 rounded-md border border-linea p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          Puerto {puerto.numero}: {NOMBRE_PUERTO[puerto.estado]}
        </p>
        <button type="button" className="text-sm text-tenue hover:text-tinta" onClick={alCerrar}>
          Cerrar
        </button>
      </div>
      {puerto.cliente && (
        <p className="mt-1">
          {puerto.cliente.nombre} <span className="text-sm text-tenue">({puerto.cliente.codigo})</span>
        </p>
      )}
      {!puerto.cliente && puerto.estado === 'ocupado' && (
        <p className="mt-1 text-sm text-tenue">Su rol no permite ver los datos del cliente.</p>
      )}
      {puerto.observaciones && !editable && <p className="mt-1 text-sm">{puerto.observaciones}</p>}
      {editable && (
        <div className="mt-2 flex flex-col gap-2">
          <label htmlFor={`obs-${puerto.id}`} className="text-sm font-medium">
            Observaciones
          </label>
          <input
            id={`obs-${puerto.id}`}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            className="rounded-md border border-linea px-3 py-1.5 outline-none focus:border-acento"
          />
          {cambiar.isError && <Aviso tipo="error">{mensajeError(cambiar.error)}</Aviso>}
          <div className="flex gap-2">
            {puerto.estado === 'libre' ? (
              <Boton variante="peligro" className="px-3 py-1.5 text-sm" cargando={cambiar.isPending} onClick={() => cambiar.mutate('averiado')}>
                Marcar averiado
              </Boton>
            ) : (
              <Boton className="px-3 py-1.5 text-sm" cargando={cambiar.isPending} onClick={() => cambiar.mutate('libre')}>
                Marcar reparado (libre)
              </Boton>
            )}
          </div>
        </div>
      )}
      {puedeEditar && !editable && (
        <p className="mt-2 text-sm text-tenue">Los puertos ocupados o reservados se liberan desde el cliente o la solicitud.</p>
      )}
    </div>
  );
}

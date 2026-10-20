import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { mensajeError } from '../lib/errores';
import { formatearFechaHora, formatearTelefono } from '../lib/formato';
import { Aviso, Cargando, EncabezadoPagina } from '../components/ui';

type Orden = {
  id: string;
  numero: string;
  tipo: string;
  prioridad: 'baja' | 'media' | 'alta' | 'urgente';
  estado: string;
  direccion: string | null;
  fecha_programada: string | null;
  descripcion: string;
  cerrada_en: string | null;
  clientes: { nombre: string; telefono: string | null } | null;
  comunas: { nombre: string } | null;
};

const TIPO: Record<string, string> = {
  instalacion: 'Instalación',
  reparacion: 'Reparación',
  mantenimiento: 'Mantenimiento',
  cambio_domicilio: 'Cambio de domicilio',
  desconexion: 'Desconexión',
  retiro_equipos: 'Retiro de equipos',
};
const ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  en_camino: 'En camino',
  en_ejecucion: 'En ejecución',
  completada: 'Completada',
  cancelada: 'Cancelada',
};
const PRIORIDAD: Record<Orden['prioridad'], { texto: string; color: string }> = {
  urgente: { texto: 'Urgente', color: 'var(--color-f-rojo)' },
  alta: { texto: 'Alta', color: 'var(--color-f-naranjo)' },
  media: { texto: 'Media', color: 'var(--color-f-azul)' },
  baja: { texto: 'Baja', color: 'var(--color-f-gris)' },
};
const ORDEN_PRIORIDAD = { urgente: 0, alta: 1, media: 2, baja: 3 } as const;

export function MisOrdenes() {
  const { session } = useAuth();
  const yo = session?.user.id;

  const consulta = useQuery({
    queryKey: ['mis-ordenes', yo],
    enabled: !!yo,
    queryFn: async () => {
      const hace7dias = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select(
          'id, numero, tipo, prioridad, estado, direccion, fecha_programada, descripcion, cerrada_en, clientes(nombre, telefono), comunas(nombre)',
        )
        .eq('tecnico_id', yo!)
        .is('eliminado_en', null)
        .or(`estado.in.(asignada,en_camino,en_ejecucion,pendiente),cerrada_en.gte."${hace7dias}"`)
        .order('fecha_programada', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Orden[];
    },
  });

  const abiertas = (consulta.data ?? [])
    .filter((o) => !['completada', 'cancelada'].includes(o.estado))
    .sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad]);
  const cerradas = (consulta.data ?? []).filter((o) => ['completada', 'cancelada'].includes(o.estado));

  return (
    <>
      <EncabezadoPagina titulo="Mis órdenes" detalle="Trabajos asignados a usted, los más urgentes primero." />
      {consulta.isPending && <Cargando />}
      {consulta.isError && <Aviso tipo="error">{mensajeError(consulta.error)}</Aviso>}
      {consulta.data && (
        <>
          {abiertas.length === 0 ? (
            <p className="text-tenue">No tiene órdenes pendientes. Cuando le asignen un trabajo aparecerá aquí.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {abiertas.map((o) => (
                <TarjetaOrden key={o.id} o={o} />
              ))}
            </ul>
          )}
          {cerradas.length > 0 && (
            <>
              <h2 className="mb-3 mt-10 font-cond text-xl font-semibold">Cerradas en los últimos 7 días</h2>
              <ul className="flex flex-col gap-3 opacity-80">
                {cerradas.map((o) => (
                  <TarjetaOrden key={o.id} o={o} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

function TarjetaOrden({ o }: { o: Orden }) {
  const p = PRIORIDAD[o.prioridad];
  const direccion = [o.direccion, o.comunas?.nombre].filter(Boolean).join(', ');
  return (
    <li className="relative overflow-hidden rounded-md border border-linea bg-superficie p-4 pl-5">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: p.color }} aria-hidden />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-cond text-lg font-semibold">
          {TIPO[o.tipo] ?? o.tipo} <span className="cifra font-medium text-tenue">{o.numero}</span>
        </p>
        <p className="flex gap-3 text-sm">
          <span style={{ color: p.color }} className="font-semibold">
            Prioridad {p.texto.toLowerCase()}
          </span>
          <span className="text-tenue">{ESTADO[o.estado] ?? o.estado}</span>
        </p>
      </div>
      <p className="mt-1 text-tenue">
        {o.cerrada_en
          ? `Cerrada ${formatearFechaHora(o.cerrada_en)}`
          : o.fecha_programada
            ? `Programada ${formatearFechaHora(o.fecha_programada)}`
            : 'Sin fecha programada'}
      </p>
      {o.clientes && <p className="mt-2 font-medium">{o.clientes.nombre}</p>}
      <p className="mt-1">{o.descripcion}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {direccion && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion + ', Chile')}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-linea px-3 text-[15px] font-medium hover:border-tenue"
          >
            <MapPin className="size-4" aria-hidden /> {direccion}
          </a>
        )}
        {o.clientes?.telefono && (
          <a
            href={`tel:${o.clientes.telefono}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-linea px-3 text-[15px] font-medium hover:border-tenue"
          >
            <Phone className="size-4" aria-hidden /> {formatearTelefono(o.clientes.telefono)}
          </a>
        )}
      </div>
    </li>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { mensajeError } from '../lib/errores';
import { formatearFechaHora } from '../lib/formato';
import { Aviso, Cargando, EncabezadoPagina } from '../components/ui';
import { PRIORIDADES, misOrdenes, nombreTipo, type OrdenVista } from '../ordenes/api';
import { InsigniaOrden } from '../ordenes/componentes';

const PESO = { urgente: 0, alta: 1, media: 2, baja: 3 } as const;
const ESTADO_PRIMERO = { en_ejecucion: 0, en_camino: 1, asignada: 2, pendiente: 3, completada: 4, cancelada: 5 } as const;

export function MisOrdenes() {
  const { session } = useAuth();
  const yo = session?.user.id;
  const q = useQuery({ queryKey: ['ordenes', 'mias', yo], queryFn: () => misOrdenes(yo!), enabled: !!yo, refetchInterval: 60_000 });

  const abiertas = (q.data ?? [])
    .filter((o) => !['completada', 'cancelada'].includes(o.estado))
    .sort((a, b) => ESTADO_PRIMERO[a.estado] - ESTADO_PRIMERO[b.estado] || PESO[a.prioridad] - PESO[b.prioridad]);
  const cerradas = (q.data ?? []).filter((o) => ['completada', 'cancelada'].includes(o.estado));

  return (
    <div className="mx-auto max-w-xl">
      <EncabezadoPagina titulo="Mis órdenes" detalle="Primero la que está en curso, luego las más urgentes." />
      {q.isPending && <Cargando />}
      {q.isError && <Aviso tipo="error">{mensajeError(q.error)}</Aviso>}
      {q.data && abiertas.length === 0 && (
        <p className="text-tenue">No tiene órdenes pendientes. Cuando le asignen un trabajo aparecerá aquí.</p>
      )}
      <ul className="flex flex-col gap-3">
        {abiertas.map((o) => <Tarjeta key={o.id} o={o} />)}
      </ul>
      {cerradas.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 font-cond text-xl font-semibold">Cerradas en los últimos 7 días</h2>
          <ul className="flex flex-col gap-3 opacity-75">
            {cerradas.map((o) => <Tarjeta key={o.id} o={o} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function Tarjeta({ o }: { o: OrdenVista }) {
  const p = PRIORIDADES.find((x) => x.valor === o.prioridad);
  return (
    <li>
      <Link to={`/mis-ordenes/${o.id}`} className="relative flex items-center gap-3 overflow-hidden rounded-md border border-linea bg-superficie p-4 pl-5 hover:border-tenue">
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: p?.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-cond text-lg font-semibold">{nombreTipo(o.tipo)} <span className="cifra text-sm font-medium text-tenue">{o.numero}</span></p>
          <p className="truncate">{o.contacto_nombre}</p>
          <p className="truncate text-sm text-tenue">{[o.direccion, o.comuna].filter(Boolean).join(', ')}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
            <InsigniaOrden estado={o.estado} />
            <span className="text-tenue">{o.cerrada_en ? `Cerrada ${formatearFechaHora(o.cerrada_en)}` : o.fecha_programada ? formatearFechaHora(o.fecha_programada) : 'Sin fecha'}</span>
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-tenue" aria-hidden />
      </Link>
    </li>
  );
}

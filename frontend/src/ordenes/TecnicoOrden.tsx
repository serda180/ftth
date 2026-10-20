import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { mensajeError } from '../lib/errores';
import { formatearFechaHora } from '../lib/formato';
import { Aviso, Boton, Cargando } from '../components/ui';
import { cambiarEstado, nombreTipo, obtenerOrden } from './api';
import { AccionesContacto, CierreOrden, DatosCierre, FotosOrden, InsigniaOrden, InsigniaPrioridad, MaterialesOrden, ResumenContacto } from './componentes';

/** Orden en el teléfono del técnico: llegar, avanzar, fotografiar, registrar y cerrar. */
export function TecnicoOrden() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ordenes', 'ficha', id], queryFn: () => obtenerOrden(id) });
  const [cerrada, setCerrada] = useState<string | null>(null);
  const avanzar = useMutation({
    mutationFn: (estado: 'en_camino' | 'en_ejecucion') => cambiarEstado(id, estado),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ordenes'] }),
  });

  if (q.isPending) return <Cargando />;
  if (q.isError) return <Aviso tipo="error">{mensajeError(q.error)}</Aviso>;
  const o = q.data;
  if (!o) return <Aviso tipo="error">La orden no existe o no está asignada a usted.</Aviso>;
  const abierta = !['completada', 'cancelada'].includes(o.estado);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Link to="/mis-ordenes" className="inline-flex items-center gap-1 text-acento"><ArrowLeft className="size-4" aria-hidden /> Mis órdenes</Link>
      <header>
        <p className="cifra text-sm text-tenue">{o.numero}</p>
        <h1 className="font-cond text-2xl font-semibold">{nombreTipo(o.tipo)}</h1>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm"><InsigniaOrden estado={o.estado} /> <span>Prioridad <InsigniaPrioridad prioridad={o.prioridad} /></span></p>
        {o.fecha_programada && <p className="text-sm text-tenue">Programada {formatearFechaHora(o.fecha_programada)}</p>}
      </header>

      {cerrada && (
        <Aviso tipo="exito">
          <span className="flex items-center gap-1.5"><CircleCheck className="size-4" aria-hidden /> {cerrada}</span>
        </Aviso>
      )}

      <ResumenContacto o={o} />
      <AccionesContacto o={o} />
      <p className="whitespace-pre-line rounded-md bg-fondo p-3">{o.descripcion}</p>

      {abierta && (
        <div className="flex flex-col gap-2">
          {o.estado === 'asignada' && (
            <Boton className="min-h-14 text-lg" cargando={avanzar.isPending} onClick={() => avanzar.mutate('en_camino')}>Voy en camino</Boton>
          )}
          {(o.estado === 'asignada' || o.estado === 'en_camino') && (
            <Boton variante={o.estado === 'en_camino' ? 'primario' : 'secundario'} className="min-h-14 text-lg" cargando={avanzar.isPending}
              onClick={() => avanzar.mutate('en_ejecucion')}>
              Llegué, iniciar trabajo
            </Boton>
          )}
          {avanzar.isError && <Aviso tipo="error">{mensajeError(avanzar.error)}</Aviso>}
        </div>
      )}

      <FotosOrden ordenId={o.id} puedeSubir={abierta} />
      <MaterialesOrden ordenId={o.id} puedeRegistrar={abierta} />

      {abierta && o.estado === 'en_ejecucion' && (
        <CierreOrden
          o={o}
          alCerrar={async (r) => {
            setCerrada(r.cliente_id ? 'Orden cerrada. El cliente quedó activo.' : 'Orden cerrada.');
            await qc.invalidateQueries({ queryKey: ['ordenes'] });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
      {abierta && o.estado !== 'en_ejecucion' && (
        <p className="text-sm text-tenue">Para cerrar la orden, primero inicie el trabajo.</p>
      )}
      {!abierta && <DatosCierre o={o} />}
    </div>
  );
}

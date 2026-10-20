import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { mensajeError } from '../lib/errores';
import { formatearFechaHora } from '../lib/formato';
import { Aviso, Boton, Campo, Cargando, Selector } from '../components/ui';
import { asignarOrden, cambiarEstado, nombreTipo, obtenerOrden, tecnicosActivos, type OrdenVista } from './api';
import { AccionesContacto, CierreOrden, DatosCierre, FotosOrden, InsigniaOrden, InsigniaPrioridad, MaterialesOrden, ResumenContacto } from './componentes';

/** Ficha de la orden para oficina (asignación, seguimiento y cierre). */
export function FichaOrden() {
  const { id = '' } = useParams();
  const { roles } = useAuth();
  const gestion = tieneRol(roles, 'supervisor_red', 'atencion_cliente');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ordenes', 'ficha', id], queryFn: () => obtenerOrden(id) });
  const [cerrando, setCerrando] = useState(false);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['ordenes'] });

  const cancelar = useMutation({
    mutationFn: (motivo: string) => cambiarEstado(id, 'cancelada', motivo),
    onSuccess: refrescar,
  });

  if (q.isPending) return <Cargando />;
  if (q.isError) return <Aviso tipo="error">{mensajeError(q.error)}</Aviso>;
  const o = q.data;
  if (!o) return <Aviso tipo="error">La orden no existe o no tiene acceso.</Aviso>;
  const abierta = !['completada', 'cancelada'].includes(o.estado);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="cifra text-tenue">{o.numero}</p>
          <h1 className="font-cond text-[28px] font-semibold leading-tight">{nombreTipo(o.tipo)}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3"><InsigniaOrden estado={o.estado} /> <span>Prioridad <InsigniaPrioridad prioridad={o.prioridad} /></span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.cliente_id && <Link to={`/clientes/${o.cliente_id}`} className="rounded-md border border-linea bg-superficie px-3 py-2 font-medium hover:border-tenue">Cliente {o.cliente_codigo}</Link>}
          {o.solicitud_id && <Link to={`/solicitudes/${o.solicitud_id}`} className="rounded-md border border-linea bg-superficie px-3 py-2 font-medium hover:border-tenue">Solicitud {o.solicitud_numero}</Link>}
          {gestion && abierta && (
            <Boton variante="peligro" cargando={cancelar.isPending} onClick={() => {
              const motivo = window.prompt('Motivo de la cancelación:');
              if (motivo && motivo.trim()) cancelar.mutate(motivo.trim());
            }}>Cancelar orden</Boton>
          )}
        </div>
      </header>
      {cancelar.isError && <div className="mb-4"><Aviso tipo="error">{mensajeError(cancelar.error)}</Aviso></div>}

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <ResumenContacto o={o} />
            <AccionesContacto o={o} />
            <p className="whitespace-pre-line">{o.descripcion}</p>
            {o.observaciones && <p className="text-sm text-tenue">Observaciones: {o.observaciones}</p>}
            <p className="text-sm text-tenue">
              Creada {formatearFechaHora(o.creado_en)}
              {o.iniciada_en && ` · iniciada ${formatearFechaHora(o.iniciada_en)}`}
            </p>
          </section>
          {gestion && abierta && <Asignacion o={o} alCambiar={refrescar} />}
          {!abierta && <DatosCierre o={o} />}
        </div>
        <div className="flex flex-col gap-8">
          <FotosOrden ordenId={o.id} puedeSubir={abierta} />
          <MaterialesOrden ordenId={o.id} puedeRegistrar={false} />
          {gestion && abierta && o.tecnico_id && (
            cerrando ? (
              <CierreOrden o={o} alCerrar={() => { setCerrando(false); void refrescar(); void qc.invalidateQueries({ queryKey: ['solicitudes'] }); void qc.invalidateQueries({ queryKey: ['clientes'] }); }} />
            ) : (
              <div>
                <Boton variante="secundario" onClick={() => setCerrando(true)}>Cerrar orden en nombre del técnico</Boton>
                <p className="mt-1 text-sm text-tenue">Normalmente la cierra el técnico desde su teléfono.</p>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}

function Asignacion({ o, alCambiar }: { o: OrdenVista; alCambiar: () => void }) {
  const tecnicos = useQuery({ queryKey: ['ordenes', 'tecnicos'], queryFn: tecnicosActivos });
  const [tecnico, setTecnico] = useState(o.tecnico_id ?? '');
  const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const [fecha, setFecha] = useState(local(o.fecha_programada));
  const guardar = useMutation({
    mutationFn: () => asignarOrden(o.id, tecnico || null, fecha ? new Date(fecha).toISOString() : null),
    onSuccess: alCambiar,
  });
  const cambio = tecnico !== (o.tecnico_id ?? '') || fecha !== local(o.fecha_programada);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-cond text-xl font-semibold">Asignación</h2>
      <div className="grid grid-cols-2 gap-3">
        <Selector id="as-tec" etiqueta="Técnico" value={tecnico} vacio="Sin técnico" onChange={(e) => setTecnico(e.target.value)}
          opciones={(tecnicos.data ?? []).map((t) => ({ valor: t.id, texto: `${t.nombre} (${t.abiertas} abiertas)` }))} />
        <Campo id="as-fecha" etiqueta="Fecha y hora" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
      <Boton className="self-start" disabled={!cambio} cargando={guardar.isPending} onClick={() => guardar.mutate()}>Guardar asignación</Boton>
    </section>
  );
}

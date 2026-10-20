import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { CircleCheck, CircleHelp, CircleX, ClipboardCheck, Pencil, TriangleAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { mensajeError } from '../lib/errores';
import { formatearRut } from '../lib/rut';
import { formatearFechaHora, formatearTelefono } from '../lib/formato';
import { AreaTexto, Aviso, Boton, Campo, Cargando, DatoFicha, Insignia, Selector } from '../components/ui';
import { MiniMapa } from '../components/MiniMapa';
import { cargarPlanesYComunas } from '../clientes/api';
import { formatearDistancia } from '../mapa/geo';
import { supabase } from '../lib/supabase';
import { PRIORIDADES, nombreEstadoOrden, tecnicosActivos } from '../ordenes/api';
import {
  ESTADOS_SOLICITUD,
  cancelarSolicitud,
  decidirFactibilidad,
  evaluarFactibilidad,
  generarOrden,
  liberarReserva,
  obtenerSolicitud,
  puertosLibres,
  reservarPuerto,
  type Factibilidad,
  type SolicitudVista,
} from './api';

export function FichaSolicitud() {
  const { id = '' } = useParams();
  const { roles } = useAuth();
  const esSupervisor = tieneRol(roles, 'supervisor_red');
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['solicitudes', 'ficha', id], queryFn: () => obtenerSolicitud(id) });
  const catalogos = useQuery({ queryKey: ['clientes', 'catalogos'], queryFn: cargarPlanesYComunas, staleTime: 5 * 60_000 });
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);

  const refrescar = () => qc.invalidateQueries({ queryKey: ['solicitudes'] });

  const cancelar = useMutation({
    mutationFn: (motivo: string) => cancelarSolicitud(id, motivo),
    onSuccess: async () => {
      setAviso({ tipo: 'exito', texto: 'Solicitud cancelada.' });
      await refrescar();
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  if (s.isPending) return <Cargando />;
  if (s.isError) return <Aviso tipo="error">{mensajeError(s.error)}</Aviso>;
  const sol = s.data;
  if (!sol) return <Aviso tipo="error">La solicitud no existe o no tiene acceso.</Aviso>;
  const e = ESTADOS_SOLICITUD.find((x) => x.valor === sol.estado);
  const cerrada = sol.estado === 'activada' || sol.estado === 'cancelada';

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="cifra text-tenue">{sol.numero}</p>
          <h1 className="font-cond text-[28px] font-semibold leading-tight">{sol.nombre}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3">
            <Insignia color={e?.color ?? '#999'}>{e?.nombre ?? sol.estado}</Insignia>
            {sol.es_demo && <span className="rounded bg-f-amarillo/25 px-2 text-sm">Dato de demostración</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!cerrada && (
            <Link to={`/solicitudes/${sol.id}/editar`} className="inline-flex items-center gap-1.5 rounded-md border border-linea bg-superficie px-3 py-2 text-[15px] font-medium hover:border-tenue">
              <Pencil className="size-4" aria-hidden /> Editar datos
            </Link>
          )}
          {!cerrada && (
            <Boton variante="peligro" cargando={cancelar.isPending} onClick={() => {
              const motivo = window.prompt('Motivo de la cancelación:');
              if (motivo && motivo.trim()) cancelar.mutate(motivo.trim());
            }}>
              Cancelar solicitud
            </Boton>
          )}
          {sol.cliente_id && (
            <Link to={`/clientes/${sol.cliente_id}`} className="inline-flex items-center gap-1.5 rounded-md bg-acento px-3 py-2 text-[15px] font-semibold text-white">
              Ver cliente
            </Link>
          )}
        </div>
      </header>

      {aviso && <div className="mb-4"><Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso></div>}

      <Pasos estado={sol.estado} />

      <div className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 font-cond text-xl font-semibold">Datos</h2>
          <dl>
            <DatoFicha etiqueta="RUT">{sol.rut ? formatearRut(sol.rut) : <span className="text-alerta">Falta (se exige para la orden)</span>}</DatoFicha>
            <DatoFicha etiqueta="Teléfono">{sol.telefono ? formatearTelefono(sol.telefono) : null}</DatoFicha>
            <DatoFicha etiqueta="WhatsApp">{sol.whatsapp ? formatearTelefono(sol.whatsapp) : null}</DatoFicha>
            <DatoFicha etiqueta="Correo">{sol.email}</DatoFicha>
            <DatoFicha etiqueta="Dirección">
              {[sol.direccion_calle, sol.direccion_numero, sol.direccion_depto].filter(Boolean).join(' ')}
              {sol.comuna && <span className="text-tenue">, {sol.comuna}</span>}
            </DatoFicha>
            <DatoFicha etiqueta="Referencia">{sol.referencia}</DatoFicha>
            <DatoFicha etiqueta="Plan">{sol.plan ?? <span className="text-alerta">Sin definir (se exige para la orden)</span>}</DatoFicha>
            <DatoFicha etiqueta="Recibida">{formatearFechaHora(sol.creado_en)}</DatoFicha>
            <DatoFicha etiqueta="Observaciones">{sol.observaciones}</DatoFicha>
            {sol.motivo_decision && <DatoFicha etiqueta="Motivo / nota">{sol.motivo_decision}</DatoFicha>}
          </dl>
          {sol.lng != null && sol.lat != null && catalogos.data ? (
            <div className="mt-4"><MiniMapa valor={{ lng: sol.lng, lat: sol.lat }} centro={catalogos.data.centro} alto={240} /></div>
          ) : (
            <p className="mt-4 text-alerta">Sin ubicación: edite la solicitud y márquela en el mapa para evaluar la factibilidad.</p>
          )}
        </section>

        <section className="flex flex-col gap-8">
          {['nueva', 'en_factibilidad', 'pendiente_info', 'factible', 'no_factible'].includes(sol.estado) && (
            <SeccionFactibilidad sol={sol} esSupervisor={esSupervisor} alCambiar={refrescar} />
          )}
          {sol.factibilidad && !['nueva', 'en_factibilidad', 'pendiente_info', 'factible', 'no_factible'].includes(sol.estado) && (
            <div>
              <h2 className="mb-2 font-cond text-xl font-semibold">Factibilidad</h2>
              <p className="text-sm text-tenue">
                Aprobada por {sol.evaluado_por_nombre ?? 'un supervisor'} el {formatearFechaHora(sol.evaluado_en)}.
              </p>
            </div>
          )}
          {(sol.estado === 'factible' || sol.estado === 'puerto_reservado') && (
            <SeccionReserva sol={sol} alCambiar={refrescar} />
          )}
          {sol.estado === 'puerto_reservado' && <SeccionOrden sol={sol} alCambiar={refrescar} />}
          {['orden_generada', 'activada', 'puerto_reservado'].includes(sol.estado) && <OrdenesDeSolicitud id={sol.id} />}
        </section>
      </div>
    </>
  );
}

const PASOS = [
  { estados: ['nueva', 'en_factibilidad', 'pendiente_info'], texto: 'Factibilidad' },
  { estados: ['factible'], texto: 'Reserva de puerto' },
  { estados: ['puerto_reservado'], texto: 'Orden de instalación' },
  { estados: ['orden_generada', 'instalada'], texto: 'Instalación' },
  { estados: ['activada'], texto: 'Servicio activo' },
];

/** Avance del flujo de la solicitud. */
function Pasos({ estado }: { estado: string }) {
  if (estado === 'cancelada' || estado === 'no_factible') return null;
  const actual = PASOS.findIndex((p) => p.estados.includes(estado));
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 text-sm" aria-label="Avance de la solicitud">
      {PASOS.map((p, i) => (
        <li key={p.texto} className="flex items-center gap-1">
          <span
            className={`rounded px-2 py-1 ${i < actual ? 'bg-ok/10 text-ok' : i === actual ? 'bg-chaqueta font-semibold text-white' : 'bg-fondo text-tenue'}`}
            aria-current={i === actual ? 'step' : undefined}
          >
            {i + 1}. {p.texto}
          </span>
          {i < PASOS.length - 1 && <span className="text-tenue" aria-hidden>›</span>}
        </li>
      ))}
    </ol>
  );
}

function SeccionFactibilidad({ sol, esSupervisor, alCambiar }: { sol: SolicitudVista; esSupervisor: boolean; alCambiar: () => void }) {
  const [resultado, setResultado] = useState<Factibilidad | null>(sol.factibilidad);
  const [nap, setNap] = useState<string | null>(sol.nap_id);
  const [motivo, setMotivo] = useState('');
  const evaluar = useMutation({ mutationFn: () => evaluarFactibilidad(sol.id), onSuccess: setResultado });
  const decidir = useMutation({
    mutationFn: (d: 'factible' | 'no_factible' | 'pendiente_info') => decidirFactibilidad(sol.id, d, motivo, d === 'factible' ? nap : null),
    onSuccess: alCambiar,
  });
  const icono = { factible: CircleCheck, revisar: CircleHelp, no_factible: CircleX };

  return (
    <div>
      <h2 className="mb-2 font-cond text-xl font-semibold">Factibilidad técnica</h2>
      <Boton variante={resultado ? 'secundario' : 'primario'} className="px-3 py-1.5 text-sm" cargando={evaluar.isPending}
        disabled={sol.lng == null} onClick={() => evaluar.mutate()}>
        {resultado ? 'Volver a analizar' : 'Analizar factibilidad'}
      </Boton>
      {evaluar.isError && <div className="mt-2"><Aviso tipo="error">{mensajeError(evaluar.error)}</Aviso></div>}

      {resultado && (() => {
        const Icono = icono[resultado.recomendacion];
        const color = resultado.recomendacion === 'factible' ? 'text-ok' : resultado.recomendacion === 'revisar' ? 'text-alerta' : 'text-error';
        return (
          <div className="mt-4">
            <p className={`flex items-center gap-2 text-lg font-semibold ${color}`}>
              <Icono className="size-5" aria-hidden />
              {{ factible: 'Recomendación: factible', revisar: 'Recomendación: revisar', no_factible: 'Recomendación: sin NAP cercana' }[resultado.recomendacion]}
            </p>
            {resultado.fuera_de_cobertura && <p className="text-sm text-alerta">La ubicación está fuera de las zonas de cobertura registradas.</p>}
            <ul className="mt-3 flex flex-col gap-2">
              {resultado.naps.map((n) => (
                <li key={n.id}>
                  <label className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${nap === n.id ? 'border-acento ring-2 ring-acento/20' : 'border-linea'}`}>
                    {esSupervisor && <input type="radio" name="nap-factible" className="mt-1" checked={nap === n.id} onChange={() => setNap(n.id)} />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{n.codigo} <span className="text-sm font-normal text-tenue">splitter {n.ratio}</span></span>
                        <span className="cifra text-sm">{formatearDistancia(n.distancia_m)}</span>
                      </span>
                      <span className="cifra block text-sm text-tenue">
                        {n.libres}/{n.capacidad} libres · pérdida estimada {n.perdida_estimada_db.toLocaleString('es-CL')} dB · margen {n.margen_db.toLocaleString('es-CL')} dB
                      </span>
                      {n.advertencias.map((a) => (
                        <span key={a} className="flex items-start gap-1 text-sm text-alerta">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {a}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-tenue">
              {resultado.aviso} Máximo de acometida {resultado.parametros.distancia_max_m} m, presupuesto óptico {resultado.parametros.presupuesto_db} dB.
            </p>
          </div>
        );
      })()}

      {esSupervisor && resultado && (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-linea p-3">
          <AreaTexto id="motivo-fact" etiqueta="Nota de la decisión (obligatoria si no es factible)" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Boton className="px-3 py-1.5 text-sm" disabled={!nap} cargando={decidir.isPending && decidir.variables === 'factible'} onClick={() => decidir.mutate('factible')}>
              Aprobar con la NAP elegida
            </Boton>
            <Boton variante="secundario" className="px-3 py-1.5 text-sm" cargando={decidir.isPending && decidir.variables === 'pendiente_info'} onClick={() => decidir.mutate('pendiente_info')}>
              Falta información
            </Boton>
            <Boton variante="peligro" className="px-3 py-1.5 text-sm" disabled={!motivo.trim()} cargando={decidir.isPending && decidir.variables === 'no_factible'} onClick={() => decidir.mutate('no_factible')}>
              No factible
            </Boton>
          </div>
          {decidir.isError && <Aviso tipo="error">{mensajeError(decidir.error)}</Aviso>}
        </div>
      )}
      {!esSupervisor && sol.estado !== 'factible' && (
        <p className="mt-3 text-sm text-tenue">La decisión de factibilidad la toma un supervisor de red.</p>
      )}
    </div>
  );
}

function SeccionReserva({ sol, alCambiar }: { sol: SolicitudVista; alCambiar: () => void }) {
  const puertos = useQuery({
    queryKey: ['solicitudes', 'puertos', sol.nap_id],
    queryFn: () => puertosLibres(sol.nap_id!),
    enabled: !!sol.nap_id && sol.estado === 'factible',
  });
  const reservar = useMutation({ mutationFn: (p: string) => reservarPuerto(sol.id, p), onSuccess: alCambiar });
  const liberar = useMutation({ mutationFn: () => liberarReserva(sol.id), onSuccess: alCambiar });

  return (
    <div>
      <h2 className="mb-2 font-cond text-xl font-semibold">Puerto</h2>
      {sol.estado === 'puerto_reservado' ? (
        <>
          <p className="text-lg">
            {sol.nap_codigo}, puerto <span className="cifra font-semibold">{sol.puerto_reservado}</span> reservado
          </p>
          {sol.reserva_vence_en && <p className="text-sm text-tenue">La reserva vence el {formatearFechaHora(sol.reserva_vence_en)} si no se genera la orden.</p>}
          <Boton variante="secundario" className="mt-2 px-3 py-1.5 text-sm" cargando={liberar.isPending} onClick={() => liberar.mutate()}>
            Liberar reserva
          </Boton>
          {liberar.isError && <Aviso tipo="error">{mensajeError(liberar.error)}</Aviso>}
        </>
      ) : (
        <>
          <p className="mb-2 text-sm text-tenue">Elija un puerto libre de {sol.nap_codigo} para reservarlo.</p>
          {puertos.isPending && <Cargando />}
          {puertos.data?.length === 0 && <p className="text-error">{sol.nap_codigo} no tiene puertos libres. Vuelva a evaluar con otra NAP.</p>}
          <ul className="grid grid-cols-8 gap-1.5">
            {puertos.data?.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={reservar.isPending} onClick={() => reservar.mutate(p.id)}
                  className="cifra grid aspect-square w-full place-items-center rounded bg-[#cfd7dc] text-sm font-semibold hover:bg-acento hover:text-white disabled:opacity-50">
                  {p.numero}
                </button>
              </li>
            ))}
          </ul>
          {reservar.isError && <div className="mt-2"><Aviso tipo="error">{mensajeError(reservar.error)}</Aviso></div>}
        </>
      )}
    </div>
  );
}

function SeccionOrden({ sol, alCambiar }: { sol: SolicitudVista; alCambiar: () => void }) {
  const qc = useQueryClient();
  const tecnicos = useQuery({ queryKey: ['ordenes', 'tecnicos'], queryFn: tecnicosActivos });
  const [tecnico, setTecnico] = useState('');
  const [fecha, setFecha] = useState('');
  const [prioridad, setPrioridad] = useState('media');
  const [descripcion, setDescripcion] = useState('');
  const generar = useMutation({
    mutationFn: () => generarOrden(sol.id, tecnico || null, fecha ? new Date(fecha).toISOString() : null, prioridad, descripcion),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ordenes'] });
      alCambiar();
    },
  });
  const faltan = [!sol.rut && 'RUT', !sol.plan_id && 'plan'].filter(Boolean);

  return (
    <div>
      <h2 className="mb-2 font-cond text-xl font-semibold">Orden de instalación</h2>
      {faltan.length > 0 ? (
        <p className="text-alerta">Antes de generar la orden, complete {faltan.join(' y ')} en «Editar datos».</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Selector id="ot-tecnico" etiqueta="Técnico" value={tecnico} vacio="Asignar después" onChange={(e) => setTecnico(e.target.value)}
              opciones={(tecnicos.data ?? []).map((t) => ({ valor: t.id, texto: `${t.nombre} (${t.abiertas} abiertas)` }))} />
            <Campo id="ot-fecha" etiqueta="Fecha y hora" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <Selector id="ot-prio" etiqueta="Prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}
            opciones={PRIORIDADES.map((p) => ({ valor: p.valor, texto: p.nombre }))} />
          <AreaTexto id="ot-desc" etiqueta="Indicaciones para el técnico" rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          {generar.isError && <Aviso tipo="error">{mensajeError(generar.error)}</Aviso>}
          <Boton className="self-start" cargando={generar.isPending} onClick={() => generar.mutate()}>
            <ClipboardCheck className="size-4" aria-hidden /> Generar orden
          </Boton>
        </div>
      )}
    </div>
  );
}

function OrdenesDeSolicitud({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['ordenes', 'de-solicitud', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_vista')
        .select('id, numero, estado, tecnico_nombre, fecha_programada, resultado_pruebas')
        .eq('solicitud_id', id)
        .order('creado_en', { ascending: false });
      if (error) throw error;
      return data as { id: string; numero: string; estado: string; tecnico_nombre: string | null; fecha_programada: string | null; resultado_pruebas: string | null }[];
    },
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 font-cond text-xl font-semibold">Órdenes</h2>
      <ul className="flex flex-col gap-2">
        {q.data.map((o) => (
          <li key={o.id} className="rounded-md border border-linea px-3 py-2">
            <Link to={`/ordenes/${o.id}`} className="font-medium text-acento hover:underline">{o.numero}</Link>{' '}
            <span className="text-sm text-tenue">
              {nombreEstadoOrden(o.estado)}
              {o.tecnico_nombre && ` · ${o.tecnico_nombre}`}
              {o.fecha_programada && ` · ${formatearFechaHora(o.fecha_programada)}`}
            </span>
            {o.resultado_pruebas && <p className="text-sm">{o.resultado_pruebas}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { MapPin, MessageCircle, Pencil, Phone, Plug, Unplug } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { tieneRol } from '../lib/roles';
import { mensajeError } from '../lib/errores';
import { formatearRut } from '../lib/rut';
import { formatearClp, formatearFecha, formatearFechaHora, formatearTelefono } from '../lib/formato';
import { AreaTexto, Aviso, Boton, Cargando, DatoFicha, Selector } from '../components/ui';
import { MiniMapa } from '../components/MiniMapa';
import { RutaCadena } from '../red/RutaCadena';
import { rutaCliente } from '../red/api';
import { formatearDistancia } from '../mapa/geo';
import { InsigniaCliente } from './ListaClientes';
import {
  ESTADOS_CLIENTE,
  agregarNota,
  asignarPuerto,
  cambiarEstadoCliente,
  cargarPlanesYComunas,
  coordenadasCliente,
  historialCliente,
  liberarPuerto,
  napsCercanas,
  obtenerCliente,
  type EstadoCliente,
  type NapCercana,
} from './api';

export function FichaCliente() {
  const { id = '' } = useParams();
  const { roles, session } = useAuth();
  const puedeEditar = tieneRol(roles, 'atencion_cliente');
  const puedeAsignar = tieneRol(roles, 'atencion_cliente', 'supervisor_red');
  const puedeNotas = tieneRol(roles, 'atencion_cliente', 'supervisor_red', 'tecnico');
  const qc = useQueryClient();

  const cliente = useQuery({ queryKey: ['clientes', 'detalle-ficha', id], queryFn: () => obtenerCliente(id) });
  const coords = useQuery({ queryKey: ['clientes', 'coords', id], queryFn: () => coordenadasCliente(id) });
  const ruta = useQuery({ queryKey: ['clientes', 'ruta', id], queryFn: () => rutaCliente(id) });
  const catalogos = useQuery({ queryKey: ['clientes', 'catalogos'], queryFn: cargarPlanesYComunas, staleTime: 5 * 60_000 });
  const [asignando, setAsignando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);

  const refrescar = () => qc.invalidateQueries({ queryKey: ['clientes'] });

  const liberar = useMutation({
    mutationFn: () => liberarPuerto(id),
    onSuccess: async () => {
      setAviso({ tipo: 'exito', texto: 'Puerto liberado.' });
      await refrescar();
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  const estado = useMutation({
    mutationFn: (e: EstadoCliente) => cambiarEstadoCliente(id, e),
    onSuccess: async () => {
      setAviso({ tipo: 'exito', texto: 'Estado actualizado.' });
      await refrescar();
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeError(e) }),
  });

  if (cliente.isPending) return <Cargando />;
  if (cliente.isError) return <Aviso tipo="error">{mensajeError(cliente.error)}</Aviso>;
  const c = cliente.data;
  if (!c) return <Aviso tipo="error">El cliente no existe o su rol no permite verlo.</Aviso>;

  const direccion = [c.direccion_calle, c.direccion_numero, c.direccion_depto].filter(Boolean).join(' ');

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="cifra text-tenue">{c.codigo}</p>
          <h1 className="font-cond text-[28px] font-semibold leading-tight">{c.nombre}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <InsigniaCliente estado={c.estado} />
            <span className="text-tenue">RUT {formatearRut(c.rut)}</span>
            {c.es_demo && <span className="rounded bg-f-amarillo/25 px-2 py-0.5 text-sm">Dato de demostración</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.telefono && (
            <a href={`tel:${c.telefono}`} className="inline-flex items-center gap-1.5 rounded-md border border-linea bg-superficie px-3 py-2 text-[15px] font-medium hover:border-tenue">
              <Phone className="size-4" aria-hidden /> Llamar
            </a>
          )}
          {c.whatsapp && (
            <a href={`https://wa.me/${c.whatsapp.replace('+', '')}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-linea bg-superficie px-3 py-2 text-[15px] font-medium hover:border-tenue">
              <MessageCircle className="size-4" aria-hidden /> WhatsApp
            </a>
          )}
          {puedeAsignar && c.estado !== 'retirado' && (
            <Link to={`/ordenes/nueva?cliente=${c.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-linea bg-superficie px-3 py-2 text-[15px] font-medium hover:border-tenue">
              Nueva orden
            </Link>
          )}
          {puedeEditar && (
            <Link to={`/clientes/${c.id}/editar`} className="inline-flex items-center gap-1.5 rounded-md bg-acento px-3 py-2 text-[15px] font-semibold text-white hover:bg-acento-osc">
              <Pencil className="size-4" aria-hidden /> Editar
            </Link>
          )}
        </div>
      </header>

      {aviso && <div className="mb-4"><Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso></div>}

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 font-cond text-xl font-semibold">Contacto y servicio</h2>
          <dl>
            <DatoFicha etiqueta="Teléfono">{c.telefono ? formatearTelefono(c.telefono) : null}</DatoFicha>
            <DatoFicha etiqueta="WhatsApp">{c.whatsapp ? formatearTelefono(c.whatsapp) : null}</DatoFicha>
            <DatoFicha etiqueta="Correo">{c.email}</DatoFicha>
            <DatoFicha etiqueta="Dirección">{direccion}{c.comuna && <span className="text-tenue">, {c.comuna}</span>}</DatoFicha>
            <DatoFicha etiqueta="Referencia">{c.referencia}</DatoFicha>
            <DatoFicha etiqueta="Plan">{c.plan}</DatoFicha>
            <DatoFicha etiqueta="Precio mensual"><span className="cifra">{formatearClp(c.precio_efectivo_clp)}</span></DatoFicha>
            <DatoFicha etiqueta="Contratación">{c.fecha_contratacion ? formatearFecha(c.fecha_contratacion) : null}</DatoFicha>
            <DatoFicha etiqueta="Contrato">{c.numero_contrato}</DatoFicha>
            <DatoFicha etiqueta="Serie ONT">{c.numero_serie_ont}</DatoFicha>
            <DatoFicha etiqueta="Observaciones">{c.observaciones}</DatoFicha>
          </dl>
          {puedeEditar && (
            <div className="mt-4 max-w-xs">
              <Selector
                id="estado-cliente"
                etiqueta="Cambiar estado"
                value={c.estado}
                disabled={estado.isPending}
                onChange={(e) => {
                  const nuevo = e.target.value as EstadoCliente;
                  const aviso = nuevo === 'retirado' && c.nap_puerto_id
                    ? ' Su puerto de NAP quedará libre.'
                    : '';
                  if (window.confirm(`¿Cambiar a «${ESTADOS_CLIENTE.find((x) => x.valor === nuevo)?.nombre}»?${aviso}`)) {
                    estado.mutate(nuevo);
                  }
                }}
                opciones={ESTADOS_CLIENTE.map((x) => ({ valor: x.valor, texto: x.nombre }))}
              />
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-cond text-xl font-semibold">Conexión a la red</h2>
          {c.nap_puerto_id ? (
            <p className="text-lg">
              <Link to={`/mapa?elemento=${c.nap_id}`} className="text-acento hover:underline">{c.nap_codigo}</Link>,
              puerto <span className="cifra font-semibold">{c.puerto}</span>
            </p>
          ) : (
            <p className="text-tenue">{c.estado === 'retirado' ? 'Cliente retirado, sin puerto.' : 'Sin puerto de NAP asignado.'}</p>
          )}
          {puedeAsignar && c.estado !== 'retirado' && !asignando && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Boton variante={c.nap_puerto_id ? 'secundario' : 'primario'} className="px-3 py-1.5 text-sm"
                disabled={!coords.data} onClick={() => setAsignando(true)}>
                <Plug className="size-4" aria-hidden /> {c.nap_puerto_id ? 'Cambiar de puerto' : 'Asignar puerto'}
              </Boton>
              {c.nap_puerto_id && (
                <Boton variante="peligro" className="px-3 py-1.5 text-sm" cargando={liberar.isPending}
                  onClick={() => window.confirm('¿Liberar el puerto de este cliente?') && liberar.mutate()}>
                  {!liberar.isPending && <Unplug className="size-4" aria-hidden />} Liberar puerto
                </Boton>
              )}
              {!coords.data && <p className="w-full text-sm text-tenue">Registre la ubicación del cliente para buscar NAP cercanas.</p>}
            </div>
          )}
          {asignando && coords.data && catalogos.data && (
            <AsignarPuerto
              clienteId={c.id}
              punto={coords.data}
              distanciaMax={catalogos.data.distanciaMaxAcometida}
              alTerminar={async (texto) => {
                setAsignando(false);
                if (texto) {
                  setAviso({ tipo: 'exito', texto });
                  await refrescar();
                }
              }}
            />
          )}

          <h3 className="mb-2 mt-6 font-cond text-lg font-semibold">Ruta registrada hasta la OLT</h3>
          {ruta.isPending ? <Cargando /> : ruta.data ? <RutaCadena camino={ruta.data} cliente={c.nombre} /> : null}

          {coords.data && catalogos.data && (
            <div className="mt-6">
              <MiniMapa
                valor={coords.data}
                centro={catalogos.data.centro}
                alto={240}
              />
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${coords.data.lat},${coords.data.lng}`}
                target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm text-acento hover:underline">
                <MapPin className="size-4" aria-hidden /> Cómo llegar
              </a>
            </div>
          )}
        </section>
      </div>

      <section className="mt-10 max-w-3xl">
        <h2 className="mb-3 font-cond text-xl font-semibold">Historial</h2>
        {puedeNotas && session && <NuevaNota clienteId={c.id} usuarioId={session.user.id} />}
        <Historial clienteId={c.id} />
      </section>
    </>
  );
}

function AsignarPuerto({
  clienteId,
  punto,
  distanciaMax,
  alTerminar,
}: {
  clienteId: string;
  punto: { lng: number; lat: number };
  distanciaMax: number;
  alTerminar: (mensaje: string | null) => void;
}) {
  const naps = useQuery({ queryKey: ['clientes', 'naps-cercanas', punto], queryFn: () => napsCercanas(punto.lng, punto.lat) });
  const [elegida, setElegida] = useState<NapCercana | null>(null);
  const asignar = useMutation({
    mutationFn: (p: { id: string; numero: number }) => asignarPuerto(clienteId, p.id),
    onSuccess: (_d, p) => alTerminar(`Puerto ${p.numero} de ${elegida?.codigo} asignado.`),
  });

  return (
    <div className="mt-3 rounded-md border border-linea bg-superficie p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">NAP cercanas</p>
        <button type="button" className="text-sm text-tenue hover:text-tinta" onClick={() => alTerminar(null)}>Cancelar</button>
      </div>
      {naps.isPending && <Cargando texto="Buscando NAP cercanas…" />}
      {naps.isError && <Aviso tipo="error">{mensajeError(naps.error)}</Aviso>}
      {naps.data?.length === 0 && <p className="text-tenue">No hay NAP registradas a menos de 600 m.</p>}
      <ul className="flex flex-col gap-2">
        {naps.data?.map((n) => {
          const lejos = n.distancia_m > distanciaMax;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setElegida(n)}
                aria-pressed={elegida?.id === n.id}
                className={`w-full rounded-md border px-3 py-2 text-left ${elegida?.id === n.id ? 'border-acento ring-2 ring-acento/20' : 'border-linea hover:border-tenue'}`}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{n.codigo}</span>
                  <span className="cifra text-sm">{formatearDistancia(n.distancia_m)} en línea recta</span>
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
                  <span className={n.libres === 0 ? 'text-error' : 'text-tenue'}>{n.libres} de {n.capacidad} libres</span>
                  {!n.ruta_completa && <span className="text-alerta">Sin ruta registrada a la OLT</span>}
                  {lejos && <span className="text-alerta">Supera {distanciaMax} m de acometida</span>}
                  {n.estado !== 'operativo' && <span className="text-alerta">{n.estado.replace('_', ' ')}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {elegida && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Puerto libre en {elegida.codigo}</p>
          {elegida.puertos_libres.length === 0 ? (
            <p className="text-error">La NAP está llena.</p>
          ) : (
            <ul className="grid grid-cols-8 gap-1.5">
              {elegida.puertos_libres.map((p) => (
                <li key={p.id}>
                  <button type="button" disabled={asignar.isPending} onClick={() => asignar.mutate(p)}
                    className="cifra grid aspect-square w-full place-items-center rounded bg-[#cfd7dc] text-sm font-semibold hover:bg-acento hover:text-white disabled:opacity-50">
                    {p.numero}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {asignar.isError && <div className="mt-2"><Aviso tipo="error">{mensajeError(asignar.error)}</Aviso></div>}
          <p className="mt-2 text-xs text-tenue">
            La disponibilidad y la distancia son referencias según los datos registrados; la factibilidad la confirma el técnico.
          </p>
        </div>
      )}
    </div>
  );
}

function NuevaNota({ clienteId, usuarioId }: { clienteId: string; usuarioId: string }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<'nota' | 'visita'>('nota');
  const guardar = useMutation({
    mutationFn: () => agregarNota(clienteId, tipo, texto, usuarioId),
    onSuccess: async () => {
      setTexto('');
      await qc.invalidateQueries({ queryKey: ['clientes', 'historial', clienteId] });
    },
  });
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (texto.trim().length >= 3) guardar.mutate();
  }
  return (
    <form onSubmit={enviar} className="mb-5 flex flex-col gap-2">
      <AreaTexto id="nota" etiqueta="Agregar al historial" value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="tipo-nota" checked={tipo === 'nota'} onChange={() => setTipo('nota')} /> Nota</label>
        <label className="flex items-center gap-1.5 text-sm"><input type="radio" name="tipo-nota" checked={tipo === 'visita'} onChange={() => setTipo('visita')} /> Visita</label>
        <Boton type="submit" variante="secundario" className="px-3 py-1.5 text-sm" cargando={guardar.isPending} disabled={texto.trim().length < 3}>
          Guardar
        </Boton>
      </div>
      {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
    </form>
  );
}

const TIPO_EVENTO: Record<string, string> = {
  creacion: 'Registro',
  cambio_estado: 'Estado',
  cambio_plan: 'Plan',
  cambio_precio: 'Precio',
  cambio_puerto: 'Puerto',
  instalacion: 'Instalación',
  visita: 'Visita',
  nota: 'Nota',
};

function Historial({ clienteId }: { clienteId: string }) {
  const q = useQuery({ queryKey: ['clientes', 'historial', clienteId], queryFn: () => historialCliente(clienteId) });
  if (q.isPending) return <Cargando />;
  if (q.isError) return <Aviso tipo="error">{mensajeError(q.error)}</Aviso>;
  if (q.data.length === 0) return <p className="text-tenue">Sin eventos.</p>;
  return (
    <ol className="flex flex-col">
      {q.data.map((ev) => (
        <li key={ev.id} className="grid grid-cols-[7.5rem_1fr] gap-3 border-t border-linea py-2.5">
          <p className="cifra text-sm text-tenue">{formatearFechaHora(ev.creado_en)}</p>
          <div>
            <p>
              <span className="mr-2 rounded bg-fondo px-1.5 py-0.5 text-xs font-medium">{TIPO_EVENTO[ev.tipo] ?? ev.tipo}</span>
              {ev.descripcion}
            </p>
            {ev.perfiles && <p className="text-sm text-tenue">{ev.perfiles.nombre_completo || ev.perfiles.email}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

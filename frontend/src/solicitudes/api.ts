// Solicitudes de instalación y factibilidad (migración 0013).
import { supabase } from '../lib/supabase';

export type EstadoSolicitud =
  | 'nueva'
  | 'en_factibilidad'
  | 'factible'
  | 'no_factible'
  | 'pendiente_info'
  | 'puerto_reservado'
  | 'orden_generada'
  | 'instalada'
  | 'activada'
  | 'cancelada';

export const ESTADOS_SOLICITUD: { valor: EstadoSolicitud; nombre: string; color: string }[] = [
  { valor: 'nueva', nombre: 'Nueva', color: 'var(--color-f-azul)' },
  { valor: 'en_factibilidad', nombre: 'En factibilidad', color: 'var(--color-f-azul)' },
  { valor: 'pendiente_info', nombre: 'Falta información', color: 'var(--color-alerta)' },
  { valor: 'factible', nombre: 'Factible', color: 'var(--color-ok)' },
  { valor: 'no_factible', nombre: 'No factible', color: 'var(--color-error)' },
  { valor: 'puerto_reservado', nombre: 'Puerto reservado', color: 'var(--color-f-amarillo)' },
  { valor: 'orden_generada', nombre: 'Orden generada', color: 'var(--color-f-violeta)' },
  { valor: 'instalada', nombre: 'Instalada', color: 'var(--color-ok)' },
  { valor: 'activada', nombre: 'Activada', color: 'var(--color-ok)' },
  { valor: 'cancelada', nombre: 'Cancelada', color: 'var(--color-f-gris)' },
];

export const CANALES = [
  { valor: 'telefono', nombre: 'Teléfono' },
  { valor: 'whatsapp', nombre: 'WhatsApp' },
  { valor: 'presencial', nombre: 'Presencial' },
  { valor: 'web', nombre: 'Web' },
  { valor: 'correo', nombre: 'Correo' },
  { valor: 'otro', nombre: 'Otro' },
];

export type NapFactibilidad = {
  id: string;
  codigo: string;
  estado: string;
  distancia_m: number;
  capacidad: number;
  libres: number;
  ratio: string;
  ruta_completa: boolean;
  perdida_estimada_db: number;
  margen_db: number;
  advertencias: string[];
  apta: boolean;
};

export type Factibilidad = {
  recomendacion: 'factible' | 'revisar' | 'no_factible';
  fuera_de_cobertura: boolean;
  naps: NapFactibilidad[];
  parametros: { distancia_max_m: number; presupuesto_db: number; atenuacion_db_km: number };
  evaluado_en: string;
  aviso: string;
};

export type SolicitudVista = {
  id: string;
  numero: string;
  estado: EstadoSolicitud;
  canal: string;
  nombre: string;
  rut: string | null;
  telefono: string | null;
  whatsapp: string | null;
  email: string | null;
  direccion_calle: string;
  direccion_numero: string | null;
  direccion_depto: string | null;
  comuna_id: number;
  comuna: string | null;
  referencia: string | null;
  lng: number | null;
  lat: number | null;
  plan_id: number | null;
  plan: string | null;
  cliente_id: string | null;
  nap_id: string | null;
  nap_codigo: string | null;
  puerto_reservado_id: string | null;
  puerto_reservado: number | null;
  reserva_vence_en: string | null;
  factibilidad: Factibilidad | null;
  motivo_decision: string | null;
  evaluado_por_nombre: string | null;
  evaluado_en: string | null;
  observaciones: string | null;
  es_demo: boolean;
  creado_en: string;
};

export const ABIERTAS: EstadoSolicitud[] = ['nueva', 'en_factibilidad', 'pendiente_info', 'factible', 'puerto_reservado', 'orden_generada'];

export async function listarSolicitudes(f: { texto: string; estado: string }, pagina: number, porPagina = 25) {
  let q = supabase.from('solicitudes_vista').select('*', { count: 'exact' });
  if (f.texto.trim()) q = q.ilike('texto_busqueda', `%${f.texto.trim().toLowerCase().replace(/[%,()]/g, ' ')}%`);
  if (f.estado === 'abiertas') q = q.in('estado', ABIERTAS);
  else if (f.estado) q = q.eq('estado', f.estado);
  const desde = pagina * porPagina;
  const { data, error, count } = await q.order('creado_en', { ascending: false }).range(desde, desde + porPagina - 1);
  if (error) throw error;
  return { filas: (data ?? []) as SolicitudVista[], total: count ?? 0 };
}

export async function obtenerSolicitud(id: string) {
  const { data, error } = await supabase.from('solicitudes_vista').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as SolicitudVista | null;
}

export type DatosSolicitud = {
  canal: string;
  nombre: string;
  rut: string;
  telefono: string;
  whatsapp: string;
  email: string;
  direccion_calle: string;
  direccion_numero: string;
  direccion_depto: string;
  comuna_id: number | null;
  referencia: string;
  plan_id: number | null;
  observaciones: string;
};

const nulo = (s: string) => (s.trim() === '' ? null : s.trim());

function aFila(d: DatosSolicitud, u: { lng: number; lat: number } | null) {
  return {
    canal: d.canal,
    nombre: d.nombre.trim(),
    rut: nulo(d.rut),
    telefono: nulo(d.telefono),
    whatsapp: nulo(d.whatsapp),
    email: nulo(d.email),
    direccion_calle: d.direccion_calle.trim(),
    direccion_numero: nulo(d.direccion_numero),
    direccion_depto: nulo(d.direccion_depto),
    comuna_id: d.comuna_id,
    referencia: nulo(d.referencia),
    plan_id: d.plan_id,
    observaciones: nulo(d.observaciones),
    ubicacion: u ? `SRID=4326;POINT(${u.lng} ${u.lat})` : null,
  };
}

export async function crearSolicitud(d: DatosSolicitud, u: { lng: number; lat: number } | null) {
  const { data, error } = await supabase.from('solicitudes').insert(aFila(d, u)).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function actualizarSolicitud(id: string, d: DatosSolicitud, u: { lng: number; lat: number } | null) {
  const { error } = await supabase.from('solicitudes').update(aFila(d, u)).eq('id', id);
  if (error) throw error;
}

async function rpc<T>(nombre: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, params);
  if (error) throw error;
  return data as T;
}

export const evaluarFactibilidad = (id: string) => rpc<Factibilidad>('evaluar_factibilidad', { p_solicitud_id: id });
export const decidirFactibilidad = (id: string, decision: 'factible' | 'no_factible' | 'pendiente_info', motivo: string, napId: string | null) =>
  rpc<null>('decidir_factibilidad', { p_solicitud_id: id, p_decision: decision, p_motivo: motivo || null, p_nap_id: napId });
export const reservarPuerto = (id: string, puertoId: string) =>
  rpc<null>('reservar_puerto', { p_solicitud_id: id, p_puerto_id: puertoId });
export const liberarReserva = (id: string) => rpc<null>('liberar_reserva', { p_solicitud_id: id });
export const generarOrden = (id: string, tecnico: string | null, fecha: string | null, prioridad: string, descripcion: string) =>
  rpc<string>('generar_orden_instalacion', {
    p_solicitud_id: id,
    p_tecnico_id: tecnico,
    p_fecha: fecha,
    p_prioridad: prioridad,
    p_descripcion: descripcion || null,
  });
export const cancelarSolicitud = (id: string, motivo: string) =>
  rpc<null>('cancelar_solicitud', { p_solicitud_id: id, p_motivo: motivo });

export async function puertosLibres(napId: string) {
  const { data, error } = await supabase
    .from('nap_puertos')
    .select('id, numero')
    .eq('nap_id', napId)
    .eq('estado', 'libre')
    .order('numero');
  if (error) throw error;
  return (data ?? []) as { id: string; numero: number }[];
}

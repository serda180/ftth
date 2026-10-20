// Datos de clientes (tabla clientes, vista clientes_vista y funciones 0012).
import { supabase } from '../lib/supabase';
import { normalizarRut } from '../lib/rut';

export type EstadoCliente = 'pendiente' | 'activo' | 'suspendido' | 'retirado';

export const ESTADOS_CLIENTE: { valor: EstadoCliente; nombre: string; color: string }[] = [
  { valor: 'pendiente', nombre: 'Pendiente', color: 'var(--color-alerta)' },
  { valor: 'activo', nombre: 'Activo', color: 'var(--color-ok)' },
  { valor: 'suspendido', nombre: 'Suspendido', color: 'var(--color-error)' },
  { valor: 'retirado', nombre: 'Retirado', color: 'var(--color-f-gris)' },
];

export type ClienteVista = {
  id: string;
  codigo: string;
  nombre: string;
  rut: string;
  telefono: string | null;
  whatsapp: string | null;
  email: string | null;
  direccion_calle: string;
  direccion_numero: string | null;
  direccion_depto: string | null;
  comuna_id: number;
  comuna: string | null;
  referencia: string | null;
  plan_id: number | null;
  plan: string | null;
  precio_mensual_clp: number | null;
  precio_efectivo_clp: number | null;
  fecha_contratacion: string | null;
  numero_contrato: string | null;
  estado: EstadoCliente;
  nap_puerto_id: string | null;
  puerto: number | null;
  nap_id: string | null;
  nap_codigo: string | null;
  acometida_cable_id: string | null;
  numero_serie_ont: string | null;
  observaciones: string | null;
  es_demo: boolean;
  creado_en: string;
  actualizado_en: string;
  tiene_ubicacion: boolean;
};

export type FiltrosClientes = {
  texto: string;
  estado: EstadoCliente | '';
  comunaId: number | null;
  planId: number | null;
  sinPuerto: boolean;
};

export const POR_PAGINA = 25;

function consultaBase(f: FiltrosClientes, conteo: boolean) {
  let q = supabase.from('clientes_vista').select('*', conteo ? { count: 'exact' } : undefined);
  const t = f.texto.trim();
  if (t) {
    // Un RUT escrito con puntos se busca normalizado.
    const rut = /^[\d.\s-]+[\dkK]$/.test(t) ? normalizarRut(t) : null;
    const patron = `%${t.toLowerCase().replace(/[%,()]/g, ' ')}%`;
    q = rut ? q.or(`texto_busqueda.ilike."${patron}",rut.eq.${rut}`) : q.ilike('texto_busqueda', patron);
  }
  if (f.estado) q = q.eq('estado', f.estado);
  if (f.comunaId) q = q.eq('comuna_id', f.comunaId);
  if (f.planId) q = q.eq('plan_id', f.planId);
  if (f.sinPuerto) q = q.is('nap_puerto_id', null).neq('estado', 'retirado');
  return q;
}

export async function listarClientes(f: FiltrosClientes, pagina: number) {
  const desde = pagina * POR_PAGINA;
  const { data, error, count } = await consultaBase(f, true)
    .order('nombre')
    .range(desde, desde + POR_PAGINA - 1);
  if (error) throw error;
  return { filas: (data ?? []) as ClienteVista[], total: count ?? 0 };
}

/** Todas las filas del filtro (para exportar), hasta un máximo razonable. */
export async function todosLosClientes(f: FiltrosClientes, maximo = 10000) {
  const filas: ClienteVista[] = [];
  for (let desde = 0; desde < maximo; desde += 1000) {
    const { data, error } = await consultaBase(f, false).order('nombre').range(desde, desde + 999);
    if (error) throw error;
    filas.push(...((data ?? []) as ClienteVista[]));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

export async function obtenerCliente(id: string) {
  const { data, error } = await supabase.from('clientes_vista').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as ClienteVista | null;
}

export async function coordenadasCliente(id: string) {
  const { data, error } = await supabase.rpc('coordenadas_cliente', { p_cliente_id: id });
  if (error) throw error;
  return data as { lng: number; lat: number } | null;
}

export type DatosCliente = {
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
  precio_mensual_clp: number | null;
  fecha_contratacion: string;
  numero_contrato: string;
  estado: EstadoCliente;
  numero_serie_ont: string;
  observaciones: string;
};

const nulo = (s: string) => (s.trim() === '' ? null : s.trim());

function aFila(d: DatosCliente, ubicacion: { lng: number; lat: number } | null) {
  return {
    nombre: d.nombre.trim(),
    rut: d.rut,
    telefono: nulo(d.telefono),
    whatsapp: nulo(d.whatsapp),
    email: nulo(d.email),
    direccion_calle: d.direccion_calle.trim(),
    direccion_numero: nulo(d.direccion_numero),
    direccion_depto: nulo(d.direccion_depto),
    comuna_id: d.comuna_id,
    referencia: nulo(d.referencia),
    plan_id: d.plan_id,
    precio_mensual_clp: d.precio_mensual_clp,
    fecha_contratacion: nulo(d.fecha_contratacion),
    numero_contrato: nulo(d.numero_contrato),
    estado: d.estado,
    numero_serie_ont: nulo(d.numero_serie_ont),
    observaciones: nulo(d.observaciones),
    // PostGIS acepta el punto en texto EWKT.
    ubicacion: ubicacion ? `SRID=4326;POINT(${ubicacion.lng} ${ubicacion.lat})` : null,
  };
}

export async function crearCliente(d: DatosCliente, ubicacion: { lng: number; lat: number } | null) {
  const { data, error } = await supabase.from('clientes').insert(aFila(d, ubicacion)).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function actualizarCliente(id: string, d: DatosCliente, ubicacion: { lng: number; lat: number } | null) {
  const { error } = await supabase.from('clientes').update(aFila(d, ubicacion)).eq('id', id);
  if (error) throw error;
}

export async function cambiarEstadoCliente(id: string, estado: EstadoCliente) {
  const { error } = await supabase.from('clientes').update({ estado }).eq('id', id);
  if (error) throw error;
}

export type Similar = { id: string; codigo: string; nombre: string; estado: EstadoCliente; motivo: 'rut' | 'direccion' };

export async function clientesSimilares(rut: string, calle: string, numero: string, comunaId: number | null, excluir?: string) {
  if (!comunaId && !rut) return [];
  const { data, error } = await supabase.rpc('clientes_similares', {
    p_rut: rut,
    p_calle: calle,
    p_numero: numero,
    p_comuna_id: comunaId ?? 0,
    p_excluir: excluir ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Similar[];
}

export type NapCercana = {
  id: string;
  codigo: string;
  nombre: string | null;
  estado: string;
  distancia_m: number;
  capacidad: number;
  ratio: string;
  libres: number;
  puertos_libres: { id: string; numero: number }[];
  ruta_completa: boolean;
  lng: number;
  lat: number;
};

export async function napsCercanas(lng: number, lat: number, radio = 600) {
  const { data, error } = await supabase.rpc('naps_cercanas', { p_lng: lng, p_lat: lat, p_radio_m: radio, p_limite: 10 });
  if (error) throw error;
  return (data ?? []) as NapCercana[];
}

export async function asignarPuerto(clienteId: string, puertoId: string) {
  const { error } = await supabase.rpc('asignar_puerto_cliente', { p_cliente_id: clienteId, p_puerto_id: puertoId });
  if (error) throw error;
}

export async function liberarPuerto(clienteId: string) {
  const { error } = await supabase.rpc('liberar_puerto_cliente', { p_cliente_id: clienteId });
  if (error) throw error;
}

export type EventoHistorial = {
  id: string;
  tipo: string;
  descripcion: string;
  datos: Record<string, unknown> | null;
  creado_en: string;
  perfiles: { nombre_completo: string; email: string } | null;
};

export async function historialCliente(id: string) {
  const { data, error } = await supabase
    .from('cliente_historial')
    .select('id, tipo, descripcion, datos, creado_en, perfiles(nombre_completo, email)')
    .eq('cliente_id', id)
    .order('creado_en', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as EventoHistorial[];
}

export async function agregarNota(clienteId: string, tipo: 'nota' | 'visita', descripcion: string, usuarioId: string) {
  const { error } = await supabase
    .from('cliente_historial')
    .insert({ cliente_id: clienteId, tipo, descripcion: descripcion.trim(), creado_por: usuarioId });
  if (error) throw error;
}

export async function cargarPlanesYComunas() {
  const [planes, comunas, conf] = await Promise.all([
    supabase.from('planes').select('id, nombre, precio_clp, bajada_mbps, subida_mbps, activo').order('precio_clp'),
    supabase.from('comunas').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('configuracion').select('clave, valor').in('clave', ['distancia_max_acometida_m', 'mapa_centro']),
  ]);
  for (const r of [planes, comunas, conf]) if (r.error) throw r.error;
  const c = new Map((conf.data ?? []).map((x: { clave: string; valor: unknown }) => [x.clave, x.valor]));
  return {
    planes: (planes.data ?? []) as { id: number; nombre: string; precio_clp: number; bajada_mbps: number; subida_mbps: number; activo: boolean }[],
    comunas: (comunas.data ?? []) as { id: number; nombre: string }[],
    distanciaMaxAcometida: Number(c.get('distancia_max_acometida_m') ?? 250),
    centro: (c.get('mapa_centro') as { lat: number; lng: number; zoom: number }) ?? { lat: -36.827, lng: -73.0503, zoom: 13 },
  };
}

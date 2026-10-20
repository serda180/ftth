// Órdenes de trabajo, fotos y materiales (migraciones 0007 y 0013).
import { supabase } from '../lib/supabase';

export type EstadoOrden = 'pendiente' | 'asignada' | 'en_camino' | 'en_ejecucion' | 'completada' | 'cancelada';
export type TipoOrden = 'instalacion' | 'reparacion' | 'mantenimiento' | 'cambio_domicilio' | 'desconexion' | 'retiro_equipos';
export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente';

export const TIPOS_ORDEN: { valor: TipoOrden; nombre: string }[] = [
  { valor: 'instalacion', nombre: 'Instalación' },
  { valor: 'reparacion', nombre: 'Reparación' },
  { valor: 'mantenimiento', nombre: 'Mantenimiento' },
  { valor: 'cambio_domicilio', nombre: 'Cambio de domicilio' },
  { valor: 'desconexion', nombre: 'Desconexión' },
  { valor: 'retiro_equipos', nombre: 'Retiro de equipos' },
];
export const ESTADOS_ORDEN: { valor: EstadoOrden; nombre: string; color: string }[] = [
  { valor: 'pendiente', nombre: 'Pendiente', color: 'var(--color-f-gris)' },
  { valor: 'asignada', nombre: 'Asignada', color: 'var(--color-f-azul)' },
  { valor: 'en_camino', nombre: 'En camino', color: 'var(--color-f-violeta)' },
  { valor: 'en_ejecucion', nombre: 'En ejecución', color: 'var(--color-f-naranjo)' },
  { valor: 'completada', nombre: 'Completada', color: 'var(--color-ok)' },
  { valor: 'cancelada', nombre: 'Cancelada', color: 'var(--color-f-gris)' },
];
export const PRIORIDADES: { valor: Prioridad; nombre: string; color: string }[] = [
  { valor: 'urgente', nombre: 'Urgente', color: 'var(--color-f-rojo)' },
  { valor: 'alta', nombre: 'Alta', color: 'var(--color-f-naranjo)' },
  { valor: 'media', nombre: 'Media', color: 'var(--color-f-azul)' },
  { valor: 'baja', nombre: 'Baja', color: 'var(--color-f-gris)' },
];
export const ABIERTAS: EstadoOrden[] = ['pendiente', 'asignada', 'en_camino', 'en_ejecucion'];

export const nombreTipo = (t: string) => TIPOS_ORDEN.find((x) => x.valor === t)?.nombre ?? t;
export const nombreEstadoOrden = (e: string) => ESTADOS_ORDEN.find((x) => x.valor === e)?.nombre ?? e;

export type OrdenVista = {
  id: string;
  numero: string;
  tipo: TipoOrden;
  prioridad: Prioridad;
  estado: EstadoOrden;
  cliente_id: string | null;
  solicitud_id: string | null;
  direccion: string | null;
  comuna_id: number | null;
  comuna: string | null;
  lng: number | null;
  lat: number | null;
  tecnico_id: string | null;
  tecnico_nombre: string | null;
  fecha_programada: string | null;
  descripcion: string;
  potencia_ont_dbm: number | null;
  potencia_nap_dbm: number | null;
  resultado_pruebas: string | null;
  conformidad_cliente: boolean | null;
  observaciones: string | null;
  iniciada_en: string | null;
  cerrada_en: string | null;
  es_demo: boolean;
  creado_en: string;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_whatsapp: string | null;
  cliente_codigo: string | null;
  solicitud_numero: string | null;
  nap_codigo: string | null;
  puerto: number | null;
  plan: string | null;
};

export type FiltrosOrdenes = { texto: string; estado: string; tipo: string; tecnico: string };

export async function listarOrdenes(f: FiltrosOrdenes, pagina: number, porPagina = 25) {
  let q = supabase.from('ordenes_vista').select('*', { count: 'exact' });
  if (f.texto.trim()) q = q.ilike('texto_busqueda', `%${f.texto.trim().toLowerCase().replace(/[%,()]/g, ' ')}%`);
  if (f.estado === 'abiertas') q = q.in('estado', ABIERTAS);
  else if (f.estado) q = q.eq('estado', f.estado);
  if (f.tipo) q = q.eq('tipo', f.tipo);
  if (f.tecnico === 'sin') q = q.is('tecnico_id', null);
  else if (f.tecnico) q = q.eq('tecnico_id', f.tecnico);
  const desde = pagina * porPagina;
  const { data, error, count } = await q
    .order('fecha_programada', { ascending: true, nullsFirst: false })
    .order('creado_en', { ascending: false })
    .range(desde, desde + porPagina - 1);
  if (error) throw error;
  return { filas: (data ?? []) as OrdenVista[], total: count ?? 0 };
}

export async function misOrdenes(tecnicoId: string) {
  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data, error } = await supabase
    .from('ordenes_vista')
    .select('*')
    .eq('tecnico_id', tecnicoId)
    .or(`estado.in.(${ABIERTAS.join(',')}),cerrada_en.gte."${hace7}"`)
    .order('fecha_programada', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as OrdenVista[];
}

export async function obtenerOrden(id: string) {
  const { data, error } = await supabase.from('ordenes_vista').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as OrdenVista | null;
}

export type Tecnico = { id: string; nombre: string; email: string; abiertas: number };
export async function tecnicosActivos() {
  const { data, error } = await supabase.rpc('tecnicos_activos');
  if (error) throw error;
  return (data ?? []) as Tecnico[];
}

async function rpc<T>(nombre: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, params);
  if (error) throw error;
  return data as T;
}

export const asignarOrden = (id: string, tecnico: string | null, fecha: string | null) =>
  rpc<null>('asignar_orden', { p_orden_id: id, p_tecnico_id: tecnico, p_fecha: fecha });

export type DatosCierre = {
  exito: boolean;
  potencia_ont_dbm: number | null;
  potencia_nap_dbm: number | null;
  resultado_pruebas: string;
  conformidad_cliente: boolean | null;
  observaciones: string;
  numero_serie_ont: string;
  lng: number | null;
  lat: number | null;
};
export const cerrarOrden = (id: string, d: DatosCierre) =>
  rpc<{ orden_id: string; exito?: boolean; cliente_id?: string }>('cerrar_orden', { p_orden_id: id, p: d });

export const crearOrdenesMasivas = (tipo: string, id: string, descripcion: string, prioridad: Prioridad) =>
  rpc<{ creadas: number; omitidas: number }>('crear_ordenes_masivas', {
    p_tipo: tipo,
    p_id: id,
    p_descripcion: descripcion,
    p_prioridad: prioridad,
  });

export async function cambiarEstado(id: string, estado: EstadoOrden, observaciones?: string) {
  const cambios: Record<string, unknown> = { estado };
  if (observaciones) cambios.observaciones = observaciones;
  const { error } = await supabase.from('ordenes_trabajo').update(cambios).eq('id', id);
  if (error) throw error;
}

export type NuevaOrden = {
  tipo: TipoOrden;
  prioridad: Prioridad;
  cliente_id: string;
  descripcion: string;
  tecnico_id: string | null;
  fecha_programada: string | null;
};

/** Orden sobre un cliente existente (reparación, mantenimiento, etc.). */
export async function crearOrden(d: NuevaOrden, cliente: { direccion: string; comuna_id: number }) {
  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .insert({
      ...d,
      estado: d.tecnico_id ? 'asignada' : 'pendiente',
      direccion: cliente.direccion,
      comuna_id: cliente.comuna_id,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------
export type Foto = { id: string; ruta: string; momento: 'antes' | 'despues' | 'otro'; creado_en: string; url: string | null };

export async function fotosDeOrden(ordenId: string): Promise<Foto[]> {
  const { data, error } = await supabase
    .from('orden_fotos')
    .select('id, ruta, momento, creado_en')
    .eq('orden_id', ordenId)
    .order('creado_en');
  if (error) throw error;
  const filas = (data ?? []) as Omit<Foto, 'url'>[];
  if (filas.length === 0) return [];
  // URL firmadas de corta duración (el bucket es privado).
  const { data: firmadas } = await supabase.storage.from('ordenes').createSignedUrls(filas.map((f) => f.ruta), 600);
  return filas.map((f, i) => ({ ...f, url: firmadas?.[i]?.signedUrl ?? null }));
}

export async function subirFoto(ordenId: string, archivo: Blob, momento: Foto['momento'], usuarioId: string) {
  const ruta = `${ordenId}/${momento}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const subida = await supabase.storage.from('ordenes').upload(ruta, archivo, { contentType: 'image/jpeg', upsert: false });
  if (subida.error) throw subida.error;
  const { error } = await supabase.from('orden_fotos').insert({ orden_id: ordenId, ruta, momento, subida_por: usuarioId });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------
export type Consumo = {
  id: string;
  cantidad: number;
  creado_en: string;
  articulos: { codigo: string; nombre: string; unidad: string } | null;
  equipos: { numero_serie: string } | null;
};

export async function materialesDeOrden(ordenId: string) {
  const { data, error } = await supabase
    .from('movimientos_inventario')
    .select('id, cantidad, creado_en, articulos(codigo, nombre, unidad), equipos(numero_serie)')
    .eq('orden_id', ordenId)
    .eq('tipo', 'consumo_ot')
    .order('creado_en');
  if (error) throw error;
  return (data ?? []) as unknown as Consumo[];
}

export type StockPropio = {
  articulo_id: number;
  cantidad: number;
  articulos: { codigo: string; nombre: string; unidad: 'unidad' | 'metro'; es_serializado: boolean } | null;
};

export async function miStock() {
  const { data: bodega, error: e1 } = await supabase.rpc('mi_bodega_id');
  if (e1) throw e1;
  if (!bodega) return { bodegaId: null as number | null, items: [] as StockPropio[], equipos: [] as { id: string; articulo_id: number; numero_serie: string }[] };
  const [stock, equipos] = await Promise.all([
    supabase
      .from('stock')
      .select('articulo_id, cantidad, articulos(codigo, nombre, unidad, es_serializado)')
      .eq('bodega_id', bodega)
      .gt('cantidad', 0),
    supabase.from('equipos').select('id, articulo_id, numero_serie').eq('bodega_id', bodega),
  ]);
  if (stock.error) throw stock.error;
  if (equipos.error) throw equipos.error;
  return {
    bodegaId: bodega as number,
    items: (stock.data ?? []) as unknown as StockPropio[],
    equipos: (equipos.data ?? []) as { id: string; articulo_id: number; numero_serie: string }[],
  };
}

export async function registrarConsumo(ordenId: string, bodegaId: number, articuloId: number, cantidad: number, equipoId: string | null) {
  const { error } = await supabase.from('movimientos_inventario').insert({
    tipo: 'consumo_ot',
    orden_id: ordenId,
    bodega_origen_id: bodegaId,
    articulo_id: articuloId,
    cantidad,
    equipo_id: equipoId,
  });
  if (error) throw error;
}

export async function rangoPotencia() {
  const { data } = await supabase.from('configuracion').select('clave, valor').in('clave', ['potencia_min_dbm', 'potencia_max_dbm']);
  const m = new Map((data ?? []).map((x: { clave: string; valor: unknown }) => [x.clave, Number(x.valor)]));
  return { min: m.get('potencia_min_dbm') ?? -27, max: m.get('potencia_max_dbm') ?? -8 };
}

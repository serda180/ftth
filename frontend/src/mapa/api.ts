// Acceso a datos del mapa (funciones RPC de la base de datos).
import { supabase } from '../lib/supabase';
import type {
  CableMapa,
  ClienteMapa,
  Clase,
  Coordenada,
  EstadoElemento,
  EstadoPuerto,
  FichaCable,
  FichaElemento,
  Filtros,
  RespuestaElementos,
  ResultadoBusqueda,
  TipoElementoCatalogo,
  Vista,
  ZonaMapa,
} from './tipos';

async function rpc<T>(nombre: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, params);
  if (error) throw error;
  return data as T;
}

const todosLosEstados = 5;

export function cargarElementos(v: Vista, f: Filtros) {
  return rpc<RespuestaElementos>('mapa_elementos', {
    p_oeste: v.oeste,
    p_sur: v.sur,
    p_este: v.este,
    p_norte: v.norte,
    p_zoom: Math.round(v.zoom),
    p_clases: f.clases,
    p_estados: f.estados.length === todosLosEstados ? null : f.estados,
    p_sector: f.sector.trim() || null,
  });
}

export function cargarCables(v: Vista, f: Filtros) {
  return rpc<CableMapa[]>('mapa_cables', {
    p_oeste: v.oeste,
    p_sur: v.sur,
    p_este: v.este,
    p_norte: v.norte,
    p_tipos: f.tiposCable,
    p_estados: f.estados.length === todosLosEstados ? null : f.estados,
  });
}

export function cargarZonas(v: Vista) {
  return rpc<ZonaMapa[]>('mapa_zonas', { p_oeste: v.oeste, p_sur: v.sur, p_este: v.este, p_norte: v.norte });
}

export function cargarClientesMapa(v: Vista) {
  return rpc<ClienteMapa[]>('mapa_clientes', { p_oeste: v.oeste, p_sur: v.sur, p_este: v.este, p_norte: v.norte });
}

export const fichaElemento = (id: string) => rpc<FichaElemento | null>('ficha_elemento', { p_id: id });
export const fichaCable = (id: string) => rpc<FichaCable | null>('ficha_cable', { p_id: id });
export const buscarRed = (texto: string) => rpc<ResultadoBusqueda[]>('buscar_red', { p_texto: texto, p_limite: 8 });

export type DatosElemento = {
  clase: Clase;
  tipo_codigo: string;
  codigo: string;
  nombre: string;
  lng: number;
  lat: number;
  direccion: string;
  comuna_id: number | null;
  sector: string;
  estado: EstadoElemento;
  fecha_instalacion: string;
  observaciones: string;
  detalle: Record<string, string>;
};

export const crearElemento = (d: DatosElemento) => rpc<string>('crear_elemento', { p: d });
export const actualizarElemento = (id: string, d: DatosElemento) => rpc<null>('actualizar_elemento', { p_id: id, p: d });
export const moverElemento = (id: string, lng: number, lat: number) =>
  rpc<null>('mover_elemento', { p_id: id, p_lng: lng, p_lat: lat });
export const eliminarElemento = (id: string) => rpc<null>('eliminar_elemento', { p_id: id });

export type DatosCable = {
  codigo: string;
  nombre_tramo: string;
  tipo: string;
  modelo_cable_id: number | null;
  cantidad_fibras: number | null;
  origen_id: string | null;
  destino_id: string | null;
  longitud_declarada_m: number | null;
  estado: EstadoElemento;
  fecha_instalacion: string;
  observaciones: string;
  coordenadas?: Coordenada[];
};

export const crearCable = (d: DatosCable) => rpc<string>('crear_cable', { p: d });
export const actualizarCable = (id: string, d: Partial<DatosCable>) => rpc<null>('actualizar_cable', { p_id: id, p: d });
export const eliminarCable = (id: string) => rpc<null>('eliminar_cable', { p_id: id });

export async function cambiarEstadoPuerto(id: string, estado: EstadoPuerto, observaciones: string | null) {
  const { error } = await supabase.from('nap_puertos').update({ estado, observaciones }).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Catálogos que usan los formularios del mapa
// ---------------------------------------------------------------------
export type Catalogos = {
  tipos: TipoElementoCatalogo[];
  ratios: { id: number; ratio: string; salidas: number; perdida_db: number }[];
  modelos: { id: number; nombre: string; cantidad_fibras: number }[];
  comunas: { id: number; nombre: string }[];
  teselas: { url: string; atribucion: string; zoom_maximo: number };
  satelite: { url: string; atribucion: string; zoom_maximo: number };
  centro: { lat: number; lng: number; zoom: number };
  ajusteMetros: number;
  umbralOcupacion: number;
};

export async function cargarCatalogos(): Promise<Catalogos> {
  const [tipos, ratios, modelos, comunas, conf] = await Promise.all([
    supabase.from('tipos_elemento').select('*').eq('activo', true).order('orden'),
    supabase.from('ratios_splitter').select('id, ratio, salidas, perdida_db').eq('activo', true).order('salidas'),
    supabase.from('modelos_cable').select('id, nombre, cantidad_fibras').eq('activo', true).order('cantidad_fibras'),
    supabase.from('comunas').select('id, nombre').eq('activo', true).order('nombre'),
    supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['mapa_teselas', 'mapa_satelite', 'mapa_centro', 'mapa_ajuste_metros', 'ocupacion_alerta_pct']),
  ]);
  for (const r of [tipos, ratios, modelos, comunas, conf]) if (r.error) throw r.error;

  const c = new Map((conf.data ?? []).map((x: { clave: string; valor: unknown }) => [x.clave, x.valor]));
  return {
    tipos: (tipos.data ?? []) as TipoElementoCatalogo[],
    ratios: (ratios.data ?? []) as Catalogos['ratios'],
    modelos: (modelos.data ?? []) as Catalogos['modelos'],
    comunas: (comunas.data ?? []) as Catalogos['comunas'],
    teselas: (c.get('mapa_teselas') as Catalogos['teselas']) ?? {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      atribucion: '&copy; colaboradores de OpenStreetMap',
      zoom_maximo: 19,
    },
    satelite: (c.get('mapa_satelite') as Catalogos['satelite']) ?? {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      atribucion: 'Imágenes &copy; Esri',
      zoom_maximo: 19,
    },
    centro: (c.get('mapa_centro') as Catalogos['centro']) ?? { lat: -36.827, lng: -73.0503, zoom: 13 },
    ajusteMetros: Number(c.get('mapa_ajuste_metros') ?? 30),
    umbralOcupacion: Number(c.get('ocupacion_alerta_pct') ?? 80),
  };
}

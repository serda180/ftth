// Tipos de datos del mapa (coinciden con las funciones SQL de la migración 0011).

export type Clase =
  | 'olt'
  | 'nap'
  | 'poste'
  | 'camara'
  | 'caja_empalme'
  | 'splitter'
  | 'gabinete'
  | 'punto_ingreso'
  | 'otro';

export type EstadoElemento = 'planificado' | 'en_construccion' | 'operativo' | 'fuera_servicio' | 'retirado';
export type TipoCable = 'troncal' | 'distribucion' | 'derivacion' | 'acometida';
export type EstadoPuerto = 'libre' | 'reservado' | 'ocupado' | 'averiado';
export type Coordenada = [number, number]; // [lng, lat] como en GeoJSON

export type ResumenNap = {
  capacidad: number;
  ratio: string;
  libres: number;
  ocupados: number;
  reservados: number;
  averiados: number;
};

export type ElementoMapa = {
  id: string;
  codigo: string;
  clase: Clase;
  tipo: string;
  tipo_nombre: string;
  color: string;
  nombre: string | null;
  estado: EstadoElemento;
  sector: string | null;
  lng: number;
  lat: number;
  nap: ResumenNap | null;
};

export type GrupoMapa = { cantidad: number; lng: number; lat: number; nap: number };

export type RespuestaElementos =
  | { modo: 'elementos'; total: number; items: ElementoMapa[] }
  | { modo: 'grupos'; total: number; items: GrupoMapa[] };

export type CableMapa = {
  id: string;
  codigo: string;
  nombre_tramo: string | null;
  tipo: TipoCable;
  estado: EstadoElemento;
  cantidad_fibras: number;
  hilos_usados: number;
  longitud_mapa_m: number;
  longitud_declarada_m: number | null;
  origen_id: string | null;
  destino_id: string | null;
  coordenadas: Coordenada[];
};

export type ZonaMapa = {
  id: string;
  nombre: string;
  estado: EstadoElemento;
  color: string;
  geometria: { type: 'Polygon'; coordinates: Coordenada[][] };
};

export type PuertoFicha = {
  id: string;
  numero: number;
  estado: EstadoPuerto;
  observaciones: string | null;
  cliente: { id: string; codigo: string; nombre: string; estado: string } | null;
};

export type FichaElemento = {
  id: string;
  codigo: string;
  clase: Clase;
  tipo_codigo: string;
  tipo_nombre: string;
  nombre: string | null;
  direccion: string | null;
  comuna_id: number | null;
  comuna: string | null;
  sector: string | null;
  estado: EstadoElemento;
  fecha_instalacion: string | null;
  observaciones: string | null;
  es_demo: boolean;
  lng: number;
  lat: number;
  creado_en: string;
  actualizado_en: string;
  detalle: Record<string, string | number | boolean | null>;
  cables: { id: string; codigo: string; tipo: TipoCable; extremo: 'origen' | 'destino' }[];
  // Solo NAP
  ratio?: string;
  puertos?: PuertoFicha[];
  alimentacion?: {
    conexion_id: string;
    confirmada: boolean;
    cable_id: string;
    cable_codigo: string;
    hilo: number;
    color: string;
    tubo: number;
    olt_codigo: string | null;
    puerto_pon: string | null;
  } | null;
  // Solo OLT
  puertos_pon?: { id: string; slot: number; puerto: number; etiqueta: string | null; activo: boolean; hilos: number }[];
};

export type HiloFicha = {
  id: string;
  numero: number;
  tubo: number;
  color: string;
  estado: 'libre' | 'en_uso' | 'reservado' | 'danado';
  nap: { id: string; codigo: string } | null;
};

export type FichaCable = {
  id: string;
  codigo: string;
  nombre_tramo: string | null;
  tipo: TipoCable;
  estado: EstadoElemento;
  modelo_cable_id: number | null;
  modelo: string | null;
  cantidad_fibras: number;
  longitud_mapa_m: number;
  longitud_declarada_m: number | null;
  fecha_instalacion: string | null;
  observaciones: string | null;
  es_demo: boolean;
  origen: { id: string; codigo: string; clase: Clase } | null;
  destino: { id: string; codigo: string; clase: Clase } | null;
  coordenadas: Coordenada[];
  hilos: HiloFicha[];
};

export type ResultadoBusqueda = {
  tipo: 'elemento' | 'cable' | 'cliente';
  id: string;
  clase: string;
  titulo: string;
  detalle: string;
  lng: number | null;
  lat: number | null;
};

export type TipoElementoCatalogo = {
  codigo: string;
  nombre: string;
  clase: Clase;
  icono: string;
  color: string;
  orden: number;
  activo: boolean;
};

export type Seleccion = { tipo: 'elemento'; id: string } | { tipo: 'cable'; id: string } | null;

export type Vista = { oeste: number; sur: number; este: number; norte: number; zoom: number };

export type Filtros = {
  clases: Clase[];
  tiposCable: TipoCable[];
  estados: EstadoElemento[];
  sector: string;
  zonas: boolean;
  clientes: boolean;
};

export type ClienteMapa = {
  id: string;
  codigo: string;
  nombre: string;
  estado: 'pendiente' | 'activo' | 'suspendido' | 'retirado';
  lng: number;
  lat: number;
  nap_lng: number | null;
  nap_lat: number | null;
  nap_codigo: string | null;
  puerto: number | null;
};

export const COLOR_CLIENTE: Record<ClienteMapa['estado'], string> = {
  pendiente: '#c98a06',
  activo: '#2e9d4f',
  suspendido: '#d33a2c',
  retirado: '#8c969d',
};

// ---------------------------------------------------------------------
// Textos y estilos
// ---------------------------------------------------------------------

export const CLASES: { valor: Clase; nombre: string }[] = [
  { valor: 'olt', nombre: 'OLT' },
  { valor: 'nap', nombre: 'NAP / CTO' },
  { valor: 'poste', nombre: 'Postes' },
  { valor: 'camara', nombre: 'Cámaras' },
  { valor: 'caja_empalme', nombre: 'Cajas de empalme' },
  { valor: 'splitter', nombre: 'Splitters' },
  { valor: 'gabinete', nombre: 'Gabinetes' },
  { valor: 'punto_ingreso', nombre: 'Ingresos a edificio' },
  { valor: 'otro', nombre: 'Otros puntos' },
];

export const ESTADOS: { valor: EstadoElemento; nombre: string }[] = [
  { valor: 'operativo', nombre: 'Operativo' },
  { valor: 'planificado', nombre: 'Planificado' },
  { valor: 'en_construccion', nombre: 'En construcción' },
  { valor: 'fuera_servicio', nombre: 'Fuera de servicio' },
  { valor: 'retirado', nombre: 'Retirado' },
];

export function nombreEstado(e: EstadoElemento): string {
  return ESTADOS.find((x) => x.valor === e)?.nombre ?? e;
}

// Color de un cable por su tipo; el estado se expresa con el trazo.
export const TIPOS_CABLE: { valor: TipoCable; nombre: string; color: string; grosor: number }[] = [
  { valor: 'troncal', nombre: 'Troncal', color: '#1f6fd1', grosor: 5 },
  { valor: 'distribucion', nombre: 'Distribución', color: '#e8740c', grosor: 4 },
  { valor: 'derivacion', nombre: 'Derivación', color: '#2e9d4f', grosor: 3 },
  { valor: 'acometida', nombre: 'Acometida', color: '#7b4cc2', grosor: 2 },
];

export function estiloCable(tipo: TipoCable, estado: EstadoElemento) {
  const t = TIPOS_CABLE.find((x) => x.valor === tipo) ?? TIPOS_CABLE[0]!;
  return {
    color: estado === 'fuera_servicio' ? '#d33a2c' : estado === 'retirado' ? '#8c969d' : t.color,
    weight: t.grosor,
    opacity: estado === 'retirado' ? 0.5 : 0.9,
    dashArray: estado === 'planificado' ? '2 8' : estado === 'en_construccion' ? '10 6' : undefined,
    lineCap: 'round' as const,
  };
}

// Colores de estado de puerto (mismos que el panel).
export const COLOR_PUERTO: Record<EstadoPuerto, string> = {
  libre: '#cfd7dc',
  ocupado: '#1f6fd1',
  reservado: '#f2c230',
  averiado: '#d33a2c',
};

export const NOMBRE_PUERTO: Record<EstadoPuerto, string> = {
  libre: 'Libre',
  ocupado: 'Ocupado',
  reservado: 'Reservado',
  averiado: 'Averiado',
};

// Colores de hilos según TIA-598 (nombre en español → hex).
export const COLOR_HILO: Record<string, string> = {
  Azul: '#1f6fd1',
  Naranjo: '#e8740c',
  Verde: '#2e9d4f',
  Café: '#8a5a3c',
  Gris: '#8c969d',
  Blanco: '#f4f6f7',
  Rojo: '#d33a2c',
  Negro: '#1b1f22',
  Amarillo: '#f2c230',
  Violeta: '#7b4cc2',
  Rosado: '#e98bb4',
  Aqua: '#2bb3b8',
};

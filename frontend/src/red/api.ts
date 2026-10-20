// Conexiones, rutas, impacto y topología (funciones de la migración 0012).
import { supabase } from '../lib/supabase';
import type { EstadoElemento, TipoCable } from '../mapa/tipos';

export type PasoCamino =
  | { tipo: 'puerto'; id: string; numero: number }
  | { tipo: 'nap'; id: string; codigo: string; estado: EstadoElemento }
  | {
      tipo: 'hilo';
      id: string;
      numero: number;
      color: string;
      estado: string;
      cable_id: string;
      cable_codigo: string;
      cable_estado: EstadoElemento;
      conexion_id: string;
      confirmada: boolean;
    }
  | { tipo: 'empalme'; conexion_id: string; confirmada: boolean; elemento_id: string | null; codigo: string | null }
  | { tipo: 'splitter'; elemento_id: string; codigo: string; estado: EstadoElemento; conexion_id: string; confirmada: boolean }
  | {
      tipo: 'pon';
      id: string;
      etiqueta: string | null;
      olt_id: string;
      olt_codigo: string;
      olt_estado: EstadoElemento;
      conexion_id: string;
      confirmada: boolean;
    };

export type Camino = { completo: boolean; pasos: PasoCamino[]; faltante: string | null };

export type ImpactoNap = {
  id: string;
  codigo: string;
  puertos_ocupados: number;
  clientes: { id: string; codigo: string; nombre: string; telefono: string | null; whatsapp: string | null; estado: string; puerto: number }[];
};
export type Impacto = { naps: ImpactoNap[]; total_naps: number; total_puertos_ocupados: number };
export type TipoImpacto = 'cable' | 'hilo' | 'pon' | 'elemento';

export type NapTopologia = {
  id: string;
  codigo: string;
  estado: EstadoElemento;
  capacidad: number;
  ocupados: number;
  pasos: PasoCamino[];
  faltante?: string;
};
export type Topologia = {
  olts: { id: string; codigo: string; estado: EstadoElemento; pons: { id: string; etiqueta: string | null; naps: NapTopologia[] }[] }[];
  sin_ruta: NapTopologia[];
};

export type HiloCercano = {
  id: string;
  numero: number;
  tubo: number;
  color: string;
  estado: 'libre' | 'en_uso' | 'reservado' | 'danado';
  alimenta: string | null;
  inyectado: string | null;
};
export type CableCercano = {
  id: string;
  codigo: string;
  tipo: TipoCable;
  estado: EstadoElemento;
  distancia_m: number;
  hilos: HiloCercano[];
};

async function rpc<T>(nombre: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, params);
  if (error) throw error;
  return data as T;
}

export const caminoNap = (id: string) => rpc<Camino | null>('camino_nap', { p_nap_id: id });
export const rutaCliente = (id: string) => rpc<Camino | null>('ruta_cliente', { p_cliente_id: id });
export const analizarImpacto = (tipo: TipoImpacto, id: string) => rpc<Impacto>('impacto', { p_tipo: tipo, p_id: id });
export const cargarTopologia = () => rpc<Topologia>('topologia', {});
export const cablesCercanos = (elementoId: string, radio = 60) =>
  rpc<CableCercano[]>('cables_cercanos', { p_elemento_id: elementoId, p_radio_m: radio });

export const conectarNap = (napId: string, hiloId: string, confirmada: boolean) =>
  rpc<string>('conectar_nap', { p_nap_id: napId, p_hilo_id: hiloId, p_confirmada: confirmada });
export const inyectarHilo = (ponId: string, hiloId: string, confirmada: boolean) =>
  rpc<string>('inyectar_hilo', { p_puerto_pon_id: ponId, p_hilo_id: hiloId, p_confirmada: confirmada });
export const confirmarConexion = (id: string, confirmada: boolean) =>
  rpc<null>('confirmar_conexion', { p_id: id, p_confirmada: confirmada });
export const eliminarConexion = (id: string) => rpc<null>('eliminar_conexion', { p_id: id });

export type InyeccionPon = { id: string; confirmada: boolean; hilo: { numero: number; color: string; cables: { codigo: string } | null } | null };

export async function inyeccionesDePon(ponId: string): Promise<InyeccionPon[]> {
  const { data, error } = await supabase
    .from('conexiones')
    .select('id, confirmada, hilo:cable_hilos!conexiones_hilo_destino_id_fkey(numero, color, cables(codigo))')
    .eq('olt_puerto_pon_id', ponId)
    .eq('tipo', 'inyeccion_olt')
    .is('eliminado_en', null);
  if (error) throw error;
  return (data ?? []) as unknown as InyeccionPon[];
}

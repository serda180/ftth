import { supabase } from './supabase';
import { mensajeError } from './errores';

/**
 * Llama una Edge Function y devuelve su respuesta. Si la función responde
 * con error, lanza un Error con el mensaje en español que ella devuelve.
 */
export async function llamarFuncion<T>(nombre: string, cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body: cuerpo });
  if (error) {
    let mensaje = mensajeError(error);
    const contexto = (error as { context?: Response }).context;
    if (contexto && typeof contexto.json === 'function') {
      try {
        const cuerpoError = (await contexto.json()) as { error?: string };
        if (cuerpoError.error) mensaje = cuerpoError.error;
      } catch {
        // la respuesta no era JSON; se mantiene el mensaje genérico
      }
    }
    throw new Error(mensaje);
  }
  return data as T;
}

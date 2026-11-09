import { createClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __CONFIG__?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; CORREO?: boolean };
  }
}

// Primero la configuración que entrega el servidor (/config.js);
// si viene vacía, las variables de Vite del .env (desarrollo).
const url = window.__CONFIG__?.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const anonKey = window.__CONFIG__?.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configuracionFaltante = !url || !anonKey;

/** Si el servidor puede enviar correos (invitaciones y recuperación de contraseña). */
export const correoConfigurado = window.__CONFIG__?.CORREO !== false;

// Solo la clave pública (anon). La clave de servicio nunca llega al navegador.
export const supabase = createClient(url || 'http://localhost', anonKey || 'falta-configurar', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

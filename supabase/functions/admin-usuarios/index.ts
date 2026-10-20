// Edge Function: gestión de usuarios por un administrador.
// Acciones: invitar, desactivar, reactivar.
// Es el único lugar donde se usa la clave de servicio, y solo después de
// comprobar que quien llama es administrador activo.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['administrador', 'supervisor_red', 'tecnico', 'atencion_cliente', 'inventario'] as const;
type Rol = (typeof ROLES)[number];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function responder(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const BANEO_INDEFINIDO = '876000h'; // ~100 años

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const autorizacion = req.headers.get('Authorization') ?? '';

  // 1. Quién llama: se usa su propio token, sujeto a RLS.
  const comoUsuario = createClient(url, anon, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false },
  });
  const { data: usuarioActual, error: errorUsuario } = await comoUsuario.auth.getUser();
  if (errorUsuario || !usuarioActual.user) return responder(401, { error: 'Sesión no válida' });

  const { data: esAdmin, error: errorRol } = await comoUsuario.rpc('es_admin');
  if (errorRol) return responder(500, { error: 'No se pudo verificar el rol' });
  if (!esAdmin) return responder(403, { error: 'Solo un administrador puede gestionar usuarios' });

  // 2. Cliente con privilegios, solo desde aquí.
  const admin = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return responder(400, { error: 'Cuerpo de la solicitud no válido' });
  }

  const accion = cuerpo.accion;

  if (accion === 'invitar') {
    const email = String(cuerpo.email ?? '').trim().toLowerCase();
    const nombre = String(cuerpo.nombre_completo ?? '').trim();
    const roles = Array.isArray(cuerpo.roles) ? (cuerpo.roles as unknown[]).map(String) : [];

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder(400, { error: 'Correo no válido' });
    if (nombre.length < 2) return responder(400, { error: 'Indique el nombre completo' });
    if (roles.length === 0 || !roles.every((r) => (ROLES as readonly string[]).includes(r))) {
      return responder(400, { error: 'Indique al menos un rol válido' });
    }

    const sitio = Deno.env.get('SITE_URL') ?? req.headers.get('origin') ?? '';
    const { data: invitado, error: errorInvitar } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nombre_completo: nombre },
      redirectTo: sitio ? `${sitio.replace(/\/$/, '')}/establecer-clave` : undefined,
    });
    if (errorInvitar) {
      const yaExiste = /already been registered|already registered|exists/i.test(errorInvitar.message);
      return responder(yaExiste ? 409 : 400, {
        error: yaExiste ? 'Ya existe un usuario con ese correo' : `No se pudo enviar la invitación: ${errorInvitar.message}`,
      });
    }

    const nuevoId = invitado.user.id;
    // El perfil lo crea un disparador al insertarse el usuario en Auth.
    const { error: errorRoles } = await admin.from('usuario_roles').insert(
      (roles as Rol[]).map((rol) => ({ usuario_id: nuevoId, rol, asignado_por: usuarioActual.user.id })),
    );
    if (errorRoles) {
      return responder(500, { error: `Se invitó al usuario, pero no se pudieron asignar los roles: ${errorRoles.message}` });
    }
    return responder(200, { ok: true, usuario_id: nuevoId });
  }

  if (accion === 'desactivar' || accion === 'reactivar') {
    const usuarioId = String(cuerpo.usuario_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) return responder(400, { error: 'Usuario no válido' });
    if (usuarioId === usuarioActual.user.id) return responder(400, { error: 'No puede desactivar su propia cuenta' });

    const activar = accion === 'reactivar';
    // Primero la base: el disparador impide dejar la plataforma sin administradores.
    const { error: errorPerfil } = await admin.from('perfiles').update({ activo: activar }).eq('id', usuarioId);
    if (errorPerfil) return responder(400, { error: errorPerfil.message });

    const { error: errorAuth } = await admin.auth.admin.updateUserById(usuarioId, {
      ban_duration: activar ? 'none' : BANEO_INDEFINIDO,
    });
    if (errorAuth) {
      // Se revierte el estado para no dejarlo inconsistente.
      await admin.from('perfiles').update({ activo: !activar }).eq('id', usuarioId);
      return responder(500, { error: `No se pudo actualizar la cuenta: ${errorAuth.message}` });
    }
    return responder(200, { ok: true });
  }

  return responder(400, { error: 'Acción no reconocida' });
});

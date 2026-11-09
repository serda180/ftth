// /functions/v1/admin-usuarios: gestión de usuarios por un administrador
// (reemplaza a la Edge Function de Supabase, mismo contrato + enlaces).
//
// Acciones:
//   invitar     {email, nombre_completo, roles[]} -> {ok, usuario_id, enlace, correo_enviado}
//   enlace      {usuario_id}                      -> {ok, enlace}   (crear o restablecer contraseña)
//   desactivar  {usuario_id}                      -> {ok}
//   reactivar   {usuario_id}                      -> {ok}
//
// Sin correo configurado, el administrador comparte el enlace (WhatsApp, etc.).
import { leerJson, responderJson } from './base.mjs';

const ROLES = ['administrador', 'supervisor_red', 'tecnico', 'atencion_cliente', 'inventario'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crearUsuarios({ pg, auth }) {
  const error = (res, estado, mensaje) => responderJson(res, estado, { error: mensaje });

  async function manejar(req, res, nombre) {
    if (nombre !== 'admin-usuarios') return error(res, 404, 'Función no encontrada');
    if (req.method !== 'POST') return error(res, 405, 'Método no permitido');

    let actual;
    try {
      actual = await auth.usuarioActual(req);
    } catch {
      return error(res, 401, 'Sesión no válida');
    }
    // Se pregunta a la base con el token del usuario (mismas reglas que la app).
    let esAdmin;
    try {
      esAdmin = await pg.rpc('es_admin', {}, { perfil: 'public', token: actual.token });
    } catch {
      return error(res, 500, 'No se pudo verificar el rol');
    }
    if (esAdmin !== true) return error(res, 403, 'Solo un administrador puede gestionar usuarios');

    let cuerpo;
    try {
      cuerpo = await leerJson(req);
    } catch {
      return error(res, 400, 'Cuerpo de la solicitud no válido');
    }

    if (cuerpo.accion === 'invitar') {
      const email = String(cuerpo.email ?? '').trim().toLowerCase();
      const nombreCompleto = String(cuerpo.nombre_completo ?? '').trim();
      const roles = Array.isArray(cuerpo.roles) ? cuerpo.roles.map(String) : [];
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error(res, 400, 'Correo no válido');
      if (nombreCompleto.length < 2) return error(res, 400, 'Indique el nombre completo');
      if (roles.length === 0 || !roles.every((r) => ROLES.includes(r))) {
        return error(res, 400, 'Indique al menos un rol válido');
      }
      const r = await pg.rpc('invitar', {
        p_email: email,
        p_nombre: nombreCompleto,
        p_roles: roles,
        p_por: actual.usuario.id,
      });
      if (r?.error === 'email_exists') return error(res, 409, 'Ya existe un usuario con ese correo');
      if (r?.error) return error(res, 400, r.error);
      const token = await pg.rpc('crear_enlace', { p_usuario: r.usuario_id, p_tipo: 'invite', p_horas: 168 });
      const enlace = auth.enlace(req, token, 'invite');
      const correoEnviado = await auth.correo(
        email,
        'Invitación a la Plataforma FTTH',
        `Hola ${nombreCompleto}:\n\nLo invitaron a la Plataforma FTTH. Para crear su contraseña, abra este enlace (vale por 7 días):\n\n${enlace}\n\nSi el navegador muestra una advertencia de seguridad, pida al administrador el certificado de la oficina.\n`,
      );
      return responderJson(res, 200, { ok: true, usuario_id: r.usuario_id, enlace, correo_enviado: correoEnviado });
    }

    if (cuerpo.accion === 'enlace') {
      const usuarioId = String(cuerpo.usuario_id ?? '');
      if (!UUID.test(usuarioId)) return error(res, 400, 'Usuario no válido');
      let token;
      try {
        token = await pg.rpc('crear_enlace', { p_usuario: usuarioId, p_tipo: 'recovery', p_horas: 72 });
      } catch {
        return error(res, 404, 'Usuario no encontrado');
      }
      return responderJson(res, 200, { ok: true, enlace: auth.enlace(req, token, 'recovery') });
    }

    if (cuerpo.accion === 'desactivar' || cuerpo.accion === 'reactivar') {
      const usuarioId = String(cuerpo.usuario_id ?? '');
      if (!UUID.test(usuarioId)) return error(res, 400, 'Usuario no válido');
      if (usuarioId === actual.usuario.id) return error(res, 400, 'No puede desactivar su propia cuenta');
      try {
        await pg.rpc('cambiar_estado', { p_usuario: usuarioId, p_activo: cuerpo.accion === 'reactivar' });
      } catch (e) {
        return error(res, 400, e.message);
      }
      return responderJson(res, 200, { ok: true });
    }

    return error(res, 400, 'Acción no reconocida');
  }

  return { manejar };
}

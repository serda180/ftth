// /auth/v1: reemplazo de Supabase Auth con el mismo protocolo que usa
// supabase-js (ingreso con contraseña, refresh token rotativo, usuario,
// cambio de contraseña, cierre de sesión, recuperación y enlaces).
import { direccionesLocales } from './certificados.mjs';
import { ErrorHttp, ipCliente, leerJson, responderJson } from './base.mjs';
import { firmar, tokenDe, verificar } from './jwt.mjs';
import { enviarCorreo } from './smtp.mjs';

const DURACION = 3600; // segundos de validez del token de acceso

const ERRORES = {
  invalid_credentials: [400, 'Invalid login credentials'],
  email_not_confirmed: [400, 'Email not confirmed'],
  user_banned: [400, 'User is banned'],
  refresh_token_not_found: [400, 'Invalid Refresh Token: Refresh Token Not Found'],
  refresh_token_already_used: [400, 'Invalid Refresh Token: Already Used'],
  weak_password: [422, 'Password should be at least 8 characters.'],
  otp_expired: [403, 'Email link is invalid or has expired'],
  user_not_found: [404, 'User not found'],
  session_not_found: [403, 'Session from session_id claim in JWT does not exist'],
  bad_jwt: [401, 'invalid JWT: unable to parse or verify signature, token is malformed or expired'],
  over_request_rate_limit: [429, 'Request rate limit reached'],
  validation_failed: [400, 'Faltan datos obligatorios'],
};

export function errorAuth(codigo) {
  const [estado, msg] = ERRORES[codigo] ?? [400, codigo];
  return new ErrorHttp(estado, { code: estado, error_code: codigo, msg });
}

/** Dirección con la que otros equipos llegan al servidor (para enlaces). */
export function sitioPublico(req) {
  let host = String(req.headers.host ?? '').replace(/:\d+$/, '');
  if (!/^[A-Za-z0-9.-]+$/.test(host) || /^(localhost|127\.|0\.0\.0\.0)/.test(host)) {
    host = direccionesLocales().find((ip) => ip !== '127.0.0.1') ?? 'localhost';
  }
  return `https://${host}`;
}

// Límite de intentos fallidos de ingreso: 10 cada 5 minutos por IP y correo.
const intentos = new Map();
function limitarIntentos(clave) {
  const ahora = Date.now();
  const lista = (intentos.get(clave) ?? []).filter((t) => ahora - t < 5 * 60 * 1000);
  intentos.set(clave, lista);
  if (lista.length >= 10) throw errorAuth('over_request_rate_limit');
  return () => {
    lista.push(ahora);
    intentos.set(clave, lista);
  };
}
setInterval(() => {
  const ahora = Date.now();
  for (const [k, lista] of intentos) if (!lista.some((t) => ahora - t < 5 * 60 * 1000)) intentos.delete(k);
}, 10 * 60 * 1000).unref();

export function crearAuth({ pg, secreto, smtp, avisar }) {
  function emitirSesion(r) {
    const ahora = Math.floor(Date.now() / 1000);
    const u = r.usuario;
    const access_token = firmar(
      {
        aud: 'authenticated',
        exp: ahora + DURACION,
        iat: ahora,
        iss: 'plataforma-ftth',
        sub: u.id,
        email: u.email,
        phone: '',
        app_metadata: u.app_metadata,
        user_metadata: u.user_metadata,
        role: 'authenticated',
        aal: 'aal1',
        amr: [{ method: 'password', timestamp: ahora }],
        session_id: r.sesion,
        is_anonymous: false,
      },
      secreto,
    );
    return {
      access_token,
      token_type: 'bearer',
      expires_in: DURACION,
      expires_at: ahora + DURACION,
      refresh_token: r.refresh_token,
      user: u,
    };
  }

  /** Verifica el token de acceso y que la sesión siga abierta. */
  async function usuarioActual(req) {
    const carga = verificar(tokenDe(req), secreto);
    if (!carga || carga.role !== 'authenticated' || !carga.sub) throw errorAuth('bad_jwt');
    const u = await pg.rpc('usuario', { p_id: carga.sub, p_sesion: carga.session_id ?? null });
    if (!u) throw errorAuth('session_not_found');
    return { usuario: u, carga, token: tokenDe(req) };
  }

  function revisar(r) {
    if (r?.error) throw errorAuth(r.error);
    return r;
  }

  function enlace(req, token, tipo) {
    const sitio = sitioPublico(req);
    const destino = `${sitio}/establecer-clave`;
    return `${sitio}/auth/v1/verify?token=${token}&type=${tipo}&redirect_to=${encodeURIComponent(destino)}`;
  }

  async function correo(para, asunto, texto) {
    if (!smtp) return false;
    try {
      await enviarCorreo(smtp, { para, asunto, texto });
      return true;
    } catch (e) {
      avisar(`No se pudo enviar el correo a ${para}: ${e.message}`);
      return false;
    }
  }

  async function manejar(req, res, ruta, url) {
    // POST /token?grant_type=password|refresh_token
    if (ruta === '/token' && req.method === 'POST') {
      const cuerpo = await leerJson(req);
      const tipo = url.searchParams.get('grant_type');
      if (tipo === 'password') {
        const email = String(cuerpo.email ?? '').trim();
        const clave = String(cuerpo.password ?? '');
        if (!email || !clave) throw errorAuth('validation_failed');
        const fallo = limitarIntentos(`${ipCliente(req)}|${email.toLowerCase()}`);
        const r = await pg.rpc('iniciar_sesion', {
          p_email: email,
          p_clave: clave,
          p_agente: String(req.headers['user-agent'] ?? ''),
          p_ip: ipCliente(req),
        });
        if (r?.error) {
          fallo();
          throw errorAuth(r.error);
        }
        return responderJson(res, 200, emitirSesion(r));
      }
      if (tipo === 'refresh_token') {
        const token = String(cuerpo.refresh_token ?? '');
        if (!token) throw errorAuth('refresh_token_not_found');
        const r = revisar(await pg.rpc('refrescar', { p_token: token }));
        return responderJson(res, 200, emitirSesion(r));
      }
      throw new ErrorHttp(400, { code: 400, error_code: 'unsupported_grant_type', msg: 'Tipo de ingreso no soportado' });
    }

    if (ruta === '/user' && req.method === 'GET') {
      const { usuario } = await usuarioActual(req);
      return responderJson(res, 200, usuario);
    }

    if (ruta === '/user' && req.method === 'PUT') {
      const { usuario } = await usuarioActual(req);
      const cuerpo = await leerJson(req);
      const r = revisar(
        await pg.rpc('actualizar_usuario', {
          p_id: usuario.id,
          p_clave: cuerpo.password ?? null,
          p_datos: cuerpo.data ?? null,
        }),
      );
      return responderJson(res, 200, r.usuario);
    }

    if (ruta === '/logout' && req.method === 'POST') {
      const carga = verificar(tokenDe(req), secreto);
      if (carga?.sub) {
        await pg.rpc('cerrar_sesion', {
          p_usuario: carga.sub,
          p_sesion: carga.session_id ?? null,
          p_alcance: url.searchParams.get('scope') ?? 'global',
        });
      }
      res.writeHead(204);
      return res.end();
    }

    // Recuperación: si hay correo configurado, envía un enlace. Siempre
    // responde igual para no revelar qué correos existen.
    if (ruta === '/recover' && req.method === 'POST') {
      const cuerpo = await leerJson(req);
      const email = String(cuerpo.email ?? '').trim();
      if (email && smtp) {
        const fallo = limitarIntentos(`recuperar|${ipCliente(req)}`);
        fallo();
        const id = await pg.rpc('buscar_por_email', { p_email: email });
        if (id) {
          const token = await pg.rpc('crear_enlace', { p_usuario: id, p_tipo: 'recovery', p_horas: 2 });
          await correo(
            email,
            'Plataforma FTTH: crear una contraseña nueva',
            `Hola:\n\nPara crear una contraseña nueva en la Plataforma FTTH, abra este enlace (vale por 2 horas):\n\n${enlace(req, token, 'recovery')}\n\nSi usted no lo pidió, ignore este correo.\n`,
          );
        }
      }
      return responderJson(res, 200, {});
    }

    // Canje de enlace de invitación o recuperación: abre sesión y vuelve
    // a la aplicación con los tokens en el fragmento (#), como Supabase.
    if (ruta === '/verify' && req.method === 'GET') {
      const tipo = url.searchParams.get('type') === 'invite' ? 'invite' : 'recovery';
      // Siempre vuelve al mismo servidor (se ignora redirect_to: sin redirecciones abiertas).
      const host = String(req.headers.host ?? '').replace(/[^A-Za-z0-9.:[\]-]/g, '') || 'localhost';
      const destino = `https://${host}/establecer-clave`;
      const r = await pg.rpc('usar_enlace', {
        p_token: String(url.searchParams.get('token') ?? ''),
        p_tipo: tipo,
        p_agente: String(req.headers['user-agent'] ?? ''),
        p_ip: ipCliente(req),
      });
      let fragmento;
      if (r?.error) {
        const [, msg] = ERRORES[r.error] ?? [400, r.error];
        fragmento = new URLSearchParams({ error: 'access_denied', error_code: r.error, error_description: msg });
      } else {
        const s = emitirSesion(r);
        fragmento = new URLSearchParams({
          access_token: s.access_token,
          expires_at: String(s.expires_at),
          expires_in: String(s.expires_in),
          refresh_token: s.refresh_token,
          token_type: 'bearer',
          type: tipo,
        });
      }
      res.writeHead(303, { Location: `${destino}#${fragmento}`, 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (ruta === '/settings' && req.method === 'GET') {
      return responderJson(res, 200, {
        external: { email: true, phone: false },
        disable_signup: true,
        mailer_autoconfirm: false,
        phone_autoconfirm: false,
        sms_provider: '',
        saml_enabled: false,
      });
    }

    if (ruta === '/health') return responderJson(res, 200, { name: 'plataforma-ftth-auth', description: 'ok' });

    throw new ErrorHttp(404, { code: 404, error_code: 'not_found', msg: 'Ruta no encontrada' });
  }

  return { manejar, usuarioActual, enlace, correo };
}

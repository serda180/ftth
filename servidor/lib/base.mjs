// Utilidades HTTP y cliente de PostgREST para los módulos del servidor.
import { firmar } from './jwt.mjs';

export class ErrorHttp extends Error {
  constructor(estado, cuerpo) {
    super(typeof cuerpo === 'string' ? cuerpo : (cuerpo?.msg ?? cuerpo?.message ?? cuerpo?.error ?? 'Error'));
    this.estado = estado;
    this.cuerpo = cuerpo;
  }
}

export function responderJson(res, estado, datos, cabeceras = {}) {
  const cuerpo = datos === undefined ? '' : JSON.stringify(datos);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...cabeceras,
  });
  res.end(cuerpo);
}

/** Lee el cuerpo completo con un límite de tamaño (bytes). */
export function leerCuerpo(req, limite = 1024 * 1024) {
  return new Promise((resolver, rechazar) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limite) {
        rechazar(new ErrorHttp(413, { statusCode: '413', error: 'Payload too large', message: 'El archivo supera el tamaño máximo permitido' }));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolver(Buffer.concat(partes)));
    req.on('error', rechazar);
  });
}

export async function leerJson(req, limite) {
  const cuerpo = await leerCuerpo(req, limite);
  if (cuerpo.length === 0) return {};
  try {
    return JSON.parse(cuerpo.toString('utf8'));
  } catch {
    throw new ErrorHttp(400, { code: 400, error_code: 'bad_json', msg: 'Could not parse request body as JSON' });
  }
}

export function ipCliente(req) {
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}

/** Cliente de PostgREST. Sin token usa service_role (solo dentro del servidor). */
export function crearPostgrest({ url, secreto }) {
  function tokenServicio() {
    const ahora = Math.floor(Date.now() / 1000);
    return firmar({ role: 'service_role', iss: 'plataforma-ftth', iat: ahora, exp: ahora + 300 }, secreto);
  }

  async function llamar(metodo, ruta, { cuerpo, token, perfil, cabeceras = {} } = {}) {
    const h = {
      Accept: 'application/json',
      Authorization: `Bearer ${token ?? tokenServicio()}`,
      ...cabeceras,
    };
    if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
    if (perfil) {
      h['Accept-Profile'] = perfil;
      h['Content-Profile'] = perfil;
    }
    const r = await fetch(url + ruta, {
      method: metodo,
      headers: h,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = texto;
    }
    return { estado: r.status, datos, ok: r.ok };
  }

  /** Llama una función de la base. Lanza si PostgREST responde con error. */
  async function rpc(nombre, args = {}, { perfil = 'servidor', token } = {}) {
    const r = await llamar('POST', `/rpc/${nombre}`, { cuerpo: args, perfil, token });
    if (!r.ok) {
      const e = new Error(r.datos?.message ?? `Error ${r.estado} en ${nombre}`);
      e.estado = r.estado;
      e.codigo = r.datos?.code;
      throw e;
    }
    return r.datos;
  }

  return { llamar, rpc, tokenServicio };
}

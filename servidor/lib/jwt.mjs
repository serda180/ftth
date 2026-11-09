// JWT HS256 con el módulo crypto de Node (sin dependencias).
// Es el mismo formato que firman Supabase Auth y que verifica PostgREST.
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function firmar(carga, secreto) {
  const cabecera = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(carga));
  const firma = createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

/** Devuelve la carga si la firma es válida y no venció; si no, null. */
export function verificar(token, secreto) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabecera, cuerpo, firma] = partes;
  let alg;
  try {
    alg = JSON.parse(Buffer.from(cabecera, 'base64url').toString('utf8')).alg;
  } catch {
    return null;
  }
  if (alg !== 'HS256') return null;
  const esperada = createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest();
  const recibida = Buffer.from(firma, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  let carga;
  try {
    carga = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof carga.exp === 'number' && carga.exp < Math.floor(Date.now() / 1000)) return null;
  return carga;
}

/** Token del encabezado Authorization: Bearer ... */
export function tokenDe(req) {
  const h = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

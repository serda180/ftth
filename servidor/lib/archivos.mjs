// /storage/v1: reemplazo de Supabase Storage para las fotos de órdenes.
// Los metadatos van en storage.objects y se insertan/leen con el token del
// usuario, así las políticas RLS de las migraciones deciden quién sube y
// quién ve. Los archivos quedan en disco, en <archivos>/<bucket>/<ruta>.
import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ErrorHttp, leerCuerpo, leerJson, responderJson } from './base.mjs';
import { firmar, verificar } from './jwt.mjs';
import { extraerArchivo } from './multipart.mjs';

const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

const errorStorage = (estado, error, message) => new ErrorHttp(estado === 409 ? 409 : 400, { statusCode: String(estado), error, message });

function validarRuta(ruta) {
  if (
    !ruta ||
    ruta.length > 500 ||
    ruta.startsWith('/') ||
    ruta.includes('\\') ||
    ruta.split('/').some((s) => s === '' || s === '.' || s === '..') ||
    !/^[\p{L}\p{N} _.()\-/]+$/u.test(ruta)
  ) {
    throw errorStorage(400, 'Invalid key', 'Nombre de archivo no válido');
  }
  return ruta;
}

export function crearArchivos({ pg, secreto, carpeta, usuarioActual }) {
  // Clave propia para las URL firmadas (distinta de la de los JWT de la API).
  const claveFirma = createHmac('sha256', secreto).update('archivos-firmados').digest('hex');

  function rutaEnDisco(bucket, ruta) {
    const base = resolve(carpeta, bucket);
    const destino = resolve(base, ...ruta.split('/'));
    if (!destino.startsWith(base + sep)) throw errorStorage(400, 'Invalid key', 'Nombre de archivo no válido');
    return destino;
  }

  async function bucket(id) {
    const r = await pg.llamar('GET', `/buckets?id=eq.${encodeURIComponent(id)}&select=*`, { perfil: 'storage' });
    const b = Array.isArray(r.datos) ? r.datos[0] : null;
    if (!b) throw errorStorage(404, 'Bucket not found', 'Bucket not found');
    return b;
  }

  async function subir(req, res, bucketId, ruta, actualizar) {
    const { usuario, token } = await usuarioActual(req);
    const b = await bucket(bucketId);
    const limite = Number(b.file_size_limit ?? 50 * 1024 * 1024);
    const cuerpo = await leerCuerpo(req, limite + 64 * 1024);

    let datos = cuerpo;
    let tipo = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (tipo === 'multipart/form-data') {
      const archivo = extraerArchivo(cuerpo, req.headers['content-type']);
      if (!archivo) throw errorStorage(400, 'Invalid request', 'No se recibió ningún archivo');
      datos = archivo.datos;
      tipo = archivo.tipo;
    }
    if (datos.length > limite) throw errorStorage(413, 'Payload too large', 'El archivo supera el tamaño máximo permitido');
    if (Array.isArray(b.allowed_mime_types) && b.allowed_mime_types.length && !b.allowed_mime_types.includes(tipo)) {
      throw errorStorage(415, 'invalid_mime_type', `Tipo de archivo no permitido: ${tipo}`);
    }

    const id = randomUUID();
    const upsert = actualizar || String(req.headers['x-upsert'] ?? '') === 'true';
    const fila = {
      id,
      bucket_id: bucketId,
      name: ruta,
      owner: usuario.id,
      owner_id: usuario.id,
      metadata: { mimetype: tipo, size: datos.length },
    };
    const r = await pg.llamar('POST', upsert ? '/objects?on_conflict=bucket_id,name' : '/objects', {
      cuerpo: fila,
      token,
      perfil: 'storage',
      cabeceras: { Prefer: upsert ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal' },
    });
    if (!r.ok) {
      if (r.datos?.code === '23505') throw errorStorage(409, 'Duplicate', 'The resource already exists');
      if (r.estado === 401 || r.estado === 403 || r.datos?.code === '42501') {
        throw errorStorage(403, 'Unauthorized', 'new row violates row-level security policy');
      }
      throw errorStorage(500, 'internal', r.datos?.message ?? 'No se pudo registrar el archivo');
    }

    const destino = rutaEnDisco(bucketId, ruta);
    try {
      await mkdir(dirname(destino), { recursive: true });
      const temporal = `${destino}.${id}.tmp`;
      await writeFile(temporal, datos);
      await rename(temporal, destino);
    } catch (e) {
      // Sin archivo no debe quedar el registro.
      await pg.llamar('DELETE', `/objects?id=eq.${id}`, { perfil: 'storage' });
      throw e;
    }
    return responderJson(res, 200, { Key: `${bucketId}/${ruta}`, Id: id });
  }

  function urlFirmada(bucketId, ruta, segundos) {
    const ahora = Math.floor(Date.now() / 1000);
    const token = firmar({ url: `${bucketId}/${ruta}`, iat: ahora, exp: ahora + segundos }, claveFirma);
    const rutaCodificada = ruta.split('/').map(encodeURIComponent).join('/');
    return `/object/sign/${bucketId}/${rutaCodificada}?token=${token}`;
  }

  async function firmarVarias(req, res, bucketId) {
    const { token } = await usuarioActual(req);
    const cuerpo = await leerJson(req);
    const rutas = Array.isArray(cuerpo.paths) ? cuerpo.paths.map(String) : [];
    const segundos = Math.min(Math.max(Number(cuerpo.expiresIn) || 60, 1), 7 * 24 * 3600);
    if (rutas.length === 0) return responderJson(res, 200, []);
    if (rutas.length > 1000) throw errorStorage(400, 'Invalid request', 'Demasiados archivos');
    // RLS: solo vuelven las filas que el usuario puede ver.
    const lista = rutas.map((p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
    const r = await pg.llamar(
      'GET',
      `/objects?select=name&bucket_id=eq.${encodeURIComponent(bucketId)}&name=in.(${encodeURIComponent(lista)})`,
      { token, perfil: 'storage' },
    );
    const visibles = new Set(Array.isArray(r.datos) ? r.datos.map((f) => f.name) : []);
    return responderJson(
      res,
      200,
      rutas.map((ruta) =>
        visibles.has(ruta)
          ? { error: null, path: ruta, signedURL: urlFirmada(bucketId, ruta, segundos) }
          : { error: 'Either the object does not exist or you do not have access to it', path: ruta, signedURL: null },
      ),
    );
  }

  async function firmarUna(req, res, bucketId, ruta) {
    const { token } = await usuarioActual(req);
    const cuerpo = await leerJson(req);
    const segundos = Math.min(Math.max(Number(cuerpo.expiresIn) || 60, 1), 7 * 24 * 3600);
    const r = await pg.llamar(
      'GET',
      `/objects?select=name&bucket_id=eq.${encodeURIComponent(bucketId)}&name=eq.${encodeURIComponent(ruta)}`,
      { token, perfil: 'storage' },
    );
    if (!Array.isArray(r.datos) || r.datos.length === 0) throw errorStorage(404, 'not_found', 'Object not found');
    return responderJson(res, 200, { signedURL: urlFirmada(bucketId, ruta, segundos) });
  }

  async function descargarFirmada(res, bucketId, ruta, token) {
    const carga = verificar(token, claveFirma);
    if (!carga || carga.url !== `${bucketId}/${ruta}`) throw errorStorage(400, 'InvalidJWT', 'jwt expired or invalid');
    const archivo = rutaEnDisco(bucketId, ruta);
    let info;
    try {
      info = await stat(archivo);
    } catch {
      throw errorStorage(404, 'not_found', 'Object not found');
    }
    const ext = ruta.split('.').pop().toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(archivo).pipe(res);
  }

  async function borrar(req, res, bucketId) {
    const { token } = await usuarioActual(req);
    const cuerpo = await leerJson(req);
    const rutas = Array.isArray(cuerpo.prefixes) ? cuerpo.prefixes.map(String) : [];
    if (rutas.length === 0) return responderJson(res, 200, []);
    const lista = rutas.map((p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
    const r = await pg.llamar(
      'DELETE',
      `/objects?bucket_id=eq.${encodeURIComponent(bucketId)}&name=in.(${encodeURIComponent(lista)})`,
      { token, perfil: 'storage', cabeceras: { Prefer: 'return=representation' } },
    );
    const borradas = Array.isArray(r.datos) ? r.datos : [];
    for (const f of borradas) await unlink(rutaEnDisco(bucketId, f.name)).catch(() => {});
    return responderJson(res, 200, borradas);
  }

  async function manejar(req, res, ruta, url) {
    // /object/sign/<bucket>             POST  -> varias URL firmadas
    // /object/sign/<bucket>/<ruta>      POST  -> una URL firmada
    // /object/sign/<bucket>/<ruta>?token GET  -> descarga
    // /object/<bucket>/<ruta>           POST/PUT -> subir
    // /object/<bucket>                  DELETE -> borrar varias
    const partes = ruta.split('/').filter(Boolean).map(decodeURIComponent);
    if (partes[0] !== 'object') throw errorStorage(404, 'not_found', 'Ruta no encontrada');
    if (partes[1] === 'sign') {
      const bucketId = partes[2];
      const rutaArchivo = partes.slice(3).join('/');
      if (!bucketId) throw errorStorage(400, 'Invalid request', 'Falta el bucket');
      if (req.method === 'POST' && !rutaArchivo) return firmarVarias(req, res, bucketId);
      validarRuta(rutaArchivo);
      if (req.method === 'POST') return firmarUna(req, res, bucketId, rutaArchivo);
      if (req.method === 'GET') return descargarFirmada(res, bucketId, rutaArchivo, url.searchParams.get('token'));
    } else {
      const bucketId = partes[1];
      const rutaArchivo = partes.slice(2).join('/');
      if (req.method === 'DELETE' && bucketId && !rutaArchivo) return borrar(req, res, bucketId);
      if ((req.method === 'POST' || req.method === 'PUT') && bucketId) {
        return subir(req, res, bucketId, validarRuta(rutaArchivo), req.method === 'PUT');
      }
    }
    throw errorStorage(405, 'not_allowed', 'Operación no soportada');
  }

  return { manejar, rutaEnDisco };
}

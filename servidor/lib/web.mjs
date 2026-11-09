// Archivos de la aplicación (frontend compilado), /config.js y cabeceras.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const COMPRIMIBLES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map']);

export const CABECERAS_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; " +
    "worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function crearWeb({ carpeta, anonKey, correoConfigurado }) {
  const base = resolve(carpeta);
  const cacheGzip = new Map(); // ruta -> {mtime, datos}

  function hostSeguro(req) {
    const h = String(req.headers.host ?? '');
    return /^[A-Za-z0-9.:[\]-]+$/.test(h) ? h : 'localhost';
  }

  function configJs(req) {
    const url = `https://${hostSeguro(req)}`;
    return (
      `window.__CONFIG__ = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, CORREO: correoConfigurado })};\n`
    );
  }

  async function servirArchivo(req, res, archivo, info, cache) {
    const ext = extname(archivo).toLowerCase();
    const cabeceras = {
      ...CABECERAS_SEGURIDAD,
      'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
      'Cache-Control': cache,
      'Last-Modified': info.mtime.toUTCString(),
    };
    if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(info.mtime.toUTCString())) {
      res.writeHead(304, cabeceras);
      return res.end();
    }
    const aceptaGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    if (aceptaGzip && COMPRIMIBLES.has(ext) && info.size > 1024) {
      let entrada = cacheGzip.get(archivo);
      if (!entrada || entrada.mtime !== info.mtimeMs) {
        entrada = { mtime: info.mtimeMs, datos: gzipSync(await readFile(archivo)) };
        cacheGzip.set(archivo, entrada);
      }
      res.writeHead(200, { ...cabeceras, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': entrada.datos.length });
      return res.end(req.method === 'HEAD' ? undefined : entrada.datos);
    }
    res.writeHead(200, { ...cabeceras, 'Content-Length': info.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(archivo).pipe(res);
  }

  async function manejar(req, res, ruta) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    if (ruta === '/config.js') {
      res.writeHead(200, { ...CABECERAS_SEGURIDAD, 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(configJs(req));
    }

    let relativa;
    try {
      relativa = decodeURIComponent(ruta);
    } catch {
      relativa = '/';
    }
    const archivo = resolve(base, `.${relativa}`);
    if (archivo.startsWith(base + sep)) {
      try {
        const info = await stat(archivo);
        if (info.isFile()) {
          const cache = ruta.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : ruta === '/sw.js'
              ? 'no-store'
              : 'no-cache';
          return await servirArchivo(req, res, archivo, info, cache);
        }
      } catch {
        // no existe: sigue a la aplicación de una sola página
      }
    }
    if (ruta.startsWith('/assets/') || extname(ruta)) {
      res.writeHead(404, { ...CABECERAS_SEGURIDAD, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    const indice = join(base, 'index.html');
    try {
      return await servirArchivo(req, res, indice, await stat(indice), 'no-cache');
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('La aplicación web no está compilada. Ejecute de nuevo el instalador.');
    }
  }

  return { manejar };
}

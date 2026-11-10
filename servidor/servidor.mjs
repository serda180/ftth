#!/usr/bin/env node
// Servidor de la Plataforma FTTH para Windows (sin Docker).
//
// Un solo proceso que:
//   - sirve la aplicación web por HTTPS (443) con certificado local,
//   - redirige HTTP (80) a HTTPS y entrega el certificado raíz,
//   - reemplaza a Supabase Auth, Storage y Edge Functions,
//   - reenvía /rest/v1 a PostgREST (proceso hijo, solo en 127.0.0.1),
//   - libera las reservas de puertos vencidas cada 15 minutos.
//
// Uso: node servidor.mjs <ruta a config.json>
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, resolve } from 'node:path';
import { crearArchivos } from './lib/archivos.mjs';
import { crearAuth } from './lib/auth.mjs';
import { ErrorHttp, crearPostgrest, responderJson } from './lib/base.mjs';
import { asegurarCertificados } from './lib/certificados.mjs';
import { firmar } from './lib/jwt.mjs';
import { crearUsuarios } from './lib/usuarios.mjs';
import { crearWeb } from './lib/web.mjs';

const rutaConfig = resolve(process.argv[2] ?? process.env.FTTH_CONFIG ?? 'config.json');
const cfg = JSON.parse(readFileSync(rutaConfig, 'utf8').replace(/^﻿/, ''));
const ruta = (p) => resolve(dirname(rutaConfig), p);

function avisar(mensaje) {
  console.log(`${new Date().toISOString()}  ${mensaje}`);
}

if (!cfg.jwt_secret || cfg.jwt_secret.length < 32) {
  console.error('config.json: jwt_secret falta o es demasiado corto');
  process.exit(1);
}

// ---------------------------------------------------------------------
// PostgREST como proceso hijo
// ---------------------------------------------------------------------
let postgrest = null;
let cerrando = false;

function iniciarPostgrest() {
  if (!cfg.postgrest.exe) return; // PostgREST externo (pruebas)
  // En Windows, postgrest.exe necesita libpq.dll y sus dependencias: la carpeta
  // bin de PostgreSQL se antepone al PATH del proceso hijo.
  const entorno = { ...process.env };
  if (cfg.postgrest.path) {
    const clave = Object.keys(entorno).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const separador = process.platform === 'win32' ? ';' : ':';
    entorno[clave] = [ruta(cfg.postgrest.path), entorno[clave]].filter(Boolean).join(separador);
  }
  postgrest = spawn(ruta(cfg.postgrest.exe), [ruta(cfg.postgrest.config)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: entorno,
  });
  postgrest.on('error', (e) => avisar(`No se pudo iniciar PostgREST: ${e.message}`));
  const registrar = (d) => {
    for (const linea of d.toString('utf8').split(/\r?\n/)) if (linea.trim()) avisar(`[postgrest] ${linea.trim()}`);
  };
  postgrest.stdout.on('data', registrar);
  postgrest.stderr.on('data', registrar);
  postgrest.on('exit', (codigo) => {
    postgrest = null;
    if (!cerrando) {
      const detalle = codigo === 3221225781 ? ' — falta una DLL (libpq.dll): revise la carpeta runtime\\pgsql\\bin' : '';
      avisar(`PostgREST terminó (código ${codigo}${detalle}); se reinicia en 3 s`);
      setTimeout(iniciarPostgrest, 3000);
    }
  });
}

// ---------------------------------------------------------------------
// Módulos
// ---------------------------------------------------------------------
const secreto = cfg.jwt_secret;
const ahora = Math.floor(Date.now() / 1000);
const anonKey = firmar({ role: 'anon', iss: 'plataforma-ftth', iat: ahora, exp: ahora + 10 * 365 * 24 * 3600 }, secreto);
const smtp = cfg.smtp?.host ? cfg.smtp : null;

const pg = crearPostgrest({ url: cfg.postgrest.url, secreto });
const auth = crearAuth({ pg, secreto, smtp, avisar });
const archivos = crearArchivos({ pg, secreto, carpeta: ruta(cfg.archivos), usuarioActual: auth.usuarioActual });
const usuarios = crearUsuarios({ pg, auth });
const web = crearWeb({ carpeta: ruta(cfg.web), anonKey, correoConfigurado: Boolean(smtp) });
let certificados = asegurarCertificados(ruta(cfg.certificados), avisar);

// ---------------------------------------------------------------------
// /rest/v1 -> PostgREST
// ---------------------------------------------------------------------
const SALTOS = ['host', 'connection', 'keep-alive', 'proxy-connection', 'upgrade', 'te', 'trailer', 'transfer-encoding'];

function proxyRest(req, res, resto) {
  // Solo el esquema public es accesible desde el navegador.
  for (const h of ['accept-profile', 'content-profile']) {
    if (req.headers[h] && req.headers[h] !== 'public') {
      return responderJson(res, 406, { code: 'PGRST106', message: 'Esquema no permitido' });
    }
  }
  const cabeceras = { ...req.headers };
  for (const h of SALTOS) delete cabeceras[h];
  if (!cabeceras.authorization && cabeceras.apikey === anonKey) cabeceras.authorization = `Bearer ${anonKey}`;

  const destino = new URL(cfg.postgrest.url + resto);
  const peticion = http.request(destino, { method: req.method, headers: cabeceras }, (r) => {
    const salida = { ...r.headers, 'x-content-type-options': 'nosniff' };
    for (const h of SALTOS) delete salida[h];
    res.writeHead(r.statusCode ?? 502, salida);
    r.pipe(res);
  });
  peticion.on('error', () => {
    if (!res.headersSent) responderJson(res, 503, { message: 'La base de datos no está disponible. Intente en unos segundos.' });
    else res.destroy();
  });
  let recibido = 0;
  req.on('data', (c) => {
    recibido += c.length;
    if (recibido > 20 * 1024 * 1024) {
      peticion.destroy();
      req.destroy();
    }
  });
  req.pipe(peticion);
}

function servirRaiz(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-x509-ca-cert',
    'Content-Disposition': 'attachment; filename="certificado-ftth.crt"',
    'Cache-Control': 'no-cache',
  });
  res.end(certificados.raiz);
}

// ---------------------------------------------------------------------
// HTTPS
// ---------------------------------------------------------------------
async function atender(req, res) {
  let url;
  try {
    url = new URL(req.url ?? '/', 'https://localhost');
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const p = url.pathname;
  try {
    if (p === '/salud') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(postgrest || !cfg.postgrest.exe ? 'ok' : 'iniciando');
    }
    if (p === '/certificado.crt') return servirRaiz(res);
    if (p === '/rest/v1' || p.startsWith('/rest/v1/')) return proxyRest(req, res, (p.slice(8) || '/') + url.search);
    if (p.startsWith('/auth/v1/')) return await auth.manejar(req, res, p.slice(8), url);
    if (p.startsWith('/storage/v1/')) return await archivos.manejar(req, res, p.slice(11), url);
    if (p.startsWith('/functions/v1/')) return await usuarios.manejar(req, res, p.slice(14));
    return await web.manejar(req, res, p);
  } catch (e) {
    if (e instanceof ErrorHttp) {
      if (!res.headersSent) return responderJson(res, e.estado, e.cuerpo);
      return res.destroy();
    }
    avisar(`Error en ${req.method} ${p}: ${e.stack ?? e.message}`);
    if (!res.headersSent) responderJson(res, 500, { message: 'Error interno del servidor' });
    else res.destroy();
  }
}

const servidorHttps = https.createServer({ key: certificados.key, cert: certificados.cert }, atender);

// HTTP: certificado raíz y redirección a HTTPS.
const servidorHttp = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/certificado.crt') return servirRaiz(res);
  if (url.pathname === '/salud') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }
  const host = String(req.headers.host ?? 'localhost').replace(/:\d+$/, '').replace(/[^A-Za-z0-9.[\]-]/g, '') || 'localhost';
  const puerto = Number(cfg.puertos?.https ?? 443) === 443 ? '' : `:${cfg.puertos.https}`;
  res.writeHead(308, { Location: `https://${host}${puerto}${url.pathname}${url.search}` });
  res.end();
});

const escuchar = (srv, puerto, nombre) =>
  srv
    .listen(puerto, cfg.escuchar ?? '0.0.0.0', () => avisar(`${nombre} en el puerto ${puerto}`))
    .on('error', (e) => {
      avisar(`No se pudo abrir el puerto ${puerto} (${nombre}): ${e.message}`);
      process.exit(1);
    });

// ---------------------------------------------------------------------
// Tareas periódicas
// ---------------------------------------------------------------------
async function tarea(nombre, fn) {
  try {
    await fn();
  } catch (e) {
    avisar(`Tarea ${nombre}: ${e.message}`);
  }
}

setInterval(() => tarea('liberar reservas', () => pg.rpc('liberar_reservas_vencidas', {}, { perfil: 'public' })), 15 * 60 * 1000);
setInterval(() => tarea('limpieza', () => pg.rpc('limpiar')), 24 * 60 * 60 * 1000);
// Si cambia la IP del PC, se renueva el certificado del sitio sin reiniciar.
setInterval(() => {
  try {
    const nuevos = asegurarCertificados(ruta(cfg.certificados), avisar);
    if (nuevos.cert !== certificados.cert) {
      certificados = nuevos;
      servidorHttps.setSecureContext({ key: nuevos.key, cert: nuevos.cert });
    }
  } catch (e) {
    avisar(`Certificados: ${e.message}`);
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------
// Arranque y cierre
// ---------------------------------------------------------------------
function cerrar() {
  if (cerrando) return;
  cerrando = true;
  avisar('Deteniendo el servidor');
  postgrest?.kill();
  servidorHttps.close();
  servidorHttp.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, cerrar);
process.on('exit', () => postgrest?.kill());

avisar(`Plataforma FTTH: iniciando (config ${rutaConfig})`);
iniciarPostgrest();
escuchar(servidorHttps, Number(cfg.puertos?.https ?? 443), 'HTTPS');
escuchar(servidorHttp, Number(cfg.puertos?.http ?? 80), 'HTTP');
setTimeout(() => tarea('liberar reservas', () => pg.rpc('liberar_reservas_vencidas', {}, { perfil: 'public' })), 60 * 1000);

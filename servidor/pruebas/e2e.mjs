// Prueba de punta a punta del servidor: reproduce las llamadas que hace supabase-js.
// Requiere el servidor corriendo contra una base con las migraciones, servidor/sql y supabase/seed.sql,
// y un administrador admin@prueba.cl / clave-segura-1. Variables: BASE (https://...), RAIZ (certificados/raiz.crt).
// Ejecutar con NODE_EXTRA_CA_CERTS=$RAIZ para validar el certificado como lo haría un navegador.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const B = process.env.BASE ?? 'https://127.0.0.1:8443';
const RAIZ = readFileSync(process.env.RAIZ, 'utf8');
let anon;
const ok = (m) => console.log('  ✔', m);

async function f(ruta, { metodo = 'GET', token, cuerpo, cabeceras = {}, crudo } = {}) {
  const h = { apikey: anon ?? '', 'X-Client-Info': 'supabase-js-web/2.x', ...cabeceras };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (crudo !== undefined) body = crudo;
  else if (cuerpo !== undefined) { body = JSON.stringify(cuerpo); h['Content-Type'] = 'application/json;charset=UTF-8'; }
  const r = await fetch(B + ruta, { method: metodo, headers: h, body, redirect: 'manual' });
  const texto = await r.text();
  let datos; try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  return { estado: r.status, datos, h: r.headers, texto };
}

// --- configuración y archivos estáticos
let r = await f('/config.js');
assert.equal(r.estado, 200);
const cfg = JSON.parse(/window.__CONFIG__ = (.*);/.exec(r.texto)[1]);
assert.equal(cfg.SUPABASE_URL, B); anon = cfg.SUPABASE_ANON_KEY; assert.equal(cfg.CORREO, false);
ok('config.js con URL del propio servidor, anon key y CORREO=false');
r = await f('/'); assert.match(r.texto, /APP-INDEX/); assert.match(r.h.get('content-security-policy'), /connect-src 'self'/);
r = await f('/clientes/123'); assert.match(r.texto, /APP-INDEX/);
r = await f('/assets/app-123.js', { cabeceras: { 'Accept-Encoding': 'gzip' } }); assert.equal(r.estado, 200); assert.match(r.h.get('cache-control'), /immutable/);
r = await f('/assets/no-existe.js'); assert.equal(r.estado, 404);
r = await f('/certificado.crt'); assert.equal(r.texto, RAIZ);
ok('estáticos: índice, ruta SPA, assets con caché inmutable, 404, certificado');

// --- ingreso
r = await f('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: 'admin@prueba.cl', password: 'mala', gotrue_meta_security: {} } });
assert.equal(r.estado, 400); assert.equal(r.datos.error_code, 'invalid_credentials'); assert.equal(r.datos.msg, 'Invalid login credentials');
ok('contraseña mala -> 400 invalid_credentials');
r = await f('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: 'Admin@Prueba.cl', password: 'clave-segura-1', gotrue_meta_security: {} } });
assert.equal(r.estado, 200, JSON.stringify(r.datos));
let s = r.datos;
for (const k of ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'user']) assert.ok(k in s, k);
assert.equal(s.user.email, 'admin@prueba.cl'); assert.equal(s.token_type, 'bearer');
ok('ingreso: sesión con access_token, refresh_token y user');
r = await f('/auth/v1/user', { token: s.access_token }); assert.equal(r.estado, 200); assert.equal(r.datos.id, s.user.id);
ok('GET /auth/v1/user');

// --- REST con RLS
r = await f('/rest/v1/perfiles?select=id,email,nombre_completo,telefono,activo&id=eq.' + s.user.id, { token: s.access_token, cabeceras: { Accept: 'application/vnd.pgrst.object+json' } });
assert.equal(r.estado, 200, JSON.stringify(r.datos)); assert.equal(r.datos.email, 'admin@prueba.cl');
r = await f('/rest/v1/rpc/mis_roles', { metodo: 'POST', token: s.access_token, cuerpo: {} });
assert.deepEqual(r.datos, ['administrador']);
r = await f('/rest/v1/clientes_vista?select=codigo&limit=3', { token: s.access_token, cabeceras: { Prefer: 'count=exact' } });
assert.ok([200, 206].includes(r.estado)); assert.ok(r.datos.length > 0); assert.match(r.h.get('content-range') ?? '', /\/\d+$/);
r = await f('/rest/v1/clientes_vista?select=codigo&limit=3', { token: anon });
assert.ok(r.estado === 200 ? r.datos.length === 0 : r.estado === 401 || r.estado === 403, `anon ve clientes: ${r.estado} ${r.texto}`);
ok('REST: perfil, rpc mis_roles, vista con count exacto; anon sin datos');
r = await f('/rest/v1/rpc/iniciar_sesion', { metodo: 'POST', token: s.access_token, cuerpo: {}, cabeceras: { 'Content-Profile': 'servidor' } });
assert.equal(r.estado, 406);
r = await f('/rest/v1/objects', { token: s.access_token, cabeceras: { 'Accept-Profile': 'storage' } });
assert.equal(r.estado, 406);
ok('REST: esquemas servidor y storage bloqueados desde el navegador');

// --- refresh
r = await f('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', cuerpo: { refresh_token: s.refresh_token } });
assert.equal(r.estado, 200); assert.notEqual(r.datos.refresh_token, s.refresh_token);
const s2 = r.datos;
r = await f('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', cuerpo: { refresh_token: 'no-existe' } });
assert.equal(r.estado, 400); assert.equal(r.datos.error_code, 'refresh_token_not_found');
ok('refresh: rota el token; token inexistente -> 400');

// --- invitación sin correo -> enlace
r = await f('/functions/v1/admin-usuarios', { metodo: 'POST', token: s2.access_token, cuerpo: { accion: 'invitar', email: 'Tec@Prueba.cl', nombre_completo: 'Técnico Uno', roles: ['tecnico'] } });
assert.equal(r.estado, 200, JSON.stringify(r.datos)); assert.equal(r.datos.correo_enviado, false);
const enlace = new URL(r.datos.enlace);
assert.equal(enlace.pathname, '/auth/v1/verify'); assert.equal(enlace.searchParams.get('type'), 'invite');
const tecId = r.datos.usuario_id;
r = await f('/functions/v1/admin-usuarios', { metodo: 'POST', token: s2.access_token, cuerpo: { accion: 'invitar', email: 'tec@prueba.cl', nombre_completo: 'Otra vez', roles: ['tecnico'] } });
assert.equal(r.estado, 409); assert.equal(r.datos.error, 'Ya existe un usuario con ese correo');
ok(`invitar: enlace ${enlace.origin}/auth/v1/verify?...; duplicado -> 409`);

r = await f(enlace.pathname + enlace.search);
assert.equal(r.estado, 303);
const loc = new URL(r.h.get('location'));
assert.equal(loc.pathname, '/establecer-clave'); assert.equal(loc.origin, B);
const frag = new URLSearchParams(loc.hash.slice(1));
assert.equal(frag.get('type'), 'invite'); assert.ok(frag.get('access_token') && frag.get('refresh_token') && frag.get('expires_in'));
r = await f(enlace.pathname + enlace.search);
assert.equal(new URLSearchParams(new URL(r.h.get('location')).hash.slice(1)).get('error_code'), 'otp_expired');
ok('enlace de invitación: redirige con tokens en #; segundo uso -> otp_expired');

const tTec = frag.get('access_token');
r = await f('/auth/v1/user', { token: tTec }); assert.equal(r.datos.email, 'tec@prueba.cl');
r = await f('/auth/v1/user', { metodo: 'PUT', token: tTec, cuerpo: { password: 'corta' } });
assert.equal(r.estado, 422); assert.match(r.datos.msg, /at least 8/);
r = await f('/auth/v1/user', { metodo: 'PUT', token: tTec, cuerpo: { password: 'clave-tecnico-1' } });
assert.equal(r.estado, 200); assert.equal(r.datos.email, 'tec@prueba.cl');
r = await f('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: 'tec@prueba.cl', password: 'clave-tecnico-1' } });
assert.equal(r.estado, 200); const sTec = r.datos;
r = await f('/rest/v1/rpc/mis_roles', { metodo: 'POST', token: sTec.access_token, cuerpo: {} });
assert.deepEqual(r.datos, ['tecnico']);
ok('invitado fija su contraseña, ingresa y tiene rol técnico');

r = await f('/functions/v1/admin-usuarios', { metodo: 'POST', token: sTec.access_token, cuerpo: { accion: 'invitar', email: 'x@prueba.cl', nombre_completo: 'X', roles: ['tecnico'] } });
assert.equal(r.estado, 403);
ok('un técnico no puede invitar -> 403');

// --- enlace de recuperación generado por el admin
r = await f('/functions/v1/admin-usuarios', { metodo: 'POST', token: s2.access_token, cuerpo: { accion: 'enlace', usuario_id: tecId } });
assert.equal(r.estado, 200); const e2 = new URL(r.datos.enlace); assert.equal(e2.searchParams.get('type'), 'recovery');
r = await f(e2.pathname + e2.search);
assert.equal(new URLSearchParams(new URL(r.h.get('location')).hash.slice(1)).get('type'), 'recovery');
ok('enlace de recuperación: type=recovery');

// --- fotos
r = await f('/rest/v1/ordenes_trabajo?select=id&limit=1', { token: s2.access_token });
const orden = r.datos[0].id;
const foto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from('foto de prueba ñ')]);
const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', new Blob([foto], { type: 'image/jpeg' }));
r = await f(`/storage/v1/object/ordenes/${orden}/foto-1.jpg`, { metodo: 'POST', token: s2.access_token, crudo: fd, cabeceras: { 'x-upsert': 'false' } });
assert.equal(r.estado, 200, JSON.stringify(r.datos)); assert.equal(r.datos.Key, `ordenes/${orden}/foto-1.jpg`);
const fd2 = new FormData(); fd2.append('', new Blob([foto], { type: 'image/jpeg' }));
r = await f(`/storage/v1/object/ordenes/${orden}/foto-1.jpg`, { metodo: 'POST', token: s2.access_token, crudo: fd2 });
assert.equal(r.datos?.error, 'Duplicate');
const fd3 = new FormData(); fd3.append('', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }));
r = await f(`/storage/v1/object/ordenes/${orden}/virus.exe`, { metodo: 'POST', token: s2.access_token, crudo: fd3 });
assert.notEqual(r.estado, 200);
const fd4 = new FormData(); fd4.append('', new Blob([foto], { type: 'image/jpeg' }));
r = await f(`/storage/v1/object/ordenes/${orden}/tecnico.jpg`, { metodo: 'POST', token: sTec.access_token, crudo: fd4 });
assert.notEqual(r.estado, 200, 'técnico no asignado no debe poder subir');
assert.match(r.datos.message, /row-level security/);
r = await f(`/storage/v1/object/ordenes/../../../etc/passwd`, { metodo: 'POST', token: s2.access_token, crudo: fd4 });
assert.notEqual(r.estado, 200);
ok('subida: ok, duplicado, tipo no permitido, RLS para técnico ajeno, ruta con ".." rechazada');

r = await f('/storage/v1/object/sign/ordenes', { metodo: 'POST', token: s2.access_token, cuerpo: { expiresIn: 600, paths: [`${orden}/foto-1.jpg`, `${orden}/no-existe.jpg`] } });
assert.equal(r.estado, 200); assert.ok(r.datos[0].signedURL); assert.equal(r.datos[1].signedURL, null);
const firmada = '/storage/v1' + r.datos[0].signedURL;
const d = await fetch(B + firmada); assert.equal(d.status, 200); assert.equal(d.headers.get('content-type'), 'image/jpeg');
assert.deepEqual(Buffer.from(await d.arrayBuffer()), foto);
const mala = firmada.replace(/token=([^&]+)/, (m, t) => 'token=' + t.slice(0, -2) + 'xx');
assert.equal((await fetch(B + mala)).status, 400);
r = await f('/storage/v1/object/sign/ordenes', { metodo: 'POST', token: sTec.access_token, cuerpo: { expiresIn: 600, paths: [`${orden}/foto-1.jpg`] } });
assert.equal(r.datos[0].signedURL, null);
ok('URL firmadas: descarga idéntica, firma alterada -> 400, técnico ajeno no obtiene URL');

// --- desactivar y cerrar sesión
r = await f('/functions/v1/admin-usuarios', { metodo: 'POST', token: s2.access_token, cuerpo: { accion: 'desactivar', usuario_id: tecId } });
assert.equal(r.estado, 200);
r = await f('/auth/v1/user', { token: sTec.access_token }); assert.equal(r.estado, 403);
r = await f('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: 'tec@prueba.cl', password: 'clave-tecnico-1' } });
assert.equal(r.datos.msg, 'User is banned');
r = await f('/functions/v1/admin-usuarios', { metodo: 'POST', token: s2.access_token, cuerpo: { accion: 'desactivar', usuario_id: s2.user.id } });
assert.equal(r.estado, 400);
ok('desactivar: sesión anulada, ingreso bloqueado; no puede desactivarse a sí mismo');

r = await f('/auth/v1/logout?scope=global', { metodo: 'POST', token: s2.access_token });
assert.equal(r.estado, 204);
r = await f('/auth/v1/user', { token: s2.access_token }); assert.equal(r.estado, 403);
ok('cerrar sesión: el token ya no sirve para /user');

// --- límite de intentos
let ultimo;
for (let i = 0; i < 11; i++) ultimo = await f('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email: 'nadie@prueba.cl', password: 'x' } });
assert.equal(ultimo.estado, 429); assert.match(ultimo.datos.msg, /rate limit/);
ok('11 intentos fallidos -> 429');
console.log('\nTODAS LAS PRUEBAS PASARON');

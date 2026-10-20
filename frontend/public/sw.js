// Service worker mínimo: permite instalar la aplicación en el teléfono.
// No guarda datos en caché (la información siempre viene del servidor);
// si no hay conexión, muestra una página simple en vez del error del navegador.
const PAGINA_SIN_CONEXION = `<!doctype html><html lang="es-CL"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title>
<body style="font-family:system-ui;padding:2rem;color:#17232c;background:#eef1f3">
<h1 style="font-size:1.4rem">Sin conexión</h1><p>No hay conexión a internet. Vuelva a intentarlo cuando tenga señal.</p>
<button onclick="location.reload()" style="padding:.7rem 1rem;font-size:1rem">Reintentar</button></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(PAGINA_SIN_CONEXION, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
  );
});

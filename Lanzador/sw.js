/* ==========================================================================
   Service worker del Lanzador
   --------------------------------------------------------------------------
   Hace dos cosas y ninguna más:

   1. Que el navegador considere la página instalable. Sin un worker con
      manejador de `fetch`, Chrome y Samsung Internet no ofrecen instalar,
      y sin instalar de verdad (WebAPK) no hay menú Compartir.

   2. Que el lanzador abra sin red. Es una lista de ligas: si el metro no
      tiene cobertura, al menos que puedas ver a dónde ibas.

   Estrategia: la página va a red primero (así una subida al repo llega en
   cuanto abres con datos) y cae a la copia guardada si no hay. El resto —
   iconos, manifiesto — va de la copia primero, que no cambian.

   Al subir una versión nueva del lanzador, sube el número de VERSION. Eso
   tira la caché vieja y evita quedarte con la de ayer.
   ========================================================================== */

const VERSION = 'lanzador-v1';

const RECURSOS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(VERSION)
      // addAll falla entero si un solo archivo falla; los metemos de uno en
      // uno para que un icono ausente no impida instalar.
      .then((c) => Promise.allSettled(RECURSOS.map((r) => c.add(r))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  // Sólo lecturas de nuestro propio origen. Las ligas a Drive o Notion no
  // pasan por aquí, y menos aún las que van directas a una app.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Navegación (incluido lo que llega desde el menú Compartir, que entra
  // como './?url=...'): red primero, copia si no hay.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copia));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Todo lo demás: copia primero, y si no está, red.
  ev.respondWith(
    caches.match(req).then((guardada) => guardada || fetch(req).then((res) => {
      if (res && res.ok) {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copia));
      }
      return res;
    }))
  );
});

/* ==========================================================================
   Service worker del Lanzador
   --------------------------------------------------------------------------
   Hace tres cosas:

   1. Que el navegador considere la página instalable. Sin un worker con
      manejador de `fetch`, Chrome y Samsung Internet no ofrecen instalar.

   2. Que abra al instante. La versión anterior iba a red primero y sólo
      tiraba de la copia si la petición fallaba — pero con señal mala una
      petición no falla, se queda colgada sin límite, y el lanzador se
      quedaba en blanco esperando. Ahora sirve la copia local de inmediato.

   3. Que se entere de las novedades igual. Después de pintar, comprueba en
      segundo plano si subiste una versión nueva; si la hay, la guarda para
      el próximo arranque y avisa a la página.

   Consecuencia a tener en cuenta: al subir un cambio al repo, lo verás la
   SEGUNDA vez que abras. La primera te avisa. Es el precio de arrancar al
   instante, y para un lanzador compensa.

   Al subir una versión nueva, sube también el número de VERSION.
   ========================================================================== */

const VERSION = 'lanzador-v3';

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
      // addAll falla entero si un solo archivo falla; de uno en uno para que
      // un icono ausente no impida instalar.
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

/** Avisa a las pestañas abiertas de que hay versión nueva guardada. */
async function avisarDeNovedad() {
  const clientes = await self.clients.matchAll({ type: 'window' });
  for (const c of clientes) c.postMessage({ tipo: 'version-nueva' });
}

/**
 * Baja el index en segundo plano y lo guarda si cambió.
 * Compara el texto entero: son 60 KB, es más fiable que fiarse de cabeceras
 * que GitHub Pages no siempre manda igual.
 */
async function revisarActualizacion() {
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    if (!res || !res.ok) return;
    const nuevo = await res.clone().text();

    const cache = await caches.open(VERSION);
    const vieja = await cache.match('./index.html');
    const anterior = vieja ? await vieja.text() : null;

    if (anterior !== nuevo) {
      await cache.put('./index.html', res);
      if (anterior !== null) await avisarDeNovedad();
    }
  } catch { /* sin red: ya volveremos a mirar */ }
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  // Sólo lecturas de nuestro propio origen. Las ligas a Drive o Notion no
  // pasan por aquí, y menos aún las que van directas a una app.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Navegación (incluido lo que llega del menú Compartir, que entra como
  // './?url=...'): copia primero, siempre. La dirección con sus parámetros
  // no cambia, así que la página los sigue leyendo de location.search.
  if (req.mode === 'navigate') {
    ev.respondWith(
      caches.match('./index.html')
        .then((guardada) => guardada || fetch(req))
        .catch(() => fetch(req))
    );
    // Y en segundo plano, sin hacer esperar a nadie, miramos si hay novedad.
    ev.waitUntil(revisarActualizacion());
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

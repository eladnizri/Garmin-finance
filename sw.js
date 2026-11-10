/* Service worker — מאפשר התקנה כאפליקציה ופתיחה מהירה גם ללא רשת.
 * אסטרטגיה: cache-first לקבצי המעטפת, network-first לנתונים (health.json). */
const CACHE = 'health-app-v48';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './common.js',
  './storage.js',
  './garmin-api.js',
  './apple-health.js',
  './app.js',
  './insights.js',
  './model.js',
  './goals.js',
  './training.js',
  './vendor/chart.umd.min.js',
  './manifest.webmanifest',
  './fonts/rubik-hebrew.woff2',
  './fonts/rubik-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // נתוני ריצות היסטוריים: קודם רשת, נפילה למטמון
  if (request.url.includes('runs_history.json')) {
    event.respondWith(
      fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // מעטפת: קודם מטמון, נפילה לרשת
  event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
});

// Service worker: caches the whole app on install so it launches offline.
// Bump VERSION whenever any file changes, so clients pick up the new build.
const VERSION = 'v8';
const CACHE = `lemmings-${VERSION}`;
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'src/main.js', 'src/ui.js',
  'src/game/engine.js', 'src/game/sprites.js', 'src/game/objects.js', 'src/game/level.js',
  'src/game/levels.js', 'src/game/title.js', 'src/game/solver.js',
  'src/render/screen.js', 'src/render/font.js', 'src/render/audio.js', 'src/render/music.js',
  'src/input/keyboard.js',
  'src/dos/dat.js', 'src/dos/dosdata.js', 'src/dos/files.js', 'src/dos/midi.js', 'src/dos/wav.js', 'src/render/gm.js', 'src/render/hdicons.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload': straight from the server, not the browser's HTTP cache
  // (GitHub Pages lets that keep files 10 minutes, which would put the old
  // version's files in the new version's cache)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// cache first, falling back to the network (and caching what it returns)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});

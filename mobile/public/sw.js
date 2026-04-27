/* TaskApp service worker — minimal stale-while-revalidate shell cache.
 *
 * Why bother: Expo SDK 52 doesn't register one by default, which means
 * a user who taps the Home-Screen icon while offline sees a blank page
 * instead of the app shell. This SW caches the app bundle + manifest +
 * icons, serves them offline, and refreshes them in the background on
 * every fetch. API calls (anything matching /sessions/* /routines/* etc
 * on the backend origin) are bypassed — stale data there would be
 * actively harmful.
 *
 * Versioning: the literal `taskapp-v1` token below is rewritten at
 * deploy time by `scripts/build-web.sh` to include the git commit SHA
 * (e.g. `taskapp-9a8f7c2b`). Each deploy gets a fresh cache identity
 * so the install handler drops the prior shell — no more "I shipped a
 * fix and iOS Safari PWA users still see the old bundle" footgun.
 * The `?sw=off` query param remains a runtime kill switch.
 */
const CACHE_VERSION = 'taskapp-v1';

// Resources we pre-cache on install. Small list — just the shell. The
// app's own JS bundle path is hashed (Metro output), so we lean on the
// runtime cache-on-fetch path for that rather than hardcoding.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Drop stale caches from previous versions so a user who just
  // reloaded after a deploy gets the new shell on their next fetch.
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Kill switch: any request with ?sw=off bypasses the cache entirely.
  if (url.searchParams.get('sw') === 'off') return;

  // Only intercept GETs on our own origin. Anything else (API calls,
  // third-party) flows through unchanged.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      // Background revalidation: always fire the network request, update
      // the cache when it succeeds, but don't block the response on it
      // if we have a cached copy. This is "stale-while-revalidate."
      const networkFetch = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          cache.put(req, resp.clone());
        }
        return resp;
      }).catch(() => cached); // fall back to cache on network failure
      return cached || networkFetch;
    }),
  );
});

/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { RangeRequestsPlugin } from 'workbox-range-requests';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SoundFont は初回取得後にキャッシュ（大きいのでプリキャッシュしない）
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/soundfonts/'),
  new CacheFirst({
    cacheName: 'soundfonts',
    plugins: [new ExpirationPlugin({ maxEntries: 8 }), new RangeRequestsPlugin()],
  }),
);

// Web Share Target（POST /share-target）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const cache = await caches.open('share-target');
        for (const f of form.getAll('files')) {
          if (f instanceof File) await cache.put(`/shared/${encodeURIComponent(f.name)}`, new Response(f));
        }
        return Response.redirect('/?shared=1', 303);
      })(),
    );
  }
});

// SPA ナビゲーション
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/share-target/, /^\/LICENSES\//],
  }),
);

// 初回訪問時もすぐにページを制御し、標準 SoundFont を先にキャッシュしてオフラインに備える
const DEFAULT_SF = '/soundfonts/GeneralUserGS.sf3';
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  (async () => {
    try {
      const cache = await caches.open('soundfonts');
      if (!(await cache.match(DEFAULT_SF))) await cache.add(DEFAULT_SF);
    } catch {
      // オフラインなどで失敗した場合は、次回ページから取得したときにキャッシュされる
    }
  })();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

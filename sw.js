/**
 * GOGO 스마트 매니저 - Service Worker
 * - 앱 셸: 네트워크 우선 → 실패 시 캐시 (배포 직후 구버전 고착 방지)
 * - Firebase / 외부 CDN 요청은 가로채지 않음 (실시간 동기화 보호)
 */
const CACHE_NAME = 'gogo-dashboard-v20261028-restore';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/push.js',
  './js/parking.js',
  './js/schedule.js',
  './js/calendar.js',
  './js/memo.js',
  './js/ledger.js',
  './js/trip.js',
  './manifest.json',
  './icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[SW] 프리캐시 일부 실패:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((cached) => cached || caches.match('./index.html')))
  );
});

/* 🔔 백그라운드 푸시 수신 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: '🚗 GOGO 매니저 알림', body: event.data ? event.data.text() : '새로운 소식이 도착했습니다.' };
  }
  const title = data.title || '🚗 GOGO 매니저';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '새로운 알림이 도착했습니다.',
    icon: 'icon.png',
    badge: 'icon.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || './index.html' }
  }));
});

/* 🔔 알림 탭 → 앱 포커스 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
    })
  );
});

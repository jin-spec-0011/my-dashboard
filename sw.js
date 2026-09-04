self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* 🔔 백그라운드 푸시 알림 수신 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: '🚗 GOGO 매니저 알림', body: event.data ? event.data.text() : '새로운 소식이 도착했습니다.' };
  }

  const title = data.title || '🚗 GOGO 매니저';
  const options = {
    body: data.body || '새로운 알림이 도착했습니다.',
    icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || './index.html' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* 🔔 알림 배너 탭 클릭 시 해당 웹앱 화면 열기 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

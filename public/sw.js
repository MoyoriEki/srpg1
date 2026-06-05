// SRPG Proto PWA Service Worker
// ナビゲーションは network-first（最新を取りつつオフラインでも起動）、
// 静的アセットは cache-first でオフライン再生を可能にする。
const VERSION = 'srpg-pwa-v1';
const BASE = '/srpg1/';
const CORE = [BASE, BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.png', BASE + 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // ページ遷移: network-first → 失敗時はキャッシュ（最後はアプリシェル）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { caches.open(VERSION).then(c => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match(BASE)))
    );
    return;
  }

  // 静的アセット: cache-first → 無ければ取得してキャッシュ
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});

// 서비스 워커: 앱 화면(껍데기)만 저장해 두어 설치된 앱이 바로 열리게 한다.
// 회계 데이터·로그인(/api/*)은 절대 가로채거나 저장하지 않는다 → 인터넷이 없으면 데이터는 보이지 않고 "서버에 연결할 수 없습니다" 안내가 나온다.
const CACHE = "khnp-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // 데이터는 항상 서버에서 직접

  // 화면 이동: 항상 최신 화면을 먼저 받고, 연결이 안 될 때만 저장해 둔 화면을 쓴다.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("/", copy)); }
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // 아이콘 등 정적 파일: 최신 우선, 실패 시 저장본
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

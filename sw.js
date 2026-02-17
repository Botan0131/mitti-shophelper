/* MITTI ShopHelper NEON - Service Worker
   - オフライン対応（初回に必要ファイルをキャッシュ）
   - 更新反映（古い app.js / style.css が残り続ける問題を減らす）
*/

const VERSION = "v1.0.1"; // sw更新用（ここを変えると確実に更新が走ります）
const CACHE_PREFIX = "mitti-shophelper-neon-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Install: 先に必要ファイルを保存
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

// Activate: 古いキャッシュを掃除
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ページ側から「すぐ更新して」メッセージを受け取る
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function cachePutIfOk(cache, req, res){
  try{
    if (res && res.ok) await cache.put(req, res.clone());
  }catch{}
}

async function staleWhileRevalidate(event, req){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((res) => {
      event.waitUntil(cachePutIfOk(cache, req, res));
      return res;
    })
    .catch(() => null);

  // まずキャッシュを返し、裏で更新
  return cached || (await fetchPromise) || cached;
}

async function networkFirst(event, req, fallback){
  const cache = await caches.open(CACHE_NAME);
  try{
    const res = await fetch(req);
    await cachePutIfOk(cache, req, res);
    return res;
  }catch{
    return (await cache.match(req)) || (fallback ? await cache.match(fallback) : null) || Response.error();
  }
}

// Fetch: ナビゲーションはネット優先（更新が反映されやすい）
//      : 静的ファイルは Stale-While-Revalidate
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SPAじゃないけど、ページ遷移は index.html に寄せる
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(event, "./index.html", "./index.html"));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, req));
});

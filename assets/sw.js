/**
 * Service Worker - A Marca Theme
 * Cache strategy para repeat visits mais rápidos
 * IMPORTANTE: Funciona apenas em HTTPS (não em localhost HTTP)
 */
const CACHE_VERSION = 'amarca-v1.0.0';
const CACHE_STATIC = CACHE_VERSION + '-static';
const CACHE_DYNAMIC = CACHE_VERSION + '-dynamic';
const CACHE_IMAGES = CACHE_VERSION + '-images';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('amarca-') && !key.includes(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.origin.includes('shopify.com') && url.origin !== location.origin) return;

  // Nunca cachear carrinho/checkout/sections (evita dados desatualizados)
  const isCartRoute = /^\/(cart|checkout|orders)(\/|$)/.test(url.pathname)
    || url.searchParams.has('sections')
    || url.pathname.endsWith('/cart.js') || url.pathname.endsWith('/cart.json')
    || url.pathname === '/cart.js' || url.pathname === '/cart.json';
  if (isCartRoute) return; // deixa o browser tratar normalmente


  if (request.destination === 'image' || /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
  } else if (url.pathname.includes('/assets/') || url.origin.includes('cdn.shopify.com')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_STATIC));
  } else {
    event.respondWith(networkFirst(request, CACHE_DYNAMIC));
  }
});

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await Promise.all(keys.slice(0, keys.length - maxItems).map((k) => cache.delete(k)));
  }
}

const CACHE_LIMITS = { [CACHE_IMAGES]: 100, [CACHE_DYNAMIC]: 30, [CACHE_STATIC]: 60 };

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      if (CACHE_LIMITS[cacheName]) trimCache(cacheName, CACHE_LIMITS[cacheName]);
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      if (CACHE_LIMITS[cacheName]) trimCache(cacheName, CACHE_LIMITS[cacheName]);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  });
  return cached || fetchPromise;
}

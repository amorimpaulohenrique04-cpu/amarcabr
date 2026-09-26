/**
 * Web Vitals Tracking - RUM
 * Envia métricas reais para analytics
 */
function sendToAnalytics({ name, value, id, delta }) {
  const val = Math.round(name === 'CLS' ? value * 1000 : value);

  if (typeof gtag !== 'undefined') {
    gtag('event', name, {
      event_category: 'Web Vitals',
      event_label: id,
      value: val,
      metric_id: id,
      metric_value: value,
      metric_delta: delta,
      non_interaction: true
    });
  }

  if (typeof window.ShopifyAnalytics !== 'undefined' && window.ShopifyAnalytics.lib) {
    try {
      window.ShopifyAnalytics.lib.track('Web Vitals', { metric: name, value: val, id });
    } catch (_) {}
  }
}

(async function () {
  try {
    const { onCLS, onINP, onLCP, onFCP, onTTFB } = await import(
      'https://cdn.jsdelivr.net/npm/web-vitals@3.5.2/dist/web-vitals.attribution.js'
    );
    onCLS(sendToAnalytics);
    onINP(sendToAnalytics);
    onLCP(sendToAnalytics);
    onFCP(sendToAnalytics);
    onTTFB(sendToAnalytics);
  } catch (e) {}
})();

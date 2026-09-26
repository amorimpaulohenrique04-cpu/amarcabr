(() => {
  const ROOT_SEL = '[data-am-search]';

  const debounce = (fn, wait = 180) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const moneyBRL = (cents) => {
    if (typeof cents !== 'number') return '';
    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(cents / 100);
    } catch (_) {
      return '';
    }
  };

  const buildUrl = (q, limit) => {
    const base = window.Shopify?.routes?.predictive_search_url || '/search/suggest';
    const params = new URLSearchParams({
      q,
      'resources[type]': 'product',
      'resources[limit]': String(limit),
      'resources[options][fields]': 'title,product_type,variants.title,vendor'
    });
    return `${base}.json?${params.toString()}`;
  };

  const safeImg = (src) => {
    if (!src || typeof src !== 'string') return '';
    return src.replace(/_(small|medium|large)\b/g, '_300x');
  };

  const escAttr = (s) => String(s || '').replace(/"/g, '&quot;');

  const renderItem = (product) => {
    const title = product?.title || '';
    const url = product?.url || '#';
    const img = safeImg(product?.image);
    const price = typeof product?.price === 'number' ? moneyBRL(product.price) : '';

    return `
      <li class="am-search__item">
        <a href="${url}">
          <div class="am-search__thumb">
            ${img ? `<img src="${img}" alt="${escAttr(title)}" loading="lazy" width="65" height="85">` : ''}
          </div>
          <div class="am-search__meta">
            <span class="am-search__title">${title}</span>
            ${price ? `<span class="am-search__price">${price}</span>` : ''}
          </div>
        </a>
      </li>
    `;
  };

  function init(root) {
    if (root.__amSearchInit) return;
    root.__amSearchInit = true;

    const input = root.querySelector('input[type="search"]');
    const list = root.querySelector('[data-am-list]');
    const dialogComponent = root.closest('dialog-component') || document.querySelector('#search-modal');
    const closeBtn = root.querySelector('.am-search__close');
    const suggestionsArea = root.querySelector('[data-am-suggestions]');
    const resultsArea = root.querySelector('.am-search__results-area');
    const status = root.querySelector('[data-am-status]');
    const footer = root.querySelector('[data-am-footer]');
    const viewAll = root.querySelector('[data-am-viewall]');
    const resultsLabel = root.querySelector('[data-results-label]');

    if (!input || !list || !dialogComponent) return;

    const limit = Number(root.dataset.limit || 6);
    let abort = null;
    let lastQuery = '';

    const showSuggestions = () => {
      if (suggestionsArea) suggestionsArea.hidden = false;
      if (resultsArea) resultsArea.hidden = true;
      if (resultsLabel) resultsLabel.hidden = true;
      if (footer) footer.hidden = true;
      if (status) status.hidden = true;
      list.innerHTML = '';
    };

    const showResultsShell = (q) => {
      if (suggestionsArea) suggestionsArea.hidden = true;
      if (resultsArea) resultsArea.hidden = false;
      if (resultsLabel) resultsLabel.hidden = false;

      if (viewAll) {
        const baseUrl = window.Shopify?.routes?.search_url || '/search';
        viewAll.href = `${baseUrl}?q=${encodeURIComponent(q)}&type=product`;
      }
    };

    const setStatus = (text) => {
      if (!status) return;
      status.hidden = !text;
      status.textContent = text || '';
    };

    const cleanup = () => {
      input.value = '';
      lastQuery = '';
      if (abort) {
        abort.abort();
        abort = null;
      }
      setStatus('');
      showSuggestions();
    };

    const requestClose = () => {
      if (typeof dialogComponent.closeDialog === 'function') {
        dialogComponent.closeDialog();
        return;
      }

      const dialog = dialogComponent.querySelector('dialog');
      if (dialog && dialog.open) {
        dialog.classList.add('dialog-closing');
        setTimeout(() => {
          dialog.classList.remove('dialog-closing');
          try {
            dialog.close();
          } catch (_) {
            dialog.removeAttribute('open');
          }
        }, 180);
      }
    };

    const runSearch = async (q) => {
      const query = (q || '').trim();

      if (query === lastQuery) return;
      lastQuery = query;

      if (abort) {
        abort.abort();
        abort = null;
      }

      if (!query) {
        showSuggestions();
        return;
      }

      showResultsShell(query);
      setStatus('Buscando...');
      if (footer) footer.hidden = true;

      abort = new AbortController();

      try {
        const res = await fetch(buildUrl(query, limit), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: abort.signal
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const products = json?.resources?.results?.products || [];

        if (!Array.isArray(products) || products.length === 0) {
          list.innerHTML = '';
          setStatus('Nenhum resultado encontrado.');
          if (footer) footer.hidden = false;
          return;
        }

        list.innerHTML = products.map(renderItem).join('');
        setStatus('');
        if (footer) footer.hidden = false;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        list.innerHTML = '';
        setStatus('Não foi possível carregar.');
        if (footer) footer.hidden = false;
      }
    };

    input.addEventListener('input', debounce((e) => {
      runSearch(e.target.value);
    }, 180));

    input.addEventListener('focus', () => {
      if (!input.value.trim()) showSuggestions();
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      });
    }

    dialogComponent.addEventListener('dialog:open', () => {
      requestAnimationFrame(() => input.focus());
    });

    dialogComponent.addEventListener('dialog:close', cleanup);
  }

  const boot = () => {
    document.querySelectorAll(ROOT_SEL).forEach(init);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  document.addEventListener('shopify:section:load', boot, { passive: true });
})();

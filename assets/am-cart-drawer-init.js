/**
 * A MARCA — Cart Drawer Controller (v7.0 — mobile-safe rewrite)
 *
 * Fixes over v6:
 * ─────────────────────────────────────────────────────────────
 * FIX-1  renderDrawerSection — Dialog agora SEMPRE abre via showModal()
 *        após inserção no DOM, garantindo Top Layer. Antes, setAttribute('open')
 *        abria como não-modal e o backdrop cobria os botões no mobile.
 *
 * FIX-2  openDrawer — close() de segurança antes de showModal() para evitar
 *        InvalidStateError se dialog ficou em estado não-modal.
 *
 * FIX-3  setItemLoading — Adia desabilitação para requestAnimationFrame para
 *        não cancelar o submit do browser. Não desabilita mais <input>.
 *
 * FIX-4  handleCartFormSubmit — Usa internalFetchDepth para o interceptor não
 *        disparar scheduleCartTouch duplicado. Trata status 422/429/500.
 *
 * FIX-5  init — Aborta bubbleAbort pendente ao reinicializar.
 *
 * FIX-6  closeDrawer — animationend listener recebe signal para limpeza
 *        correta no BFCache.
 *
 * FIX-7  Checkout form — protege contra desabilitar botões que impedem submit.
 */
(() => {
  /* ════════════════════════════════════════
   * CONSTANTS
   * ════════════════════════════════════════ */
  const SEL = {
    dialog:      'cart-drawer-component dialog.cart-drawer__dialog',
    openBtn:     '[data-cart-drawer-open]',
    closeBtn:    '[data-cart-drawer-close]',
    sectionHost: '#shopify-section-cart-drawer',

    bubble: [
      '[data-cart-bubble]',
      '[ref="cartBubble"]',
      '[x-ref="cartBubble"]',
      '.cart-bubble',
    ].join(','),

    bubbleCount: [
      '[data-cart-count]',
      '[ref="cartBubbleCount"]',
      '[x-ref="cartBubbleCount"]',
    ].join(','),

    bubbleText: [
      '[data-cart-text]',
      '[ref="cartBubbleText"]',
      '[x-ref="cartBubbleText"]',
    ].join(','),
  };

  const REOPEN_GUARD_MS    = 400;
  const SESSION_MAX_AGE_MS = 1000 * 60 * 10;
  const CLOSE_ANIM_TIMEOUT = 260;

  /* ════════════════════════════════════════
   * STATE
   * ════════════════════════════════════════ */
  const STATE_KEY = '__AM_CART_DRAWER_STATE__';
  function getState() {
    if (!window[STATE_KEY]) {
      window[STATE_KEY] = {
        controller:            null,
        renderAbort:           null,
        bubbleAbort:           null,
        pendingRender:         null,
        isClosing:             false,
        isHydrating:           false,
        navigatingToCheckout:  false,
        lastManualClose:       0,
        renderToken:           0,
        fetchPatched:          false,
        lastCartTouchTs:       0,
        cartTouchTimer:        0,
        internalFetchDepth:    0,
        bubbleRetryTimer:      0,
        lastCartUpdateEventTs: 0,
        loadingTimers:         [],
        lastBubbleSyncTs:      0,
        closeTimer:            0,
        lastCartDrawerSectionHtml: null,
        lastCartDrawerSectionTs:   0,
      };
    }
    return window[STATE_KEY];
  }

  /* ════════════════════════════════════════
   * DOM HELPERS
   * ════════════════════════════════════════ */
  function getDialog() {
    return document.querySelector(SEL.dialog);
  }

  function isOpen() {
    const d = getDialog();
    return !!(d && d.open);
  }

  function isMobileCartViewport() {
    return !!window.matchMedia?.('(max-width: 749px)')?.matches;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForDrawerOpenMotion() {
    const dialog = getDialog();
    if (!dialog?.open || !isMobileCartViewport()) return;
    const animations = typeof dialog.getAnimations === 'function'
      ? dialog.getAnimations().filter(a => a.playState === 'running')
      : [];
    if (!animations.length) {
      await wait(190);
      return;
    }
    await Promise.race([
      Promise.allSettled(animations.map(a => a.finished)),
      wait(220),
    ]);
  }

  /* ── Backdrop ── */
  let backdropEl = null;
  function ensureBackdrop() {
    if (backdropEl && document.body.contains(backdropEl)) return backdropEl;
    backdropEl = document.querySelector('.am-cart-backdrop');
    if (!backdropEl) {
      backdropEl = document.createElement('div');
      backdropEl.className = 'am-cart-backdrop';
      backdropEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(backdropEl);
    }
    return backdropEl;
  }
  function showBackdrop() { ensureBackdrop().classList.add('is-visible'); }
  function hideBackdrop() { ensureBackdrop().classList.remove('is-visible'); }

  /* ── Scroll lock ── */
  function lockScroll(lock) {
    const api = window.AMScrollLock;
    if (api && typeof api.lock === 'function' && typeof api.unlock === 'function') {
      if (lock) api.lock('cart-drawer');
      else      api.unlock('cart-drawer');
      return;
    }
    // fallback (legacy)
    document.documentElement.classList.toggle('am-cart-lock', lock);
    document.body.classList.toggle('am-cart-lock', lock);
  }

  /* ── Sections URL ── */
  function getSectionsUrl(sectionId) {
    const basePath      = window.Shopify?.routes?.root || '/';
    const currentParams = new URLSearchParams(window.location.search);
    const params        = new URLSearchParams();
    ['preview_theme_id', 'pb', 'locale'].forEach(key => {
      const val = currentParams.get(key);
      if (val) params.set(key, val);
    });
    params.set('sections', sectionId);
    return `${basePath.replace(/\/+$/, '')}/?${params.toString()}`;
  }

  /* ════════════════════════════════════════
   * BADGE UPDATE
   * ════════════════════════════════════════ */
  function updateBubble(count, _retry) {
    _retry = _retry || 0;
    const state = getState();
    const n     = Math.max(0, Number(count) || 0);
    const nStr  = String(n);
    let found   = false;

    /* 1. Count elements */
    document.querySelectorAll(SEL.bubbleCount).forEach(el => {
      if (el.children.length === 0) el.textContent = nStr;
      if (el.hasAttribute('data-cart-count')) el.setAttribute('data-cart-count', nStr);
      if (n > 0) el.classList.remove('hidden');
      else       el.classList.add('hidden');
      found = true;
    });

    /* 2. Bubble containers */
    document.querySelectorAll(SEL.bubble).forEach(bubble => {
      if (n > 0) {
        bubble.classList.remove('is-empty', 'visually-hidden');
        bubble.removeAttribute('hidden');
      } else {
        bubble.classList.add('is-empty', 'visually-hidden');
      }

      ['data-count', 'data-cart-count', 'data-item-count'].forEach(attr => {
        if (bubble.hasAttribute(attr)) bubble.setAttribute(attr, nStr);
      });

      if (!found) {
        const inner = bubble.querySelector(SEL.bubbleCount);
        if (inner) {
          if (inner.children.length === 0) inner.textContent = nStr;
          if (inner.hasAttribute('data-cart-count'))
            inner.setAttribute('data-cart-count', nStr);
          found = true;
        } else if (bubble.children.length === 0) {
          bubble.textContent = nStr;
          found = true;
        }
      }
    });

    /* 3. Limpar texto auxiliar ("itens") */
    document.querySelectorAll(SEL.bubbleText).forEach(el => {
      try { if (el.matches(SEL.bubbleCount)) return; } catch (_) {}
      if (el.children.length > 0) return;
      el.textContent = '';
    });

    document.querySelectorAll(SEL.bubbleCount).forEach(el => {
      const parent = el.parentNode;
      if (!parent) return;
      [...parent.childNodes].forEach(node => {
        if (node === el) return;
        if (node.nodeType !== Node.TEXT_NODE) return;
        if (/\b(itens?|items?)\b/i.test(node.textContent || ''))
          node.textContent = '';
      });
    });

    /* 4. Session storage */
    try {
      sessionStorage.setItem(
        'cart-count',
        JSON.stringify({ value: nStr, timestamp: Date.now() })
      );
    } catch (_) {}

    /* 5. Acessibilidade */
    let lr = document.getElementById('am-cart-live-region');
    if (!lr) {
      lr = document.createElement('div');
      lr.id = 'am-cart-live-region';
      lr.setAttribute('aria-live', 'polite');
      lr.setAttribute('aria-atomic', 'true');
      lr.className = 'sr-only visually-hidden';
      lr.style.cssText =
        'position:absolute;width:1px;height:1px;overflow:hidden;' +
        'clip:rect(0,0,0,0);white-space:nowrap;border:0;';
      document.body.appendChild(lr);
    }
    lr.textContent = n === 0 ? 'Carrinho vazio' : `${n} no carrinho`;

    /* 6. Retry */
    if (state.bubbleRetryTimer) {
      clearTimeout(state.bubbleRetryTimer);
      state.bubbleRetryTimer = 0;
    }
    if (!found && _retry < 5) {
      const delay = _retry < 2 ? 300 : 1000;
      state.bubbleRetryTimer = setTimeout(() => {
        state.bubbleRetryTimer = 0;
        updateBubble(count, _retry + 1);
      }, delay);
    }
  }

  function fastSyncBubbleFromSession() {
    try {
      const raw = sessionStorage.getItem('cart-count');
      if (!raw) return;
      const { value, timestamp } = JSON.parse(raw);
      if (typeof timestamp === 'number' && Date.now() - timestamp > SESSION_MAX_AGE_MS) {
        sessionStorage.removeItem('cart-count');
        return;
      }
      const c = parseInt(value, 10);
      if (Number.isFinite(c) && c >= 0) updateBubble(c);
    } catch (_) {}
  }

  function getCurrentBubbleCount() {
    const el = document.querySelector(SEL.bubbleCount);
    if (el && el.children.length === 0) {
      const n = parseInt(el.textContent, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    try {
      const raw = sessionStorage.getItem('cart-count');
      if (raw) {
        const { value } = JSON.parse(raw);
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    } catch (_) {}
    return 0;
  }

  const CART_COUNT_TOTAL_SOURCES = new Set(['cart-items-component', 'cart-drawer']);

  function toCartCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function getCartEventData(event) {
    return event?.detail?.data || {};
  }

  function getCartEventSections(event) {
    return event?.detail?.sections || getCartEventData(event).sections || null;
  }

  function getCartDrawerSectionFromEvent(event) {
    const sections = getCartEventSections(event);
    return sections && typeof sections === 'object'
      ? sections['cart-drawer'] || null
      : null;
  }

  function getCartCountFromSectionHtml(html) {
    if (!html || typeof html !== 'string') return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return toCartCount(tmp.querySelector('[ref="cartItemCount"]')?.textContent);
  }

  function rememberCartDrawerSection(html) {
    if (!html || typeof html !== 'string') return;
    const state = getState();
    state.lastCartDrawerSectionHtml = html;
    state.lastCartDrawerSectionTs = Date.now();
  }

  function consumeRecentCartDrawerSection() {
    const state = getState();
    if (!state.lastCartDrawerSectionHtml) return null;
    if (Date.now() - state.lastCartDrawerSectionTs > 3000) {
      state.lastCartDrawerSectionHtml = null;
      state.lastCartDrawerSectionTs = 0;
      return null;
    }
    const html = state.lastCartDrawerSectionHtml;
    state.lastCartDrawerSectionHtml = null;
    state.lastCartDrawerSectionTs = 0;
    return html;
  }

  function getExplicitCartCount(event) {
    const data   = getCartEventData(event);
    const source = data.source || event?.detail?.source;
    const total  =
      event?.detail?.cart?.item_count ??
      event?.detail?.resource?.item_count ??
      data.cart?.item_count ??
      data.item_count ??
      (data.itemCountIsTotal === true || CART_COUNT_TOTAL_SOURCES.has(source)
        ? data.itemCount
        : null);

    return toCartCount(total);
  }

  // itemCount pode ser delta em add-to-cart/combos e total em cart-items.
  function applyCartUpdateCount(event) {
    const explicitTotal = getExplicitCartCount(event);
    if (explicitTotal !== null) {
      updateBubble(explicitTotal);
      return 'total';
    }

    const delta = toCartCount(getCartEventData(event).itemCount);
    if (delta === null) return 'none';
    if (event?.detail?.__amCartReplay === true) return 'none';

    updateBubble(getCurrentBubbleCount() + delta);
    return 'optimistic';
  }

  /* ════════════════════════════════════════
   * CHECKOUT DETECTOR
   * ════════════════════════════════════════ */
  function isCheckoutSubmit(form, submitter) {
    if (!form || !(form instanceof HTMLFormElement)) return false;
    const formAction     = (form.getAttribute('action') || '').trim();
    const formActionFull = form.action || '';
    const CART_API       = /\/cart\/(change|update|add|clear)\b/i;

    if (CART_API.test(formAction) || CART_API.test(formActionFull)) return false;

    if (submitter) {
      const sfa = submitter.getAttribute('formaction') || '';
      if (CART_API.test(sfa)) return false;
      if (submitter.formAction && CART_API.test(submitter.formAction)) return false;
      if (submitter.name === 'checkout') return true;
      if (submitter.hasAttribute('data-checkout')) return true;
      if (/\/checkout\b/i.test(sfa)) return true;
      if (submitter.formAction && /\/checkout\b/i.test(submitter.formAction))
        return true;
    }

    if (/\/checkout\b/i.test(formAction) || /\/checkout\b/i.test(formActionFull))
      return true;
    if (form.hasAttribute('data-checkout-form')) return true;

    if (submitter == null) {
      const cb = form.querySelector(
        'button[name="checkout"], input[name="checkout"], [data-checkout]'
      );
      if (cb) {
        try {
          const url  = new URL(formActionFull || formAction, location.origin);
          const path = url.pathname.replace(/\/+$/, '');
          const root = (window.Shopify?.routes?.root || '/').replace(/\/+$/, '');
          if (path === '/cart' || path === root + '/cart') return true;
        } catch (_) {}
      }
    }
    return false;
  }

  /* ════════════════════════════════════════
   * OPEN / CLOSE DRAWER  — FIX-2
   * ════════════════════════════════════════ */
  function openDrawer({ animate = true, reason = 'program' } = {}) {
    const dialog = getDialog();
    if (!dialog) {
      queueRender({ keepOpen: true }).catch(() => {});
      return;
    }

    const state = getState();
    if (reason !== 'user' && Date.now() - state.lastManualClose < REOPEN_GUARD_MS)
      return;

    state.isClosing = false;
    state.navigatingToCheckout = false;
    if (state.closeTimer) {
      clearTimeout(state.closeTimer);
      state.closeTimer = 0;
    }
    dialog.classList.remove('dialog-closing');
    dialog.classList.remove('am-cart-no-motion');
    window.AMOverlay?.closeAll?.({ except: dialog });

    if (!animate) {
      dialog.style.setProperty('animation',  'none', 'important');
      dialog.style.setProperty('transition', 'none', 'important');
    }

    lockScroll(true);

    /* FIX-2: Sempre close() antes de showModal() para garantir
       que o dialog entre no Top Layer mesmo se já tinha open="" */
    try {
      if (dialog.open) dialog.close();
      dialog.showModal();
    } catch (_) {
      if (!dialog.open) dialog.setAttribute('open', '');
    }
    showBackdrop();

    if (!animate) {
      requestAnimationFrame(() => {
        dialog.style.removeProperty('animation');
        dialog.style.removeProperty('transition');
      });
    }
  }

  function closeDrawer({ reason = 'user' } = {}) {
    const dialog = getDialog();
    const state  = getState();
    if (reason === 'user') state.lastManualClose = Date.now();

    hideBackdrop();

    if (!dialog || !dialog.open) {
      lockScroll(false);
      state.isClosing = false;
      if (state.closeTimer) {
        clearTimeout(state.closeTimer);
        state.closeTimer = 0;
      }
      return;
    }
    if (state.isClosing) return;
    state.isClosing = true;

    dialog.classList.add('dialog-closing');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.classList.remove('dialog-closing');
      try { if (dialog.open) dialog.close(); }
      catch (_) { dialog.removeAttribute('open'); }
      lockScroll(false);
      state.isClosing = false;
      if (state.closeTimer) {
        clearTimeout(state.closeTimer);
        state.closeTimer = 0;
      }
    };

    /* FIX-6: usa signal para limpeza no BFCache */
    const sig = state.controller?.signal;
    dialog.addEventListener('animationend', e => {
      if (e.target === dialog) finish();
    }, { once: true, signal: sig });
    state.closeTimer = setTimeout(finish, CLOSE_ANIM_TIMEOUT);
  }

  function hardResetUI() {
    const dialog = getDialog();
    const state  = getState();
    hideBackdrop();
    lockScroll(false);
    state.isClosing = false;
    if (state.closeTimer) {
      clearTimeout(state.closeTimer);
      state.closeTimer = 0;
    }
    if (dialog) {
      dialog.classList.remove('dialog-closing');
      try { if (dialog.open) dialog.close(); }
      catch (_) { dialog.removeAttribute('open'); }
      dialog.style.removeProperty('animation');
      dialog.style.removeProperty('transition');
      dialog.style.removeProperty('display');
      delete dialog.dataset.clickOutsideBound;
    }
  }

  function bindDialogClickOutside(dialog, signal) {
    if (!dialog || dialog.dataset.clickOutsideBound) return;
    dialog.dataset.clickOutsideBound = '1';
    dialog.addEventListener('click', e => {
      if (!dialog.open) return;
      if (e.target === dialog) closeDrawer({ reason: 'outside' });
    }, { signal });
  }

  function rerunScripts(container) {
    container.querySelectorAll('script').forEach(old => {
      const s = document.createElement('script');
      [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
      s.textContent = old.textContent;
      old.parentNode?.replaceChild(s, old);
    });
  }

  /* ════════════════════════════════════════
   * RENDER DRAWER — FIX-1
   * ════════════════════════════════════════ */
  async function renderDrawerSection({
    keepOpen     = false,
    sectionsHtml = null,
  } = {}) {
    const state = getState();
    state.renderAbort?.abort();
    state.renderAbort = new AbortController();
    const { signal } = state.renderAbort;
    state.renderToken = (state.renderToken || 0) + 1;
    const token       = state.renderToken;
    state.isHydrating = true;
    const shouldOpen  = !!(keepOpen || isOpen());

    try {
      /* ── Obter HTML ── */
      let html;
      if (sectionsHtml && typeof sectionsHtml === 'string') {
        html = sectionsHtml;
      } else {
        state.internalFetchDepth++;
        try {
          const res = await fetch(getSectionsUrl('cart-drawer'), {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal,
          });
          if (!res.ok || token !== state.renderToken) return;
          const json = await res.json();
          if (token !== state.renderToken) return;
          html = json?.['cart-drawer'];
        } finally {
          state.internalFetchDepth--;
        }
      }

      if (!html || token !== state.renderToken) return;

      const host = document.querySelector(SEL.sectionHost);
      if (!host) return;

      /* ── Parse ── */
      const tmp        = document.createElement('div');
      tmp.innerHTML    = html;
      const parsedHost = tmp.querySelector(SEL.sectionHost);
      const newDialog  = tmp.querySelector(SEL.dialog);

      /* FIX-1: NÃO setar open="" no parsed dialog. */
      if (newDialog) {
        newDialog.removeAttribute('open');                           // ← FIX-1
      }

      if (token !== state.renderToken) return;

      const currentDialog = getDialog();
      const canPatchOpenDialog = !!(
        shouldOpen &&
        currentDialog &&
        currentDialog.open &&
        newDialog
      );

      /* ── Inserir no DOM ── */
      if (canPatchOpenDialog) {
        const preservedStyle = currentDialog.getAttribute('style') || '';
        currentDialog.className = newDialog.className;
        currentDialog.classList.add('am-cart-no-motion');

        [...currentDialog.attributes].forEach(attr => {
          if (attr.name === 'open' || attr.name === 'style' || attr.name === 'class') return;
          currentDialog.removeAttribute(attr.name);
        });
        [...newDialog.attributes].forEach(attr => {
          if (attr.name === 'open' || attr.name === 'style' || attr.name === 'class') return;
          currentDialog.setAttribute(attr.name, attr.value);
        });

        currentDialog.innerHTML = newDialog.innerHTML;

        if (preservedStyle) currentDialog.setAttribute('style', preservedStyle);
        else currentDialog.removeAttribute('style');

        showBackdrop();
        lockScroll(true);
      } else {
        host.innerHTML = (parsedHost || tmp).innerHTML;
        rerunScripts(host);
      }

      /* ── Re-bind dialog listeners ── */
      const d = getDialog();
      if (d && !canPatchOpenDialog) {
        delete d.dataset.clickOutsideBound;
        bindDialogClickOutside(d, state.controller?.signal);
        d.addEventListener('cancel', e => {
          e.preventDefault();
          closeDrawer({ reason: 'esc' });
        }, { signal: state.controller?.signal });
      }

      /* ── Abrir / Fechar ── */
      if (shouldOpen) {
        if (d) window.AMOverlay?.closeAll?.({ except: d });
        lockScroll(true);

        if (d && !canPatchOpenDialog) {
          /* FIX-1: Sempre usar showModal() para Top Layer.
             close() de segurança caso o template Liquid traga open="" */
          try {
            if (d.open) d.close();
            d.showModal();
          } catch (_) {
            if (!d.open) d.setAttribute('open', '');
          }

          d.style.removeProperty('animation');
          d.style.removeProperty('transition');
        }
        showBackdrop();
      } else {
        hardResetUI();
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('[cart-drawer] render error:', err);
    } finally {
      if (token === state.renderToken) {
        state.isHydrating = false;
        state.renderAbort = null;
      }
    }
  }

  async function queueRender(opts) {
    const state = getState();
    if (state.pendingRender) {
      try { await state.pendingRender; } catch (_) {}
    }
    state.pendingRender = renderDrawerSection(opts)
      .finally(() => { state.pendingRender = null; });
    return state.pendingRender;
  }

  /* ════════════════════════════════════════
   * REFRESH BUBBLE (cart.js)
   * ════════════════════════════════════════ */
  async function refreshBubble(force) {
    const state = getState();
    const now = Date.now();
    if (!force && state.lastBubbleSyncTs && now - state.lastBubbleSyncTs < 1500) return;
    state.bubbleAbort?.abort();
    state.bubbleAbort = new AbortController();
    const { signal } = state.bubbleAbort;

    try {
      state.internalFetchDepth++;
      const res = await fetch(
        (window.Shopify?.routes?.root || '/') + 'cart.js',
        { headers: { Accept: 'application/json' }, cache: 'no-store', signal }
      );

      if (!res.ok) return;

      const cart = await res.json();
      if (typeof cart?.item_count === 'number') updateBubble(cart.item_count);
      state.lastBubbleSyncTs = Date.now();
    } catch (err) {
      if (err?.name !== 'AbortError')
        console.warn('[cart-drawer] bubble refresh error:', err);
    } finally {
      state.internalFetchDepth = Math.max(0, state.internalFetchDepth - 1);
      state.bubbleAbort = null;
    }
  }

  /* ════════════════════════════════════════
   * ITEM LOADING & ERROR UX — FIX-3
   * ════════════════════════════════════════ */
  function setItemLoading(itemEl) {
    if (!itemEl) return;
    itemEl.classList.add('is-loading');

    /* FIX-3: Adia desabilitação para o próximo frame para não cancelar
       o activation behavior (form submit) do browser.
       Desabilita APENAS buttons — inputs precisam existir no FormData. */
    requestAnimationFrame(() => {
      if (!itemEl.classList.contains('is-loading')) return;
      itemEl.querySelectorAll('button').forEach(el => { el.disabled = true; });
    });

    const state = getState();
    const timer = setTimeout(() => {
      itemEl.classList.remove('is-loading');
      itemEl.querySelectorAll('button').forEach(el => { el.disabled = false; });
    }, 8000);
    state.loadingTimers.push(timer);
  }

  function clearItemLoadingStates() {
    const state = getState();
    state.loadingTimers.forEach(t => clearTimeout(t));
    state.loadingTimers = [];
    document.querySelectorAll('.cart-drawer__item.is-loading').forEach(el => {
      el.classList.remove('is-loading');
      el.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    });
  }

  function showDrawerError(msg) {
    const host = document.querySelector(SEL.sectionHost);
    if (!host) return;
    let errEl = host.querySelector('.cart-drawer__global-error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'cart-drawer__global-error';
      errEl.setAttribute('role', 'alert');
      const content = host.querySelector('.cart-drawer__content');
      if (content) content.prepend(errEl);
      else return;
    }
    errEl.textContent = msg || 'Erro ao atualizar o carrinho. Tente novamente.';
    errEl.hidden = false;
    setTimeout(() => { if (errEl) errEl.hidden = true; }, 5000);
  }

  /* ════════════════════════════════════════
   * CART API FORMS — FIX-4
   * ════════════════════════════════════════ */
  function isCartApiForm(form) {
    const a1 = (form.getAttribute('action') || '').trim();
    const a2 = (form.action || '').trim();
    return /\/cart\/(change|update|add|clear)\b/i.test(a1) ||
           /\/cart\/(change|update|add|clear)\b/i.test(a2);
  }


  async function updateDrawerItemQuantity(itemKey, nextQuantity) {
    const safeQty = Number.isFinite(Number(nextQuantity)) && Number(nextQuantity) > 0
      ? Number.parseInt(nextQuantity, 10)
      : 0;
    const state = getState();
    const host = document.querySelector(SEL.sectionHost);
    const cartChangeUrl = (window.routes && window.routes.cart_change_url)
      ? window.routes.cart_change_url
      : '/cart/change.js';

    if (!itemKey) return;
    if (host) host.classList.add('cart-drawer--updating');

    try {
      state.internalFetchDepth++;
      let res;
      try {
        res = await fetch(cartChangeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            id: itemKey,
            quantity: safeQty,
            sections: ['cart-drawer'],
          }),
        });
      } finally {
        state.internalFetchDepth--;
      }

      if (!res.ok) {
        const errMsg =
          res.status === 422 ? 'Quantidade indisponível em estoque.' :
          res.status === 429 ? 'Muitas requisições. Aguarde um momento.' :
          res.status >= 500  ? 'Erro no servidor. Tente novamente.' :
                               'Erro ao atualizar o carrinho.';
        throw new Error(errMsg);
      }

      const data = await res.json();
      const keepOpen = true;
      const sectionHtml = data?.sections?.['cart-drawer'] || null;

      if (typeof data?.item_count === 'number') {
        updateBubble(data.item_count);
      }

      await queueRender({ keepOpen, sectionsHtml: sectionHtml });

      if (typeof data?.item_count !== 'number') {
        await refreshBubble(true);
      }
    } catch (err) {
      console.error('[cart-drawer] quantity update error:', err);
      showDrawerError(err?.message || 'Erro ao atualizar o carrinho. Tente novamente.');
      await queueRender({ keepOpen: true });
      await refreshBubble(true).catch(() => {});
    } finally {
      if (host) host.classList.remove('cart-drawer--updating');
      clearItemLoadingStates();
    }
  }

  async function handleCartFormSubmit(form) {
    const action = form.action || form.getAttribute('action') || '';
    const method = (form.method || 'POST').toUpperCase();
    const state  = getState();
    const host   = document.querySelector(SEL.sectionHost);

    if (host) host.classList.add('cart-drawer--updating');

    try {
      const formData  = new FormData(form);
      const fetchOpts = {
        method,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      };

      /* FIX-4: internalFetchDepth impede o interceptor de disparar
         scheduleCartTouch em duplicata */
      let res;
      state.internalFetchDepth++;
      try {
        if (method === 'GET') {
          const qs  = new URLSearchParams(formData).toString();
          const url = action + (action.includes('?') ? '&' : '?') + qs;
          res = await fetch(url, fetchOpts);
        } else {
          fetchOpts.body = formData;
          res = await fetch(action, fetchOpts);
        }
      } finally {
        state.internalFetchDepth--;
      }

      /* FIX-4: Feedback para erros HTTP */
      if (res && !res.ok && !res.redirected) {
        const errMsg =
          res.status === 422 ? 'Quantidade indisponível em estoque.' :
          res.status === 429 ? 'Muitas requisições. Aguarde um momento.' :
          res.status >= 500  ? 'Erro no servidor. Tente novamente.' :
                               'Erro ao atualizar o carrinho.';
        showDrawerError(errMsg);
      }

      /* Captura estado DEPOIS do fetch — respeita se o usuário
         fechou o drawer durante a requisição */
      const keepOpen = isOpen();
      await queueRender({ keepOpen });
      await refreshBubble(true);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('[cart-drawer] form submit error:', err);
        showDrawerError();
      }
    } finally {
      if (host) host.classList.remove('cart-drawer--updating');
      clearItemLoadingStates();
    }
  }

  /* ════════════════════════════════════════
   * INIT — FIX-5
   * ════════════════════════════════════════ */
  function init() {
    const state = getState();

    /* Aborta TODOS os controllers pendentes do ciclo anterior */
    state.controller?.abort();
    state.bubbleAbort?.abort();   // ← FIX-5
    state.renderAbort?.abort();
    if (state.closeTimer) {
      clearTimeout(state.closeTimer);
      state.closeTimer = 0;
    }

    state.controller            = new AbortController();
    state.navigatingToCheckout  = false;
    state.bubbleAbort           = null;
    state.renderAbort           = null;

    const { signal } = state.controller;


    /* ── Click: open / close ── */
    document.addEventListener('click', e => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(SEL.openBtn)) {
        e.preventDefault();
        openDrawer({ reason: 'user' });
        return;
      }
      if (t.closest(SEL.closeBtn)) {
        e.preventDefault();
        closeDrawer({ reason: 'user' });
        return;
      }
    }, { passive: false, signal });

    /* ── Overlay ── */
    ensureBackdrop().addEventListener('click', () => {
      closeDrawer({ reason: 'overlay' });
    }, { signal });

    /* ── ESC ── */
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !isOpen()) return;
      e.preventDefault();
      closeDrawer({ reason: 'esc' });
    }, { passive: false, signal });

    /* ── Dialog ── */
    const dialog = getDialog();
    if (dialog) {
      dialog.addEventListener('cancel', e => {
        e.preventDefault();
        closeDrawer({ reason: 'esc' });
      }, { signal });
      bindDialogClickOutside(dialog, signal);
    }

    /* ── Theme events ── */
    document.addEventListener('cart:update', async e => {
      state.lastCartUpdateEventTs = Date.now();

      const data = getCartEventData(e);
      if (data.didError) {
        clearItemLoadingStates();
        return;
      }

      const source       = data.source || e?.detail?.source;
      let countMode      = applyCartUpdateCount(e);
      const html         = getCartDrawerSectionFromEvent(e);
      const sectionCount = getCartCountFromSectionHtml(html);
      if (sectionCount !== null) {
        updateBubble(sectionCount);
        countMode = 'total';
      }
      rememberCartDrawerSection(html);
      const canAutoOpen  =
        source === 'product-form-component' &&
        document.querySelector('cart-drawer-component[auto-open]') &&
        Date.now() - state.lastManualClose >= REOPEN_GUARD_MS;
      // Open first, then hydrate, so mobile feedback is immediate after add-to-cart.
      const openedNow = !!(canAutoOpen && !isOpen() && getDialog());
      if (openedNow) {
        openDrawer({ reason: 'cart-add' });
      }
      const keepOpen     = isOpen() || canAutoOpen;
      const shouldRender = keepOpen;

      try {
        if (shouldRender) {
          if (openedNow) await waitForDrawerOpenMotion();
          await queueRender({ keepOpen: keepOpen && (isOpen() || !getDialog()), sectionsHtml: html });
        }
        if (countMode !== 'total') {
          await refreshBubble(true).catch(() => {});
        }
      } finally {
        clearItemLoadingStates();
      }
    }, { passive: true, signal });

    document.addEventListener('cart:refresh', async e => {
      const keep = isOpen();
      const c    = getExplicitCartCount(e);
      const html = getCartDrawerSectionFromEvent(e);
      const sectionCount = getCartCountFromSectionHtml(html);
      if (c !== null) updateBubble(c);
      else if (sectionCount !== null) updateBubble(sectionCount);
      rememberCartDrawerSection(html);
      try { await queueRender({ keepOpen: keep, sectionsHtml: html }); }
      catch (_) {}
      if (c === null && sectionCount === null) await refreshBubble(true).catch(() => {});
      clearItemLoadingStates();
    }, { passive: true, signal });

    document.addEventListener('cart:open', async e => {
      if (Date.now() - state.lastManualClose < REOPEN_GUARD_MS) return;
      const c    = getExplicitCartCount(e);
      const html = getCartDrawerSectionFromEvent(e) || consumeRecentCartDrawerSection();
      const sectionCount = getCartCountFromSectionHtml(html);
      if (c !== null) updateBubble(c);
      else if (sectionCount !== null) updateBubble(sectionCount);
      const openedNow = !!(!isOpen() && getDialog());
      if (openedNow) {
        openDrawer({ reason: e?.detail?.source || 'cart-open' });
      }
      try {
        if (openedNow) await waitForDrawerOpenMotion();
        await queueRender({ keepOpen: isOpen() || !getDialog(), sectionsHtml: html });
      }
      catch (_) {}
      if (c === null && sectionCount === null) await refreshBubble(true).catch(() => {});
      clearItemLoadingStates();
    }, { passive: true, signal });

    document.addEventListener('cart:close', e => {
      closeDrawer({ reason: e?.detail?.source || 'program' });
    }, { passive: true, signal });

    /* ── Drawer qty/remove: mesma lógica do main cart ── */
    document.addEventListener('click', e => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      const qtyBtn = t.closest('[data-cart-drawer-qty]');
      if (qtyBtn && qtyBtn.closest(SEL.sectionHost)) {
        e.preventDefault();
        const item = qtyBtn.closest('.cart-drawer__item');
        const input = item?.querySelector('.cart-drawer__qty-input');
        const key = item?.getAttribute('data-key');
        const currentQty = Number.parseInt(input?.value || '0', 10);
        const action = qtyBtn.getAttribute('data-cart-drawer-qty');
        const nextQty = action === 'increase' ? currentQty + 1 : currentQty - 1;

        if (!item || !key || !Number.isFinite(currentQty)) return;
        if (nextQty === currentQty || nextQty < 0) return;

        updateDrawerItemQuantity(key, nextQty);
        return;
      }

      const removeBtn = t.closest('[data-cart-drawer-remove]');
      if (removeBtn && removeBtn.closest(SEL.sectionHost)) {
        e.preventDefault();
        const item = removeBtn.closest('.cart-drawer__item');
        const key = item?.getAttribute('data-key');
        if (!item || !key) return;
        updateDrawerItemQuantity(key, 0);
      }
    }, { passive: false, signal });

    /* ── Per-item loading UX — FIX-3 ── */
    document.addEventListener('click', e => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const removeBtn = t.closest(
        '.cart-drawer__remove-x, [data-cart-drawer-remove], [data-cart-remove]'
      );
      const qtyBtn  = t.closest('.cart-drawer__qty button');
      const trigger = removeBtn || qtyBtn;
      if (!trigger) return;
      const item = trigger.closest('.cart-drawer__item');
      if (!item || !item.closest(SEL.sectionHost)) return;
      setItemLoading(item);
    }, { passive: true, signal });

    /* ── Submit — FIX-7 ── */
    document.addEventListener('submit', e => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = e.submitter || null;

      /* FIX-7: Checkout — limpa UI imediatamente sem desabilitar nada */
      if (isCheckoutSubmit(form, submitter)) {
        state.navigatingToCheckout = true;
        document.documentElement.classList.add('am-cart-restoring');
        hardResetUI();
        return;                            // ← deixa o submit nativo acontecer
      }

      if (isCartApiForm(form) && form.closest(SEL.sectionHost)) {
        e.preventDefault();
        handleCartFormSubmit(form);
      }
    }, { capture: true, passive: false, signal });
  }

  
  /* ── BFCache (listeners globais, sem signal) ── */
  function ensureBFCacheListeners() {
    const state = getState();
    if (state.__bfcacheListenersBound) return;
    state.__bfcacheListenersBound = true;

    window.addEventListener('pagehide', () => {
      document.documentElement.classList.add('am-cart-restoring');
      hardResetUI();
    }, { passive: true });

    window.addEventListener('pageshow', function handlePageshow(e) {
      if (!e.persisted) return;
      hardResetUI();
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('am-cart-restoring');
      });
      setTimeout(() => init(), 0);
      fastSyncBubbleFromSession();
      refreshBubble(false).catch(() => {});
    }, { passive: true });
  }


  /* ── Bootstrap ── */
  function bootstrap() {
    ensureBFCacheListeners();
    init();
    fastSyncBubbleFromSession();
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => refreshBubble(false).catch(() => {}), { timeout: 2500 });
    } else {
      setTimeout(() => refreshBubble(false).catch(() => {}), 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

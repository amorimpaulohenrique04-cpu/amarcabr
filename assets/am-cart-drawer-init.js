import { cartService } from '@theme/cart-service';
import { CartUpdateEvent, CartErrorEvent } from '@theme/events';

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
        bubbleRetryTimer:      0,
        loadingTimers:         [],
        lastBubbleSyncTs:      0,
        closeTimer:            0,
        lastCartDrawerSectionHtml: null,
        lastCartDrawerSectionTs:   0,
        itemMutationTokens:    new Map(),
        itemMutationTimers:    new Map(),
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

    /* 4. Acessibilidade */
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

    /* 5. Retry */
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

  function toCartCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function getCartEventData(event) {
    return event?.detail?.data || {};
  }

  function getCartEventSections(event) {
    return getCartEventData(event).sections || null;
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
    const total  =
      data.cart?.item_count ??
      data.itemCount;

    return toCartCount(total);
  }

  function applyCartUpdateCount(event) {
    const explicitTotal = getExplicitCartCount(event);
    if (explicitTotal !== null) {
      updateBubble(explicitTotal);
      return 'total';
    }
    return 'none';
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
   * OPEN / CLOSE DRAWER
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
   * RENDER DRAWER
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
        const result = await cartService.getSections(['cart-drawer'], { signal });
        if (token !== state.renderToken) return;
        html = result.sections?.['cart-drawer'];
      }

      if (!html || token !== state.renderToken) return;

      const host = document.querySelector(SEL.sectionHost);
      if (!host) return;

      /* ── Parse ── */
      const tmp        = document.createElement('div');
      tmp.innerHTML    = html;
      const parsedHost = tmp.querySelector(SEL.sectionHost);
      const newDialog  = tmp.querySelector(SEL.dialog);

      if (newDialog) {
        newDialog.removeAttribute('open');
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
      const result = await cartService.get({ signal });
      const cart = result.resource;
      if (typeof cart?.item_count === 'number') updateBubble(cart.item_count);
      state.lastBubbleSyncTs = Date.now();
    } catch (err) {
      if (err?.name !== 'AbortError')
        console.warn('[cart-drawer] bubble refresh error:', err);
    } finally {
      state.bubbleAbort = null;
    }
  }

  /* ════════════════════════════════════════
   * ITEM LOADING & ERROR UX
   * ════════════════════════════════════════ */
  function setItemLoading(itemEl) {
    if (!itemEl) return;
    itemEl.classList.add('is-loading');

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

  async function updateDrawerItemQuantity(itemKey, nextQuantity) {
    const safeQty = Number.isFinite(Number(nextQuantity)) && Number(nextQuantity) > 0
      ? Number.parseInt(nextQuantity, 10)
      : 0;
    const state = getState();
    const host = document.querySelector(SEL.sectionHost);
    const token = (state.itemMutationTokens.get(itemKey) || 0) + 1;
    state.itemMutationTokens.set(itemKey, token);

    if (!itemKey) return;
    if (host) host.classList.add('cart-drawer--updating');

    try {
      const result = safeQty === 0
        ? await cartService.remove(itemKey, { sections: cartService.getCartSectionIds() })
        : await cartService.change(itemKey, safeQty, { sections: cartService.getCartSectionIds() });
      if (state.itemMutationTokens.get(itemKey) !== token) return;
      document.dispatchEvent(new CartUpdateEvent(result.resource, 'cart-drawer', {
        source: 'cart-drawer',
        operation: safeQty === 0 ? 'remove' : 'change',
        itemCount: result.itemCount,
        cart: result.cart,
        sections: result.sections,
      }));
    } catch (err) {
      if (state.itemMutationTokens.get(itemKey) !== token) return;
      console.error('[cart-drawer] quantity update error:', err);
      document.dispatchEvent(new CartErrorEvent('cart-drawer', err.message, err.description, err.errors, {
        source: 'cart-drawer',
        operation: safeQty === 0 ? 'remove' : 'change',
        status: err.status,
      }));
      showDrawerError(err?.message || 'Erro ao atualizar o carrinho. Tente novamente.');
      await queueRender({ keepOpen: true });
      await refreshBubble(true).catch(() => {});
      clearItemLoadingStates();
    } finally {
      if (state.itemMutationTokens.get(itemKey) === token) {
        state.itemMutationTokens.delete(itemKey);
        if (host) host.classList.remove('cart-drawer--updating');
      }
    }
  }

  function scheduleDrawerItemQuantity(itemKey, nextQuantity, itemElement) {
    const state = getState();
    const currentTimer = state.itemMutationTimers.get(itemKey);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(() => {
      state.itemMutationTimers.delete(itemKey);
      setItemLoading(itemElement);
      updateDrawerItemQuantity(itemKey, nextQuantity);
    }, 180);
    state.itemMutationTimers.set(itemKey, timer);
  }

  function init() {
    const state = getState();

    /* Aborta TODOS os controllers pendentes do ciclo anterior */
    state.controller?.abort();
    state.bubbleAbort?.abort();
    state.renderAbort?.abort();
    state.itemMutationTimers.forEach(timer => clearTimeout(timer));
    state.itemMutationTimers.clear();
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
      const data = getCartEventData(e);
      let countMode      = applyCartUpdateCount(e);
      const html         = getCartDrawerSectionFromEvent(e);
      const sectionCount = getCartCountFromSectionHtml(html);
      if (sectionCount !== null) {
        updateBubble(sectionCount);
        countMode = 'total';
      }
      rememberCartDrawerSection(html);
      const canAutoOpen  =
        data.operation === 'add' &&
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

        input.value = String(nextQty);
        scheduleDrawerItemQuantity(key, nextQty, item);
        return;
      }

      const removeBtn = t.closest('[data-cart-drawer-remove]');
      if (removeBtn && removeBtn.closest(SEL.sectionHost)) {
        e.preventDefault();
        const item = removeBtn.closest('.cart-drawer__item');
        const key = item?.getAttribute('data-key');
        if (!item || !key) return;
        setItemLoading(item);
        updateDrawerItemQuantity(key, 0);
      }
    }, { passive: false, signal });

    /* ── Checkout submit ── */
    document.addEventListener('submit', e => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = e.submitter || null;

      if (isCheckoutSubmit(form, submitter)) {
        state.navigatingToCheckout = true;
        document.documentElement.classList.add('am-cart-restoring');
        hardResetUI();
        return;
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
      refreshBubble(false).catch(() => {});
    }, { passive: true });
  }


  /* ── Bootstrap ── */
  function bootstrap() {
    ensureBFCacheListeners();
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

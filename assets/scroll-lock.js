/*
  Unified Scroll Lock (ref-counted)
  - Avoids conflicts between cart drawer, header drawer, dialogs, etc.
  - Uses body-position:fixed technique (iOS-safe) + html[scroll-lock] for CSS.
*/
(() => {
  const w = window;
  const d = document;

  const KEY = '__AM_SCROLL_LOCK_STATE__';
  const state = (w[KEY] ||= {
    count: 0,
    locks: Object.create(null),
    scrollY: 0,
    prevScrollBehavior: '',
    prevBody: {
      width: '',
      position: '',
      top: '',
      paddingRight: '',
    },
  });

  const getHtml = () => d.documentElement;
  const getBody = () => d.body;

  function applyLock() {
    const html = getHtml();
    const body = getBody();
    if (!html || !body) return;

    state.scrollY = w.scrollY || w.pageYOffset || 0;

    state.prevScrollBehavior = html.style.scrollBehavior;
    state.prevBody.width = body.style.width;
    state.prevBody.position = body.style.position;
    state.prevBody.top = body.style.top;
    state.prevBody.paddingRight = body.style.paddingRight;

    // Compensa scrollbar (desktop) para evitar layout shift ao travar.
    const scrollBarWidth = Math.max(0, (w.innerWidth || 0) - (html.clientWidth || 0));
    if (scrollBarWidth) body.style.paddingRight = `${scrollBarWidth}px`;

    html.style.scrollBehavior = 'auto';
    html.setAttribute('scroll-lock', '');

    body.style.width = '100%';
    body.style.position = 'fixed';
    body.style.top = `-${state.scrollY}px`;
  }

  function releaseLock() {
    const html = getHtml();
    const body = getBody();
    if (!html || !body) return;

    const top = body.style.top;
    const restoredY = top ? Math.abs(parseInt(top, 10)) : state.scrollY;

    html.removeAttribute('scroll-lock');

    body.style.width = state.prevBody.width || '';
    body.style.position = state.prevBody.position || '';
    body.style.top = state.prevBody.top || '';
    body.style.paddingRight = state.prevBody.paddingRight || '';

    w.scrollTo(0, restoredY);
    requestAnimationFrame(() => {
      html.style.scrollBehavior = state.prevScrollBehavior || '';
    });
  }

  function lock(key = 'default') {
    const k = String(key || 'default');
    if (state.locks[k]) return;
    state.locks[k] = true;

    if (state.count === 0) applyLock();
    state.count += 1;
  }

  function unlock(key = 'default') {
    const k = String(key || 'default');
    if (!state.locks[k]) return;
    delete state.locks[k];

    state.count = Math.max(0, state.count - 1);
    if (state.count === 0) releaseLock();
  }

  w.AMScrollLock = {
    lock,
    unlock,
    isLocked: () => state.count > 0,
  };

  function isSameTree(a, b) {
    if (!a || !b) return false;
    return a === b || a.contains?.(b) || b.contains?.(a);
  }

  // Fecha superfícies globais antes de outra ocupar o top layer no mobile.
  function closePeerOverlays({ except = null } = {}) {
    try {
      d.querySelectorAll('[popover]:popover-open').forEach((el) => {
        if (!isSameTree(el, except) && typeof el.hidePopover === 'function') el.hidePopover();
      });
    } catch (_) {}

    d.querySelectorAll('.np-overlay.np-visible').forEach((overlay) => {
      if (!isSameTree(overlay, except)) {
        overlay.dispatchEvent(new CustomEvent('am:overlay:close', { bubbles: true }));
      }
    });

    d.querySelectorAll('header-drawer').forEach((drawer) => {
      const details = drawer.refs?.details || drawer.querySelector('details[open]');
      if (!details?.open || isSameTree(drawer, except) || isSameTree(details, except)) return;
      if (typeof drawer.close === 'function') drawer.close();
      else details.removeAttribute('open');
    });

    d.querySelectorAll('dialog-component').forEach((component) => {
      const dialog = component.querySelector('dialog[open]');
      if (!dialog || isSameTree(component, except) || isSameTree(dialog, except)) return;
      if (typeof component.closeDialog === 'function') component.closeDialog();
    });

    d.querySelectorAll('cart-drawer-component dialog[open]').forEach((dialog) => {
      if (isSameTree(dialog, except)) return;
      d.dispatchEvent(new CustomEvent('cart:close', {
        bubbles: true,
        detail: { source: 'overlay-coordinator' },
      }));
    });
  }

  w.AMOverlay = {
    closeAll: closePeerOverlays,
  };

  d.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('[popovertarget]');
    if (!trigger) return;
    const popover = d.getElementById(trigger.getAttribute('popovertarget') || '');
    closePeerOverlays({ except: popover || trigger });
  }, { capture: true, passive: true });
})();

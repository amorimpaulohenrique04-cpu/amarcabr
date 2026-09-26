const STATE_KEY = '__AM_HEADER_BINDINGS__';

function getState() {
  if (!window[STATE_KEY]) {
    window[STATE_KEY] = {
      root: null,
      mobileNav: null,
      controller: null,
      closeTimer: 0,
    };
  }
  return window[STATE_KEY];
}

function initAmHeader() {
  const header = document.querySelector('#header-component.am-header');
  const mobileNav = document.querySelector('[data-am-mobile-nav]');
  if (!header) return;

  const state = getState();
  if (state.root === header && state.mobileNav === mobileNav) return;

  if (state.mobileNav?.classList.contains('is-open')) {
    if (window.AMScrollLock && typeof window.AMScrollLock.unlock === 'function') window.AMScrollLock.unlock('am-mobile-nav');
    else document.documentElement.style.overflow = '';
  }

  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
  if (state.closeTimer) {
    clearTimeout(state.closeTimer);
    state.closeTimer = 0;
  }

  state.root = header;
  state.mobileNav = mobileNav;
  state.controller = new AbortController();
  const signal = state.controller.signal;

  const openBtn = header.querySelector('[data-am-mobile-open]');
  const closeBtn = mobileNav?.querySelector('[data-am-mobile-close]');

  function resetPanels(nav) {
    const panels = nav.querySelectorAll('[data-am-panel]');
    panels.forEach((panel, idx) => {
      panel.classList.remove('is-exit-left', 'is-active');
      if (idx === 0) panel.classList.add('is-active');
      if (panel.dataset.level !== '0' && !panel.closest('template')) panel.remove();
    });
  }

  function openMobileNav(nav) {
    if (!nav || nav.classList.contains('is-open')) return;

    window.AMOverlay?.closeAll?.({ except: nav });

    nav.hidden = false;
    nav.classList.add('is-open');
    openBtn?.setAttribute('aria-expanded', 'true');

    const focusable = nav.querySelector('button, a, input, [tabindex]:not([tabindex="-1"])');
    if (focusable) requestAnimationFrame(() => focusable.focus());

    const scrollLock = window.AMScrollLock;
    if (scrollLock && typeof scrollLock.lock === 'function') scrollLock.lock('am-mobile-nav');
    else document.documentElement.style.overflow = 'hidden';
  }

  function closeMobileNav(nav, returnFocus = true) {
    if (!nav || !nav.classList.contains('is-open')) return;

    nav.classList.remove('is-open');
    openBtn?.setAttribute('aria-expanded', 'false');

    const scrollLock = window.AMScrollLock;
    if (scrollLock && typeof scrollLock.unlock === 'function') scrollLock.unlock('am-mobile-nav');
    else document.documentElement.style.overflow = '';

    if (state.closeTimer) clearTimeout(state.closeTimer);
    state.closeTimer = window.setTimeout(() => {
      nav.hidden = true;
      resetPanels(nav);
      state.closeTimer = 0;
    }, 240);

    if (returnFocus && openBtn) requestAnimationFrame(() => openBtn.focus());
  }

  header.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-am-search-toggle]');
    if (toggle) {
      const root = toggle.closest('[data-am-inline-search]');
      if (!root) return;

      const isOpen = root.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));

      const input = root.querySelector('.am-search-input');
      if (isOpen && input) requestAnimationFrame(() => input.focus());
      else if (input) input.blur();
      return;
    }

    if (mobileNav && e.target.closest('[data-am-mobile-open]')) {
      openMobileNav(mobileNav);
      return;
    }

    if (mobileNav && e.target.closest('[data-am-mobile-close]')) {
      closeMobileNav(mobileNav);
      return;
    }
  }, { signal });

  header.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const openSearch = header.querySelector('[data-am-inline-search].is-open');
    if (openSearch) {
      openSearch.classList.remove('is-open');
      const toggle = openSearch.querySelector('[data-am-search-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    if (mobileNav?.classList.contains('is-open')) closeMobileNav(mobileNav);
  }, { signal });

  mobileNav?.addEventListener('click', (e) => {
    if (e.target === mobileNav) {
      closeMobileNav(mobileNav);
      return;
    }

    const openSub = e.target.closest('[data-am-open-submenu]');
    if (openSub) {
      const item = openSub.closest('.am-mobile-item');
      const template = item?.querySelector('template[data-am-submenu-template]');
      const panel = template?.content?.firstElementChild?.cloneNode(true);
      if (!panel) return;

      const panelsRoot = mobileNav.querySelector('[data-am-panels]');
      const current = panelsRoot?.querySelector('.am-mobile-panel.is-active');
      if (!panelsRoot) return;

      panelsRoot.appendChild(panel);
      requestAnimationFrame(() => {
        current?.classList.add('is-exit-left');
        panel.classList.add('is-active');
      });
      return;
    }

    const back = e.target.closest('[data-am-back]');
    if (back) {
      const panelsRoot = mobileNav.querySelector('[data-am-panels]');
      const active = panelsRoot?.querySelector('.am-mobile-panel.is-active');
      const panels = panelsRoot?.querySelectorAll('.am-mobile-panel');
      const prev = panels && panels[panels.length - 2];
      if (!active || !prev) return;

      active.classList.remove('is-active');
      prev.classList.remove('is-exit-left');
      window.setTimeout(() => active.remove(), 240);
    }
  }, { signal });
}

function teardownAmHeader(e) {
  const state = getState();
  if (e?.target && state.root && !e.target.contains(state.root)) return;
  if (state.mobileNav?.classList.contains('is-open')) {
    if (window.AMScrollLock && typeof window.AMScrollLock.unlock === 'function') window.AMScrollLock.unlock('am-mobile-nav');
    else document.documentElement.style.overflow = '';
  }
  state.controller?.abort();
  state.controller = null;
  state.root = null;
  state.mobileNav = null;
  if (state.closeTimer) {
    clearTimeout(state.closeTimer);
    state.closeTimer = 0;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAmHeader, { once: true });
} else {
  requestAnimationFrame(initAmHeader);
}

document.addEventListener('shopify:section:load', initAmHeader, { passive: true });
document.addEventListener('shopify:section:reorder', initAmHeader, { passive: true });
document.addEventListener('shopify:section:unload', teardownAmHeader, { passive: true });
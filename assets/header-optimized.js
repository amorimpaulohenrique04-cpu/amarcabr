import { Component } from '@theme/component';
import { onDocumentLoaded, changeMetaThemeColor } from '@theme/utilities';

// Throttle utility otimizado para scroll performance
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

class HeaderComponent extends Component {
  requiredRefs = ['headerDrawerContainer', 'headerMenu', 'headerRowTop'];
  
  // Private properties
  #menuDrawerHiddenWidth = null;
  #intersectionObserver = null;
  #offscreen = false;
  #lastScrollTop = 0;
  #timeout = null;
  #scrollRafId = null;
  #animationDelay = 150;
  #isInitialized = false;

  // Optimized ResizeObserver with debouncing
  #resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry?.borderBoxSize?.[0]) return;
    
    const roundedHeaderHeight = Math.round(entry.borderBoxSize[0].blockSize);
    // Use requestAnimationFrame for better performance
    requestAnimationFrame(() => {
      document.body.style.setProperty('--header-height', `${roundedHeaderHeight}px`);
      
      if (this.#menuDrawerHiddenWidth && window.innerWidth > this.#menuDrawerHiddenWidth) {
        this.#updateMenuVisibility(false);
      }
    });
  });

  #observeStickyPosition = (alwaysSticky = true) => {
    if (this.#intersectionObserver) return;
    
    const config = {
      threshold: alwaysSticky ? 1 : 0,
      rootMargin: '0px 0px -1px 0px' // Slight optimization
    };
    
    this.#intersectionObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      
      const { isIntersecting } = entry;
      
      // Use requestAnimationFrame to avoid sync DOM writes
      requestAnimationFrame(() => {
        if (alwaysSticky) {
          this.dataset.stickyState = isIntersecting ? 'inactive' : 'active';
          if (this.dataset.themeColor) {
            changeMetaThemeColor(this.dataset.themeColor);
          }
        } else {
          this.#offscreen = !isIntersecting || this.dataset.stickyState === 'active';
        }
      });
    }, config);
    
    this.#intersectionObserver.observe(this);
  };

  #handleOverflowMinimum = (event) => {
    this.#updateMenuVisibility(event.detail.minimumReached);
  };

  #updateMenuVisibility(hideMenu) {
    // Batch DOM updates
    requestAnimationFrame(() => {
      if (hideMenu) {
        this.refs.headerDrawerContainer.classList.remove('desktop:hidden');
        this.#menuDrawerHiddenWidth = window.innerWidth;
        this.refs.headerMenu.classList.add('hidden');
      } else {
        this.refs.headerDrawerContainer.classList.add('desktop:hidden');
        this.#menuDrawerHiddenWidth = null;
        this.refs.headerMenu.classList.remove('hidden');
      }
    });
  }

  // Optimized scroll handler with proper throttling
  #handleWindowScroll = throttle(() => {
    if (this.#scrollRafId !== null) return;
    
    this.#scrollRafId = requestAnimationFrame(() => {
      this.#scrollRafId = null;
      this.#updateScrollState();
    });
  }, 16); // ~60fps throttling

  #updateScrollState = () => {
    const stickyMode = this.getAttribute('sticky');
    const scrollTop = document.scrollingElement?.scrollTop ?? 0;

    // Scrolled class for visual state (box-shadow, compact height) — consolidado aqui
    this.classList.toggle('am-header--scrolled', scrollTop > 40);

    if (!this.#offscreen && stickyMode !== 'always') {
      this.#lastScrollTop = scrollTop;
      return;
    }

    const headerTop = this.getBoundingClientRect().top;
    const isScrollingUp = scrollTop < this.#lastScrollTop;
    const isAtTop = headerTop >= 0;

    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = null;
    }

    // Batch DOM updates
    requestAnimationFrame(() => {
      if (stickyMode === 'always') {
        if (isAtTop) {
          this.dataset.scrollDirection = 'none';
        } else if (isScrollingUp) {
          this.dataset.scrollDirection = 'up';
        } else {
          this.dataset.scrollDirection = 'down';
        }
        this.#lastScrollTop = scrollTop;
        return;
      }

      if (isScrollingUp) {
        this.removeAttribute('data-animating');
        if (isAtTop) {
          this.#offscreen = false;
          this.dataset.stickyState = 'inactive';
          this.dataset.scrollDirection = 'none';
        } else {
          this.dataset.stickyState = 'active';
          this.dataset.scrollDirection = 'up';
        }
      } else if (this.dataset.stickyState === 'active') {
        this.dataset.scrollDirection = 'none';
        this.setAttribute('data-animating', '');
        this.#timeout = setTimeout(() => {
          this.dataset.stickyState = 'idle';
          this.removeAttribute('data-animating');
        }, this.#animationDelay);
      } else {
        this.dataset.scrollDirection = 'none';
        this.dataset.stickyState = 'idle';
      }

      this.#lastScrollTop = scrollTop;
    });
  };

  connectedCallback() {
    if (this.#isInitialized) return;
    
    super.connectedCallback();
    
    // Delay initialization slightly to avoid blocking initial render
    requestAnimationFrame(() => {
      this.#resizeObserver.observe(this);
      this.addEventListener('overflowMinimum', this.#handleOverflowMinimum);

      const stickyMode = this.getAttribute('sticky');
      if (stickyMode) {
        this.#observeStickyPosition(stickyMode === 'always');
        
        if (stickyMode === 'scroll-up' || stickyMode === 'always') {
          document.addEventListener('scroll', this.#handleWindowScroll, { passive: true });
        }
      }
      
      this.#isInitialized = true;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    // Clean up all observers
    this.#resizeObserver.disconnect();
    this.#intersectionObserver?.disconnect();
    this.removeEventListener('overflowMinimum', this.#handleOverflowMinimum);
    document.removeEventListener('scroll', this.#handleWindowScroll);
    
    // Cancel pending animations
    if (this.#scrollRafId !== null) {
      cancelAnimationFrame(this.#scrollRafId);
      this.#scrollRafId = null;
    }
    
    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = null;
    }

    // Reset CSS properties
    document.body.style.setProperty('--header-height', '0px');
    
    this.#isInitialized = false;
  }
}

// Only define custom element if not already defined (prevents conflicts)
if (!customElements.get('header-component')) {
  customElements.define('header-component', HeaderComponent);
}

// Optimized initialization with better error handling
onDocumentLoaded(() => {
  // Use more specific selectors to avoid conflicts
  const header = document.querySelector('header-component.am-header, header-component');
  const headerGroup = document.querySelector('#header-group');
  
  if (!headerGroup) return;

  let resizeTimeout;
  const resizeObserver = new ResizeObserver((entries) => {
    // Debounce resize calculations for better performance
    if (resizeTimeout) clearTimeout(resizeTimeout);
    
    resizeTimeout = setTimeout(() => {
      const headerGroupHeight = entries.reduce((totalHeight, entry) => {
        if (entry.target !== header || 
            (header instanceof HTMLElement && 
             header.hasAttribute('transparent') && 
             header.parentElement?.nextElementSibling)) {
          return totalHeight + (entry.borderBoxSize[0]?.blockSize ?? 0);
        }
        return totalHeight;
      }, 0);

      const roundedHeaderGroupHeight = Math.round(headerGroupHeight);
      document.body.style.setProperty('--header-group-height', `${roundedHeaderGroupHeight}px`);
    }, 50); // Debounce for 50ms
  });

  // Observe header if it exists
  if (header instanceof HTMLElement) {
    resizeObserver.observe(header);
  }

  // Observe all children of header group
  const observeChildren = () => {
    const children = Array.from(headerGroup.children);
    children.forEach(element => {
      if (element instanceof HTMLElement) {
        resizeObserver.observe(element);
      }
    });
  };

  observeChildren();

  // Optimize mutation observer
  const mutationObserver = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        shouldUpdate = true;
        break;
      }
    }
    
    if (shouldUpdate) {
      // Debounce the update
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(observeChildren, 100);
    }
  });
  
  mutationObserver.observe(headerGroup, { childList: true });
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    if (resizeTimeout) clearTimeout(resizeTimeout);
  });
});
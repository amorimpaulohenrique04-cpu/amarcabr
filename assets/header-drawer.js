import { Component } from '@theme/component';
import { trapFocus, removeTrapFocus } from '@theme/focus';
import { onAnimationEnd, removeWillChangeOnAnimationEnd } from '@theme/utilities';

/**
 * HeaderDrawer
 * - Fecha com ESC (já existia)
 * - Fecha ao clicar fora do drawer (document pointerdown capture)
 * - Evita duplicar listeners (AbortController por instância)
 * - Não interfere em navegação/cliques fora (não dá preventDefault)
 */
class HeaderDrawer extends Component {
  requiredRefs = ['details'];

  /** @type {AbortController | null} */
  #docController = null;


  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('keyup', this.#onKeyUp);
    this.#setupAnimatedElementListeners();

    // Listener global para "click fora" (somente quando aberto).
    // Usamos pointerdown em capture para pegar toque/click antes do "click".
    this.#bindDocumentOutsideClose();
  }


  disconnectedCallback() {
    super.disconnectedCallback();

    this.removeEventListener('keyup', this.#onKeyUp);
    this.#unbindDocumentOutsideClose();
  }

  get isOpen() {
    return this.refs.details.hasAttribute('open');
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  open(event) {
    const details = this.#getDetailsElement(event);
    const summary = details.querySelector('summary');
    if (!summary) return;

    summary.setAttribute('aria-expanded', 'true');
    this.preventInitialAccordionAnimations(details);

    requestAnimationFrame(() => {
      details.setAttribute('open', '');
      details.classList.add('menu-open');


      const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');
      onAnimationEnd(drawer || details, () => trapFocus(details), { subtree: false });
    });
  }

  back(event) {
    this.#close(this.#getDetailsElement(event));
  }

  close() {
    this.#close(this.refs.details);
  }

  #onKeyUp = (event) => {
    if (event.key !== 'Escape') return;
    this.#close(this.#getDetailsElement(event));
  };

  #getDetailsElement(event) {
    if (!(event?.target instanceof Element)) return this.refs.details;
    return event.target.closest('details') ?? this.refs.details;
  }

  #close(details) {
    const summary = details.querySelector('summary');
    if (!summary) return;

    summary.setAttribute('aria-expanded', 'false');
    details.classList.remove('menu-open');

    const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');
    onAnimationEnd(
      drawer || details,
      () => {
        reset(details);

        if (details === this.refs.details) {
          removeTrapFocus();

          // Fecha quaisquer details internos que tenham ficado abertos.
          const openDetails = this.querySelectorAll('details[open]:not(accordion-custom > details)');
          openDetails.forEach(reset);
        } else {
          trapFocus(this.refs.details);
        }
      },
      { subtree: false }
    );
  }

  #setupAnimatedElementListeners() {
    const allAnimated = this.querySelectorAll('.menu-drawer__animated-element');
    allAnimated.forEach((element) => {
      element.addEventListener('animationend', removeWillChangeOnAnimationEnd);
    });
  }

  #bindDocumentOutsideClose() {
    // Garantia: apenas um set de listeners por instância.
    this.#unbindDocumentOutsideClose();

    this.#docController = new AbortController();
    const { signal } = this.#docController;

    /** @param {Event} event */
    const onPointerDown = (event) => {
      if (!this.isOpen) return;
      const target = event.composedPath?.()[0] ?? event.target;
      if (!(target instanceof Node)) return;

      // Se clicou/tocou dentro do drawer (details), não fecha.
      if (this.refs.details.contains(target)) return;

      // Clique/touch fora -> fecha com segurança.
      this.close();
    };

    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true, signal });

    // Acessibilidade: se o foco "salta" para fora do drawer quando aberto, fechamos.
    // Isso evita estado preso em leitores de tela / tab.
    const onFocusIn = (event) => {
      if (!this.isOpen) return;
      const target = event.composedPath?.()[0] ?? event.target;
      if (!(target instanceof Node)) return;
      if (this.refs.details.contains(target)) return;
      this.close();
    };
    document.addEventListener('focusin', onFocusIn, { capture: true, passive: true, signal });
  }

  #unbindDocumentOutsideClose() {
    if (this.#docController) {
      this.#docController.abort();
      this.#docController = null;
    }
  }

  preventInitialAccordionAnimations(details) {
    const content = details.querySelectorAll('accordion-custom .details-content');
    content.forEach((element) => {
      if (element instanceof HTMLElement) element.classList.add('details-content--no-animation');
    });

    setTimeout(() => {
      content.forEach((element) => {
        if (element instanceof HTMLElement) element.classList.remove('details-content--no-animation');
      });
    }, 100);
  }
}

if (!customElements.get('header-drawer')) {
  customElements.define('header-drawer', HeaderDrawer);
}

function reset(element) {
  element.classList.remove('menu-open');
  element.removeAttribute('open');
  element.querySelector('summary')?.setAttribute('aria-expanded', 'false');
}

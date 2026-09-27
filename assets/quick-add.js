import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { ThemeEvents } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';
import VariantPicker from '@theme/variant-picker';

export class QuickAddComponent extends Component {
  #abortController = null;
  #cachedContent = new Map();
  #cartUpdateAbortController = new AbortController();

  get productPageUrl() {
    const productCard = this.closest('product-card');
    const hotspotProduct = this.closest('product-hotspot-component');
    const amProductCard = this.closest('[data-am-product-card]');
    const productLink =
      productCard?.getProductCardLink() ||
      hotspotProduct?.getHotspotProductLink() ||
      amProductCard?.querySelector('[data-am-product-link]');
    const productUrl = productLink?.href || amProductCard?.dataset.productUrl || this.dataset.productUrl;

    if (!productUrl) return '';

    const url = new URL(productUrl, window.location.origin);
    if (url.searchParams.has('variant')) return url.toString();

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) url.searchParams.set('variant', selectedVariantId);

    return url.toString();
  }

  #getSelectedVariantId() {
    const productCard = this.closest('product-card');
    const amProductCard = this.closest('[data-am-product-card]');
    return productCard?.getSelectedVariantId() || amProductCard?.dataset.selectedVariantId || null;
  }

  #getQuickAddRequestUrl(productPageUrl) {
    const url = new URL(productPageUrl, window.location.origin);
    url.searchParams.set('section_id', 'section-rendering-product-card');
    return url.toString();
  }

  connectedCallback() {
    super.connectedCallback();
    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate, {
      signal: this.#cartUpdateAbortController.signal,
    });
    document.addEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#abortController?.abort();
    this.#cartUpdateAbortController.abort();
    document.removeEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState);
  }

  #handleCartUpdate = () => {
    this.#cachedContent.clear();
  };

  #updateVariantPicker(newHtml) {
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!modalContent) return;

    const variantPicker = modalContent.querySelector('variant-picker');
    if (variantPicker instanceof VariantPicker) variantPicker.updateVariantPicker(newHtml);
  }

  handleClick = async (event) => {
    event.preventDefault();
    const currentUrl = this.productPageUrl;
    let productGrid = this.#cachedContent.get(currentUrl);

    if (!productGrid) {
      const html = await this.fetchProductPage(this.#getQuickAddRequestUrl(currentUrl));
      if (html) {
        const gridElement = html.querySelector('[data-product-grid-content]');
        if (gridElement) {
          productGrid = gridElement.cloneNode(true);
          this.#cachedContent.set(currentUrl, productGrid);
        }
      }
    }

    if (productGrid) {
      const freshContent = productGrid.cloneNode(true);
      await this.updateQuickAddModal(freshContent);
      this.#updateVariantPicker(productGrid);
    }

    this.#openQuickAddModal();
  };

  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);
    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #positionQuickBuy(dialogComponent) {
    const dialog = dialogComponent.querySelector('dialog');
    if (!(dialog instanceof HTMLDialogElement)) return;

    if (isMobileBreakpoint()) {
      dialog.style.removeProperty('--quick-buy-left');
      dialog.style.removeProperty('--quick-buy-bottom');
      dialog.style.removeProperty('--quick-buy-width');
      dialog.style.removeProperty('--quick-buy-max-height');
      return;
    }

    const cardRect = this.getBoundingClientRect();
    const viewportInset = 8;
    const cardInset = Math.min(16, cardRect.width * 0.05);
    const left = Math.max(viewportInset, cardRect.left + cardInset);
    const right = Math.min(window.innerWidth - viewportInset, cardRect.right - cardInset);
    const bottom = Math.max(viewportInset, window.innerHeight - cardRect.bottom + cardInset);
    const maxHeight = Math.max(0, Math.min(cardRect.height - cardInset * 2, window.innerHeight - bottom - viewportInset));

    dialog.style.setProperty('--quick-buy-left', `${left}px`);
    dialog.style.setProperty('--quick-buy-bottom', `${bottom}px`);
    dialog.style.setProperty('--quick-buy-width', `${Math.max(0, right - left)}px`);
    dialog.style.setProperty('--quick-buy-max-height', `${maxHeight}px`);
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#positionQuickBuy(dialogComponent);
    this.#stayVisibleUntilDialogCloses(dialogComponent);
    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;
    dialogComponent.closeDialog();
  };

  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, { signal: this.#abortController.signal });
      if (!response.ok) throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);

      const responseText = await response.text();
      return new DOMParser().parseFromString(responseText, 'text/html');
    } catch (error) {
      if (error.name === 'AbortError') return null;
      throw error;
    } finally {
      this.#abortController = null;
    }
  }

  async updateQuickAddModal(productGrid) {
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!productGrid || !modalContent) return;

    if (isMobileBreakpoint()) {
      const productDetails = productGrid.querySelector('.product-details');
      const productFormComponent = productGrid.querySelector('product-form-component');
      const variantPicker = productGrid.querySelector('variant-picker');
      const productPrice = productGrid.querySelector('product-price');
      const productTitle = document.createElement('a');
      productTitle.textContent = this.dataset.productTitle || '';
      productTitle.href = this.productPageUrl;
      const productHeader = document.createElement('div');
      productHeader.classList.add('product-header');
      productHeader.appendChild(productTitle);
      if (productPrice) productHeader.appendChild(productPrice);

      productGrid.appendChild(productHeader);
      if (variantPicker) productGrid.appendChild(variantPicker);
      if (productFormComponent) productGrid.appendChild(productFormComponent);
      productDetails?.remove();
    } else {
      const compactContent = document.createElement('div');
      const quickBuy = document.createElement('div');
      const variantPicker = productGrid.querySelector('variant-picker');
      const productFormComponent = productGrid.querySelector('product-form-component');
      quickBuy.className = 'quick-buy';

      if (variantPicker) quickBuy.appendChild(variantPicker);
      if (productFormComponent) quickBuy.appendChild(productFormComponent);
      compactContent.appendChild(quickBuy);
      productGrid = compactContent;
    }

    morph(modalContent, productGrid);
    this.#syncVariantSelection(modalContent);
  }

  #updateQuickAddButtonState = (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const eventCard = event.target.closest('product-card, [data-am-product-card]');
    const currentCard = this.closest('product-card, [data-am-product-card]');
    if (eventCard !== currentCard) return;

    const productOptionsCount = this.dataset.productOptionsCount;
    const quickAddButton = productOptionsCount === '1' ? 'add' : 'choose';
    this.setAttribute('data-quick-add-button', quickAddButton);
  };

  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  #updateProductTitleLink = (event) => {
    const anchorElement = event.detail.data.html?.querySelector('.view-product-title a');
    const viewMoreDetailsLink = this.querySelector('.view-product-title a');
    const mobileProductTitle = this.querySelector('.product-header a');
    if (!anchorElement) return;
    if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
    if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = '';
        });
      }
    });
  };
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}

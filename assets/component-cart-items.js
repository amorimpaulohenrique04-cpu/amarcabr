import { Component } from '@theme/component';
import { debounce, onAnimationEnd, prefersReducedMotion, resetShimmer } from '@theme/utilities';
import { morphSection, sectionRenderer } from '@theme/section-renderer';
import {
  ThemeEvents,
  CartUpdateEvent,
  CartErrorEvent,
  QuantitySelectorUpdateEvent,
  DiscountUpdateEvent,
} from '@theme/events';
import { cartPerformance } from '@theme/performance';
import { cartService, getCartSectionIds } from '@theme/cart-service';

class CartItemsComponent extends Component {
  #debouncedOnChange = debounce(this.#onQuantityChange, 80).bind(this);
  #mutationTokens = new Map();

  #onRemoveClick = (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-cart-drawer-remove],[data-cart-remove]');
    if (!button || !this.contains(button)) return;
    event.preventDefault();
    const lineValue = button.getAttribute('data-line') || button.getAttribute('data-cart-line');
    const line = lineValue ? Number.parseInt(lineValue, 10) : Number.NaN;
    if (!line || Number.isNaN(line)) return;
    this.onLineItemRemove(line);
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    this.addEventListener('click', this.#onRemoveClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    this.removeEventListener('click', this.#onRemoveClick);
  }

  #onQuantityChange(event) {
    if (!(event.target instanceof Node) || !this.contains(event.target)) return;
    const { quantity, cartLine: line } = event.detail;
    if (!line) return;
    if (quantity === 0) return this.onLineItemRemove(line);
    this.updateQuantity({ line, quantity, action: 'change' });
    const lineItemRow = this.refs.cartItemRows[line - 1];
    lineItemRow?.querySelector('text-component')?.shimmer();
  }

  onLineItemRemove(line) {
    this.updateQuantity({ line, quantity: 0, action: 'remove' });
    const cartItemRow = this.refs.cartItemRows[line - 1];
    if (!cartItemRow) return;
    const rows = [
      cartItemRow,
      ...this.refs.cartItemRows.filter((row) => row.dataset.parentKey === cartItemRow.dataset.key),
    ];
    rows.forEach((row) => {
      const remove = () => row.remove();
      if (prefersReducedMotion()) return remove();
      row.style.setProperty('--row-height', `${row.clientHeight}px`);
      row.classList.add('removing');
      onAnimationEnd(row, remove);
    });
  }

  async updateQuantity({ line, quantity, action }) {
    const marker = cartPerformance.createStartingMarker(`${action}:user-action`);
    const token = Symbol(String(line));
    this.#mutationTokens.set(line, token);
    this.#disableCartItems();
    this.refs.cartTotal?.shimmer();

    try {
      const result = quantity === 0
        ? await cartService.remove(line, { sections: getCartSectionIds([this.sectionId]) })
        : await cartService.change(line, quantity, { sections: getCartSectionIds([this.sectionId]) });
      if (this.#mutationTokens.get(line) !== token) return;

      resetShimmer(this);
      this.#updateQuantitySelectors(result.resource);
      this.dispatchEvent(new CartUpdateEvent(result.resource, this.sectionId, {
        source: 'cart-items-component',
        operation: action,
        itemCount: result.itemCount,
        cart: result.cart,
        sections: result.sections,
      }));
      const sectionHtml = result.sections[this.sectionId];
      if (sectionHtml) morphSection(this.sectionId, sectionHtml);
      this.#updateCartQuantitySelectorButtonStates();
    } catch (error) {
      if (this.#mutationTokens.get(line) !== token) return;
      resetShimmer(this);
      this.#handleCartError(line, error);
      this.dispatchEvent(new CartErrorEvent(
        this.sectionId,
        error.message,
        error.description,
        error.errors,
        { source: 'cart-items-component', operation: action, status: error.status }
      ));
    } finally {
      if (this.#mutationTokens.get(line) === token) {
        this.#mutationTokens.delete(line);
        this.#enableCartItems();
      }
      cartPerformance.measureFromMarker(marker);
    }
  }

  handleDiscountUpdate = (event) => this.#handleCartUpdate(event);

  #handleCartError = (line, error) => {
    const quantityInput = this.refs.quantitySelectors[line - 1]?.querySelector('input');
    if (quantityInput) quantityInput.value = quantityInput.defaultValue;
    const errorElement = this.refs[`cartItemError-${line}`];
    const errorContainer = this.refs[`cartItemErrorContainer-${line}`];
    if (errorElement instanceof HTMLElement) errorElement.textContent = error.message;
    if (errorContainer instanceof HTMLElement) errorContainer.classList.remove('hidden');
  };

  #handleCartUpdate = (event) => {
    if (event instanceof DiscountUpdateEvent) {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
      return;
    }
    if (event.target === this) return;
    const sectionHtml = event.detail.data.sections?.[this.sectionId];
    if (sectionHtml) {
      morphSection(this.sectionId, sectionHtml);
      this.#updateCartQuantitySelectorButtonStates();
    } else {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
    }
  };

  #disableCartItems() {
    this.classList.add('cart-items-disabled');
  }

  #enableCartItems() {
    this.classList.remove('cart-items-disabled');
  }

  #updateQuantitySelectors(updatedCart) {
    if (!updatedCart.items) return;
    for (const item of updatedCart.items) {
      const selectors = document.querySelectorAll(`quantity-selector-component[data-variant-id="${item.variant_id}"]`);
      for (const selector of selectors) {
        const input = selector.querySelector('input[data-cart-quantity]');
        if (!input) continue;
        input.setAttribute('data-cart-quantity', item.quantity.toString());
        selector.updateCartQuantity?.();
      }
    }
  }

  #updateCartQuantitySelectorButtonStates() {
    for (const selector of document.querySelectorAll('cart-quantity-selector-component')) {
      selector.updateButtonStates?.();
    }
  }

  get sectionId() {
    const { sectionId } = this.dataset;
    if (!sectionId) throw new Error('Section id missing');
    return sectionId;
  }
}

if (!customElements.get('cart-items-component')) {
  customElements.define('cart-items-component', CartItemsComponent);
}

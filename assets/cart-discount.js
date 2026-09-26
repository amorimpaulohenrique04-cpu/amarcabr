import { Component } from '@theme/component';
import { morphSection } from '@theme/section-renderer';
import { DiscountUpdateEvent, CartErrorEvent } from '@theme/events';
import { cartPerformance } from '@theme/performance';
import { cartService } from '@theme/cart-service';

class CartDiscount extends Component {
  requiredRefs = ['cartDiscountError', 'cartDiscountErrorDiscountCode', 'cartDiscountErrorShipping'];
  #activeFetch = null;

  #createAbortController() {
    this.#activeFetch?.abort();
    const abortController = new AbortController();
    this.#activeFetch = abortController;
    return abortController;
  }

  applyDiscount = async (event) => {
    const { cartDiscountError, cartDiscountErrorDiscountCode, cartDiscountErrorShipping } = this.refs;
    event.preventDefault();
    event.stopPropagation();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const discountCode = form.querySelector('input[name="discount"]');
    if (!(discountCode instanceof HTMLInputElement) || typeof this.dataset.sectionId !== 'string') return;
    const discountCodeValue = discountCode.value;
    const abortController = this.#createAbortController();

    try {
      const existingDiscounts = this.#existingDiscounts();
      if (existingDiscounts.includes(discountCodeValue)) return;
      cartDiscountError.classList.add('hidden');
      cartDiscountErrorDiscountCode.classList.add('hidden');
      cartDiscountErrorShipping.classList.add('hidden');
      const result = await cartService.update(
        { discount: [...existingDiscounts, discountCodeValue].join(',') },
        { sections: [this.dataset.sectionId], signal: abortController.signal }
      );
      const data = result.resource;
      if (data.discount_codes.find((discount) => discount.code === discountCodeValue && !discount.applicable)) {
        discountCode.value = '';
        this.#handleDiscountError('discount_code');
        return;
      }

      const newHtml = data.sections[this.dataset.sectionId];
      const parsedHtml = new DOMParser().parseFromString(newHtml, 'text/html');
      const section = parsedHtml.getElementById(`shopify-section-${this.dataset.sectionId}`);
      const discountCodes = section?.querySelectorAll('.cart-discount__pill') || [];
      if (section) {
        const codes = Array.from(discountCodes)
          .map((element) => element instanceof HTMLLIElement ? element.dataset.discountCode : null)
          .filter(Boolean);
        const onlyShippingDiscountChanged = codes.length === existingDiscounts.length
          && codes.every((code) => existingDiscounts.includes(code))
          && data.discount_codes.find((discount) => discount.code === discountCodeValue && discount.applicable);
        if (onlyShippingDiscountChanged) {
          this.#handleDiscountError('shipping');
          discountCode.value = '';
          return;
        }
      }
      document.dispatchEvent(new DiscountUpdateEvent(data, this.id));
      morphSection(this.dataset.sectionId, newHtml);
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.dispatchEvent(new CartErrorEvent(this.id, error.message, error.description, error.errors, {
          source: 'cart-discount', operation: 'update', status: error.status,
        }));
      }
    } finally {
      if (this.#activeFetch === abortController) this.#activeFetch = null;
      cartPerformance.measureFromEvent('discount-update:user-action', event);
    }
  };

  removeDiscount = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if ((event instanceof KeyboardEvent && event.key !== 'Enter')
      || !(event instanceof MouseEvent)
      || !(event.target instanceof HTMLElement)
      || typeof this.dataset.sectionId !== 'string') return;
    const pill = event.target.closest('.cart-discount__pill');
    if (!(pill instanceof HTMLLIElement)) return;
    const discountCode = pill.dataset.discountCode;
    if (!discountCode) return;
    const existingDiscounts = this.#existingDiscounts();
    const index = existingDiscounts.indexOf(discountCode);
    if (index === -1) return;
    existingDiscounts.splice(index, 1);
    const abortController = this.#createAbortController();
    try {
      const result = await cartService.update(
        { discount: existingDiscounts.join(',') },
        { sections: [this.dataset.sectionId], signal: abortController.signal }
      );
      const data = result.resource;
      document.dispatchEvent(new DiscountUpdateEvent(data, this.id));
      morphSection(this.dataset.sectionId, data.sections[this.dataset.sectionId]);
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.dispatchEvent(new CartErrorEvent(this.id, error.message, error.description, error.errors, {
          source: 'cart-discount', operation: 'update', status: error.status,
        }));
      }
    } finally {
      if (this.#activeFetch === abortController) this.#activeFetch = null;
    }
  };

  #handleDiscountError(type) {
    const { cartDiscountError, cartDiscountErrorDiscountCode, cartDiscountErrorShipping } = this.refs;
    const target = type === 'discount_code' ? cartDiscountErrorDiscountCode : cartDiscountErrorShipping;
    cartDiscountError.classList.remove('hidden');
    target.classList.remove('hidden');
  }

  #existingDiscounts() {
    const discountCodes = [];
    for (const pill of this.querySelectorAll('.cart-discount__pill')) {
      if (pill instanceof HTMLLIElement && typeof pill.dataset.discountCode === 'string') {
        discountCodes.push(pill.dataset.discountCode);
      }
    }
    return discountCodes;
  }
}

if (!customElements.get('cart-discount-component')) {
  customElements.define('cart-discount-component', CartDiscount);
}

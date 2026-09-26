import { Component } from '@theme/component';
import { debounce } from '@theme/utilities';
import { cartPerformance } from '@theme/performance';
import { cartService } from '@theme/cart-service';
import { CartErrorEvent } from '@theme/events';

class CartNote extends Component {
  #activeFetch = null;

  updateCartNote = debounce(async (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    this.#activeFetch?.abort();
    const abortController = new AbortController();
    this.#activeFetch = abortController;
    try {
      await cartService.update({ note: event.target.value }, { signal: abortController.signal });
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.dispatchEvent(new CartErrorEvent(this.id, error.message, error.description, error.errors, {
          source: 'cart-note', operation: 'update', status: error.status,
        }));
      }
    } finally {
      if (this.#activeFetch === abortController) this.#activeFetch = null;
      cartPerformance.measureFromEvent('note-update:user-action', event);
    }
  }, 200);
}

if (!customElements.get('cart-note')) {
  customElements.define('cart-note', CartNote);
}

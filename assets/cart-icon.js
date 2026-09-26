import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';
import { ThemeEvents } from '@theme/events';
import { cartService } from '@theme/cart-service';

const toCartCount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
};

class CartIcon extends Component {
  requiredRefs = ['cartBubble', 'cartBubbleCount'];

  set currentCartCount(value) {
    this.refs.cartBubbleCount.textContent = value < 100 ? String(value) : '';
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.addEventListener('pageshow', this.onPageShow);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  onPageShow = async (event) => {
    if (!event.persisted) return;
    try {
      const result = await cartService.get();
      this.renderCartBubble(result.itemCount, false);
    } catch (_) {}
  };

  onCartUpdate = (event) => {
    const data = event.detail?.data || {};
    const count = toCartCount(data.cart?.item_count ?? event.detail?.resource?.item_count ?? data.itemCount);
    if (count !== null) this.renderCartBubble(count);
  };

  renderCartBubble = async (itemCount, animate = true) => {
    const count = toCartCount(itemCount);
    if (count === null) return;
    this.refs.cartBubbleCount.classList.toggle('hidden', count === 0);
    this.refs.cartBubble.classList.toggle('visually-hidden', count === 0);
    this.currentCartCount = count;
    this.classList.toggle('header-actions__cart-icon--has-cart', count > 0);
    if (!animate || count === 0) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    this.refs.cartBubble.classList.add('cart-bubble--animating');
    await onAnimationEnd(this.refs.cartBubbleText || this.refs.cartBubble);
    this.refs.cartBubble.classList.remove('cart-bubble--animating');
  };
}

if (!customElements.get('cart-icon')) {
  customElements.define('cart-icon', CartIcon);
}

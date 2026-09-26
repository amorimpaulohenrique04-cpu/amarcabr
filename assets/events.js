export class ThemeEvents {
  static variantSelected = 'variant:selected';
  static variantUpdate = 'variant:update';
  static cartUpdate = 'cart:update';
  static cartError = 'cart:error';
  static mediaStartedPlaying = 'media:started-playing';
  static quantitySelectorUpdate = 'quantity-selector:update';
  static megaMenuHover = 'megaMenu:hover';
  static zoomMediaSelected = 'zoom-media:selected';
  static discountUpdate = 'discount:update';
  static FilterUpdate = 'filter:update';
}

function mutationData(resource, sourceId, data, defaultOperation) {
  const cart = data?.cart || (Number.isFinite(Number(resource?.item_count)) ? resource : null);
  const rawItemCount = cart?.item_count ?? data?.itemCount;
  const parsedItemCount = Number(rawItemCount);
  return {
    ...data,
    source: data?.source || sourceId || 'unknown',
    operation: data?.operation || defaultOperation,
    itemCount: rawItemCount !== null && rawItemCount !== undefined
      && Number.isFinite(parsedItemCount) && parsedItemCount >= 0 ? parsedItemCount : null,
    cart,
    sections: data?.sections || resource?.sections || {},
  };
}

export class VariantSelectedEvent extends Event {
  constructor(resource) {
    super(ThemeEvents.variantSelected, { bubbles: true });
    this.detail = { resource };
  }
}

export class VariantUpdateEvent extends Event {
  constructor(resource, sourceId, data) {
    super(ThemeEvents.variantUpdate, { bubbles: true });
    this.detail = {
      resource: resource || null,
      sourceId,
      data: { html: data.html, productId: data.productId, newProduct: data.newProduct },
    };
  }
}

export class CartAddEvent extends Event {
  static eventName = ThemeEvents.cartUpdate;

  constructor(resource, sourceId, data = {}) {
    super(CartAddEvent.eventName, { bubbles: true });
    this.detail = { resource, sourceId, data: mutationData(resource, sourceId, data, 'add') };
  }
}

export class CartUpdateEvent extends Event {
  constructor(resource, sourceId, data = {}) {
    super(ThemeEvents.cartUpdate, { bubbles: true });
    this.detail = { resource, sourceId, data: mutationData(resource, sourceId, data, 'change') };
  }
}

export class CartErrorEvent extends Event {
  constructor(sourceId, message, description, errors, data = {}) {
    super(ThemeEvents.cartError, { bubbles: true });
    this.detail = {
      sourceId,
      data: {
        source: data.source || sourceId || 'unknown',
        operation: data.operation || 'unknown',
        status: data.status || 0,
        message,
        description,
        errors,
      },
    };
  }
}

export class QuantitySelectorUpdateEvent extends Event {
  constructor(quantity, cartLine) {
    super(ThemeEvents.quantitySelectorUpdate, { bubbles: true });
    this.detail = { quantity, cartLine };
  }
}

export class DiscountUpdateEvent extends Event {
  constructor(resource, sourceId) {
    super(ThemeEvents.discountUpdate, { bubbles: true });
    this.detail = { resource, sourceId };
  }
}

export class MediaStartedPlayingEvent extends Event {
  constructor(resource) {
    super(ThemeEvents.mediaStartedPlaying, { bubbles: true });
    this.detail = { resource };
  }
}

export class SlideshowSelectEvent extends Event {
  static eventName = 'slideshow:select';
  detail;

  constructor(data) {
    super(SlideshowSelectEvent.eventName, { bubbles: true });
    this.detail = data;
  }
}

export class ZoomMediaSelectedEvent extends Event {
  constructor(index) {
    super(ThemeEvents.zoomMediaSelected, { bubbles: true });
    this.detail = { index };
  }
}

export class MegaMenuHoverEvent extends Event {
  constructor() {
    super(ThemeEvents.megaMenuHover, { bubbles: true });
  }
}

export class FilterUpdateEvent extends Event {
  constructor(queryParams) {
    super(ThemeEvents.FilterUpdate, { bubbles: true });
    this.detail = { queryParams };
  }

  shouldShowClearAll() {
    return [...this.detail.queryParams.entries()].filter(([key]) => key.startsWith('filter.')).length > 0;
  }
}

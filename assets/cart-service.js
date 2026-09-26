const MAX_SECTIONS = 5;
const DEFAULT_SECTION = 'cart-drawer';
const changeQueues = new Map();

export class CartServiceError extends Error {
  constructor(message, { status = 0, description = '', errors = null, response = null } = {}) {
    super(message || 'Não foi possível atualizar o carrinho.');
    this.name = 'CartServiceError';
    this.status = status;
    this.description = description;
    this.errors = errors;
    this.response = response;
  }
}

function route(name) {
  const value = Theme?.routes?.[name];
  if (!value) throw new CartServiceError(`Rota do carrinho não configurada: ${name}`);
  return value;
}

function uniqueSections(sectionIds = []) {
  return [...new Set([DEFAULT_SECTION, ...sectionIds].filter(Boolean))].slice(0, MAX_SECTIONS);
}

export function getCartSectionIds(extraSectionIds = []) {
  const componentSectionIds = [...document.querySelectorAll('cart-items-component[data-section-id]')]
    .map((element) => element.dataset.sectionId)
    .filter(Boolean);
  return uniqueSections([...extraSectionIds, ...componentSectionIds]);
}

function cartCountFromSection(sections) {
  const html = sections?.[DEFAULT_SECTION];
  if (!html || typeof html !== 'string') return null;
  const documentFragment = new DOMParser().parseFromString(html, 'text/html');
  const value = Number(documentFragment.querySelector('[ref="cartItemCount"]')?.textContent);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeResponse(resource) {
  const sections = resource?.sections && typeof resource.sections === 'object' ? resource.sections : {};
  const responseCount = Number(resource?.item_count);
  const itemCount = Number.isFinite(responseCount) && responseCount >= 0
    ? responseCount
    : cartCountFromSection(sections);
  return {
    resource,
    cart: Number.isFinite(responseCount) ? resource : null,
    sections,
    itemCount,
  };
}

async function parseResponse(response) {
  const resource = await response.json().catch(() => ({}));
  if (!response.ok || resource?.status || resource?.errors) {
    const fallback = response.status === 422
      ? 'Quantidade indisponível em estoque.'
      : response.status === 429
        ? 'Muitas requisições. Aguarde um momento.'
        : response.status >= 500
          ? 'Erro no servidor. Tente novamente.'
          : 'Não foi possível atualizar o carrinho.';
    throw new CartServiceError(resource?.description || resource?.message || fallback, {
      status: Number(resource?.status) || response.status || 0,
      description: resource?.description || '',
      errors: resource?.errors || null,
      response: resource,
    });
  }
  return normalizeResponse(resource);
}

function withSections(payload, sectionIds, sectionsUrl = window.location.pathname) {
  const sections = uniqueSections(sectionIds);
  return {
    ...payload,
    sections,
    sections_url: sectionsUrl,
  };
}

function enqueueChange(identifier, mutation) {
  const key = String(identifier);
  const previous = changeQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(mutation);
  changeQueues.set(key, current);
  current.finally(() => {
    if (changeQueues.get(key) === current) changeQueues.delete(key);
  }).catch(() => {});
  return current;
}

export async function add(input, { sections = getCartSectionIds(), signal } = {}) {
  let body;
  let headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const sectionIds = sections === false ? null : uniqueSections(sections);

  if (input instanceof FormData) {
    body = new FormData();
    input.forEach((value, key) => body.append(key, value));
    if (sectionIds) {
      body.set('sections', sectionIds.join(','));
      body.set('sections_url', window.location.pathname);
    }
  } else {
    const payload = Array.isArray(input) ? { items: input } : input;
    body = JSON.stringify(sectionIds ? withSections(payload, sectionIds) : payload);
    headers = { ...headers, 'Content-Type': 'application/json' };
  }

  const response = await fetch(route('cart_add_url'), { method: 'POST', headers, body, signal });
  return parseResponse(response);
}

export function change(identifier, quantity, { sections = getCartSectionIds(), signal } = {}) {
  const parsedQuantity = Number.parseInt(quantity, 10);
  const safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;
  return enqueueChange(identifier, async () => {
    const body = JSON.stringify(withSections({ id: identifier, quantity: safeQuantity }, sections));
    const response = await fetch(route('cart_change_url'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
      signal,
    });
    return parseResponse(response);
  });
}

export function remove(identifier, options) {
  return change(identifier, 0, options);
}

export async function update(payload, { sections, sectionsUrl, signal } = {}) {
  const requestPayload = sections ? withSections(payload, sections, sectionsUrl) : payload;
  const response = await fetch(route('cart_update_url'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(requestPayload),
    signal,
  });
  return parseResponse(response);
}

export async function get({ signal } = {}) {
  const response = await fetch(route('cart_get_url'), {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    cache: 'no-store',
    signal,
  });
  return parseResponse(response);
}

export async function getSections(sectionIds = [DEFAULT_SECTION], { signal } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set('sections', uniqueSections(sectionIds).join(','));
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  const result = await parseResponse(response);
  return { ...result, sections: result.resource };
}

export const cartService = { add, change, remove, update, get, getSections, getCartSectionIds };

// Passively forwards listing, auction-detail, and price-history responses.
(() => {
  'use strict';
  let latest = null;
  let snapshotSent = false;
  const pendingPrices = new Map(), pendingAuctions = new Map();
  const post = message => window.postMessage({ __wmsfMarketHook: true, ...message }, location.origin);
  const publishMarketplace = data => {
    if (!data || !Array.isArray(data.auctions)) return;
    latest = data;
    post({ type: 'marketplace', data });
  };
  const publishPriceHistory = (cardId, data) => {
    if (!cardId || !data || typeof data !== 'object' || !data.by_rarity || typeof data.by_rarity !== 'object') return;
    if (!snapshotSent) pendingPrices.set(cardId, data);
    post({ type: 'price-history', cardId, data });
  };
  const publishAuction = (auctionId, data) => {
    const auction = data?.auction || data;
    const card = auction?.card || {};
    const cardId = auction?.card_id || card.id;
    const rarity = auction?.snapshot_rarity || card.rarity;
    if (!auctionId || typeof cardId !== 'string' || !RARITIES.has(rarity)) return;
    const listing = {
      id: auction.id || auctionId,
      cardId,
      rarity,
      title: card.wikipedia_title || card.name || auction.card_title || ''
    };
    if (!snapshotSent) pendingAuctions.set(listing.id, listing);
    post({
      type: 'auction',
      auction: listing
    });
  };
  const RARITIES = new Set(['C', 'PC', 'R', 'SR', 'UR', 'L']);
  const pathOf = input => {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input?.url, location.href);
      return url.origin === location.origin ? url.pathname : '';
    } catch { return ''; }
  };

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin ||
        message?.__wmsfMarketContent !== true || message.type !== 'snapshot') return;
    if (latest) post({ type: 'marketplace', data: latest });
    for (const [cardId, data] of pendingPrices) post({ type: 'price-history', cardId, data });
    for (const auction of pendingAuctions.values()) post({ type: 'auction', auction });
    pendingPrices.clear();
    pendingAuctions.clear();
    snapshotSent = true;
  });

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const path = pathOf(input), method = init?.method || input?.method || 'GET';
    const response = originalFetch.apply(this, arguments);
    if (path === '/api/marketplace' && String(method).toUpperCase() === 'GET') {
      response.then(result => result.ok
        ? result.clone().json().then(publishMarketplace).catch(() => {})
        : null).catch(() => {});
    }
    const historyMatch = path.match(/^\/api\/marketplace\/cards\/([^/]+)\/price-history$/);
    if (historyMatch && String(method).toUpperCase() === 'GET') {
      response.then(result => result.ok ? result.clone().json()
        .then(data => publishPriceHistory(decodeURIComponent(historyMatch[1]), data))
        .catch(() => {}) : null).catch(() => {});
    }
    const auctionMatch = path.match(/^\/api\/marketplace\/([^/]+)$/);
    if (auctionMatch && String(method).toUpperCase() === 'GET') {
      response.then(result => result.ok ? result.clone().json()
        .then(data => publishAuction(decodeURIComponent(auctionMatch[1]), data))
        .catch(() => {}) : null).catch(() => {});
    }
    return response;
  };

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open, send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__wmsfMarketRequest = { method, path: pathOf(url) };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      const request = this.__wmsfMarketRequest;
      if (request && String(request.method).toUpperCase() === 'GET') {
        this.addEventListener('load', () => {
          try {
            if (this.status < 200 || this.status >= 300) return;
            const data = this.responseType === 'json'
              ? this.response
              : !this.responseType || this.responseType === 'text'
                ? JSON.parse(this.responseText)
                : null;
            if (request.path === '/api/marketplace') publishMarketplace(data);
            const historyMatch = request.path.match(/^\/api\/marketplace\/cards\/([^/]+)\/price-history$/);
            if (historyMatch) publishPriceHistory(decodeURIComponent(historyMatch[1]), data);
            const auctionMatch = request.path.match(/^\/api\/marketplace\/([^/]+)$/);
            if (auctionMatch) publishAuction(decodeURIComponent(auctionMatch[1]), data);
          } catch {}
        }, { once: true });
      }
      return send.apply(this, arguments);
    };
  }
})();

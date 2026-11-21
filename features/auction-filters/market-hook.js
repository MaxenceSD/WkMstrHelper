// Passively forwards marketplace responses so the isolated content script can map
// visible auctions to card ids without issuing extra listing requests.
(() => {
  'use strict';
  let latest = null;
  const post = data => window.postMessage({ __wmsfMarketHook: true, data }, location.origin);
  const publish = data => {
    if (!data || !Array.isArray(data.auctions)) return;
    latest = data;
    post(data);
  };
  const pathOf = input => {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input?.url, location.href);
      return url.origin === location.origin ? url.pathname : '';
    } catch { return ''; }
  };

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source === window && event.origin === location.origin &&
        message?.__wmsfMarketContent === true && message.type === 'snapshot' && latest) post(latest);
  });

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const path = pathOf(input), method = init?.method || input?.method || 'GET';
    const response = originalFetch.apply(this, arguments);
    if (path === '/api/marketplace' && String(method).toUpperCase() === 'GET') {
      response.then(result => result.clone().json().then(publish).catch(() => {})).catch(() => {});
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
      if (request?.path === '/api/marketplace' && String(request.method).toUpperCase() === 'GET') {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === 'json') publish(this.response);
            else if (!this.responseType || this.responseType === 'text') publish(JSON.parse(this.responseText));
          } catch {}
        }, { once: true });
      }
      return send.apply(this, arguments);
    };
  }
})();

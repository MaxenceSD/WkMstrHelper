/* Local DOM filtering plus user-triggered market price reads. */
(() => {
  'use strict';
  if (!/^(www\.)?wiki-masters\.com$/.test(location.hostname) || globalThis.__wmFinder12) return;
  globalThis.__wmFinder12 = true;
  const C = globalThis.WMFinderCore, P = globalThis.WMFinderPanel;
  const KEY = 'wmFinder12Prefs', WATCH_KEY = 'wmshV5Watchlist';
  const MARKET_CACHE_KEY = 'wmFinder12LegendaryPrices';
  const MARKET_AUCTIONS_KEY = 'wmFinder12LegendaryAuctions';
  const LIMIT = 2000, PRICE_TTL = 24 * 60 * 60 * 1000, PRICE_GAP = 500;
  const PRICE_RETRY_DELAY = 60 * 1000;
  let prefs = { ...C.DEFAULTS }, ui = null, main = null, grid = null, suspendedGrid = null, tabbar = null, browse = false;
  let shinyButton = null, shinyButtonGroup = null;
  let pendingNavigation = null, scan = null, disposed = false;
  let batchTimer = null, syncTimer = null, timeTimer = null, priceStaleTimer = null, errorMessage = '';
  const cards = new Map(), dirty = new Set(), added = new Set(), timeDirty = new Set();
  const sessionHiddenCards = new Set();
  const marketAuctions = new Map(), marketPrices = new Map();
  let marketPriceSave = Promise.resolve();
  const priceKey = (cardId, rarity) => `${cardId}|${rarity}`;
  const marketEntry = (cardId, rarity = 'L') => marketPrices.get(priceKey(cardId, rarity)) || null;
  globalThis.WMFinderMarketPrice = {
    ready: false,
    getCachedForAuction(path) {
      const listing = marketAuctions.get(String(path || '').replace(/\/$/, ''));
      if (!listing || !hasFreshMarketPrice(listing.cardId, listing.rarity)) return null;
      return cachedMarketPrice(listing.cardId, listing.rarity);
    }
  };
  let priceLoad = { running: false, done: 0, total: 0, message: '' }, showMarketPrices = true;
  let removed = false, favorites = new Set();
  const rootPath = () => /^\/marketplace\/?$/.test(location.pathname);
  const filteringActive = () => (prefs.shinyOnly || prefs.minPrice !== null || prefs.maxPrice !== null ||
    prefs.minMinutes !== null || prefs.maxMinutes !== null || prefs.dealsOnly) && (!suspendedGrid || suspendedGrid !== grid);
  const timeActive = () => prefs.minMinutes !== null || prefs.maxMinutes !== null;
  const visible = el => !!el?.isConnected && !el.closest('[hidden],[aria-hidden="true"]') && !!el.getClientRects().length;
  const own = el => !!el?.closest?.('wm-shiny-finder,button[data-wm-shiny-filter]');

  function setAttr(el, name, value) {
    if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function clearMark(card) {
    card.root.removeAttribute('data-wmsf-hidden');
    card.root.removeAttribute('data-wmsf-state');
    removeHideButton(card);
  }
  function removeMarketPriceBadge(card) { card.frame.querySelector(':scope > [data-wmsf-market-price]')?.remove(); }
  function removeHideButton(card) { card.frame.querySelector(':scope > [data-wmsf-hide-card]')?.remove(); }
  const formattedPrice = value => Number(value).toLocaleString('fr-FR');
  const cachedMarketPrice = (cardId, rarity = 'L') => marketEntry(cardId, rarity)?.price ?? null;
  const hasCachedMarketPrice = (cardId, rarity = 'L') => marketEntry(cardId, rarity) !== null;
  const priceAge = entry => Date.now() - (entry?.computedAt ?? entry?.t ?? 0);
  const hasFreshMarketPrice = (cardId, rarity = 'L') => {
    const entry = marketEntry(cardId, rarity);
    return Boolean(entry) && priceAge(entry) < PRICE_TTL;
  };
  const marketPriceExpired = (cardId, rarity = 'L') => {
    const entry = marketEntry(cardId, rarity);
    return !entry || Date.now() - (entry.fetchedAt ?? entry.t ?? 0) >= PRICE_TTL;
  };
  function renderMarketPriceBadge(frame, cardId, rarity) {
    const entry = marketEntry(cardId, rarity);
    if (!entry) {
      frame.querySelector(':scope > [data-wmsf-market-price]')?.remove();
      return;
    }
    let badge = frame.querySelector(':scope > [data-wmsf-market-price]');
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute('data-wmsf-market-price', '');
      frame.append(badge);
    }
    const stale = priceAge(entry) >= PRICE_TTL;
    badge.toggleAttribute('data-stale', stale);
    const text = entry.price == null ? 'Aucune vente' : `${formattedPrice(entry.price)} ₩${stale ? ' · ancien' : ''}`;
    if (badge.textContent !== text) badge.textContent = text;
    const title = entry.price == null ? `Aucune vente connue pour cette carte (${rarity})` :
      `Prix moyen (${rarity}), calculé le ${new Date(entry.computedAt ?? entry.t).toLocaleString('fr-FR')}${stale ? ' — données de plus de 24 h' : ''}`;
    if (badge.title !== title) badge.title = title;
  }
  function renderMarketPrice(card) {
    if (!showMarketPrices) { removeMarketPriceBadge(card); return; }
    const listing = marketAuctions.get(card.id);
    if (!listing) { removeMarketPriceBadge(card); return; }
    renderMarketPriceBadge(card.frame, listing.cardId, listing.rarity);
  }
  function renderAuctionDetailPrice() {
    const match = location.pathname.match(/^\/marketplace\/([^/]+)\/?$/);
    if (!match) return;
    const listing = marketAuctions.get(`/marketplace/${match[1]}`);
    if (!listing) return;
    const root = document.getElementById(`marketplace-auction-${match[1]}`) ||
      document.querySelector('main,[role="main"]') || document;
    const candidates = [
      ...(root instanceof Element && root.matches(C.FRAME) ? [root] : []),
      ...root.querySelectorAll(C.FRAME)
    ];
    const titledCandidate = listing.title
      ? candidates.find(item => C.norm(item.querySelector('h3')?.textContent) === C.norm(listing.title))
      : null;
    const rarityCandidates = candidates.filter(item =>
      item.classList.contains(`glow-${listing.rarity.toLowerCase()}`) ||
      (listing.rarity === 'L' && (item.classList.contains('shiny-card') || item.classList.contains('glow-shiny')))
    );
    const frame = titledCandidate || (rarityCandidates.length === 1 ? rarityCandidates[0] : null);
    if (frame) renderMarketPriceBadge(frame, listing.cardId, listing.rarity);
  }
  function updateCardPrice(cardId, rarity) {
    for (const [anchor, card] of cards) {
      const listing = marketAuctions.get(card.id);
      if (listing?.cardId !== cardId || listing.rarity !== rarity) continue;
      card.marketPrice = cachedMarketPrice(cardId, rarity);
      card.marketPriceKnown = hasCachedMarketPrice(cardId, rarity);
      card.marketPriceFresh = hasFreshMarketPrice(cardId, rarity);
      apply(card);
      if (visible(anchor)) renderMarketPrice(card);
      else removeMarketPriceBadge(card);
    }
  }
  function serializeMarketPrices() {
    const serialized = {};
    for (const [key, entry] of marketPrices) {
      const separator = key.lastIndexOf('|');
      const cardId = key.slice(0, separator), rarity = key.slice(separator + 1);
      serialized[cardId] ||= { byRarity: {} };
      serialized[cardId].byRarity[rarity] = entry;
    }
    return serialized;
  }
  function loadMarketPrices(saved) {
    marketPrices.clear();
    for (const [cardId, value] of Object.entries(saved || {})) {
      if (value && Number.isFinite(value.t) &&
          (value.price === null || (Number.isFinite(value.price) && value.price >= 0))) {
        marketPrices.set(priceKey(cardId, 'L'), {
          price: value.price, t: value.t, computedAt: value.t, fetchedAt: value.t
        });
        continue;
      }
      for (const [rarity, entry] of Object.entries(value?.byRarity || {})) {
        if (!C.RARITIES.includes(rarity) || !entry || !Number.isFinite(entry.t) ||
            (entry.price !== null && (!Number.isFinite(entry.price) || entry.price < 0))) continue;
        marketPrices.set(priceKey(cardId, rarity), {
          price: entry.price,
          t: entry.t,
          computedAt: Number.isFinite(entry.computedAt) ? entry.computedAt : entry.t,
          fetchedAt: Number.isFinite(entry.fetchedAt) ? entry.fetchedAt : entry.t
        });
      }
    }
  }
  function savePriceHistory(cardId, history) {
    const fetchedAt = Date.now();
    const parsedComputedAt = Date.parse(history?.computed_at);
    const computedAt = Number.isFinite(parsedComputedAt) && parsedComputedAt <= fetchedAt
      ? parsedComputedAt
      : fetchedAt;
    let found = false;
    for (const rarity of C.RARITIES) {
      if (!Array.isArray(history?.by_rarity?.[rarity]?.weekly)) continue;
      marketPrices.set(priceKey(cardId, rarity), {
        price: C.marketAverage(history, rarity),
        t: fetchedAt,
        fetchedAt,
        computedAt: Number.isFinite(computedAt) ? computedAt : fetchedAt
      });
      found = true;
    }
    if (!found) return false;
    const saved = marketPriceSave.then(() =>
      chrome.storage.local.set({ [MARKET_CACHE_KEY]: serializeMarketPrices() })
    );
    marketPriceSave = saved.catch(error => {
      errorMessage = `Prix moyen non enregistré : ${error.message || 'erreur de stockage'}`;
      render();
    });
    for (const rarity of C.RARITIES) updateCardPrice(cardId, rarity);
    renderAuctionDetailPrice();
    return saved.then(() => true);
  }
  function renderHideButton(card) {
    const eligible = card.result?.state === 'deal' && card.marketPriceKnown && card.marketPriceFresh;
    if (!eligible || sessionHiddenCards.has(card.id)) {
      removeHideButton(card);
      return;
    }
    let button = card.frame.querySelector(':scope > [data-wmsf-hide-card]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-wmsf-hide-card', '');
      button.setAttribute('aria-label', 'Cacher cette carte pour cette session');
      button.title = 'Cacher cette carte pour cette session';
      button.textContent = 'Cacher';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        sessionHiddenCards.add(card.id);
        apply(card);
        removeHideButton(card);
      });
      card.frame.append(button);
    }
  }
  function renderMarketPrices() {
    for (const card of cards.values()) {
      const listing = marketAuctions.get(card.id);
      card.marketPrice = listing ? cachedMarketPrice(listing.cardId, listing.rarity) : null;
      card.marketPriceKnown = listing ? hasCachedMarketPrice(listing.cardId, listing.rarity) : false;
      card.marketPriceFresh = listing ? hasFreshMarketPrice(listing.cardId, listing.rarity) : false;
      apply(card);
      if (visible(card.anchor)) renderMarketPrice(card);
      else removeMarketPriceBadge(card);
    }
  }
  function visibleLegendaryAuctions() {
    const found = new Map();
    for (const anchor of grid?.querySelectorAll(C.LINK) || []) {
      if (!visible(anchor)) continue;
      const card = C.read(anchor, location.origin);
      if (!card || card.rarity !== 'L') continue;
      const listing = marketAuctions.get(card.id);
      if (!listing || listing.rarity !== 'L') continue;
      found.set(listing.cardId, { cardId: listing.cardId, anchor, card });
    }
    return [...found.values()];
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function fetchMarketPrice(cardId) {
    const response = await fetch(`${location.origin}/api/marketplace/cards/${encodeURIComponent(cardId)}/price-history`, {
      credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch {
      const error = new Error(`Réponse du site illisible (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data.error || data.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    if (!data || typeof data !== 'object' || !data.by_rarity || typeof data.by_rarity !== 'object')
      throw new Error('Format de prix inattendu.');
    if (!await savePriceHistory(cardId, data)) throw new Error('Aucun historique de prix exploitable.');
  }
  const isPriceRequestBlocked = error => /automati|rate|limit|block/i.test(error.code || '') ||
    error.status === 403 || error.status === 429;
  async function waitAfterPriceBlock() {
    for (let seconds = Math.ceil(PRICE_RETRY_DELAY / 1000); seconds > 0; seconds--) {
      if (!browse || !rootPath() || document.hidden) return false;
      priceLoad.message = `Limite temporaire du site ; nouvelle tentative dans ${seconds} s.`;
      render();
      await wait(1000);
    }
    return browse && rootPath() && !document.hidden;
  }
  async function loadVisiblePrices() {
    if (priceLoad.running || !browse || !rootPath() || document.hidden || !grid) return;
    priceLoad = { running: true, done: 0, total: 0, message: '' };
    errorMessage = '';
    try {
      showMarketPrices = true;
      requestMarketplaceSnapshot();
      await wait(100);
      const candidates = visibleLegendaryAuctions();
      for (const item of candidates) {
        item.card.marketPrice = cachedMarketPrice(item.cardId, item.card.rarity);
        item.card.marketPriceKnown = hasCachedMarketPrice(item.cardId, item.card.rarity);
        item.card.marketPriceFresh = hasFreshMarketPrice(item.cardId, item.card.rarity);
        item.card.root = rootOf(item.anchor);
        cards.set(item.anchor, item.card);
        apply(item.card);
        if (visible(item.anchor)) renderMarketPrice(item.card);
        else removeMarketPriceBadge(item.card);
      }
      const pending = candidates.filter(item => marketPriceExpired(item.cardId, item.card.rarity));
      if (!pending.length) {
        priceLoad.message = 'Aucun nouveau prix à charger parmi les cartes légendaires visibles.';
        return;
      }
      priceLoad.total = pending.length;
      render();
      for (const item of pending) {
        if (!browse || !rootPath() || document.hidden) break;
        if (!visible(item.anchor)) continue;
        if (!marketPriceExpired(item.cardId, item.card.rarity)) continue;
        if (priceLoad.done > 0) await wait(PRICE_GAP);
        let loaded = false;
        while (!loaded && browse && rootPath() && !document.hidden) {
          try {
            await fetchMarketPrice(item.cardId);
            priceLoad.done++;
            priceLoad.message = '';
            render();
            loaded = true;
          } catch (error) {
            if (isPriceRequestBlocked(error)) {
              if (!await waitAfterPriceBlock()) break;
            } else {
              priceLoad.message = `Lecture arrêtée après une erreur : ${error.message || 'erreur réseau'}`;
              break;
            }
          }
        }
        if (!loaded) break;
      }
      if (!priceLoad.message && (document.hidden || !browse))
        priceLoad.message = `Lecture interrompue : ${priceLoad.done}/${priceLoad.total} prix chargés.`;
      else if (!priceLoad.message && priceLoad.done < priceLoad.total)
        priceLoad.message = `Lecture terminée : ${priceLoad.done}/${priceLoad.total} prix chargés.`;
      else if (!priceLoad.message)
        priceLoad.message = priceLoad.total ? `Lecture terminée : ${priceLoad.done} prix chargés.` : 'Aucun nouveau prix à charger parmi les cartes légendaires visibles.';
    } catch (error) {
      priceLoad.message = `Lecture arrêtée : ${error.message || 'erreur de stockage'}`;
    } finally {
      priceLoad.running = false;
      render();
    }
  }
  function receiveMarketplace(data) {
    let changed = false;
    for (const auction of data?.auctions || []) {
      const cardId = auction?.card_id || auction?.card?.id;
      const rarity = auction?.snapshot_rarity || auction?.card?.rarity;
      if (auction?.id && typeof cardId === 'string' && C.RARITIES.includes(rarity)) {
        const path = `/marketplace/${auction.id}`;
        const listing = {
          cardId,
          rarity,
          title: auction.card?.wikipedia_title || auction.card?.name || ''
        };
        if (JSON.stringify(marketAuctions.get(path)) !== JSON.stringify(listing)) {
          marketAuctions.set(path, listing);
          changed = true;
        }
      }
    }
    if (changed) {
      chrome.storage.local.set({ [MARKET_AUCTIONS_KEY]: Object.fromEntries(marketAuctions) })
        .catch(error => {
          errorMessage = `Correspondance des cartes non sauvegardée : ${error.message || 'erreur de stockage'}`;
          render();
        });
    }
    renderMarketPrices();
    renderAuctionDetailPrice();
  }
  function receiveAuction(auction) {
    if (!auction?.id || typeof auction.cardId !== 'string' || !C.RARITIES.includes(auction.rarity)) return;
    marketAuctions.set(`/marketplace/${auction.id}`, {
        cardId: auction.cardId,
        rarity: auction.rarity,
        title: typeof auction.title === 'string' ? auction.title : ''
    });
    chrome.storage.local.set({ [MARKET_AUCTIONS_KEY]: Object.fromEntries(marketAuctions) })
        .catch(error => {
          errorMessage = `Correspondance de l’enchère non sauvegardée : ${error.message || 'erreur de stockage'}`;
          render();
        });
    renderAuctionDetailPrice();
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.__wmsfMarketHook !== true) return;
    if (message.type === 'marketplace') receiveMarketplace(message.data);
    else if (message.type === 'auction') receiveAuction(message.auction);
    else if (message.type === 'price-history' && typeof message.cardId === 'string')
        savePriceHistory(message.cardId, message.data).catch(error => {
          errorMessage = `Prix moyen non enregistré : ${error.message || 'erreur de stockage'}`;
          render();
        });
  });
  function requestMarketplaceSnapshot() {
    window.postMessage({ __wmsfMarketContent: true, type: 'snapshot' }, location.origin);
  }
  async function save() {
    const storedPrefs = { ...prefs };
    delete storedPrefs.shinyOnly;
    try { await chrome.storage.local.set({ [KEY]: storedPrefs, [WATCH_KEY]: [...favorites].slice(0, 1000) }); }
    catch { errorMessage = 'Sauvegarde indisponible. Réglages conservés dans cet onglet seulement.'; render(); }
  }

  function stopScan() {
    if (!scan) return;
    const old = scan; scan = null; old.abort.abort();
    render();
  }

  function stopWork() {
    gridObserver.disconnect(); clearTimeout(batchTimer); batchTimer = null; clearInterval(timeTimer); timeTimer = null;
    dirty.clear(); added.clear(); timeDirty.clear(); removed = false;
    for (const card of cards.values()) { clearMark(card); removeMarketPriceBadge(card); }
    cards.clear();
  }

  function suspend() {
    stopScan(); stopWork(); sessionHiddenCards.clear(); browse = false; suspendedGrid = null;
    if (ui) { ui.host.remove(); ui = null; }
    if (shinyButtonGroup) shinyButtonGroup.removeAttribute('data-wm-rarity-group');
    if (shinyButton) { shinyButton.remove(); shinyButton = null; shinyButtonGroup = null; }
  }

  function activeView() {
    if (!rootPath() || document.hidden) return null;
    const scope = document.querySelector('main,[role="main"]');
    if (!scope) return null;
    if ([...scope.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(visible)) return null;
    const tabs = [...scope.querySelectorAll('button,[role="tab"]')].filter(el => !own(el) && visible(el) && C.tabName(el.textContent));
    const active = tabs.filter(el => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page' ||
      el.getAttribute('data-state') === 'active' || el.classList.contains('border-b-2') || el.classList.contains('border-b-4'));
    if (active.length !== 1) return null;
    const kind = C.tabName(active[0].textContent);
    if (pendingNavigation?.kind && pendingNavigation.kind !== kind) return null;
    if (pendingNavigation?.path && pendingNavigation.path !== location.pathname) return null;
    pendingNavigation = null;
    if (kind !== 'browse') return null;
    let listingGrid = null;
    for (const a of scope.querySelectorAll(C.LINK)) {
      if (a.closest('[role="dialog"],[aria-modal="true"]') || !C.identity(a, location.origin) || !a.querySelector(C.FRAME)) continue;
      for (let el = a.parentElement, depth = 0; el && el !== scope && depth < 4; el = el.parentElement, depth++) {
        if (el.classList.contains('flex-wrap') || el.classList.contains('grid')) { listingGrid = el; break; }
      }
      if (listingGrid) break;
    }
    return { scope, bar: active[0].parentElement, grid: listingGrid };
  }

  function observeMain() {
    const next = document.querySelector('main,[role="main"]');
    if (main === next) return;
    pageObserver.disconnect(); main = next;
    if (main) pageObserver.observe(main, { childList: true, subtree: true });
  }

  function sync() {
    syncTimer = null; if (disposed || document.hidden) return;
    observeMain();
    requestMarketplaceSnapshot();
    renderAuctionDetailPrice();
    const view = activeView();
    if (!view) { suspend(); return; }
    browse = true;
    ensureShinyButton(view.scope);
    if (tabbar !== view.bar) {
      tabsObserver.disconnect(); tabbar = view.bar;
      tabsObserver.observe(tabbar, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-selected', 'aria-current', 'data-state'] });
    }
    if (!ui?.host.isConnected) {
      if (ui) ui.host.remove();
      ui = P.create({
        change: onSettings, start: startScan, stop: stopScan, loadPrices: loadVisiblePrices
      });
      tabbar.insertAdjacentElement('afterend', ui.host);
    }
    if (grid !== view.grid) {
      stopScan();
      stopWork(); grid = view.grid; suspendedGrid = null; errorMessage = '';
      if ((filteringActive() || showMarketPrices) && grid) activateGrid();
    } else if ((filteringActive() || showMarketPrices) && grid && !cards.size) activateGrid();
    updateTimeTimer(); render();
  }

  function scheduleSync() { if (!disposed && syncTimer === null) syncTimer = setTimeout(sync, 60); }

  function rootOf(anchor) {
    let el = anchor; while (el.parentElement && el.parentElement !== grid) el = el.parentElement;
    return el.parentElement === grid ? el : anchor;
  }

  function apply(card) {
    card.result = C.evaluate(card, prefs);
    const sessionHidden = sessionHiddenCards.has(card.id);
    setAttr(card.root, 'data-wmsf-hidden', (card.result.match || card.result.pending) && !sessionHidden ? null : 'true');
    setAttr(card.root, 'data-wmsf-state', card.result.state === 'deal' || card.result.pending ? card.result.state : null);
    if (sessionHidden) setAttr(card.root, 'data-wmsf-state', null);
    if (visible(card.anchor)) renderHideButton(card);
    else removeHideButton(card);
  }

  function readCard(anchor) {
    if (!grid?.contains(anchor)) return;
    const previous = cards.get(anchor), card = C.read(anchor, location.origin);
    if (!card) { if (previous) clearMark(previous); cards.delete(anchor); return; }
    card.root = rootOf(anchor); if (previous && previous.root !== card.root) clearMark(previous);
    const listing = marketAuctions.get(card.id);
    card.marketPrice = listing ? cachedMarketPrice(listing.cardId, listing.rarity) : null;
    card.marketPriceKnown = listing ? hasCachedMarketPrice(listing.cardId, listing.rarity) : false;
    card.marketPriceFresh = listing ? hasFreshMarketPrice(listing.cardId, listing.rarity) : false;
    cards.set(anchor, card); apply(card);
    if (visible(anchor)) renderMarketPrice(card);
    else removeMarketPriceBadge(card);
  }

  function activateGrid() {
    if ((!filteringActive() && !showMarketPrices) || !browse || !grid || document.hidden) return;
    const anchors = grid.querySelectorAll(C.LINK);
    if (anchors.length > LIMIT) {
      suspendedGrid = grid; errorMessage = `Filtres suspendus : plus de ${LIMIT} annonces chargées.`;
      stopWork(); render(); return;
    }
    for (const a of anchors) readCard(a);
    gridObserver.observe(grid, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'href', 'data-shiny', 'data-is-shiny'] });
    updateTimeTimer(); render();
  }

  function scheduleFlush() {
    if (batchTimer === null) {
      batchTimer = setTimeout(flush, 120);
    }
  }

  function flush() {
    clearTimeout(batchTimer); batchTimer = null;
    if ((!filteringActive() && !showMarketPrices) || !browse || document.hidden || !rootPath() || !grid?.isConnected) return;
    if (removed) { for (const [a, c] of cards) if (!grid.contains(a)) { clearMark(c); cards.delete(a); } removed = false; }
    for (const node of added) {
      if (!grid.contains(node)) continue;
      if (node.matches?.(C.LINK)) dirty.add(node);
      for (const a of node.querySelectorAll?.(C.LINK) || []) dirty.add(a);
    }
    added.clear();
    if (cards.size + [...dirty].filter(a => !cards.has(a)).length > LIMIT) {
      suspendedGrid = grid; errorMessage = `Filtres suspendus : plus de ${LIMIT} annonces chargées.`;
      stopWork(); render(); return;
    }
    for (const a of dirty) readCard(a);
    for (const a of timeDirty) {
      if (dirty.has(a)) continue;
      const c = cards.get(a); if (!c || !grid.contains(a)) continue;
      c.seconds = c.fields.time && !c.fields.time.ambiguous ? C.seconds(c.fields.time.value.textContent) : null;
      apply(c);
    }
    dirty.clear(); timeDirty.clear();
    render();
  }

  const gridObserver = new MutationObserver(records => {
    if ((!filteringActive() && !showMarketPrices) || !browse || document.hidden) return;
    for (const change of records) {
      const el = change.target.nodeType === 1 ? change.target : change.target.parentElement;
      if (el?.closest?.('[data-wmsf-market-price]')) continue;
      const anchor = el?.closest(C.LINK), card = cards.get(anchor);
      if (anchor && grid.contains(anchor)) {
        if (card?.fields.time?.value?.contains(el)) {
          if (timeActive() || prefs.dealsOnly) timeDirty.add(anchor);
        } else dirty.add(anchor);
      } else if (change.type === 'childList') {
        for (const node of change.addedNodes) if (node.nodeType === 1) added.add(node);
        if (change.removedNodes.length) removed = true;
      }
    }
    if (dirty.size || added.size || timeDirty.size || removed) scheduleFlush();
  });

  const pageObserver = new MutationObserver(records => {
    if (document.hidden || disposed) return;
    for (const r of records) {
      if (own(r.target) || (grid?.isConnected && (r.target === grid || grid.contains(r.target)))) continue;
      if ([...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !own(n))) { scheduleSync(); break; }
    }
  });

  const shellObserver = new MutationObserver(scheduleSync), tabsObserver = new MutationObserver(scheduleSync);
  function updateTimeTimer() {
    const needed = filteringActive() && browse && grid && timeActive() && !document.hidden;
    if (!needed && timeTimer !== null) { clearInterval(timeTimer); timeTimer = null; }
    if (needed && timeTimer === null) timeTimer = setInterval(() => {
      // Re-read cached fields only; never guess time from the wall clock.
      for (const [a, c] of cards) if (c.fields.time?.value?.isConnected) timeDirty.add(a);
      if (timeDirty.size) scheduleFlush();
    }, 1000);
  }

  function onSettings(patch) {
    const filterChanged = Object.keys(patch).some(key => key !== 'batches');
    prefs = C.settings({ ...prefs, ...patch }); save();
    if (filterChanged) {
      suspendedGrid = null;
      errorMessage = '';
      if (filteringActive()) {
        if (browse && grid) {
          if (cards.size) { for (const a of cards.keys()) dirty.add(a); flush(); }
          else activateGrid();
        }
      } else stopWork();
      if (!filteringActive() && showMarketPrices && browse && grid) activateGrid();
      updateTimeTimer();
    }
    render();
  }

  function ensureShinyButton(scope) {
    const group = [...scope.querySelectorAll('div.flex.flex-wrap')].find(el =>
      [...el.children].some(child => child.tagName === 'BUTTON' && C.RARITIES.includes(C.clean(child.textContent))));
    if (!group) {
      if (shinyButtonGroup) shinyButtonGroup.removeAttribute('data-wm-rarity-group');
      if (shinyButton) shinyButton.remove();
      shinyButton = null; shinyButtonGroup = null;
      return;
    }
    if (shinyButtonGroup && shinyButtonGroup !== group) shinyButtonGroup.removeAttribute('data-wm-rarity-group');
    group.setAttribute('data-wm-rarity-group', '');
    if (shinyButton?.isConnected && shinyButtonGroup === group) { updateShinyButton(); return; }
    if (shinyButton) shinyButton.remove();
    shinyButton = document.createElement('button');
    shinyButton.type = 'button';
    shinyButton.textContent = 'L✦';
    shinyButton.setAttribute('data-wm-shiny-filter', '');
    shinyButton.setAttribute('aria-label', 'Afficher uniquement les cartes shiny');
    shinyButton.setAttribute('aria-pressed', 'false');
    shinyButton.setAttribute('title', 'Afficher uniquement les cartes shiny');
    shinyButton.addEventListener('click', event => { event.stopPropagation(); toggleShinyFilter(); });
    shinyButtonGroup = group;
    group.insertBefore(shinyButton, group.firstElementChild);
    updateShinyButton();
  }

  function updateShinyButton() {
    if (!shinyButton) return;
    const active = prefs.shinyOnly;
    shinyButton.setAttribute('aria-pressed', String(active));
  }

  function toggleShinyFilter() {
    onSettings({ shinyOnly: !prefs.shinyOnly });
  }

  function clearShinyFilter() {
    if (prefs.shinyOnly) onSettings({ shinyOnly: false });
  }

  function render() {
    updateShinyButton();
    if (ui) ui.render({ prefs, scan: !!scan, priceLoad, error: errorMessage });
  }

  function loadButtons() {
    if (!browse || !main) return [];
    return [...main.querySelectorAll('button')].filter(button =>
      !own(button) && C.clean(button.textContent) === 'Charger la suite' &&
      !button.closest('[role="dialog"],[aria-modal="true"]') && visible(button));
  }

  function loadButton() {
    const buttons = loadButtons().filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    return buttons.length === 1 ? buttons[0] : null;
  }

  function waitNew(run, known, previousCount, clickedButton) {
    return new Promise(resolve => {
      let timer = null, finished = false, sawLoading = false;
      const observer = new MutationObserver(check);
      const finish = loaded => {
        if (finished) return;
        finished = true; clearTimeout(timer); observer.disconnect();
        run.abort.signal.removeEventListener('abort', onAbort); resolve(loaded);
      };
      const onAbort = () => finish(false);
      function check() {
        if (!grid?.isConnected) { finish(false); return; }
        const anchors = [...grid.querySelectorAll(C.LINK)];
        const hasNewCard = anchors.length > previousCount || anchors.some(anchor => {
          const id = C.identity(anchor, location.origin);
          return id && !known.has(id);
        });
        const buttons = loadButtons();
        const loading = buttons.some(button => button.disabled || button.getAttribute('aria-disabled') === 'true');
        if (!clickedButton.isConnected || clickedButton.disabled || clickedButton.getAttribute('aria-disabled') === 'true' || loading) {
          sawLoading = true;
        }
        if (sawLoading && buttons.some(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true')) {
          finish(true); return;
        }
        if (hasNewCard && !loading) {
          clearTimeout(timer);
          timer = setTimeout(() => finish(true), 120);
        } else clearTimeout(timer);
      }
      if (!grid?.isConnected || !main) { resolve(false); return; }
      observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'class'] });
      run.abort.signal.addEventListener('abort', onAbort, { once: true });
      check();
    });
  }

  async function startScan() {
    if (scan || !browse || document.hidden || !grid) return;
    const run = { abort: new AbortController(), max: prefs.batches, done: 0 }; scan = run;
    errorMessage = ''; render();
    try {
      for (let i = 0; i < run.max; i++) {
        if (scan !== run || !browse || !grid?.isConnected) break;
        const button = loadButton();
        if (!button) {
          if (!run.done) errorMessage = 'Aucune page supplémentaire disponible.';
          break;
        }
        const anchors = [...grid.querySelectorAll(C.LINK)];
        const known = new Set(anchors.map(anchor => C.identity(anchor, location.origin)).filter(Boolean));
        const waiting = waitNew(run, known, anchors.length, button);
        button.click();
        if (!await waiting || scan !== run) break;
        run.done++;
        render();
      }
    } catch {
      if (scan === run) errorMessage = 'Exploration interrompue : le marché a changé.';
    } finally {
      if (scan === run) { scan = null; render(); }
    }
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button,a,[role="tab"]') : null;
    if (!target || own(target)) return;
    if (rootPath() && target.tagName === 'BUTTON' && C.norm(target.textContent) === 'reinitialiser' && prefs.shinyOnly) {
      onSettings({ shinyOnly: false });
    }
    const kind = C.tabName(target.textContent);
    if (rootPath() && kind) { pendingNavigation = { kind }; suspend(); scheduleSync(); return; }
    if (target.tagName === 'A') try {
      const url = new URL(target.href, location.href);
      if (url.origin === location.origin && url.pathname !== location.pathname && target.target !== '_blank' && !event.ctrlKey && !event.metaKey) {
        pendingNavigation = { path: url.pathname }; clearShinyFilter(); suspend(); scheduleSync();
      }
    } catch { }
    if (rootPath() && target.closest('main')) scheduleSync();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { gridObserver.disconnect(); clearInterval(timeTimer); timeTimer = null; clearTimeout(batchTimer); batchTimer = null; }
    else { stopWork(); scheduleSync(); }
  });

  document.addEventListener('change', e => { if (!own(e.target) && rootPath()) { stopScan(); scheduleSync(); } }, true);

  window.addEventListener('popstate', () => { pendingNavigation = null; clearShinyFilter(); suspend(); scheduleSync(); });

  if (window.navigation) window.navigation.addEventListener('currententrychange', () => { pendingNavigation = null; clearShinyFilter(); suspend(); scheduleSync(); });

  window.addEventListener('pagehide', () => {
    sessionHiddenCards.clear();
    clearShinyFilter();
    stopScan(); stopWork(); pageObserver.disconnect(); tabsObserver.disconnect(); shellObserver.disconnect();
    clearInterval(priceStaleTimer); priceStaleTimer = null;
    clearTimeout(syncTimer); syncTimer = null; disposed = true;
  });

  window.addEventListener('pageshow', () => { if (disposed) { disposed = false; main = null; tabbar = null; startObservers(); scheduleSync(); } });

  function startObservers() {
    shellObserver.observe(document.body, { childList: true });
    for (const el of document.querySelectorAll('main,[role="main"]')) for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)shellObserver.observe(p, { childList: true });
    observeMain();
    if (priceStaleTimer === null) {
      priceStaleTimer = setInterval(() => {
        for (const card of cards.values()) if (visible(card.anchor)) renderMarketPrice(card);
        renderAuctionDetailPrice();
      }, 60 * 1000);
    }
  }

  async function init() {
    try {
      const saved = await chrome.storage.local.get([KEY, WATCH_KEY, MARKET_CACHE_KEY, MARKET_AUCTIONS_KEY]);
      const loadedPrefs = C.settings(saved[KEY]);
      prefs = { ...loadedPrefs, shinyOnly: false };
      loadMarketPrices(saved[MARKET_CACHE_KEY]);
      for (const [path, listing] of Object.entries(saved[MARKET_AUCTIONS_KEY] || {})) {
        if (/^\/marketplace\/[^/?#]+$/.test(path) && listing &&
            typeof listing.cardId === 'string' && C.RARITIES.includes(listing.rarity))
          marketAuctions.set(path, {
            cardId: listing.cardId,
            rarity: listing.rarity,
            title: typeof listing.title === 'string' ? listing.title : ''
          });
      }
      favorites = new Set((Array.isArray(saved[WATCH_KEY]) ? saved[WATCH_KEY] : []).filter(x => typeof x === 'string').map(x => {
        try { return new URL(x, location.origin).pathname; } catch { return ''; }
      }).filter(x => /^\/marketplace\/[^/]+$/.test(x)).slice(0, 1000));
      if (loadedPrefs.shinyOnly) await save();
    } catch { errorMessage = 'Sauvegarde indisponible. Réglages par défaut dans cet onglet.'; }
    globalThis.WMFinderMarketPrice.ready = true;
    // Ignore legacy filters and scan-session keys.
    startObservers(); requestMarketplaceSnapshot(); sync();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[MARKET_CACHE_KEY]) {
      loadMarketPrices(changes[MARKET_CACHE_KEY].newValue);
      renderMarketPrices();
      renderAuctionDetailPrice();
    }
  });

  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init, { once: true });
})();

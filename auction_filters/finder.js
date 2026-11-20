/* Local DOM filtering only. No network calls or account actions. */
(() => {
  'use strict';
  if (!/^(www\.)?wiki-masters\.com$/.test(location.hostname) || globalThis.__wmFinder12) return;
  globalThis.__wmFinder12 = true;
  const C = globalThis.WMFinderCore, P = globalThis.WMFinderPanel;
  const KEY = 'wmFinder12Prefs', WATCH_KEY = 'wmshV5Watchlist', LIMIT = 2000;
  let prefs = { ...C.DEFAULTS }, ui = null, main = null, grid = null, suspendedGrid = null, tabbar = null, browse = false;
  let shinyButton = null, shinyButtonGroup = null;
  let pendingNavigation = null, scan = null, disposed = false;
  let batchTimer = null, syncTimer = null, timeTimer = null, errorMessage = '';
  const cards = new Map(), dirty = new Set(), added = new Set(), timeDirty = new Set();
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

  function clearMark(card) { card.root.removeAttribute('data-wmsf-hidden'); card.root.removeAttribute('data-wmsf-state'); }
  async function save() {
    try { await chrome.storage.local.set({ [KEY]: prefs, [WATCH_KEY]: [...favorites].slice(0, 1000) }); }
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
    for (const card of cards.values()) clearMark(card);
    cards.clear();
  }

  function suspend() {
    stopScan(); stopWork(); browse = false; suspendedGrid = null;
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
    observeMain(); const view = activeView();
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
        change: onSettings, start: startScan, stop: stopScan
      });
      tabbar.insertAdjacentElement('afterend', ui.host);
    }
    if (grid !== view.grid) {
      stopScan();
      stopWork(); grid = view.grid; suspendedGrid = null; errorMessage = '';
      if (filteringActive() && grid) activateGrid();
    } else if (filteringActive() && grid && !cards.size) activateGrid();
    updateTimeTimer(); render();
  }

  function scheduleSync() { if (!disposed && syncTimer === null) syncTimer = setTimeout(sync, 60); }

  function rootOf(anchor) {
    let el = anchor; while (el.parentElement && el.parentElement !== grid) el = el.parentElement;
    return el.parentElement === grid ? el : anchor;
  }

  function apply(card) {
    card.result = C.evaluate(card, prefs);
    setAttr(card.root, 'data-wmsf-hidden', card.result.match || card.result.pending ? null : 'true');
    setAttr(card.root, 'data-wmsf-state', card.result.state === 'deal' || card.result.pending ? card.result.state : null);
  }

  function readCard(anchor) {
    if (!grid?.contains(anchor)) return;
    const previous = cards.get(anchor), card = C.read(anchor, location.origin);
    if (!card) { if (previous) clearMark(previous); cards.delete(anchor); return; }
    card.root = rootOf(anchor); if (previous && previous.root !== card.root) clearMark(previous);
    cards.set(anchor, card); apply(card);
  }

  function activateGrid() {
    if (!filteringActive() || !browse || !grid || document.hidden) return;
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
    if (!filteringActive() || !browse || document.hidden || !rootPath() || !grid?.isConnected) return;
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
    if (!filteringActive() || !browse || document.hidden) return;
    for (const change of records) {
      const el = change.target.nodeType === 1 ? change.target : change.target.parentElement;
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
    shinyButton.textContent = 'LS';
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

  function render() {
    updateShinyButton();
    if (ui) ui.render({ prefs, scan: !!scan, error: errorMessage });
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
    const kind = C.tabName(target.textContent);
    if (rootPath() && kind) { pendingNavigation = { kind }; suspend(); scheduleSync(); return; }
    if (target.tagName === 'A') try {
      const url = new URL(target.href, location.href);
      if (url.origin === location.origin && url.pathname !== location.pathname && target.target !== '_blank' && !event.ctrlKey && !event.metaKey) {
        pendingNavigation = { path: url.pathname }; suspend(); scheduleSync();
      }
    } catch { }
    if (rootPath() && target.closest('main')) scheduleSync();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { gridObserver.disconnect(); clearInterval(timeTimer); timeTimer = null; clearTimeout(batchTimer); batchTimer = null; }
    else { stopWork(); scheduleSync(); }
  });

  document.addEventListener('change', e => { if (!own(e.target) && rootPath()) { stopScan(); scheduleSync(); } }, true);

  window.addEventListener('popstate', () => { pendingNavigation = null; suspend(); scheduleSync(); });

  if (window.navigation) window.navigation.addEventListener('currententrychange', () => { pendingNavigation = null; suspend(); scheduleSync(); });

  window.addEventListener('pagehide', () => { stopScan(); stopWork(); pageObserver.disconnect(); tabsObserver.disconnect(); shellObserver.disconnect(); clearTimeout(syncTimer); syncTimer = null; disposed = true; });

  window.addEventListener('pageshow', () => { if (disposed) { disposed = false; main = null; tabbar = null; startObservers(); scheduleSync(); } });

  function startObservers() {
    shellObserver.observe(document.body, { childList: true });
    for (const el of document.querySelectorAll('main,[role="main"]')) for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)shellObserver.observe(p, { childList: true });
    observeMain();
  }

  async function init() {
    try {
      const saved = await chrome.storage.local.get([KEY, WATCH_KEY]); prefs = C.settings(saved[KEY]);
      favorites = new Set((Array.isArray(saved[WATCH_KEY]) ? saved[WATCH_KEY] : []).filter(x => typeof x === 'string').map(x => {
        try { return new URL(x, location.origin).pathname; } catch { return ''; }
      }).filter(x => /^\/marketplace\/[^/]+$/.test(x)).slice(0, 1000));
    } catch { errorMessage = 'Sauvegarde indisponible. Réglages par défaut dans cet onglet.'; }
    // Ignore legacy filters and scan-session keys.
    startObservers(); sync();
  }

  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init, { once: true });
})();

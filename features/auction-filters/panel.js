(() => {
  'use strict';
  const CSS = `
  :host{display:block;color-scheme:dark;font:12px/1.4 system-ui,Segoe UI,sans-serif;color:#edf2ff;text-align:left;--muted:#9eacc2;--line:#2b3548;--accent:#c6a9ff}*{box-sizing:border-box}
  .panel{background:#101725;border:1px solid #303b50;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px #0002}
  button,input,select{font:inherit}button{cursor:pointer;border:1px solid #394762;background:#202c41;color:#e4ebfa;border-radius:7px;padding:6px 10px;font-weight:650;white-space:nowrap}
  button:hover:enabled{border-color:#a6b7d6;background:#2a3850}button:disabled{opacity:.45;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .body{padding:10px 12px}.filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .field,.discount{min-width:0;display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid #29364a;border-radius:9px;background:#0d1420}
  .field-title{flex:none;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
  .range{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.range input{width:50%;min-width:0}
  input[type=number],select{height:30px;min-width:0;background:#172235;border:1px solid #35435b;border-radius:6px;padding:4px 7px;color:#f2f5ff}
  input::placeholder{color:#7788a2}.discount{justify-content:space-between}.discount-toggle{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;white-space:nowrap}
  input[type=checkbox]{accent-color:#c6a9ff;width:14px;height:14px;margin:0}.discount-value{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:11px}.discount-value input{width:54px}
  .price-load{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;padding:7px 9px;border:1px solid #29364a;border-radius:9px;background:#0d1420}
  .price-load button{background:#172b4d;border-color:#536b94;color:#e2ecff}.price-progress{color:var(--muted);font-size:11px}
  .explorer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;padding:7px 9px;border:1px solid #29364a;border-radius:9px;background:#0d1420}
  .explorer-title{font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;color:#c7d2e5}.explorer-controls{display:flex;align-items:center;gap:6px}
  .explorer select{width:110px}.primary{background:#26334a;border-color:#465672}.stop{color:#ffc3ca;background:#392632}
  .error{margin:7px 0 0;padding:5px 8px;border-left:2px solid #e88793;background:#e8879312;color:#ffc0c7;font-size:11px}.error:empty{display:none}[hidden]{display:none!important}
  @media(max-width:720px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.discount{grid-column:1/-1}}
  @media(max-width:480px){.filters{grid-template-columns:1fr}.discount{grid-column:auto}.explorer{align-items:flex-start;flex-direction:column}.explorer-controls{width:100%}.explorer select{flex:1;width:auto}}
  `;

  function create(actions) {
    const host = document.createElement('wm-shiny-finder'), root = host.attachShadow({ mode: 'open' });

    root.innerHTML = `<style>${CSS}</style><section class="panel" aria-label="Filtres du marché">
      <div class="body">
        <div class="filters">
          <div class="field"><span class="field-title">Prix · WB</span><div class="range">
            <input id="minPrice" aria-label="Prix minimum" type="number" min="0" max="100000000" step="1" placeholder="Min">
            <input id="maxPrice" aria-label="Prix maximum" type="number" min="0" max="100000000" step="1" placeholder="Max">
          </div></div>
          <div class="field"><span class="field-title">Temps · min</span><div class="range">
            <input id="minMinutes" aria-label="Temps restant minimum en minutes" type="number" min="0" max="43200" step="1" placeholder="Min">
            <input id="maxMinutes" aria-label="Temps restant maximum en minutes" type="number" min="0" max="43200" step="1" placeholder="Max">
          </div></div>
          <div class="discount">
            <label class="discount-toggle"><input id="dealsOnly" type="checkbox"><span>Décote</span></label>
            <label class="discount-value"><input id="discount" aria-label="Décote minimale en pourcentage" type="number" min="0" max="99" step="1"><span>%</span></label>
          </div>
        </div>
        <div class="price-load"><button id="loadPrices" type="button" aria-label="Charger les prix moyens des cartes visibles" title="Charger les cartes légendaires visibles sans prix en cache">Chargement des prix</button><span class="price-progress" id="priceProgress" aria-live="polite"></span></div>
        <div class="explorer" aria-label="Défilement automatique">
          <strong class="explorer-title">Défilement automatique</strong>
          <div class="explorer-controls">
            <select id="batches" aria-label="Nombre de pages à charger"><option value="2">2 pages</option><option value="5">5 pages</option><option value="10">10 pages</option><option value="20">20 pages</option></select>
            <button class="primary" id="start" type="button">Explorer</button>
            <button class="stop" id="stop" type="button" disabled>Stop</button>
          </div>
        </div>
        <p class="error" id="error" role="alert"></p>
      </div>
    </section>`;

    const $ = id => root.getElementById(id), text = (id, value) => { if ($(id).textContent !== String(value)) $(id).textContent = String(value); };
    for (const id of ['start', 'stop']) $(id).addEventListener('click', () => actions[id]());
    $('loadPrices').addEventListener('click', () => actions.loadPrices());
    $('dealsOnly').addEventListener('change', () => actions.change({ dealsOnly: $('dealsOnly').checked }));
    $('batches').addEventListener('change', () => actions.change({ batches: Number($('batches').value) }));
    for (const id of ['minPrice', 'maxPrice', 'minMinutes', 'maxMinutes', 'discount']) $(id).addEventListener('change', () => {
      if (!$(id).checkValidity()) { text('error', 'Entre une valeur valide, positive et dans les limites du champ.'); return; }
      text('error', '');
      actions.change({ [id]: $(id).value === '' ? null : Number($(id).value) });
    });

    function render(state) {
      const { prefs: p, scan, priceLoad, priceAvailability } = state;
      for (const id of ['minPrice', 'maxPrice', 'minMinutes', 'maxMinutes', 'discount', 'batches']) {
        if (root.activeElement !== $(id)) $(id).value = p[id] ?? '';
      }
      $('dealsOnly').checked = p.dealsOnly;
      $('loadPrices').disabled = !!priceLoad?.running || priceAvailability.available <= 0;
      text('loadPrices', priceLoad?.running ? 'Chargement…' : 'Chargement des prix');
      const next = `Prochain renouvellement du quota dans ${priceAvailability.label}`;
      const available = `${priceAvailability.available} requêtes disponibles`;
      const progress = priceLoad?.running ? `Lecture ${priceLoad.done}/${priceLoad.total} · ` : '';
      const result = !priceLoad?.running && priceLoad?.message ? `${priceLoad.message} · ` : '';
      text('priceProgress', `${progress}${result}${next} · ${available}`);
      const invalid = (p.minPrice !== null && p.maxPrice !== null && p.minPrice > p.maxPrice) || (p.minMinutes !== null && p.maxMinutes !== null && p.minMinutes > p.maxMinutes);
      text('error', state.error || (invalid ? 'Le minimum dépasse le maximum.' : ''));
      $('start').disabled = !!scan || invalid;
      $('stop').disabled = !scan;
      $('batches').disabled = !!scan;
    }
    return { host, render };
  }
  globalThis.WMFinderPanel = { create };
})();

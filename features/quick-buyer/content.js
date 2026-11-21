
(() => {
    "use strict";

    const CONFIG = {
        origin: "https://www.wiki-masters.com",
        path: "/marketplace/",
        blockId: "wiki-marketplace-custom-panel"
    };

    const CONTROLLER_KEY = "__wikiMastersMarketplaceController";

    // Éviter les initialisations multiples
    if (window[CONTROLLER_KEY]) {
        window[CONTROLLER_KEY].destroy();
    }

    let cleanupFeature = null;
    let navigationWatcher = null;

    // =====================================================
    // DÉTECTION DE LA PAGE
    // =====================================================

    function isTargetPage() {
        return (
            location.origin === CONFIG.origin &&
            location.pathname.startsWith(CONFIG.path) &&
            location.pathname.length > CONFIG.path.length
        );
    }

    // =====================================================
    // RECHERCHE DU BLOC ORIGINAL
    // =====================================================

    function findOriginalBlock() {

        const input = [...document.querySelectorAll(
            'input[aria-label="Montant de la mise"]'
        )].find(el => !el.closest("#" + CONFIG.blockId));

        if (!input) return null;

        const card = input.closest(".card-frame");
        if (!card) return null;

        const button = [...card.querySelectorAll("button")].find(
            b => b.textContent.trim() === "Miser"
        );

        if (!button) return null;

        return { card, input, button };
    }

    function parseToolboxAmount(value) {
        const amount = Number(String(value).replace(/\D/g, ""));
        return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
    }

    function parseAuctionAmount(card, labelText) {
        const label = [...card.querySelectorAll("span")].find(
            element => element.textContent.trim() === labelText
        );
        const text = label?.nextElementSibling?.textContent;
        const amount = Number(String(text ?? "").replace(/\D/g, ""));

        return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
    }

    let toolboxIsland = null;

    function findInOpenShadowRoots(root, selector) {
        const hosts = root.querySelectorAll("*");

        for (const host of hosts) {
            if (!host.shadowRoot) continue;

            const island = host.shadowRoot.querySelector(selector) ||
                findInOpenShadowRoots(host.shadowRoot, selector);

            if (island) return island;
        }

        return null;
    }

    function getOptimalBidBaseInfo() {
        const cachedPrice = globalThis.WMFinderMarketPrice?.getCachedForAuction(location.pathname);
        if (Number.isSafeInteger(cachedPrice) && cachedPrice > 0) {
            return { amount: cachedPrice, source: "cache" };
        }

        const selector = '[aria-label="Analyse WikiMasters Toolbox"]';
        const island = toolboxIsland?.isConnected
            ? toolboxIsland
            : document.querySelector(selector) ||
                findInOpenShadowRoots(document, selector);

        if (!island) return null;
        toolboxIsland = island;

        const marketRow = [...island.querySelectorAll(".kv")].find(row =>
            [...row.querySelectorAll(".k")].some(
                label => label.textContent.trim() === "Prix du marché Légendaire"
            )
        );
        const marketPrice = parseToolboxAmount(
            marketRow?.querySelector(".money.price-big")?.textContent
        );

        return marketPrice === null ? null : { amount: marketPrice, source: "Toolbox" };
    }

    function getOptimalBidBase() {
        return getOptimalBidBaseInfo()?.amount ?? null;
    }

    // =====================================================
    // CRÉATION DU PANNEAU PERSONNALISÉ
    // =====================================================

    function initFeature() {

        let customPanel = null;
        let observer = null;
        let optimalBidRetryTimer = null;
        let refreshOptimalBidScale = () => {};

        function startOptimalBidRetry() {
            if (optimalBidRetryTimer !== null) return;

            optimalBidRetryTimer = setInterval(() => {
                if (customPanel?.isConnected && refreshOptimalBidScale() &&
                    globalThis.WMFinderMarketPrice?.ready) {
                    clearInterval(optimalBidRetryTimer);
                    optimalBidRetryTimer = null;
                }
            }, 500);
        }

        function createPanel() {

            const original = findOriginalBlock();

            if (!original) return;

            if (customPanel?.isConnected) return;

            document.getElementById(CONFIG.blockId)?.remove();

            // =================================================
            // CONTENEUR PRINCIPAL
            // =================================================

            customPanel = document.createElement("div");
            customPanel.id = CONFIG.blockId;

            customPanel.style.cssText = `
                margin-top: 14px;
                padding: 16px;
                border-radius: 12px;
                border: 1px solid var(--color-border);
                background: color-mix(
                    in srgb,
                    var(--color-surface) 82%,
                    var(--color-accent) 18%
                );
                color: var(--color-foreground);
            `;

            // =================================================
            // TITRE
            // =================================================

            const title = document.createElement("div");

            title.textContent = "Mise personnalisée";

            title.style.cssText = `
                font-size: 13px;
                font-weight: 700;
                margin-bottom: 12px;
            `;

            customPanel.appendChild(title);

            // =================================================
            // CHAMP ET BOUTONS + / -
            // =================================================

            const amountContainer = document.createElement("div");

            amountContainer.style.cssText = `
                display: flex;
                align-items: stretch;
                gap: 8px;
                width: 100%;
            `;

            function createSideButton(label) {

                const button = document.createElement("button");

                button.type = "button";
                button.textContent = label;
                button.style.cssText = `
                    width: 46px;
                    flex-shrink: 0;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    background: var(--color-surface);
                    color: var(--color-foreground);
                    font-size: 22px;
                    font-weight: 600;
                    cursor: pointer;
                `;

                return button;
            }

            const decrease = createSideButton("−");
            const increase = createSideButton("+");

            decrease.setAttribute("aria-label", "Diminuer de 10 %");
            increase.setAttribute("aria-label", "Augmenter de 10 %");

            const input = document.createElement("input");

            input.type = "number";
            input.inputMode = "numeric";
            input.step = "1";
            input.min = original.input.min || "0";
            input.value = original.input.value;

            input.setAttribute(
                "aria-label",
                "Montant de la mise personnalisée"
            );

            input.style.cssText = `
                flex: 1;
                min-width: 0;
                padding: 11px 8px;
                border: 1px solid var(--color-border);
                border-radius: 8px;
                background: var(--color-surface);
                color: var(--color-foreground);
                font-size: 16px;
                font-weight: 600;
                text-align: center;
                outline: none;
            `;

            const minimum = Number(input.min) || 0;

            function getCurrentMinimumBid() {
                const currentOriginal = findOriginalBlock();

                if (!currentOriginal) return minimum;

                const inputMinimum = Number(currentOriginal.input.min) || minimum;
                const startingBid = parseAuctionAmount(
                    currentOriginal.card,
                    "Mise de départ"
                );
                const currentBid = parseAuctionAmount(
                    currentOriginal.card,
                    "Mise actuelle"
                );

                if (currentBid !== null) {
                    return Math.max(
                        inputMinimum,
                        startingBid ?? 0,
                        Math.ceil(currentBid * 1.105)
                    );
                }

                return Math.max(inputMinimum, startingBid ?? 0);
            }

            function getCustomAmount() {
                return Number(input.value);
            }

            function updateAmount(value) {

                input.value = String(
                    Math.max(minimum, Math.round(value))
                );

            }

            // +10,5 % et -10 % sur le montant personnalisé actuel

            decrease.addEventListener("click", () => {

                const current = getCustomAmount();

                if (!Number.isFinite(current)) return;

                updateAmount(current * 0.90);
            });

            increase.addEventListener("click", () => {

                const current = getCustomAmount();

                if (!Number.isFinite(current)) return;

                updateAmount(Math.ceil(current * 1.105));
            });

            amountContainer.appendChild(decrease);
            amountContainer.appendChild(input);
            amountContainer.appendChild(increase);

            customPanel.appendChild(amountContainer);

            // =================================================
            // BOUTONS DE POURCENTAGE
            // Basés sur le champ ORIGINAL du site
            // =================================================

            const quickActions = document.createElement("div");

            quickActions.style.cssText = `
                display: flex;
                gap: 8px;
                margin-top: 10px;
                width: 100%;
            `;

            [0, 10, 25, 50].forEach(percent => {

                const button = document.createElement("button");

                button.type = "button";

                if (percent === 0) {
                    button.textContent = `=`;
                } else {
                    button.textContent = `+${percent.toLocaleString("fr-FR")}%`;
                }

                button.style.cssText = `
                    flex: 1;
                    padding: 10px 5px;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    background: var(--color-surface);
                    color: var(--color-foreground);
                    font-size: 13px;
                    font-weight: 700;
                    cursor: pointer;
                `;

                button.addEventListener("click", () => {

                    // Toujours relire la mise originale du site
                    const currentOriginal = findOriginalBlock();

                    if (!currentOriginal) return;

                    const baseAmount = Number(
                        currentOriginal.input.value
                    );

                    if (!Number.isFinite(baseAmount)) return;

                    // Calcul indépendant du champ personnalisé
                    const calculatedAmount =
                        baseAmount * (1 + percent / 100);
                    const newAmount = percent === 10.5
                        ? Math.ceil(calculatedAmount)
                        : Math.round(calculatedAmount);

                    updateAmount(newAmount);
                });

                quickActions.appendChild(button);
            });

            customPanel.appendChild(quickActions);

            const optimalScale = document.createElement("section");
            optimalScale.style.cssText = `
                display: none;
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid var(--color-border);
            `;

            const optimalScaleHeading = document.createElement("div");
            optimalScaleHeading.style.cssText = `
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 8px;
            `;

            const optimalScaleTitle = document.createElement("span");
            optimalScaleTitle.textContent = "Échelle de mise optimale";
            optimalScaleTitle.style.cssText = "font-size: 12px; font-weight: 700;";

            const optimalScaleBase = document.createElement("span");
            optimalScaleBase.style.cssText = `
                color: var(--color-foreground);
                opacity: 0.65;
                font-size: 10px;
                text-align: right;
            `;

            optimalScaleHeading.append(optimalScaleTitle, optimalScaleBase);

            const optimalScaleOptions = document.createElement("div");
            optimalScaleOptions.style.cssText = `
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 6px;
            `;

            const optimalScaleButtons = [50, 75, 90, 100].map(percent => {
                const button = document.createElement("button");
                const percentLabel = document.createElement("span");
                const amountLabel = document.createElement("span");

                button.type = "button";
                button.setAttribute(
                    "aria-label",
                    `Miser ${percent} % du prix de référence`
                );
                button.style.cssText = `
                    display: flex;
                    min-width: 0;
                    flex-direction: column;
                    align-items: center;
                    gap: 3px;
                    padding: 8px 3px;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    background: var(--color-surface);
                    color: var(--color-foreground);
                    cursor: pointer;
                `;

                percentLabel.textContent = `${percent}%`;
                percentLabel.style.cssText = "font-size: 12px; font-weight: 700;";
                amountLabel.style.cssText = `
                    max-width: 100%;
                    overflow: hidden;
                    font-size: 9px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    opacity: 0.7;
                `;
                button.append(percentLabel, amountLabel);

                button.addEventListener("click", () => {
                    const base = getOptimalBidBase();

                    if (base === null) return;

                    const bid = Math.round(base * percent / 100);
                    if (bid < getCurrentMinimumBid()) return;

                    updateAmount(bid);
                });

                optimalScaleOptions.appendChild(button);
                return { percent, amountLabel, button };
            });

            optimalScale.append(optimalScaleHeading, optimalScaleOptions);
            customPanel.appendChild(optimalScale);

            refreshOptimalBidScale = () => {
                const baseInfo = getOptimalBidBaseInfo();
                const base = baseInfo?.amount ?? null;
                const isVisible = baseInfo !== null;

                const display = isVisible ? "block" : "none";
                if (optimalScale.style.display !== display) {
                    optimalScale.style.display = display;
                }

                if (!isVisible) return;

                const formattedBase = `Base ${baseInfo.source} : ${new Intl.NumberFormat("fr-FR").format(base)} ₩`;
                if (optimalScaleBase.textContent !== formattedBase) {
                    optimalScaleBase.textContent = formattedBase;
                }

                const minimumBid = getCurrentMinimumBid();

                for (const { percent, amountLabel, button } of optimalScaleButtons) {
                    const bid = Math.round(base * percent / 100);
                    const formattedBid = `${new Intl.NumberFormat("fr-FR").format(bid)} ₩`;
                    const isBelowMinimum = bid < minimumBid;

                    if (amountLabel.textContent !== formattedBid) {
                        amountLabel.textContent = formattedBid;
                    }

                    button.disabled = isBelowMinimum;
                    button.title = isBelowMinimum
                        ? `Mise minimale : ${new Intl.NumberFormat("fr-FR").format(minimumBid)} ₩`
                        : `Miser ${formattedBid}`;
                    button.style.opacity = isBelowMinimum ? "0.45" : "1";
                    button.style.cursor = isBelowMinimum ? "not-allowed" : "pointer";
                }

                return true;
            };

            // =================================================
            // BOUTON MISER
            // =================================================

            const submit = document.createElement("button");

            submit.type = "button";
            submit.textContent = "Miser";

            submit.style.cssText = `
                display: block;
                width: 100%;
                margin-top: 12px;
                padding: 12px;
                border: none;
                border-radius: 8px;
                background: var(--color-accent);
                color: var(--color-accent-foreground);
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
            `;

            submit.addEventListener("click", () => {

                const current = findOriginalBlock();

                if (!current) return;

                const amount = Number(input.value);
                const min = Number(current.input.min) || 0;

                if (
                    !Number.isFinite(amount) ||
                    !Number.isInteger(amount) ||
                    amount < min
                ) {
                    console.warn(
                        "Wiki Masters : montant invalide."
                    );
                    return;
                }

                // Mise à jour du véritable champ du site
                const descriptor = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    "value"
                );

                if (!descriptor?.set) return;

                descriptor.set.call(
                    current.input,
                    String(amount)
                );

                current.input.dispatchEvent(
                    new Event("input", { bubbles: true })
                );

                current.input.dispatchEvent(
                    new Event("change", { bubbles: true })
                );

                // Déclenchement du bouton original
                current.button.click();
            });

            customPanel.appendChild(submit);

            // =================================================
            // INSERTION APRÈS LE BLOC ORIGINAL
            // =================================================

            original.card.insertAdjacentElement(
                "afterend",
                customPanel
            );

            if (!refreshOptimalBidScale() || !globalThis.WMFinderMarketPrice?.ready) {
                startOptimalBidRetry();
            }

            console.log(
                "Wiki Masters : panneau personnalisé ajouté."
            );
        }

        // =================================================
        // SURVEILLANCE DU DOM
        // =================================================

        observer = new MutationObserver(() => {

            if (!customPanel?.isConnected) {
                customPanel = null;
                createPanel();
            } else {
                refreshOptimalBidScale();
            }
        });

        observer.observe(document.body, {
            childList: true,
            characterData: true,
            subtree: true
        });

        const refreshMarketPrice = (changes, area) => {
            if (area === "local" &&
                (changes.wmFinder12LegendaryPrices || changes.wmFinder12LegendaryAuctions)) {
                refreshOptimalBidScale();
            }
        };
        chrome.storage.onChanged.addListener(refreshMarketPrice);

        createPanel();

        // =================================================
        // NETTOYAGE
        // =================================================

        return function cleanup() {

            observer?.disconnect();
            chrome.storage.onChanged.removeListener(refreshMarketPrice);
            clearInterval(optimalBidRetryTimer);
            optimalBidRetryTimer = null;

            customPanel?.remove();
            customPanel = null;

            console.log(
                "Wiki Masters : panneau personnalisé supprimé."
            );
        };
    }

    // =====================================================
    // NAVIGATION
    // =====================================================

    function checkNavigation() {

        if (!document.body) return;

        if (isTargetPage()) {

            if (cleanupFeature !== null) return;

            cleanupFeature = initFeature();

            console.log(
                "Wiki Masters : arrivée sur Marketplace."
            );

        } else if (cleanupFeature !== null) {

            cleanupFeature();
            cleanupFeature = null;

            console.log(
                "Wiki Masters : départ de Marketplace."
            );
        }
    }

    // =====================================================
    // HISTORIQUE
    // =====================================================

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    function patchedPushState(...args) {
        const result = originalPushState.apply(this, args);
        checkNavigation();
        return result;
    }

    function patchedReplaceState(...args) {
        const result = originalReplaceState.apply(this, args);
        checkNavigation();
        return result;
    }

    history.pushState = patchedPushState;
    history.replaceState = patchedReplaceState;

    // =====================================================
    // CONTRÔLEUR
    // =====================================================

    function destroy() {

        cleanupFeature?.();
        cleanupFeature = null;

        clearInterval(navigationWatcher);

        window.removeEventListener("popstate", checkNavigation);
        window.removeEventListener("hashchange", checkNavigation);
        window.removeEventListener("pageshow", checkNavigation);

        if (history.pushState === patchedPushState) {
            history.pushState = originalPushState;
        }

        if (history.replaceState === patchedReplaceState) {
            history.replaceState = originalReplaceState;
        }

        delete window[CONTROLLER_KEY];
    }

    window[CONTROLLER_KEY] = {
        checkNavigation,
        destroy
    };

    window.addEventListener("popstate", checkNavigation);
    window.addEventListener("hashchange", checkNavigation);
    window.addEventListener("pageshow", checkNavigation);

    // =====================================================
    // DÉMARRAGE
    // =====================================================

    function start() {

        if (!document.body) {
            document.addEventListener(
                "DOMContentLoaded",
                start,
                { once: true }
            );
            return;
        }

        checkNavigation();

        navigationWatcher = setInterval(
            checkNavigation,
            500
        );
    }

    start();

})();

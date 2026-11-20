(() => {
    "use strict";

    const CONTROLLER_KEY = "__wkmQuickAuctionController";

    const CARD_SELECTOR = '[id^="marketplace-auction-"]';
    const PANEL_CLASS = "wkm-qa-panel";
    const SALES_TOTAL_ATTRIBUTE = "data-wkm-sales-total";

    // Évite les doubles injections du module.
    if (window[CONTROLLER_KEY]) {
        window[CONTROLLER_KEY].destroy();
    }

    let observer = null;
    let salesTotalTimer = null;

    function scheduleSalesTotalUpdate() {
        clearTimeout(salesTotalTimer);
        salesTotalTimer = setTimeout(updateSalesTabTotal, 100);
    }

    /**
     * Vérifie que nous sommes sur la page marketplace.
     */
    function isMarketplacePage() {
        return (
            location.origin === "https://www.wiki-masters.com" &&
            location.pathname.replace(/\/$/, "") === "/marketplace"
        );
    }

    function findSalesTab() {
        return [...document.querySelectorAll(
            "div.flex.overflow-x-auto.border-b button"
        )].find(button => /^Mes ventes(?:\s|\(|$)/.test(button.textContent.trim())) || null;
    }

    function getDisplayedAuctionPrice(card) {
        const labels = [...card.querySelectorAll("span")];
        const currentBidLabel = labels.find(
            element => element.textContent.trim() === "Mise actuelle"
        );
        const startingBidLabel = labels.find(
            element => element.textContent.trim() === "Mise de départ"
        );

        function parseAmount(label) {
            const price = label?.nextElementSibling?.textContent.replace(/\D/g, "");
            const amount = Number(price);
            return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
        }

        return parseAmount(currentBidLabel) ?? parseAmount(startingBidLabel);
    }

    function createSalesTotalIndicator() {
        const indicator = document.createElement("span");
        indicator.setAttribute(SALES_TOTAL_ATTRIBUTE, "");
        indicator.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 3px;
            margin-left: 7px;
            font-variant-numeric: tabular-nums;
        `;

        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("fill", "none");
        icon.setAttribute("stroke", "currentColor");
        icon.setAttribute("stroke-width", "2");
        icon.setAttribute("stroke-linecap", "round");
        icon.setAttribute("stroke-linejoin", "round");
        icon.setAttribute("aria-hidden", "true");
        icon.style.cssText = "width: 13px; height: 13px; flex: none;";

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "12");
        circle.setAttribute("cy", "12");
        circle.setAttribute("r", "9");

        const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
        mark.setAttribute("d", "M7.5 8.5 9.5 15.5 12 10 14.5 15.5 16.5 8.5");

        icon.append(circle, mark);
        indicator.appendChild(icon);

        return indicator;
    }

    function updateSalesTabTotal() {
        const salesTab = findSalesTab();

        if (!salesTab?.classList.contains("border-b-2")) return;

        const cardElements = [...document.querySelectorAll(CARD_SELECTOR)];
        const expectedCount = Number(
            salesTab.textContent.match(/\((\d+)\s*\/\s*\d+\)/)?.[1]
        );

        if (
            Number.isFinite(expectedCount) &&
            expectedCount > 0 &&
            cardElements.length < expectedCount
        ) {
            return;
        }

        const prices = cardElements.map(getDisplayedAuctionPrice);

        if (prices.some(amount => amount === null)) return;

        const total = prices.reduce((sum, amount) => sum + amount, 0);

        let indicator = salesTab.querySelector(`[${SALES_TOTAL_ATTRIBUTE}]`);

        if (!indicator) {
            indicator = createSalesTotalIndicator();
            salesTab.appendChild(indicator);
        }

        const formattedTotal = new Intl.NumberFormat("fr-FR").format(total);

        if (indicator.lastChild?.textContent !== formattedTotal) {
            if (indicator.lastChild?.nodeType === Node.TEXT_NODE) {
                indicator.lastChild.textContent = formattedTotal;
            } else {
                indicator.appendChild(document.createTextNode(formattedTotal));
            }
        }
    }

    function isBrowseTabActive() {
        const tabButtons = document.querySelectorAll(
            "div.flex.overflow-x-auto.border-b button"
        );

        const browseButton = [...tabButtons].find(
            button => button.textContent.trim() === "Parcourir"
        );

        return Boolean(
            browseButton &&
            browseButton.classList.contains("border-b-2")
        );
    }

    /**
     * Récupère l'identifiant de l'enchère depuis l'identifiant
     * du conteneur HTML.
     *
     * Exemple :
     * marketplace-auction-xxxxxxxx
     */
    function getAuctionId(cardElement) {
        const prefix = "marketplace-auction-";

        if (!cardElement.id.startsWith(prefix)) {
            return "";
        }

        return cardElement.id.slice(prefix.length);
    }

    /**
     * Dans le HTML fourni, le nom du vendeur correspond
     * au dernier paragraphe de la carte.
     */
    function getSellerElement(cardElement) {
        const paragraphs = cardElement.querySelectorAll("p");

        if (paragraphs.length === 0) {
            return null;
        }

        return paragraphs[paragraphs.length - 1];
    }

    /**
     * Calcule le montant minimum proposé.
     *
     * Sans mise :
     * base_amount
     *
     * Avec une mise :
     * current_bid + 1
     */
    function getMinimumBid(auction) {
        const baseAmount = Number(auction.base_amount) || 0;

        const currentBid =
            auction.current_bid === null ||
                auction.current_bid === undefined
                ? null
                : Number(auction.current_bid);

        // Aucune mise : on s'aligne sur la mise de départ.
        if (currentBid === null || !Number.isFinite(currentBid)) {
            return Math.max(1, baseAmount);
        }

        // Une mise existe : on ajoute 10,5 % pour dépasser le minimum du site.
        return Math.max(
            1,
            baseAmount,
            Math.ceil(currentBid * 1.105)
        );
    }

    /**
     * Formate un montant selon les conventions françaises.
     */
    function formatAmount(amount) {
        return new Intl.NumberFormat("fr-FR").format(amount);
    }

    function updateDisplayedAmount(card, labelText, amount) {
        if (!Number.isFinite(amount)) return false;

        const label = [...card.querySelectorAll("span")].find(
            element => element.textContent.trim() === labelText
        );
        const value = label?.nextElementSibling;

        if (!value) return false;

        const formattedAmount = formatAmount(amount);
        let amountText = null;

        for (const child of value.childNodes) {
            if (
                child.nodeType === Node.TEXT_NODE &&
                child.textContent.trim()
            ) {
                amountText = child;
            }
        }

        if (amountText) {
            amountText.textContent = formattedAmount;
        } else {
            value.appendChild(document.createTextNode(formattedAmount));
        }

        return true;
    }

    function updateCardPrices(panel, auction) {
        const card = panel.closest(CARD_SELECTOR);

        if (!card) {
            console.warn("[WKM Quick Auction] Carte introuvable pour actualiser son prix.");
            return;
        }

        const startingBidUpdated = updateDisplayedAmount(
            card,
            "Mise de départ",
            Number(auction.base_amount)
        );
        const currentBidUpdated = auction.current_bid === null ||
            auction.current_bid === undefined
            ? false
            : updateDisplayedAmount(card, "Mise actuelle", Number(auction.current_bid));

        if (!startingBidUpdated && !currentBidUpdated) {
            console.warn("[WKM Quick Auction] Prix affiché introuvable sur la carte.");
        }
    }

    /**
     * Crée un bouton avec une icône et un libellé accessible.
     */
    function createIconButton(icon, label, className) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = className;
        button.textContent = icon;

        button.title = label;
        button.setAttribute("aria-label", label);

        return button;
    }

    /**
     * Modifie le message d'état affiché sous les contrôles.
     */
    function setPanelMessage(panel, message, state = "info") {
        const status = panel.querySelector(".wkm-qa-status");

        status.textContent = message;
        status.dataset.state = state;
    }

    /**
     * Actualise les informations de l'enchère.
     *
     * updateInput :
     * true  = remplace le montant saisi par le minimum actualisé.
     * false = conserve le montant déjà saisi.
     */
    async function refreshAuction(
        panel,
        auctionId,
        updateInput = true
    ) {
        const refreshButton = panel.querySelector(".wkm-qa-refresh");
        const bidButton = panel.querySelector(".wkm-qa-bid");
        const amountInput = panel.querySelector(".wkm-qa-amount");

        refreshButton.disabled = true;
        refreshButton.classList.add("is-loading");

        // On bloque les mises pendant l'actualisation.
        bidButton.disabled = true;

        setPanelMessage(panel, "Actualisation…");

        try {
            const auction =
                await window.WKMQuickAuctionApi.getAuction(auctionId);

            updateCardPrices(panel, auction);

            const minimumBid = getMinimumBid(auction);

            panel.dataset.minimumBid = String(minimumBid);
            panel.dataset.auctionStatus = auction.status || "";

            if (updateInput || !amountInput.value) {
                amountInput.value = String(minimumBid);
            }

            if (auction.status !== "active") {
                setPanelMessage(
                    panel,
                    "Cette enchère n'est plus active.",
                    "warning"
                );

                bidButton.disabled = true;

                return;
            }

            bidButton.disabled = false;
        } catch (error) {
            setPanelMessage(
                panel,
                error.message,
                "error"
            );

        } finally {
            refreshButton.disabled = false;
            refreshButton.classList.remove("is-loading");
        }
    }

    /**
     * Envoie une mise après clic manuel sur le bouton.
     */
    async function submitBid(panel, auctionId) {
        const amountInput = panel.querySelector(".wkm-qa-amount");
        const bidButton = panel.querySelector(".wkm-qa-bid");

        const amount = Number(amountInput.value);
        const minimumBid = Number(panel.dataset.minimumBid);

        // Vérification du montant saisi.
        if (!Number.isSafeInteger(amount) || amount < 1) {
            setPanelMessage(
                panel,
                "Saisis un montant entier valide.",
                "error"
            );

            amountInput.focus();

            return;
        }

        // Vérification du minimum connu.
        if (
            !Number.isFinite(minimumBid) ||
            amount < minimumBid
        ) {
            setPanelMessage(
                panel,
                `La mise minimale est de ${formatAmount(minimumBid)}. Actualise si nécessaire.`,
                "warning"
            );

            amountInput.focus();

            return;
        }

        bidButton.disabled = true;

        setPanelMessage(
            panel,
            "Envoi de la mise…"
        );

        try {
            const result =
                await window.WKMQuickAuctionApi.placeBid(
                    auctionId,
                    amount
                );

            const acceptedAmount = Number(
                result.current_bid ?? amount
            );

            setPanelMessage(
                panel,
                `Mise enregistrée : ${formatAmount(acceptedAmount)}.`,
                "success"
            );
        } catch (error) {
            setPanelMessage(
                panel,
                error.message,
                "error"
            );

            bidButton.disabled =
                panel.dataset.auctionStatus !== "active";
        }
    }

    /**
     * Crée le panneau Quick Auction.
     */
    function createPanel(auctionId) {
        const panel = document.createElement("section");

        panel.className = PANEL_CLASS;
        panel.dataset.auctionId = auctionId;

        panel.innerHTML = `
            <div class="wkm-qa-controls" >
                <input
                    class="wkm-qa-amount"
                    type="number"
                    min="1"
                    step="1"
                    inputmode="numeric"
                    aria-label="Montant de la mise"
                    placeholder="Mise">

                <button
                    class="wkm-qa-icon-button wkm-qa-refresh"
                    type="button"
                    title="Actualiser la mise minimale"
                    aria-label="Actualiser la mise minimale"
                >↻</button>

                <button
                    class="wkm-qa-icon-button wkm-qa-bid"
                    type="button"
                    title="Placer une mise"
                    aria-label="Placer une mise"
                    disabled
                >⚖</button>

            </div>

            <p
                class="wkm-qa-status"
                role="status"
                aria-live="polite"
            ></p>
        `;

        const refreshButton =
            panel.querySelector(".wkm-qa-refresh");

        const bidButton =
            panel.querySelector(".wkm-qa-bid");

        // Les contrôles sont insérés dans une carte qui contient
        // un lien. On empêche donc la navigation au clic.
        ["click", "pointerdown", "mousedown", "touchstart"].forEach(eventName => {
            panel.addEventListener(eventName, event => {
                event.stopPropagation();

                if (eventName === "click") {
                    event.preventDefault();
                }
            });
        });

        refreshButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            refreshAuction(
                panel,
                auctionId,
                true
            );
        });

        bidButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            submitBid(
                panel,
                auctionId
            );
        });

        return panel;
    }

    /**
     * Ajoute Quick Auction sur une carte.
     */
    function addQuickAuctionPanel(cardElement) {
        // Ne crée pas deux panneaux sur la même carte.
        if (cardElement.querySelector(`.${PANEL_CLASS} `)) {
            return;
        }

        const auctionId = getAuctionId(cardElement);
        const sellerElement = getSellerElement(cardElement);

        if (
            !auctionId ||
            !sellerElement ||
            !window.WKMQuickAuctionApi
        ) {
            return;
        }

        const panel = createPanel(auctionId);

        // Insertion juste avant le nom du vendeur.
        sellerElement.insertAdjacentElement(
            "beforebegin",
            panel
        );
    }

    /**
     * Parcourt les cartes présentes sur la page.
     */
    function scanMarketplace() {
        if (!isMarketplacePage()) {
            return;
        }

        scheduleSalesTotalUpdate();

        // Dans les autres onglets, on retire tous les panneaux.
        if (!isBrowseTabActive()) {
            document
                .querySelectorAll(`.${PANEL_CLASS}`)
                .forEach(panel => panel.remove());

            return;
        }

        // Dans Parcourir, on ajoute les panneaux aux cartes.
        document
            .querySelectorAll(CARD_SELECTOR)
            .forEach(addQuickAuctionPanel);
    }

    /**
     * Nettoyage du module.
     */
    function destroy() {
        observer?.disconnect();
        clearTimeout(salesTotalTimer);

        document
            .querySelectorAll(`.${PANEL_CLASS} `)
            .forEach(panel => panel.remove());
    }

    // La marketplace peut charger ses cartes progressivement.
    observer = new MutationObserver(scanMarketplace);

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class"]
    });

    scanMarketplace();

    window[CONTROLLER_KEY] = {
        destroy
    };
})();
(() => {
    "use strict";

    const CONTROLLER_KEY = "__wkmCollectionAuctionDefaultsController";
    const AUCTION_DIALOG_TITLE = "Mettre aux enchères";
    const PRICE_LABELS = {
        start: "Mise de départ",
        average: "Moyenne"
    };
    const DURATION_LABELS = new Map([
        [10, "10 min"],
        [30, "30 min"],
        [60, "1 h"],
        [180, "3 h"],
        [360, "6 h"],
        [720, "12 h"]
    ]);

    if (window[CONTROLLER_KEY]) {
        window[CONTROLLER_KEY].destroy();
    }

    let observer = null;
    const processedDialogs = new WeakSet();

    function isCollectionPage() {
        return (
            location.origin === "https://www.wiki-masters.com" &&
            location.pathname.replace(/\/$/, "") === "/collection"
        );
    }

    function normalizeTitle(title) {
        return title
            .normalize("NFKC")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase("fr");
    }

    function findAuctionDialog() {
        const heading = [...document.querySelectorAll("h2")].find(
            element => element.textContent.trim() === AUCTION_DIALOG_TITLE
        );

        return heading?.closest(".card-frame") || null;
    }

    function getLabeledValue(dialog, labelText) {
        const label = [...dialog.querySelectorAll("span")].find(
            element => element.textContent.trim() === labelText
        );
        const value = label?.nextElementSibling;

        if (!value) return null;

        const digits = value.textContent.replace(/\D/g, "");
        const amount = Number(digits);

        return Number.isSafeInteger(amount) && amount > 0
            ? amount
            : null;
    }

    function waitForLabeledValue(dialog, labelText, timeoutMs = 30000) {
        return new Promise(resolve => {
            let finished = false;
            let timeout = null;
            let observer = null;

            function finish(amount) {
                if (finished) return;

                finished = true;
                observer?.disconnect();
                clearTimeout(timeout);
                resolve(amount);
            }

            function check() {
                const amount = getLabeledValue(dialog, labelText);

                if (amount) {
                    finish(amount);
                } else if (!dialog.isConnected) {
                    finish(null);
                }
            }

            observer = new MutationObserver(check);
            observer.observe(document.documentElement, {
                childList: true,
                characterData: true,
                subtree: true
            });

            timeout = setTimeout(() => finish(null), timeoutMs);
            check();
        });
    }

    function setInputValue(input, amount) {
        const descriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
        );

        if (!descriptor?.set) {
            throw new Error("Impossible de modifier le champ de mise.");
        }

        descriptor.set.call(input, String(amount));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function getQuickMarketCardSettings(title, dataKey, cards, settings) {
        const normalizedTitle = normalizeTitle(title);
        const keyCardId = dataKey?.split("|")[1]?.trim();
        const matches = cards.filter(
            card => normalizeTitle(card.title) === normalizedTitle
        );

        if (keyCardId) {
            const keyedMatch = matches.find(
                card => String(card.id) === keyCardId ||
                    String(card.ownedId) === keyCardId
            );
            if (keyedMatch) return settings.cards?.[keyedMatch.id] || null;
        }

        const matchingIds = [...new Set(matches.map(card => String(card.id)))];

        if (matchingIds.length === 1) {
            return settings.cards?.[matchingIds[0]] || null;
        }

        if (matchingIds.length > 1) {
            console.warn(
                `[WKM Collection Auction] Plusieurs cartes correspondent à « ${title} » ; le prix moyen sera utilisé.`
            );
        }

        return null;
    }

    function findCardTitle(dialog, dataKey) {
        const keyTitle = dataKey?.split("|")[0]?.trim();

        if (keyTitle) return keyTitle;

        return dialog.querySelector("h3")?.textContent.trim() || "";
    }

    function selectDuration(dialog, durationMinutes) {
        const label = DURATION_LABELS.get(Number(durationMinutes));

        if (!label) return false;

        const button = [...dialog.querySelectorAll("button")].find(
            element => element.textContent.trim() === label
        );

        if (!button) return false;

        button.click();
        return true;
    }

    async function configureAuctionDialog(dialog) {
        const input = dialog.querySelector(
            `input[aria-label="${PRICE_LABELS.start}"]`
        );

        if (!input) {
            console.warn("[WKM Collection Auction] Champ de mise de départ introuvable.");
            return;
        }

        const previewCard = dialog.querySelector("[data-wmt-key]");
        const dataKey = previewCard?.getAttribute("data-wmt-key") || "";
        const title = findCardTitle(dialog, dataKey);

        let settings = null;
        let cards = [];
        const [settingsResult, cardsResult] = await Promise.allSettled([
            window.WKMQuickMarketStorage.load(),
            window.WKMQuickMarketApi.getLegendaryCards()
        ]);

        if (settingsResult.status === "fulfilled") {
            settings = settingsResult.value;
        } else {
            console.error(
                "[WKM Collection Auction] Impossible de charger les réglages Quick Market :",
                settingsResult.reason
            );
        }

        if (cardsResult.status === "fulfilled") {
            cards = cardsResult.value;
        } else {
            console.error(
                "[WKM Collection Auction] Impossible de retrouver la carte dans Quick Market :",
                cardsResult.reason
            );
        }

        const quickMarketCardSettings = settings && title
            ? getQuickMarketCardSettings(title, dataKey, cards, settings)
            : null;
        const configuredAmount = Number(quickMarketCardSettings?.baseAmount);

        if (Number.isSafeInteger(configuredAmount) && configuredAmount > 0) {
            if (input.isConnected) {
                setInputValue(input, configuredAmount);
            }
        } else {
            const averageAmount = await waitForLabeledValue(
                dialog,
                PRICE_LABELS.average
            );

            if (averageAmount && input.isConnected) {
                setInputValue(input, averageAmount);
            } else if (dialog.isConnected) {
                console.warn(
                    "[WKM Collection Auction] Prix moyen introuvable après 30 secondes."
                );
            }
        }

        if (
            settings &&
            dialog.isConnected &&
            !selectDuration(dialog, settings.durationMinutes)
        ) {
            console.warn(
                "[WKM Collection Auction] Durée Quick Market introuvable dans la fenêtre."
            );
        }
    }

    function scan() {
        if (!isCollectionPage()) return;

        const dialog = findAuctionDialog();

        if (!dialog || processedDialogs.has(dialog)) return;

        processedDialogs.add(dialog);
        configureAuctionDialog(dialog).catch(error => {
            console.error(
                "[WKM Collection Auction] Impossible de configurer l’enchère :",
                error
            );
        });
    }

    function destroy() {
        observer?.disconnect();
        window.removeEventListener("popstate", scan);
        delete window[CONTROLLER_KEY];
    }

    observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    window.addEventListener("popstate", scan);
    window[CONTROLLER_KEY] = { destroy };
    scan();
})();

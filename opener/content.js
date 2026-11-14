(() => {
    "use strict";

    // =====================================================
    // CONFIGURATION
    // =====================================================

    const CONFIG = {
        origin: "https://www.wiki-masters.com",
        path: "/pulls",

        initialDelay: 30,
        openDelay: 45,

        arrowClicks: 4,
        arrowDelay: 1,
        arrowDelayRandom: 3,

        checkDelay: 300,
        checkDelayRandom: 45
    };

    const CONTROLLER_KEY = "__wikiMastersController";
    const SCHEDULE_STORAGE_KEY = "wikiMastersOpenerSchedule";

    function normalizeSchedule(value) {
        const schedule = {
            start: value?.start ?? "",
            end: value?.end ?? ""
        };
        const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

        if (
            (schedule.start !== "" && !timePattern.test(schedule.start)) ||
            (schedule.end !== "" && !timePattern.test(schedule.end))
        ) {
            throw new Error("Les heures enregistrées pour l’opener sont invalides.");
        }

        return schedule;
    }

    function loadSchedule() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(SCHEDULE_STORAGE_KEY, result => {
                const error = chrome.runtime.lastError;

                if (error) {
                    reject(new Error(error.message));
                    return;
                }

                try {
                    resolve(normalizeSchedule(result[SCHEDULE_STORAGE_KEY]));
                } catch (validationError) {
                    reject(validationError);
                }
            });
        });
    }

    function saveSchedule(schedule) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(
                { [SCHEDULE_STORAGE_KEY]: schedule },
                () => {
                    const error = chrome.runtime.lastError;

                    if (error) {
                        reject(new Error(error.message));
                        return;
                    }

                    resolve();
                }
            );
        });
    }

    // =====================================================
    // ÉVITER LES INITIALISATIONS MULTIPLES
    // =====================================================

    if (window[CONTROLLER_KEY]) {
        window[CONTROLLER_KEY].checkNavigation();
        return;
    }

    let cleanupAutomation = null;

    const normalizePath = path => path.replace(/\/+$/, "");

    function isTargetPage() {
        return (
            location.origin === CONFIG.origin &&
            normalizePath(location.pathname) === CONFIG.path
        );
    }

    // =====================================================
    // INITIALISATION DE L'AUTOMATISATION
    // =====================================================

    function initAutomation() {

        let running = false;
        let runId = 0;
        let nextActionAt = null;

        let timer = null;
        let cancelWait = null;
        let schedule = { start: "", end: "" };

        const scheduleReady = loadSchedule().then(savedSchedule => {
            schedule = savedSchedule;
        });

        scheduleReady.catch(error => {
            console.error("Impossible de charger les horaires de l’opener :", error);
        });

        // =================================================
        // WIDGET
        // =================================================

        const host = document.createElement("div");
        host.id = "wiki-masters-overlay";

        host.style.cssText = `
            position: fixed;
            top: 12px;
            left: 12px;
            z-index: 2147483647;
        `;

        document.documentElement.appendChild(host);

        const shadow = host.attachShadow({ mode: "open" });

        shadow.innerHTML = `
            <style>
                * { box-sizing: border-box; }

                .widget {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 12px 8px 8px;
                    background: #0b0f19;
                    color: white;
                    border: 1px solid #263247;
                    border-radius: 12px;
                    box-shadow: 0 5px 22px #0005;
                    font-family: Arial, sans-serif;
                    user-select: none;
                }

                button {
                    width: 34px;
                    height: 34px;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    border: 1px solid #be7180;
                    background: #4a202b;
                    color: #ffc2ce;
                    cursor: pointer;
                }

                button.active {
                    background: #14532d;
                    color: #bbf7d0;
                    border-color: #22c55e;
                }

                button svg {
                    width: 17px;
                    height: 17px;
                }

                .settings-button {
                    border-color: #475569;
                    background: #1e293b;
                    color: #cbd5e1;
                }

                .settings-button:hover {
                    background: #334155;
                }

                .label {
                    font-size: 10px;
                    color: #94a3b8;
                    margin-bottom: 3px;
                    white-space: nowrap;
                }

                .countdown {
                    font-size: 15px;
                    font-weight: bold;
                    font-variant-numeric: tabular-nums;
                }

                dialog {
                    width: min(320px, calc(100vw - 32px));
                    padding: 18px;
                    border: 1px solid #475569;
                    border-radius: 12px;
                    background: #0b0f19;
                    color: #f8fafc;
                    box-shadow: 0 16px 48px #0009;
                    font: 14px Arial, sans-serif;
                }

                dialog::backdrop {
                    background: #0009;
                }

                dialog h2 {
                    margin: 0 0 8px;
                    font-size: 17px;
                }

                dialog p {
                    margin: 0 0 16px;
                    color: #94a3b8;
                    font-size: 12px;
                    line-height: 1.4;
                }

                .time-fields {
                    display: grid;
                    gap: 12px;
                }

                .time-fields label {
                    display: grid;
                    gap: 5px;
                    color: #cbd5e1;
                    font-size: 12px;
                }

                .time-fields input {
                    width: 100%;
                    padding: 9px;
                    border: 1px solid #475569;
                    border-radius: 7px;
                    background: #111827;
                    color: #f8fafc;
                    font: inherit;
                }

                .dialog-actions {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-top: 18px;
                }

                .dialog-actions button {
                    width: auto;
                    height: auto;
                    padding: 8px 10px;
                    border-radius: 7px;
                    font-size: 12px;
                }

                .save-button {
                    border-color: #22c55e;
                    background: #14532d;
                    color: #bbf7d0;
                }

                .clear-button,
                .close-button {
                    border-color: #475569;
                    background: #1e293b;
                    color: #cbd5e1;
                }

                .dialog-status {
                    min-height: 15px;
                    margin-top: 10px;
                    color: #fca5a5;
                    font-size: 11px;
                }
            </style>

            <div class="widget">
                <button id="toggle" title="Activer">
                    <svg viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2"
                        stroke-linecap="round">
                        <path d="M12 2v10"/>
                        <path d="M5.5 5.5a9 9 0 1 0 13 0"/>
                    </svg>
                </button>

                <button id="settings" class="settings-button"
                    type="button" title="Paramètres des horaires"
                    aria-label="Paramètres des horaires">
                    <svg viewBox="0 0 24 24" fill="currentColor"
                        aria-hidden="true">
                        <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.62l-1.92-3.32c-.12-.22-.37-.3-.6-.22l-2.39.96c-.5-.38-1.03-.69-1.62-.93l-.36-2.55c-.04-.24-.25-.41-.49-.41h-3.84c-.24 0-.45.17-.49.41L9.21 5.35c-.59.24-1.13.55-1.62.93L5.2 5.32c-.23-.09-.48 0-.6.22L2.68 8.86c-.12.21-.07.48.12.62l2.03 1.58c-.05.31-.08.63-.08.94s.02.63.07.94L2.8 14.52c-.18.14-.23.41-.12.62l1.92 3.32c.12.22.37.3.6.22l2.39-.96c.5.38 1.03.69 1.62.93l.36 2.55c.04.24.25.41.49.41h3.84c.24 0 .45-.17.49-.41l.36-2.55c.59-.24 1.13-.55 1.62-.93l2.39.96c.23.09.48 0 .6-.22l1.92-3.32c.12-.21.07-.48-.12-.62l-2.03-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
                    </svg>
                </button>

                <div>
                    <div class="countdown" id="countdown">--:--</div>
                </div>
            </div>

            <dialog id="schedule-dialog" aria-labelledby="schedule-title">
                <form id="schedule-form">
                    <h2 id="schedule-title">Horaires de l’opener</h2>
                    <p>Chaque heure est facultative ; laisse les deux vides pour désactiver la limite.</p>
                    <div class="time-fields">
                        <label>
                            Heure de début
                            <input id="start-time" type="time">
                        </label>
                        <label>
                            Heure de fin
                            <input id="end-time" type="time">
                        </label>
                    </div>
                    <div class="dialog-status" id="schedule-status" role="status"></div>
                    <div class="dialog-actions">
                        <button class="clear-button" id="clear-schedule" type="button">
                            Supprimer les heures
                        </button>
                        <button class="close-button" id="close-dialog" type="button">
                            Fermer
                        </button>
                        <button class="save-button" type="submit">
                            Enregistrer
                        </button>
                    </div>
                </form>
            </dialog>
        `;

        const $ = id => shadow.getElementById(id);

        const button = $("toggle");
        const countdown = $("countdown");
        const settingsButton = $("settings");
        const scheduleDialog = $("schedule-dialog");
        const scheduleForm = $("schedule-form");
        const startTimeInput = $("start-time");
        const endTimeInput = $("end-time");
        const scheduleStatus = $("schedule-status");

        const powerIcon = button.innerHTML;

        const stopIcon = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
        `;

        // =================================================
        // AFFICHAGE
        // =================================================

        function updateWidget() {
            button.innerHTML = running ? stopIcon : powerIcon;
            button.classList.toggle("active", running);
            button.title = running ? "Désactiver" : "Activer";

            if (!running || nextActionAt === null) {
                countdown.textContent = "--:--";
                return;
            }

            const seconds = Math.max(
                0,
                Math.ceil((nextActionAt - Date.now()) / 1000)
            );

            countdown.textContent =
                String(Math.floor(seconds / 60)).padStart(2, "0") +
                ":" +
                String(seconds % 60).padStart(2, "0");
        }

        const countdownInterval = setInterval(updateWidget, 250);

        // =================================================
        // GESTION DES ATTENTES
        // =================================================

        function wait(run, min, random = 0) {

            if (!running || run !== runId) {
                return Promise.resolve(false);
            }

            const delay = (min + Math.random() * random) * 1000;

            nextActionAt = Date.now() + delay;
            updateWidget();

            return new Promise(resolve => {

                let finished = false;

                function finish(valid) {
                    if (finished) return;

                    finished = true;

                    if (timer !== null) {
                        clearTimeout(timer);
                        timer = null;
                    }

                    cancelWait = null;
                    nextActionAt = null;
                    updateWidget();

                    resolve(valid);
                }

                cancelWait = () => finish(false);

                timer = setTimeout(() => {

                    const valid = running && run === runId;

                    finish(valid);

                }, delay);
            });
        }

        function stop() {

            running = false;
            runId++;

            if (cancelWait !== null) {
                cancelWait();
            }

            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }

            nextActionAt = null;
            updateWidget();
        }

        // =================================================
        // RECHERCHE DES BOUTONS
        // =================================================

        function findOpen() {
            return [...document.querySelectorAll("button")].find(
                b => b.textContent.trim().includes("Ouvrir")
            );
        }

        function findArrow() {
            return document.querySelector(
                'button svg polyline[points="9 18 15 12 9 6"]'
            )?.closest("button") || null;
        }

        function findContinue() {
            return [...document.querySelectorAll("button")].find(
                b => b.textContent.trim() === "Continuer"
            );
        }

        function timeToMinutes(value) {
            if (!value) return null;

            const [hours, minutes] = value.split(":").map(Number);
            return hours * 60 + minutes;
        }

        function isWithinSchedule() {
            const start = timeToMinutes(schedule.start);
            const end = timeToMinutes(schedule.end);

            if (start === null && end === null) return true;

            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();

            if (start === null) return currentTime < end;
            if (end === null) return currentTime >= start;
            if (start === end) return true;

            return start < end
                ? currentTime >= start && currentTime < end
                : currentTime >= start || currentTime < end;
        }

        // =================================================
        // CYCLE AUTOMATIQUE
        // =================================================

        async function executeCycle(run, delay) {

            // Attente initiale

            if (!await wait(run, delay === 0
                ? CONFIG.initialDelay
                : delay
            )) return;

            // 4 clics sur la flèche

            for (let i = 0; i < CONFIG.arrowClicks; i++) {

                if (!running || run !== runId) return;

                const arrow = findArrow();

                if (!arrow || arrow.disabled) {
                    console.warn("Bouton fléché indisponible.");
                    return;
                }

                arrow.click();

                // Attente après chaque clic, y compris le dernier

                if (!await wait(
                    run,
                    CONFIG.arrowDelay,
                    CONFIG.arrowDelayRandom
                )) return;
            }

            // Cliquer sur Continuer

            if (!running || run !== runId) return;

            const next = findContinue();

            if (!next || next.disabled) {
                console.warn("Bouton Continuer indisponible.");
                return;
            }

            next.click();
        }

        // =================================================
        // BOUCLE PRINCIPALE
        // =================================================

        async function loop(run) {

            await scheduleReady;

            while (running && run === runId) {

                const open = findOpen();

                if (open && !open.disabled && isWithinSchedule()) {

                    open.click();

                    await executeCycle(run, CONFIG.openDelay);

                } else if (findArrow()) {

                    await executeCycle(run, 0);
                }

                if (!running || run !== runId) return;

                if (!await wait(
                    run,
                    CONFIG.checkDelay,
                    CONFIG.checkDelayRandom
                )) return;
            }
        }

        // =================================================
        // DÉMARRAGE
        // =================================================

        function start() {

            if (running) return;

            running = true;

            const run = ++runId;

            updateWidget();

            loop(run).catch(error => {
                console.error("Erreur automatisation :", error);

                if (run === runId) {
                    stop();
                }
            });
        }

        // =================================================
        // BOUTON
        // =================================================

        button.addEventListener("click", () => {

            if (running) {
                stop();
            } else {
                start();
            }
        });

        settingsButton.addEventListener("click", async () => {
            scheduleStatus.textContent = "";

            try {
                await scheduleReady;
                startTimeInput.value = schedule.start;
                endTimeInput.value = schedule.end;
            } catch (error) {
                console.error("Impossible de charger les horaires de l’opener :", error);
                startTimeInput.value = "";
                endTimeInput.value = "";
                scheduleStatus.textContent =
                    "Impossible de charger les horaires enregistrés. Tu peux les redéfinir.";
            }

            if (!scheduleDialog.open) {
                scheduleDialog.showModal();
            }
        });

        $("close-dialog").addEventListener("click", () => {
            scheduleDialog.close();
        });

        scheduleForm.addEventListener("submit", async event => {
            event.preventDefault();
            scheduleStatus.textContent = "";

            try {
                const updatedSchedule = normalizeSchedule({
                    start: startTimeInput.value,
                    end: endTimeInput.value
                });

                await saveSchedule(updatedSchedule);
                schedule = updatedSchedule;
                scheduleDialog.close();
            } catch (error) {
                console.error("Impossible d’enregistrer les horaires de l’opener :", error);
                scheduleStatus.textContent =
                    "Impossible d’enregistrer les horaires. Réessaie.";
            }
        });

        $("clear-schedule").addEventListener("click", async () => {
            scheduleStatus.textContent = "";
            const clearedSchedule = { start: "", end: "" };

            try {
                await saveSchedule(clearedSchedule);
                schedule = clearedSchedule;
                startTimeInput.value = "";
                endTimeInput.value = "";
                scheduleStatus.textContent = "Les horaires ont été supprimés.";
            } catch (error) {
                console.error("Impossible de supprimer les horaires de l’opener :", error);
                scheduleStatus.textContent =
                    "Impossible de supprimer les horaires. Réessaie.";
            }
        });

        // =================================================
        // NETTOYAGE
        // =================================================

        return function cleanup() {

            stop();

            clearInterval(countdownInterval);

            host.remove();

            console.log("Wiki Masters : automatisation nettoyée.");
        };
    }

    // =====================================================
    // SURVEILLANCE DE LA NAVIGATION
    // =====================================================

    function checkNavigation() {

        if (isTargetPage()) {

            if (cleanupAutomation !== null) return;

            console.log("Wiki Masters : arrivée sur /pulls.");

            cleanupAutomation = initAutomation();

        } else {

            if (cleanupAutomation !== null) {

                cleanupAutomation();

                cleanupAutomation = null;

                console.log("Wiki Masters : départ de /pulls.");
            }
        }
    }

    // =====================================================
    // INTERCEPTION DE L'HISTORIQUE
    // =====================================================

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {

        const result = originalPushState.apply(this, args);

        checkNavigation();

        return result;
    };

    history.replaceState = function (...args) {

        const result = originalReplaceState.apply(this, args);

        checkNavigation();

        return result;
    };

    // =====================================================
    // ÉVÉNEMENTS DE NAVIGATION
    // =====================================================

    window.addEventListener("popstate", checkNavigation);
    window.addEventListener("hashchange", checkNavigation);
    window.addEventListener("pageshow", checkNavigation);

    // Surveillance complémentaire :
    // détecte aussi les changements d'URL non interceptés.

    const navigationWatcher = setInterval(
        checkNavigation,
        500
    );

    // =====================================================
    // CONTRÔLEUR GLOBAL
    // =====================================================

    window[CONTROLLER_KEY] = {
        checkNavigation
    };

    // Première vérification

    checkNavigation();

})();

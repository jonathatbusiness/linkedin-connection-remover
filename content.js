(() => {
  "use strict";

  if (window.__linkedinConnectionRemoverLoaded) return;
  window.__linkedinConnectionRemoverLoaded = true;

  const STORAGE_KEY = "lcrStateV2";
  const LEGACY_STORAGE_KEY = "lcrStateV1";
  const UI_TIMEOUT_MS = 3000;
  const POLL_INTERVAL_MS = 100;
  const ACTION_DELAY_RANGE = [300, 600];
  const PERSON_DELAY_RANGE = [1200, 2000];
  const MAX_COLLECTION_PAGES = 100;
  const ROUTES = {
    connections: "/mynetwork/invite-connect/connections",
    search: "/search/results/people"
  };
  const SELECTORS = {
    connectionSearch: [
      '[componentkey="connectionsListTypeahead_ConnectionsListTypeahead"] input[data-testid="typeahead-input"]',
      'main input[placeholder="Search by name"]',
      'input[placeholder="Search by name"]'
    ].join(", "),
    connectionCard: '[componentkey^="ConnectionCard_"]',
    profileLink: 'a[href*="linkedin.com/in/"], a[href^="/in/"]',
    menu: '[role="menu"]',
    menuItem: '[role="menuitem"]',
    dialog: '[role="dialog"], [role="alertdialog"], dialog',
    searchResultCard: 'main a[tabindex="0"][href*="/in/"][componentkey]',
    currentPage: 'button[data-testid^="pagination-indicator-"][aria-current="true"]',
    nextPage: 'button[data-testid="pagination-controls-next-button-visible"]',
    firstDegreeFilter: '[role="radio"][aria-label="Filter by 1st connections"][aria-checked="true"]'
  };

  const state = {
    activeTab: isPeopleSearchPage() ? "collect" : "remove",
    collection: {
      mode: "idle",
      profiles: [],
      pagesVisited: [],
      duplicates: 0,
      currentPage: 0,
      searchUrl: "",
      message: "Ready to collect the current filtered search.",
      pauseRequested: false,
      stopRequested: false
    },
    removal: {
      mode: "idle",
      names: [],
      index: 0,
      results: [],
      message: "No removal in progress.",
      pauseRequested: false,
      stopRequested: false
    }
  };

  let removalLoopActive = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomBetween = ([min, max]) => Math.floor(min + Math.random() * (max - min + 1));
  const normalize = (value) => (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();

  function isConnectionsPage() {
    return location.pathname.startsWith(ROUTES.connections);
  }

  function isPeopleSearchPage() {
    return location.pathname.startsWith(ROUTES.search);
  }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function textMatches(element, options) {
    const value = normalize(element?.innerText || element?.textContent);
    return options.some((option) => value === normalize(option));
  }

  function canonicalProfileUrl(value) {
    try {
      const url = new URL(value, location.origin);
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] !== "in" || !segments[1]) return "";
      return `https://www.linkedin.com/in/${segments[1]}`;
    } catch {
      return "";
    }
  }

  function hasFirstDegreeFilter() {
    let urlHasFirstDegree = false;
    try {
      const network = JSON.parse(new URL(location.href).searchParams.get("network") || "[]");
      urlHasFirstDegree = Array.isArray(network) && network.includes("F");
    } catch {
      urlHasFirstDegree = false;
    }
    return urlHasFirstDegree && Boolean(document.querySelector(SELECTORS.firstDegreeFilter));
  }

  function searchStartUrl(value = location.href) {
    try {
      const url = new URL(value);
      url.pathname = ROUTES.search + "/";
      url.searchParams.delete("page");
      return url.href;
    } catch {
      return "https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=FACETED_SEARCH";
    }
  }

  async function openSection(section) {
    state.activeTab = section;
    if (isPeopleSearchPage()) state.collection.searchUrl = searchStartUrl();
    render();
    await persist();

    if (section === "collect" && !isPeopleSearchPage()) {
      location.assign(state.collection.searchUrl || searchStartUrl("https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=FACETED_SEARCH"));
    } else if (section === "remove" && !isConnectionsPage()) {
      location.assign(`https://www.linkedin.com${ROUTES.connections}/`);
    }
  }

  async function waitFor(getter, timeout = UI_TIMEOUT_MS, interval = POLL_INTERVAL_MS) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = getter();
      if (value) return value;
      await sleep(interval);
    }
    throw new Error("LinkedIn did not update within the time limit.");
  }

  async function persist() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        activeTab: state.activeTab,
        collection: {
          ...state.collection,
          mode: state.collection.mode === "running" ? "paused" : state.collection.mode,
          pauseRequested: false,
          stopRequested: false
        },
        removal: {
          ...state.removal,
          mode: state.removal.mode === "running" ? "paused" : state.removal.mode,
          pauseRequested: false,
          stopRequested: false
        }
      }
    });
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function parseNames(raw) {
    const seen = new Set();
    return raw.split(/\r?\n/).map((name) => name.trim()).filter((name) => {
      const key = normalize(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function cleanProfileName(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\([^()]*\/[^()]*\)\s*$/, "")
      .trim();
  }

  function getSearchResultCards() {
    return [...document.querySelectorAll(SELECTORS.searchResultCard)]
      .filter(visible)
      .filter((card) => card.querySelector('[id^="SearchResults"]'))
      .filter((card) => /(?:^|\s)•?\s*1st(?:\s|$)/i.test(card.innerText || ""));
  }

  function extractProfile(card) {
    const cardUrl = canonicalProfileUrl(card.href);
    const nameLink = [...card.querySelectorAll('p a[href*="/in/"]')]
      .find((link) => canonicalProfileUrl(link.href) === cardUrl);
    const name = cleanProfileName(nameLink?.innerText || nameLink?.textContent);
    if (!name || !cardUrl) return null;
    return {
      name,
      profileUrl: cardUrl,
      profileKey: cardUrl.toLocaleLowerCase(),
      degree: "1st",
      sourceUrl: location.href,
      sourcePage: getCurrentPage(),
      collectedAt: new Date().toISOString()
    };
  }

  function getCurrentPage() {
    const current = document.querySelector(SELECTORS.currentPage);
    const labelMatch = current?.getAttribute("aria-label")?.match(/(\d+)/);
    if (labelMatch) return Number(labelMatch[1]);
    return Number(new URL(location.href).searchParams.get("page")) || 1;
  }

  function getPageSignature() {
    return getSearchResultCards()
      .map((card) => canonicalProfileUrl(card.href))
      .filter(Boolean)
      .sort()
      .join("|");
  }

  function getNextButton() {
    const button = document.querySelector(SELECTORS.nextPage);
    if (!visible(button) || button.disabled || button.getAttribute("aria-disabled") === "true") return null;
    return button;
  }

  function captureCurrentPage() {
    const cards = getSearchResultCards();
    const existing = new Set(state.collection.profiles.map((profile) => profile.profileKey));
    let added = 0;
    let duplicates = 0;
    for (const card of cards) {
      const profile = extractProfile(card);
      if (!profile) continue;
      if (existing.has(profile.profileKey)) {
        duplicates += 1;
        continue;
      }
      existing.add(profile.profileKey);
      state.collection.profiles.push(profile);
      added += 1;
    }
    const page = getCurrentPage();
    if (!state.collection.pagesVisited.includes(page)) state.collection.pagesVisited.push(page);
    state.collection.currentPage = page;
    state.collection.duplicates += duplicates;
    state.collection.message = `Page ${page}: ${added} added, ${duplicates} duplicates skipped.`;
    render();
    persist();
    return { added, duplicates, cards: cards.length };
  }

  async function collectionCheckpoint() {
    while (state.collection.pauseRequested && !state.collection.stopRequested) {
      state.collection.mode = "paused";
      render();
      await sleep(200);
    }
    if (state.collection.stopRequested) throw new Error("__LCR_STOPPED__");
    if (!isPeopleSearchPage()) throw new Error("__LCR_WRONG_PAGE__");
  }

  async function runCollection() {
    if (!isPeopleSearchPage()) {
      state.collection.message = "Open a LinkedIn people search before collecting.";
      render();
      return;
    }
    if (!hasFirstDegreeFilter()) {
      state.collection.message = "Select the 1st connection filter before collecting.";
      render();
      return;
    }

    state.collection.mode = "running";
    state.collection.searchUrl = searchStartUrl();
    state.collection.pauseRequested = false;
    state.collection.stopRequested = false;
    state.collection.message = "Reading the current page...";
    render();

    try {
      for (let count = 0; count < MAX_COLLECTION_PAGES; count += 1) {
        await collectionCheckpoint();
        await waitFor(() => getSearchResultCards().length > 0);
        captureCurrentPage();
        await collectionCheckpoint();

        const next = getNextButton();
        if (!next) {
          state.collection.mode = "completed";
          state.collection.message = "Collection completed. Review the list before adding it to removal.";
          break;
        }

        const oldPage = getCurrentPage();
        const oldSignature = getPageSignature();
        state.collection.message = `Waiting for page ${oldPage + 1}...`;
        render();
        next.click();
        await waitFor(() => {
          const signature = getPageSignature();
          return getCurrentPage() !== oldPage && signature && signature !== oldSignature;
        });
      }
      if (state.collection.mode === "running") {
        state.collection.mode = "stopped";
        state.collection.message = `Stopped at the ${MAX_COLLECTION_PAGES}-page safety limit.`;
      }
    } catch (error) {
      if (error.message === "__LCR_STOPPED__") {
        state.collection.mode = "stopped";
        state.collection.message = "Collection stopped. Captured profiles were preserved.";
      } else if (error.message === "__LCR_WRONG_PAGE__") {
        state.collection.mode = "paused";
        state.collection.message = "Collection paused because you left the people search page.";
      } else {
        state.collection.mode = "error";
        state.collection.message = error.message || "Collection failed.";
      }
    }
    render();
    await persist();
  }

  function getConnectionCardName(card) {
    const link = [...card.querySelectorAll(SELECTORS.profileLink)].find((item) => visible(item) && item.innerText.trim());
    if (!link) return "";
    const paragraph = link.querySelector("p");
    return (paragraph?.innerText || link.innerText.split("\n")[0] || "").trim();
  }

  function findMatchingConnectionCards(name) {
    const expected = normalize(name);
    return [...document.querySelectorAll(SELECTORS.connectionCard)]
      .filter(visible)
      .filter((card) => normalize(getConnectionCardName(card)) === expected);
  }

  function findMoreButton(card, name) {
    return [...card.querySelectorAll("button")].find((button) => {
      const label = normalize(button.getAttribute("aria-label"));
      return label === normalize(`More actions for ${name}`) || label.startsWith("more actions for ");
    });
  }

  function dialogConfirmsName(dialog, fullName) {
    const dialogText = normalize(dialog?.innerText || dialog?.textContent);
    const normalizedFullName = normalize(fullName);
    if (dialogText.includes(normalizedFullName)) return true;
    const firstName = normalizedFullName.split(" ")[0];
    const words = dialogText.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return Boolean(firstName) && words.includes(firstName);
  }

  function findRemovalDialog() {
    return [...document.querySelectorAll(SELECTORS.dialog)]
      .filter(visible)
      .find((dialog) => [...dialog.querySelectorAll("button")]
        .some((button) => textMatches(button, ["Remove connection", "Remover conexão"])));
  }

  function findCancelButton() {
    const dialog = findRemovalDialog();
    return dialog && [...dialog.querySelectorAll("button")]
      .find((button) => textMatches(button, ["Cancel", "Cancelar"]));
  }

  function updateRemovalResult(index, status, message) {
    state.removal.results[index] = { name: state.removal.names[index], status, message };
    state.removal.message = message;
    render();
    persist();
  }

  async function removalCheckpoint() {
    while (state.removal.pauseRequested && !state.removal.stopRequested) {
      state.removal.mode = "paused";
      render();
      await sleep(200);
    }
    if (state.removal.stopRequested) throw new Error("__LCR_STOPPED__");
    if (!isConnectionsPage()) throw new Error("__LCR_WRONG_PAGE__");
  }

  async function processName(name, index) {
    updateRemovalResult(index, "processing", "Searching...");
    await removalCheckpoint();
    const search = await waitFor(() => document.querySelector(SELECTORS.connectionSearch));
    search.focus();
    setNativeInputValue(search, name);

    const matches = await waitFor(() => {
      const currentMatches = findMatchingConnectionCards(name);
      return currentMatches.length > 0 ? currentMatches : null;
    }).catch(() => []);
    if (matches.length === 0) {
      updateRemovalResult(index, "error", "No exact match found.");
      return;
    }
    if (matches.length > 1) {
      updateRemovalResult(index, "ambiguous", "Multiple exact matches; nobody was removed.");
      return;
    }

    const card = matches[0];
    const actualName = getConnectionCardName(card);
    const moreButton = findMoreButton(card, actualName);
    if (!moreButton) throw new Error("Actions button not found.");
    updateRemovalResult(index, "processing", "Opening actions menu...");
    await sleep(randomBetween(ACTION_DELAY_RANGE));
    await removalCheckpoint();
    moreButton.click();

    const menu = await waitFor(() => [...document.querySelectorAll(SELECTORS.menu)].find(visible));
    const removeItem = [...menu.querySelectorAll(SELECTORS.menuItem)]
      .find((item) => textMatches(item, ["Remove connection", "Remover conexão"]));
    if (!removeItem) throw new Error("Remove connection action not found.");
    updateRemovalResult(index, "processing", "Opening LinkedIn confirmation...");
    await sleep(randomBetween(ACTION_DELAY_RANGE));
    await removalCheckpoint();
    removeItem.click();

    const dialog = await waitFor(findRemovalDialog);
    if (!dialogConfirmsName(dialog, actualName)) {
      findCancelButton()?.click();
      throw new Error("The confirmation dialog did not match the expected name.");
    }
    const confirmButton = [...dialog.querySelectorAll("button")]
      .find((button) => textMatches(button, ["Remove connection", "Remover conexão"]));
    updateRemovalResult(index, "processing", "Confirming removal...");
    await sleep(randomBetween(ACTION_DELAY_RANGE));
    await removalCheckpoint();
    confirmButton.click();
    await waitFor(() => !document.body.contains(dialog) || !visible(dialog));
    updateRemovalResult(index, "removed", "Connection removed.");
  }

  async function runRemoval() {
    if (!isConnectionsPage()) {
      state.removal.message = "Open LinkedIn's Connections page before starting removal.";
      render();
      return;
    }
    removalLoopActive = true;
    state.removal.mode = "running";
    state.removal.pauseRequested = false;
    state.removal.stopRequested = false;
    render();

    for (; state.removal.index < state.removal.names.length; state.removal.index += 1) {
      const currentIndex = state.removal.index;
      try {
        await processName(state.removal.names[currentIndex], currentIndex);
      } catch (error) {
        if (error.message === "__LCR_STOPPED__") {
          updateRemovalResult(currentIndex, "stopped", "Stopped before removal.");
          break;
        }
        if (error.message === "__LCR_WRONG_PAGE__") {
          state.removal.mode = "paused";
          state.removal.message = "Removal paused because you left the Connections page.";
          break;
        }
        findCancelButton()?.click();
        updateRemovalResult(currentIndex, "error", error.message || "Unexpected error.");
      }
      if (state.removal.stopRequested || state.removal.mode === "paused") break;
      if (state.removal.index < state.removal.names.length - 1) await sleep(randomBetween(PERSON_DELAY_RANGE));
    }

    if (!state.removal.stopRequested && state.removal.index >= state.removal.names.length - 1 && state.removal.mode !== "paused") {
      state.removal.index = state.removal.names.length;
      state.removal.mode = "completed";
      state.removal.message = "Removal queue completed.";
    } else if (state.removal.stopRequested) {
      state.removal.mode = "stopped";
    }
    removalLoopActive = false;
    render();
    await persist();
  }

  function showConfirmation({ title, body, warning, confirmText, danger = false }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "lcr-modal-backdrop";
      backdrop.innerHTML = `
        <section class="lcr-modal" role="dialog" aria-modal="true" aria-labelledby="lcr-confirm-title">
          <h2 id="lcr-confirm-title"></h2><p class="lcr-modal-copy"></p>
          ${warning ? '<p class="lcr-warning"></p>' : ""}
          <div class="lcr-modal-actions">
            <button class="lcr-button lcr-button-tertiary lcr-cancel" type="button">Cancel</button>
            <button class="lcr-button ${danger ? "lcr-button-danger" : "lcr-button-primary"} lcr-confirm" type="button"></button>
          </div>
        </section>`;
      backdrop.querySelector("h2").textContent = title;
      backdrop.querySelector(".lcr-modal-copy").textContent = body;
      if (warning) backdrop.querySelector(".lcr-warning").textContent = warning;
      backdrop.querySelector(".lcr-confirm").textContent = confirmText;
      document.documentElement.appendChild(backdrop);
      backdrop.querySelector(".lcr-cancel").addEventListener("click", () => { backdrop.remove(); resolve(false); });
      backdrop.querySelector(".lcr-confirm").addEventListener("click", () => { backdrop.remove(); resolve(true); });
      backdrop.querySelector(".lcr-cancel").focus();
    });
  }

  function addCollectedToRemoval() {
    const names = state.collection.profiles.map((profile) => profile.name);
    const merged = parseNames([...state.removal.names, ...names].join("\n"));
    state.removal.names = merged;
    state.removal.index = 0;
    state.removal.results = merged.map((name) => ({ name, status: "waiting", message: "Waiting" }));
    state.removal.mode = "idle";
    state.removal.message = `${names.length} collected profiles added to the removal queue.`;
    state.activeTab = "remove";
    syncTextarea();
    render();
    persist();
  }

  function clearProcessed() {
    const processed = new Set(["removed", "error", "ambiguous", "stopped"]);
    const pending = state.removal.results.filter((result) => !processed.has(result.status));
    state.removal.names = pending.map((result) => result.name);
    state.removal.results = pending.map((result) => ({ ...result, status: "waiting", message: "Waiting" }));
    state.removal.index = 0;
    state.removal.mode = "idle";
    state.removal.pauseRequested = false;
    state.removal.stopRequested = false;
    state.removal.message = "Processed results cleared from local history.";
    syncTextarea();
    render();
    persist();
  }

  function clearCollected() {
    state.collection.profiles = [];
    state.collection.pagesVisited = [];
    state.collection.duplicates = 0;
    state.collection.currentPage = 0;
    state.collection.mode = "idle";
    state.collection.message = "Collected profiles cleared from local storage.";
    render();
    persist();
  }

  function syncTextarea() {
    const textarea = document.querySelector("#lcr-names");
    if (textarea) textarea.value = state.removal.names.join("\n");
  }

  function statusLabel(mode) {
    return ({ idle: "Ready", running: "Running", paused: "Paused", stopped: "Stopped", completed: "Completed", error: "Error" })[mode] || mode;
  }

  function render() {
    const root = document.querySelector("#lcr-root");
    if (!root) return;
    root.dataset.page = isPeopleSearchPage() ? "search" : isConnectionsPage() ? "connections" : "unsupported";
    root.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === state.activeTab));
    root.querySelectorAll("[data-panel]").forEach((panel) => panel.hidden = panel.dataset.panel !== state.activeTab);

    const collectionRunning = ["running", "paused"].includes(state.collection.mode);
    root.querySelector("[data-action=collect]").disabled = state.collection.mode === "running" || !isPeopleSearchPage();
    root.querySelector("[data-action=collect-pause]").disabled = state.collection.mode !== "running";
    root.querySelector("[data-action=collect-stop]").disabled = !collectionRunning;
    root.querySelector("[data-action=add-to-removal]").disabled = !state.collection.profiles.length || collectionRunning;
    root.querySelector("[data-action=clear-collected]").disabled = !state.collection.profiles.length || collectionRunning;
    root.querySelector(".lcr-collect-state").textContent = statusLabel(state.collection.mode);
    root.querySelector(".lcr-collect-page").textContent = `Page ${state.collection.currentPage || getCurrentPage()}`;
    root.querySelector(".lcr-collect-count").textContent = String(state.collection.profiles.length);
    root.querySelector(".lcr-duplicate-count").textContent = String(state.collection.duplicates);
    root.querySelector(".lcr-collect-message").textContent = state.collection.message;
    root.querySelector(".lcr-profile-list").innerHTML = state.collection.profiles.slice(-50).reverse().map((profile) => `
      <div class="lcr-profile"><div><strong></strong><small></small></div><span class="lcr-badge">1st</span></div>`).join("");
    [...root.querySelectorAll(".lcr-profile")].forEach((row, index) => {
      const profile = [...state.collection.profiles].slice(-50).reverse()[index];
      row.querySelector("strong").textContent = profile.name;
      row.querySelector("small").textContent = profile.profileUrl.replace("https://www.linkedin.com/in/", "linkedin.com/in/");
    });

    const removalRunning = ["running", "paused"].includes(state.removal.mode);
    root.querySelector("#lcr-names").disabled = removalRunning;
    root.querySelector("[data-action=remove-run]").disabled = state.removal.mode === "running" || !isConnectionsPage();
    root.querySelector("[data-action=remove-pause]").disabled = state.removal.mode !== "running";
    root.querySelector("[data-action=remove-stop]").disabled = !removalRunning;
    root.querySelector("[data-action=clear-processed]").disabled = removalLoopActive || state.removal.mode === "running" || !state.removal.results.some((result) => ["removed", "error", "ambiguous", "stopped"].includes(result.status));
    root.querySelector(".lcr-remove-state").textContent = statusLabel(state.removal.mode);
    root.querySelector(".lcr-remove-progress").textContent = `${Math.min(state.removal.index, state.removal.names.length)} / ${state.removal.names.length}`;
    root.querySelector(".lcr-remove-message").textContent = state.removal.message;
    root.querySelector(".lcr-results").innerHTML = state.removal.results.map((result) => `
      <div class="lcr-result" data-status="${result.status}"><span class="lcr-dot"></span><div><strong></strong><small></small></div></div>`).join("");
    [...root.querySelectorAll(".lcr-result")].forEach((row, index) => {
      row.querySelector("strong").textContent = state.removal.results[index].name;
      row.querySelector("small").textContent = state.removal.results[index].message;
    });
  }

  function createPanel() {
    const root = document.createElement("aside");
    root.id = "lcr-root";
    root.innerHTML = `
      <header class="lcr-header"><div class="lcr-brand"><span class="lcr-brand-mark">in</span><div><h2>Connection Remover</h2><p>Collect. Review. Remove.</p></div></div><button class="lcr-icon-button lcr-close" type="button" aria-label="Close panel">×</button></header>
      <nav class="lcr-tabs" aria-label="Extension sections"><button data-tab="collect" type="button">Collect</button><button data-tab="remove" type="button">Remove</button></nav>
      <section class="lcr-panel" data-panel="collect">
        <div class="lcr-context"><span class="lcr-context-icon">1st</span><div><strong>Filtered people search</strong><p>Only first-degree connections are collected.</p></div></div>
        <div class="lcr-metrics"><div><strong class="lcr-collect-count">0</strong><span>Collected</span></div><div><strong class="lcr-duplicate-count">0</strong><span>Duplicates</span></div><div><strong class="lcr-collect-page">Page 1</strong><span>Current</span></div></div>
        <div class="lcr-controls"><button class="lcr-button lcr-button-primary" data-action="collect" type="button"><span class="lcr-play-icon">▶</span> Collect all pages</button><button class="lcr-button lcr-button-secondary lcr-square" data-action="collect-pause" type="button" aria-label="Pause collection">Ⅱ</button><button class="lcr-button lcr-button-tertiary lcr-square lcr-stop-icon" data-action="collect-stop" type="button" aria-label="Stop collection">■</button></div>
        <div class="lcr-status"><strong class="lcr-collect-state">Ready</strong><p class="lcr-collect-message">Ready to collect the current filtered search.</p></div>
        <div class="lcr-section-heading"><h3>Collected profiles</h3><div class="lcr-heading-actions"><span>Latest 50</span><button class="lcr-text-button" data-action="clear-collected" type="button">Clear</button></div></div><div class="lcr-profile-list lcr-scroll-list"><div class="lcr-empty">No profiles collected yet.</div></div>
        <button class="lcr-button lcr-button-secondary lcr-full" data-action="add-to-removal" type="button">Add collected profiles to removal</button>
      </section>
      <section class="lcr-panel" data-panel="remove" hidden>
        <label class="lcr-label" for="lcr-names">Removal queue</label><textarea class="lcr-textarea" id="lcr-names" placeholder="One exact name per line"></textarea><p class="lcr-hint">Collected profiles and manually entered names remain separate from the collection action until you start removal.</p>
        <div class="lcr-controls"><button class="lcr-button lcr-button-primary" data-action="remove-run" type="button"><span class="lcr-play-icon">▶</span> Run removal</button><button class="lcr-button lcr-button-secondary lcr-square" data-action="remove-pause" type="button" aria-label="Pause removal">Ⅱ</button><button class="lcr-button lcr-button-tertiary lcr-square lcr-stop-icon" data-action="remove-stop" type="button" aria-label="Stop removal">■</button></div>
        <div class="lcr-status"><div class="lcr-status-line"><strong class="lcr-remove-state">Ready</strong><span class="lcr-remove-progress">0 / 0</span></div><p class="lcr-remove-message">No removal in progress.</p></div>
        <div class="lcr-section-heading"><h3>Queue results</h3><button class="lcr-text-button" data-action="clear-processed" type="button">Clear processed</button></div><div class="lcr-results lcr-scroll-list"><div class="lcr-empty">No queue results yet.</div></div>
      </section>`;
    document.documentElement.appendChild(root);

    root.querySelector(".lcr-close").addEventListener("click", () => root.classList.add("lcr-hidden"));
    root.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => openSection(button.dataset.tab)));
    root.querySelector("[data-action=collect]").addEventListener("click", () => {
      if (state.collection.mode === "paused") {
        state.collection.pauseRequested = false;
        state.collection.mode = "running";
        render();
        return;
      }
      runCollection();
    });
    root.querySelector("[data-action=collect-pause]").addEventListener("click", () => { state.collection.pauseRequested = true; state.collection.mode = "paused"; render(); persist(); });
    root.querySelector("[data-action=collect-stop]").addEventListener("click", () => { state.collection.stopRequested = true; state.collection.pauseRequested = false; state.collection.mode = "stopped"; state.collection.message = "Stopping collection..."; render(); persist(); });
    root.querySelector("[data-action=add-to-removal]").addEventListener("click", addCollectedToRemoval);
    root.querySelector("[data-action=clear-collected]").addEventListener("click", async () => {
      const confirmed = await showConfirmation({ title: "Clear collected profiles?", body: "This removes the collected profile list from local extension storage.", warning: "Profiles already added to the removal queue will not be changed.", confirmText: "Clear profiles" });
      if (confirmed) clearCollected();
    });
    root.querySelector("[data-action=remove-run]").addEventListener("click", async () => {
      if (state.removal.mode === "paused") {
        state.removal.pauseRequested = false;
        state.removal.mode = "running";
        render();
        return;
      }
      const names = parseNames(root.querySelector("#lcr-names").value);
      if (!names.length) { state.removal.message = "Add at least one name to the queue."; render(); return; }
      const confirmed = await showConfirmation({ title: "Confirm connection removal", body: `You are about to process ${names.length} connection(s).`, warning: "This removes real LinkedIn connections and cannot be undone by this extension.", confirmText: "Start removal", danger: true });
      if (!confirmed) return;
      state.removal.names = names;
      state.removal.index = 0;
      state.removal.results = names.map((name) => ({ name, status: "waiting", message: "Waiting" }));
      runRemoval();
    });
    root.querySelector("[data-action=remove-pause]").addEventListener("click", () => { state.removal.pauseRequested = true; state.removal.mode = "paused"; render(); persist(); });
    root.querySelector("[data-action=remove-stop]").addEventListener("click", () => { state.removal.stopRequested = true; state.removal.pauseRequested = false; findCancelButton()?.click(); state.removal.mode = "stopped"; state.removal.message = "Stopping removal..."; render(); persist(); });
    root.querySelector("[data-action=clear-processed]").addEventListener("click", async () => {
      const confirmed = await showConfirmation({ title: "Clear processed results?", body: "This removes completed and failed entries from local extension history only.", warning: "This does not change any LinkedIn connection.", confirmText: "Clear processed" });
      if (confirmed) clearProcessed();
    });
    return root;
  }

  let lastRoute = location.pathname;
  function monitorRoute() {
    if (location.pathname === lastRoute) return;
    lastRoute = location.pathname;
    if (state.collection.mode === "running" && !isPeopleSearchPage()) {
      state.collection.pauseRequested = true;
      state.collection.mode = "paused";
      state.collection.message = "Collection paused because you left the people search page.";
    }
    if (state.removal.mode === "running" && !isConnectionsPage()) {
      state.removal.pauseRequested = true;
      state.removal.mode = "paused";
      state.removal.message = "Removal paused because you left the Connections page.";
    }
    render();
    persist();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "LCR_TOGGLE_PANEL") return;
    document.querySelector("#lcr-root")?.classList.toggle("lcr-hidden");
  });

  const panel = createPanel();
  chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]).then((saved) => {
    const previous = saved[STORAGE_KEY];
    if (previous?.collection) Object.assign(state.collection, previous.collection, { pauseRequested: false, stopRequested: false });
    if (previous?.removal) Object.assign(state.removal, previous.removal, { pauseRequested: false, stopRequested: false });
    if (saved[LEGACY_STORAGE_KEY] && !previous?.removal) {
      const legacy = saved[LEGACY_STORAGE_KEY];
      Object.assign(state.removal, { names: legacy.names || [], index: legacy.index || 0, results: legacy.results || [], mode: legacy.mode || "idle" });
    }
    state.activeTab = isPeopleSearchPage() ? "collect" : "remove";
    if (isPeopleSearchPage()) state.collection.searchUrl = searchStartUrl();
    syncTextarea();
    render();
  });
  setInterval(monitorRoute, 500);
})();

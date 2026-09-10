(() => {
  "use strict";

  if (window.__linkedinConnectionRemoverLoaded) return;
  window.__linkedinConnectionRemoverLoaded = true;

  const STORAGE_KEY = "lcrStateV1";
  const SEARCH_SETTLE_MS = 750;
  const ACTION_DELAY_RANGE = [300, 600];
  const PERSON_DELAY_RANGE = [1200, 2000];
  const SELECTORS = {
    search: [
      '[componentkey="connectionsListTypeahead_ConnectionsListTypeahead"] input[data-testid="typeahead-input"]',
      'main input[placeholder="Search by name"]',
      'input[placeholder="Search by name"]'
    ].join(", "),
    card: '[componentkey^="ConnectionCard_"]',
    profileLink: 'a[href*="linkedin.com/in/"], a[href^="/in/"]',
    menu: '[role="menu"]',
    menuItem: '[role="menuitem"]',
    dialog: '[role="dialog"], [role="alertdialog"], dialog'
  };

  const state = {
    mode: "idle",
    names: [],
    index: 0,
    results: [],
    stopRequested: false,
    pauseRequested: false
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomBetween = ([min, max]) => Math.floor(min + Math.random() * (max - min + 1));
  const normalize = (value) => (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();

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

  function dialogConfirmsName(dialog, fullName) {
    const dialogText = normalize(dialog?.innerText || dialog?.textContent);
    const normalizedFullName = normalize(fullName);
    if (dialogText.includes(normalizedFullName)) return true;

    // O modal atual do LinkedIn costuma exibir somente o primeiro nome,
    // mesmo quando o card e a busca mostram o nome completo.
    const firstName = normalizedFullName.split(" ")[0];
    if (!firstName) return false;
    const words = dialogText.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return words.includes(firstName);
  }

  function findRemovalDialog() {
    return [...document.querySelectorAll(SELECTORS.dialog)]
      .filter(visible)
      .find((dialog) => [...dialog.querySelectorAll("button")]
        .some((button) => textMatches(button, ["Remove connection", "Remover conexão"])));
  }

  async function waitFor(getter, timeout = 10000, interval = 200) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = getter();
      if (value) return value;
      await sleep(interval);
    }
    throw new Error("Tempo esgotado aguardando a interface do LinkedIn.");
  }

  async function persist() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        names: state.names,
        index: state.index,
        results: state.results,
        mode: state.mode === "running" ? "paused" : state.mode
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

  function getCardName(card) {
    const link = [...card.querySelectorAll(SELECTORS.profileLink)].find((item) => visible(item) && item.innerText.trim());
    if (!link) return "";
    const paragraph = link.querySelector("p");
    return (paragraph?.innerText || link.innerText.split("\n")[0] || "").trim();
  }

  function findMatchingCards(name) {
    const expected = normalize(name);
    return [...document.querySelectorAll(SELECTORS.card)]
      .filter(visible)
      .filter((card) => normalize(getCardName(card)) === expected);
  }

  function findMoreButton(card, name) {
    return [...card.querySelectorAll("button")].find((button) => {
      const label = normalize(button.getAttribute("aria-label"));
      return label === normalize(`More actions for ${name}`) || label.startsWith("more actions for ");
    });
  }

  function updateResult(index, status, message) {
    state.results[index] = { name: state.names[index], status, message };
    render();
    persist();
  }

  async function waitWhilePaused() {
    while (state.pauseRequested && !state.stopRequested) {
      state.mode = "paused";
      render();
      await sleep(250);
    }
    if (!state.stopRequested) state.mode = "running";
  }

  async function checkpoint() {
    await waitWhilePaused();
    if (state.stopRequested) throw new Error("__LCR_STOPPED__");
  }

  function findCancelButton() {
    const dialog = findRemovalDialog();
    if (!dialog) return null;
    return [...dialog.querySelectorAll("button")].find((button) => textMatches(button, ["Cancel", "Cancelar"]));
  }

  async function stopSafely() {
    state.stopRequested = true;
    state.pauseRequested = false;
    const cancel = findCancelButton();
    if (cancel) cancel.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    state.mode = "stopped";
    render();
    await persist();
  }

  async function processName(name, index) {
    updateResult(index, "processing", "Pesquisando…");
    await checkpoint();

    const search = await waitFor(() => document.querySelector(SELECTORS.search));
    search.focus();
    setNativeInputValue(search, name);
    await sleep(SEARCH_SETTLE_MS);
    await checkpoint();

    const matches = findMatchingCards(name);
    if (matches.length === 0) {
      updateResult(index, "error", "Não encontrado com correspondência exata.");
      return;
    }
    if (matches.length > 1) {
      updateResult(index, "ambiguous", "Mais de um resultado exato; ninguém foi removido.");
      return;
    }

    const card = matches[0];
    const actualName = getCardName(card);
    if (normalize(actualName) !== normalize(name)) throw new Error("O nome do card não corresponde à busca.");

    const moreButton = findMoreButton(card, actualName);
    if (!moreButton) throw new Error("Botão de três pontos não encontrado.");
    updateResult(index, "processing", "Abrindo menu de ações…");
    await sleep(randomBetween(ACTION_DELAY_RANGE));
    await checkpoint();
    moreButton.click();

    const menu = await waitFor(() => [...document.querySelectorAll(SELECTORS.menu)].find(visible));
    const removeItem = [...menu.querySelectorAll(SELECTORS.menuItem)]
      .find((item) => textMatches(item, ["Remove connection", "Remover conexão"]));
    if (!removeItem) throw new Error("Opção de remover conexão não encontrada.");

    updateResult(index, "processing", "Abrindo confirmação do LinkedIn…");
    await sleep(randomBetween(ACTION_DELAY_RANGE));
    await checkpoint();
    removeItem.click();

    const dialog = await waitFor(findRemovalDialog, 10000);
    if (!dialogConfirmsName(dialog, actualName)) {
      findCancelButton()?.click();
      throw new Error("O modal não confirmou o nome esperado; operação cancelada.");
    }

    const confirmButton = [...dialog.querySelectorAll("button")]
      .find((button) => textMatches(button, ["Remove connection", "Remover conexão"]));
    if (!confirmButton) throw new Error("Botão final de confirmação não encontrado.");

    updateResult(index, "processing", "Aguardando confirmação final…");
    await sleep(randomBetween(ACTION_DELAY_RANGE));
    await checkpoint();
    confirmButton.click();

    await waitFor(() => !document.body.contains(dialog) || !visible(dialog), 12000);
    updateResult(index, "removed", "Conexão removida.");
  }

  async function runQueue() {
    state.mode = "running";
    state.stopRequested = false;
    state.pauseRequested = false;
    render();

    for (; state.index < state.names.length; state.index += 1) {
      const currentIndex = state.index;
      try {
        await processName(state.names[currentIndex], currentIndex);
      } catch (error) {
        if (error.message === "__LCR_STOPPED__") {
          updateResult(currentIndex, "stopped", "Execução interrompida antes da remoção.");
          break;
        }
        findCancelButton()?.click();
        updateResult(currentIndex, "error", error.message || "Erro inesperado.");
      }

      await persist();
      if (state.stopRequested) break;
      if (state.index < state.names.length - 1) {
        await sleep(randomBetween(PERSON_DELAY_RANGE));
        await checkpoint().catch(() => {});
      }
      if (state.stopRequested) break;
    }

    if (!state.stopRequested && state.index >= state.names.length - 1) {
      state.index = state.names.length;
      state.mode = "completed";
    } else if (state.stopRequested) {
      state.mode = "stopped";
    }
    render();
    await persist();
  }

  function showConfirmation(names) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "lcr-modal-backdrop";
      backdrop.innerHTML = `
        <section class="lcr-modal" role="dialog" aria-modal="true" aria-labelledby="lcr-confirm-title">
          <h2 id="lcr-confirm-title">Confirmar remoções</h2>
          <p>Você está prestes a processar <strong>${names.length}</strong> conexão(ões).</p>
          <p class="lcr-warning">Esta ação remove conexões reais do LinkedIn e não pode ser desfeita pela extensão.</p>
          <div class="lcr-modal-actions">
            <button class="lcr-modal-button lcr-cancel" type="button">Cancelar</button>
            <button class="lcr-modal-button lcr-confirm" type="button">Sim, iniciar</button>
          </div>
        </section>`;
      document.documentElement.appendChild(backdrop);
      backdrop.querySelector(".lcr-cancel").addEventListener("click", () => { backdrop.remove(); resolve(false); });
      backdrop.querySelector(".lcr-confirm").addEventListener("click", () => { backdrop.remove(); resolve(true); });
      backdrop.querySelector(".lcr-cancel").focus();
    });
  }

  function render() {
    const root = document.querySelector("#lcr-root");
    if (!root) return;
    const running = ["running", "paused"].includes(state.mode);
    root.querySelector("textarea").disabled = running;
    root.querySelector("[data-action=play]").disabled = state.mode === "running";
    root.querySelector("[data-action=pause]").disabled = state.mode !== "running";
    root.querySelector("[data-action=stop]").disabled = !running;
    root.querySelector(".lcr-state").textContent = ({
      idle: "Pronto", running: "Executando", paused: "Pausado", stopped: "Interrompido", completed: "Concluído"
    })[state.mode] || state.mode;
    root.querySelector(".lcr-progress").textContent = `${Math.min(state.index, state.names.length)} / ${state.names.length}`;
    root.querySelector(".lcr-current").textContent = running && state.names[state.index]
      ? `Atual: ${state.names[state.index]}` : "Nenhuma remoção em andamento";
    root.querySelector(".lcr-results").innerHTML = state.results.map((result) => `
      <div class="lcr-result" data-status="${result.status}">
        <span class="lcr-dot"></span>
        <div><div class="lcr-result-name"></div><div class="lcr-result-message"></div></div>
      </div>`).join("");
    [...root.querySelectorAll(".lcr-result")].forEach((row, index) => {
      row.querySelector(".lcr-result-name").textContent = state.results[index].name;
      row.querySelector(".lcr-result-message").textContent = state.results[index].message;
    });
  }

  function createPanel() {
    const root = document.createElement("aside");
    root.id = "lcr-root";
    root.innerHTML = `
      <header class="lcr-header">
        <h2 class="lcr-title">Connection Remover</h2>
        <button class="lcr-close" type="button" aria-label="Fechar painel">×</button>
      </header>
      <div class="lcr-body">
        <label class="lcr-label" for="lcr-names">Uma pessoa por linha</label>
        <textarea class="lcr-textarea" id="lcr-names" placeholder="Maria Silva&#10;João Souza"></textarea>
        <p class="lcr-hint">Somente nomes com correspondência exata serão processados.</p>
        <div class="lcr-controls">
          <button class="lcr-control lcr-play" data-action="play" type="button" title="Iniciar ou continuar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Run</span>
          </button>
          <button class="lcr-control lcr-pause" data-action="pause" type="button" title="Pausar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span>Pause</span>
          </button>
          <button class="lcr-control lcr-stop" data-action="stop" type="button" title="Parar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg><span>Stop</span>
          </button>
        </div>
        <div class="lcr-status" aria-live="polite">
          <span class="lcr-state">Pronto</span><span class="lcr-progress">0 / 0</span>
          <span class="lcr-current">Nenhuma remoção em andamento</span>
        </div>
        <div class="lcr-results"></div>
      </div>`;
    document.documentElement.appendChild(root);

    root.querySelector(".lcr-close").addEventListener("click", () => root.classList.add("lcr-hidden"));
    root.querySelector("[data-action=play]").addEventListener("click", async () => {
      if (state.mode === "paused") {
        state.pauseRequested = false;
        state.mode = "running";
        render();
        return;
      }
      if (state.mode === "running") return;
      const names = parseNames(root.querySelector("textarea").value);
      if (!names.length) {
        alert("Cole pelo menos um nome, um por linha.");
        return;
      }
      if (!(await showConfirmation(names))) return;
      state.names = names;
      state.index = 0;
      state.results = names.map((name) => ({ name, status: "waiting", message: "Aguardando" }));
      runQueue();
    });
    root.querySelector("[data-action=pause]").addEventListener("click", () => {
      state.pauseRequested = true;
      state.mode = "paused";
      render();
      persist();
    });
    root.querySelector("[data-action=stop]").addEventListener("click", stopSafely);
    return root;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "LCR_TOGGLE_PANEL") return;
    document.querySelector("#lcr-root")?.classList.toggle("lcr-hidden");
  });

  const panel = createPanel();
  chrome.storage.local.get(STORAGE_KEY).then((saved) => {
    const previous = saved[STORAGE_KEY];
    if (!previous) return;
    state.names = Array.isArray(previous.names) ? previous.names : [];
    state.index = Number.isInteger(previous.index) ? previous.index : 0;
    state.results = Array.isArray(previous.results) ? previous.results : [];
    state.mode = previous.mode === "running" ? "paused" : (previous.mode || "idle");
    panel.querySelector("textarea").value = state.names.join("\n");
    render();
  });
})();

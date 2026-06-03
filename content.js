(() => {
  "use strict";

  const HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const host = window.location.hostname.replace(/^www\./, "");

  if (!HOSTS.has(host) || window.__chatgptBulkDeleteLoaded) {
    return;
  }

  window.__chatgptBulkDeleteLoaded = true;

  const EXT = "cgptbd";
  const CHAT_LINK_SELECTOR = [
    'a[href^="/c/"]',
    'a[href*="chatgpt.com/c/"]',
    'a[href*="chat.openai.com/c/"]'
  ].join(",");

  const state = {
    selecting: false,
    deleting: false,
    selected: new Map(),
    accessToken: null,
    observer: null,
    refreshTimer: null,
    panel: null
  };

  function boot() {
    if (!document.body) {
      window.setTimeout(boot, 50);
      return;
    }

    ensurePanel();
    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    scheduleRefresh();
  }

  function ensurePanel() {
    if (state.panel && document.body.contains(state.panel)) {
      return state.panel;
    }

    const panel = document.createElement("section");
    panel.className = `${EXT}-panel`;
    panel.setAttribute("aria-label", "ChatGPT bulk delete controls");

    const header = document.createElement("div");
    header.className = `${EXT}-header`;

    const title = document.createElement("span");
    title.className = `${EXT}-title`;
    title.textContent = "Bulk delete";

    const count = document.createElement("span");
    count.className = `${EXT}-count`;
    count.dataset.cgptbdCount = "";
    count.textContent = "0 selected";

    header.append(title, count);

    const actions = document.createElement("div");
    actions.className = `${EXT}-actions`;

    actions.append(
      makePanelButton("toggle", "Select chats", `${EXT}-primary`),
      makePanelButton("select-shown", "Select shown", "", true),
      makePanelButton("clear", "Clear", "", true),
      makePanelButton("delete", "Delete", `${EXT}-danger`, true)
    );

    const status = document.createElement("div");
    status.className = `${EXT}-status`;
    status.dataset.cgptbdStatus = "";
    status.setAttribute("aria-live", "polite");

    panel.append(header, actions, status);

    panel.addEventListener("click", onPanelClick);
    document.body.append(panel);
    state.panel = panel;
    updatePanel();
    return panel;
  }

  function makePanelButton(action, label, className, hidden = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cgptbdAction = action;
    button.textContent = label;

    if (className) {
      button.className = className;
    }

    if (hidden) {
      button.hidden = true;
    }

    return button;
  }

  function onPanelClick(event) {
    const button = event.target.closest(`button[data-${EXT}-action]`);
    if (!button || state.deleting) {
      return;
    }

    const action = button.getAttribute(`data-${EXT}-action`);
    if (action === "toggle") {
      if (state.selecting) {
        stopSelecting();
      } else {
        startSelecting();
      }
      return;
    }

    if (action === "select-shown") {
      selectShownChats();
      return;
    }

    if (action === "clear") {
      clearSelection();
      return;
    }

    if (action === "delete") {
      void confirmAndDelete();
    }
  }

  function startSelecting() {
    state.selecting = true;
    setStatus("Select chats from the sidebar.");
    scheduleRefresh();
    updatePanel();
  }

  function stopSelecting() {
    state.selecting = false;
    clearSelection();
    cleanupDecorations();
    setStatus("");
    updatePanel();
  }

  function clearSelection() {
    state.selected.clear();
    syncAllDecorations();
    updatePanel();
  }

  function selectShownChats() {
    let added = 0;
    for (const link of findChatLinks()) {
      const id = getConversationId(link);
      if (id && !state.selected.has(id)) {
        state.selected.set(id, getConversationData(link, id));
        added += 1;
      }
    }

    syncAllDecorations();
    updatePanel();
    setStatus(added > 0 ? `Selected ${added} shown chat${added === 1 ? "" : "s"}.` : "No new shown chats found.");
  }

  function scheduleRefresh() {
    if (!state.selecting || state.refreshTimer) {
      return;
    }

    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = null;
      refreshDecorations();
    }, 120);
  }

  function refreshDecorations() {
    if (!state.selecting) {
      return;
    }

    for (const link of findChatLinks()) {
      decorateLink(link);
    }
  }

  function findChatLinks() {
    const seen = new Set();
    const links = [];

    for (const link of document.querySelectorAll(CHAT_LINK_SELECTOR)) {
      const id = getConversationId(link);
      if (!id || seen.has(id) || !isLikelySidebarChatLink(link)) {
        continue;
      }

      seen.add(id);
      links.push(link);
    }

    return links;
  }

  function getConversationId(linkOrHref) {
    const href = typeof linkOrHref === "string"
      ? linkOrHref
      : linkOrHref.getAttribute("href") || linkOrHref.href || "";

    try {
      const url = new URL(href, window.location.origin);
      const urlHost = url.hostname.replace(/^www\./, "");
      if (!HOSTS.has(urlHost)) {
        return null;
      }

      const match = url.pathname.match(/^\/c\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_error) {
      return null;
    }
  }

  function getConversationData(link, id) {
    const title = normalizeText(link.textContent) || "Untitled chat";
    return {
      id,
      title,
      url: new URL(`/c/${encodeURIComponent(id)}`, window.location.origin).href
    };
  }

  function isLikelySidebarChatLink(link) {
    if (link.closest(`.${EXT}-panel`) || link.closest('[role="dialog"]')) {
      return false;
    }

    const rect = link.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 12) {
      return false;
    }

    if (hasSidebarAncestor(link)) {
      return true;
    }

    const maxSidebarRight = Math.min(520, Math.max(300, window.innerWidth * 0.45));
    return rect.left < maxSidebarRight && rect.width <= 540 && rect.height <= 84;
  }

  function hasSidebarAncestor(element) {
    let current = element.parentElement;
    while (current && current !== document.body) {
      const tagName = current.tagName.toLowerCase();
      const role = (current.getAttribute("role") || "").toLowerCase();
      const label = (current.getAttribute("aria-label") || "").toLowerCase();
      const testId = (current.getAttribute("data-testid") || "").toLowerCase();
      const id = (current.id || "").toLowerCase();

      if (
        tagName === "nav" ||
        tagName === "aside" ||
        role === "navigation" ||
        label.includes("history") ||
        label.includes("sidebar") ||
        testId.includes("history") ||
        testId.includes("sidebar") ||
        id.includes("history") ||
        id.includes("sidebar")
      ) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function decorateLink(link) {
    const id = getConversationId(link);
    if (!id) {
      return;
    }

    if (link.dataset.cgptbdDecorated === "true") {
      syncLinkDecoration(link);
      return;
    }

    const selector = document.createElement("span");
    selector.className = `${EXT}-selector`;
    selector.setAttribute("role", "checkbox");
    selector.setAttribute("aria-checked", "false");
    selector.setAttribute("aria-label", `Select ${normalizeText(link.textContent) || "chat"}`);
    selector.tabIndex = 0;

    selector.addEventListener("pointerdown", stopEvent);
    selector.addEventListener("mousedown", stopEvent);
    selector.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection(id, link);
    });
    selector.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        toggleSelection(id, link);
      }
    });

    link.classList.add(`${EXT}-chat-link`);
    link.dataset.cgptbdDecorated = "true";
    link.dataset.cgptbdId = id;
    link.insertBefore(selector, link.firstChild);
    syncLinkDecoration(link);
  }

  function stopEvent(event) {
    event.stopPropagation();
  }

  function toggleSelection(id, link) {
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      state.selected.set(id, getConversationData(link, id));
    }

    syncDecorationsForId(id);
    updatePanel();
  }

  function syncDecorationsForId(id) {
    for (const link of document.querySelectorAll(`a[data-${EXT}-id]`)) {
      if (link.dataset.cgptbdId === id) {
        syncLinkDecoration(link);
      }
    }
  }

  function syncAllDecorations() {
    for (const link of document.querySelectorAll(`a[data-${EXT}-id]`)) {
      syncLinkDecoration(link);
    }
  }

  function syncLinkDecoration(link) {
    const id = link.dataset.cgptbdId || getConversationId(link);
    const selector = link.querySelector(`:scope > .${EXT}-selector`);
    if (!id || !selector) {
      return;
    }

    selector.setAttribute("aria-checked", state.selected.has(id) ? "true" : "false");
  }

  function cleanupDecorations() {
    for (const selector of document.querySelectorAll(`.${EXT}-selector`)) {
      selector.remove();
    }

    for (const link of document.querySelectorAll(`a.${EXT}-chat-link`)) {
      link.classList.remove(`${EXT}-chat-link`);
      delete link.dataset.cgptbdDecorated;
      delete link.dataset.cgptbdId;
    }
  }

  function updatePanel() {
    const panel = ensurePanel();
    const count = state.selected.size;
    const selecting = state.selecting;
    const deleting = state.deleting;

    const countElement = panel.querySelector(`[data-${EXT}-count]`);
    const toggleButton = panel.querySelector(`[data-${EXT}-action="toggle"]`);
    const selectShownButton = panel.querySelector(`[data-${EXT}-action="select-shown"]`);
    const clearButton = panel.querySelector(`[data-${EXT}-action="clear"]`);
    const deleteButton = panel.querySelector(`[data-${EXT}-action="delete"]`);

    countElement.textContent = `${count} selected`;
    toggleButton.textContent = selecting ? "Cancel" : "Select chats";
    toggleButton.disabled = deleting;
    selectShownButton.hidden = !selecting;
    clearButton.hidden = !selecting;
    deleteButton.hidden = !selecting;
    selectShownButton.disabled = deleting;
    clearButton.disabled = deleting || count === 0;
    deleteButton.disabled = deleting || count === 0;
  }

  function setStatus(message) {
    const panel = ensurePanel();
    const status = panel.querySelector(`[data-${EXT}-status]`);
    status.textContent = message;
  }

  async function confirmAndDelete() {
    const items = Array.from(state.selected.values());
    if (items.length === 0 || state.deleting) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${items.length} selected ChatGPT chat${items.length === 1 ? "" : "s"}? This action cannot be undone by this extension.`
    );

    if (!confirmed) {
      return;
    }

    state.deleting = true;
    updatePanel();

    let deleted = 0;
    let deletedCurrentChat = false;
    const failed = [];
    const currentId = getConversationId(window.location.href);

    for (const item of items) {
      setStatus(`Deleting ${deleted + failed.length + 1}/${items.length}: ${truncate(item.title, 54)}`);

      try {
        await deleteConversation(item);
        deleted += 1;
        state.selected.delete(item.id);
        markConversationDeleted(item.id);
        if (item.id === currentId) {
          deletedCurrentChat = true;
        }
      } catch (error) {
        failed.push({ item, error });
      }

      syncDecorationsForId(item.id);
      updatePanel();
      await sleep(250);
    }

    state.deleting = false;
    updatePanel();

    if (failed.length === 0) {
      setStatus(`Deleted ${deleted} chat${deleted === 1 ? "" : "s"}.`);
    } else {
      const first = failed[0];
      setStatus(
        `Deleted ${deleted}. Failed ${failed.length}: ${truncate(first.item.title, 38)} (${first.error.message}).`
      );
    }

    if (deletedCurrentChat && failed.every((entry) => entry.item.id !== currentId)) {
      window.setTimeout(() => {
        window.location.assign(window.location.origin + "/");
      }, 700);
    }
  }

  async function deleteConversation(item) {
    try {
      await deleteViaApi(item.id);
      return;
    } catch (apiError) {
      try {
        await deleteViaVisibleUi(item.id);
        return;
      } catch (uiError) {
        throw new Error(`API ${apiError.message}; UI ${uiError.message}`);
      }
    }
  }

  async function deleteViaApi(id) {
    let token = await getAccessToken(false);
    let response = await patchConversation(id, token);

    if ((response.status === 401 || response.status === 403) && token) {
      state.accessToken = null;
      token = await getAccessToken(true);
      if (token) {
        response = await patchConversation(id, token);
      }
    }

    if (!response.ok) {
      const text = await safeResponseText(response);
      throw new Error(`HTTP ${response.status}${text ? ` ${truncate(text, 90)}` : ""}`);
    }
  }

  async function patchConversation(id, token) {
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return window.fetch(`${window.location.origin}/backend-api/conversation/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify({ is_visible: false })
    });
  }

  async function getAccessToken(forceRefresh) {
    if (state.accessToken && !forceRefresh) {
      return state.accessToken;
    }

    try {
      const response = await window.fetch(`${window.location.origin}/api/auth/session`, {
        credentials: "include",
        cache: "no-store"
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const token = data.accessToken || data.access_token || data.user?.accessToken || null;
      if (typeof token === "string" && token.length > 20) {
        state.accessToken = token;
        return token;
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  async function deleteViaVisibleUi(id) {
    const link = findChatLinks().find((candidate) => getConversationId(candidate) === id);
    if (!link) {
      throw new Error("fallback needs the chat to be visible");
    }

    const row = getChatRow(link);
    row.scrollIntoView({ block: "center", inline: "nearest" });
    emitHover(row);
    await sleep(180);

    const menuButton = findMenuButton(row, link);
    if (!menuButton) {
      throw new Error("menu button not found");
    }

    clickElement(menuButton);

    const deleteItem = await waitFor(() => findDeleteMenuItem(), 2600);
    clickElement(deleteItem);

    const confirmButton = await waitFor(() => findConfirmDeleteButton(), 3200);
    clickElement(confirmButton);
    await sleep(450);
  }

  function getChatRow(link) {
    return (
      link.closest("li") ||
      link.closest('[role="listitem"]') ||
      link.parentElement?.parentElement ||
      link.parentElement ||
      link
    );
  }

  function findMenuButton(row, link) {
    const roots = uniqueElements([
      row,
      link.parentElement,
      link.parentElement?.parentElement,
      link.parentElement?.parentElement?.parentElement
    ]).filter(Boolean);

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll('button,[role="button"]'))
        .filter(isUsablePageControl);
      const labeled = buttons.find((button) => {
        const text = normalizeText(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent);
        return /options|more|menu|actions/i.test(text);
      });

      if (labeled) {
        return labeled;
      }

      if (buttons.length > 0) {
        return buttons[buttons.length - 1];
      }
    }

    const linkRect = link.getBoundingClientRect();
    return Array.from(document.querySelectorAll('button,[role="button"]'))
      .filter(isUsablePageControl)
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const verticallyAligned = rect.top < linkRect.bottom + 10 && rect.bottom > linkRect.top - 10;
        const closeToLink = rect.left > linkRect.left && rect.left < linkRect.right + 100;
        return verticallyAligned && closeToLink;
      })
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] || null;
  }

  function findDeleteMenuItem() {
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"]'))
      .filter(isUsablePageControl)
      .filter((element) => /delete/i.test(normalizeText(element.textContent || element.getAttribute("aria-label") || "")));

    return candidates.find((element) => /^delete(?: chat)?$/i.test(normalizeText(element.textContent))) || candidates[0] || null;
  }

  function findConfirmDeleteButton() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]'))
      .filter(isElementVisible);
    const roots = dialogs.length > 0 ? dialogs : [document.body];

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll('button,[role="button"]'))
        .filter(isUsablePageControl)
        .filter((button) => /^delete(?: chat)?$/i.test(normalizeText(button.textContent || button.getAttribute("aria-label") || "")));

      if (buttons.length > 0) {
        return buttons[buttons.length - 1];
      }
    }

    return null;
  }

  function isUsablePageControl(element) {
    return !element.closest(`.${EXT}-panel`) &&
      !element.classList.contains(`${EXT}-selector`) &&
      isElementVisible(element);
  }

  function isElementVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
  }

  function emitHover(element) {
    for (const type of ["pointerover", "mouseover", "mouseenter"]) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }
  }

  function clickElement(element) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }
  }

  async function waitFor(callback, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = callback();
      if (result) {
        return result;
      }
      await sleep(80);
    }

    throw new Error("timed out");
  }

  function markConversationDeleted(id) {
    for (const link of document.querySelectorAll(`a[data-${EXT}-id]`)) {
      if (link.dataset.cgptbdId !== id) {
        continue;
      }

      const row = getChatRow(link);
      row.classList.add(`${EXT}-row-deleted`);
      window.setTimeout(() => {
        if (row.isConnected) {
          row.remove();
        }
      }, 220);
    }
  }

  async function safeResponseText(response) {
    try {
      return normalizeText(await response.text());
    } catch (_error) {
      return "";
    }
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function truncate(value, maxLength) {
    const text = normalizeText(value);
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  boot();
})();

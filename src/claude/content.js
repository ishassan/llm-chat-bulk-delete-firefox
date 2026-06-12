(function () {
  "use strict";

  if (window.location.hostname !== "claude.ai" || window.__claudeBulkDeleteLoaded) {
    return;
  }

  window.__claudeBulkDeleteLoaded = true;

  const rootGlobal = typeof globalThis === "object" && globalThis ? globalThis : window;
  const Core = window.ClaudeBulkDeleteCore || rootGlobal.ClaudeBulkDeleteCore;
  if (!Core) {
    return;
  }

  const EXT = "cbd";
  const REFRESH_DELAY_MS = 140;
  const CODE_SESSION_API = "/v1/code/sessions";
  const CODE_SESSION_HEADERS = {
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "ccr-byoc-2025-07-29",
    "anthropic-client-feature": "ccr"
  };
  const CODE_SESSION_ID_PATTERN = /\bsession_[A-Za-z0-9]+\b/;
  const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

  const state = {
    deleting: false,
    items: new Map(),
    lastSelectedKey: null,
    nextSyntheticId: 1,
    observer: null,
    panel: null,
    refreshTimer: null,
    selected: new Map(),
    status: ""
  };

  function boot() {
    if (!document.body) {
      window.setTimeout(boot, 50);
      return;
    }

    cleanupLegacyUi();
    ensurePanel();
    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true
    });
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    window.setInterval(scheduleRefresh, 2500);
    scheduleRefresh();
  }

  function cleanupLegacyUi() {
    document.querySelectorAll(".cbd-panel,.cbd-toolbar,.cbd-row-control").forEach((element) => element.remove());
    document.querySelectorAll(".cbd-row").forEach((row) => {
      row.classList.remove("cbd-row", "cbd-selected", "cbd-deleting", "cbd-delete-failed");
      row.removeAttribute("data-cbd-item-key");
      row.removeAttribute("data-cbd-source");
      row.style.removeProperty("--cbd-original-padding-left");
    });
  }

  function ensurePanel() {
    if (state.panel && document.body.contains(state.panel)) {
      return state.panel;
    }

    const panel = document.createElement("section");
    panel.className = `${EXT}-panel`;
    panel.dataset.cbdRoot = "true";
    panel.setAttribute("aria-label", "Claude bulk delete controls");

    const header = document.createElement("div");
    header.className = `${EXT}-header`;

    const title = document.createElement("span");
    title.className = `${EXT}-title`;
    title.textContent = "Bulk delete";

    const count = document.createElement("span");
    count.className = `${EXT}-count`;
    count.dataset.cbdCount = "";
    count.textContent = "0 selected";

    header.append(title, count);

    const actions = document.createElement("div");
    actions.className = `${EXT}-actions`;
    actions.append(
      makePanelButton("select-all", "Select all"),
      makePanelButton("clear", "Clear"),
      makePanelButton("delete", "Delete", `${EXT}-danger`)
    );

    const status = document.createElement("div");
    status.className = `${EXT}-status`;
    status.dataset.cbdStatus = "";
    status.setAttribute("aria-live", "polite");

    panel.append(header, actions, status);
    panel.addEventListener("click", onPanelClick);
    document.body.append(panel);
    state.panel = panel;
    updatePanel();
    return panel;
  }

  function makePanelButton(action, label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cbdAction = action;
    button.textContent = label;
    if (className) {
      button.className = className;
    }
    return button;
  }

  function onPanelClick(event) {
    const button = event.target.closest("button[data-cbd-action]");
    if (!button || state.deleting) {
      return;
    }

    const action = button.dataset.cbdAction;
    if (action === "select-all") {
      selectAllVisible();
    } else if (action === "clear") {
      clearSelection();
    } else if (action === "delete") {
      void confirmAndDelete();
    }
  }

  function scheduleRefresh() {
    if (state.refreshTimer) {
      return;
    }

    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = null;
      refreshDecorations();
    }, REFRESH_DELAY_MS);
  }

  function refreshDecorations() {
    if (!document.body) {
      return;
    }

    const items = collectVisibleItems();
    const currentElements = new Set();
    const nextItems = new Map();

    for (const item of items) {
      currentElements.add(item.element);
      nextItems.set(item.key, item);
      decorateItem(item);
      if (state.selected.has(item.key)) {
        state.selected.set(item.key, getSelectionData(item));
      }
    }

    state.items = nextItems;
    cleanupStaleDecorations(currentElements);
    syncAllDecorations();
    updatePanel();
  }

  function collectVisibleItems() {
    const items = Core.collectConversationItems(document, window.location)
      .filter(isLikelySidebarItem);
    const seenElements = new Set(items.map((item) => item.element));
    const seenKeys = new Set(items.map((item) => item.key));

    if (isWebRecentsContext()) {
      for (const item of collectWebRecentsPageItems(seenElements)) {
        if (seenKeys.has(item.key)) {
          continue;
        }
        seenElements.add(item.element);
        seenKeys.add(item.key);
        items.push(item);
      }
    }

    if (Core.isCodeContext(window.location)) {
      for (const item of collectCodeSessionButtonItems(seenElements)) {
        if (seenKeys.has(item.key)) {
          continue;
        }
        seenElements.add(item.element);
        seenKeys.add(item.key);
        items.push(item);
      }

      for (const item of collectCodePlainSessionRows(seenElements)) {
        if (seenKeys.has(item.key)) {
          continue;
        }
        seenElements.add(item.element);
        seenKeys.add(item.key);
        items.push(item);
      }

      for (const item of collectUnlinkedSidebarItems(seenElements)) {
        if (seenKeys.has(item.key)) {
          continue;
        }
        seenElements.add(item.element);
        seenKeys.add(item.key);
        items.push(item);
      }
    }

    return items;
  }

  function isWebRecentsContext() {
    return !Core.isCodeContext(window.location) &&
      window.location.pathname.replace(/\/+$/, "") === "/recents";
  }

  function collectWebRecentsPageItems(existingElements) {
    const items = [];
    const seenRows = new Set(existingElements);
    const rows = Array.from(document.querySelectorAll("tr,[role='row']"));

    for (const row of rows) {
      if (seenRows.has(row) || Core.isExtensionElement(row) || !Core.isVisible(row)) {
        continue;
      }
      if (row.closest("[role='dialog'],[aria-modal='true']")) {
        continue;
      }

      const rowData = webRecentsRowData(row);
      if (!rowData) {
        continue;
      }

      const href = webChatHrefIn(row);
      const key = href || webRecentsSyntheticKey(row, rowData.title);
      seenRows.add(row);
      items.push({
        element: row,
        href,
        key,
        selectorHost: rowData.selectorHost,
        source: "claude-web",
        title: rowData.title
      });
    }

    return items;
  }

  function webRecentsSyntheticKey(row, title) {
    const attributeId = row.getAttribute("data-chat-id") ||
      row.getAttribute("data-thread-id") ||
      row.getAttribute("data-conversation-id") ||
      row.getAttribute("data-thread") ||
      "";

    if (attributeId) {
      return `claude-web:recents:${attributeId}`;
    }

    if (!row.dataset.cbdSyntheticId) {
      row.dataset.cbdSyntheticId = String(state.nextSyntheticId);
      state.nextSyntheticId += 1;
    }

    return `claude-web:recents:synthetic:${row.dataset.cbdSyntheticId}:${title}`;
  }

  function webRecentsRowData(row) {
    const cells = directRowCells(row);
    for (const cell of cells) {
      const title = recentsTitleFromText(Core.readableText(cell));
      if (isLikelyRecentsTitle(title)) {
        return { selectorHost: cell, title };
      }
    }

    const rowTitle = recentsTitleFromText(Core.readableText(row));
    if (!isLikelyRecentsTitle(rowTitle)) {
      return null;
    }

    return { selectorHost: cells[0] || row, title: rowTitle };
  }

  function directRowCells(row) {
    return Array.from(row.children || [])
      .filter((child) => {
        const tagName = child.tagName.toLowerCase();
        const role = (child.getAttribute("role") || "").toLowerCase();
        return tagName === "td" ||
          tagName === "th" ||
          role === "cell" ||
          role === "gridcell" ||
          role === "columnheader";
      });
  }

  function recentsTitleFromText(value) {
    return normalizeText(value)
      .replace(/\b(just now|today|yesterday|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)$/i, "")
      .replace(/\s+\.\.\.$/, "")
      .trim();
  }

  function isLikelyRecentsTitle(title) {
    const text = Core.normalizeText(title);
    if (text.length < 3 || text.length > 160) {
      return false;
    }

    if (/^(loading|search chats|select chats|new chat|chats|projects|claude|\.{3}|···|⋯)$/i.test(text)) {
      return false;
    }

    if (/^(bulk delete|select all|selected|clear|delete)$/i.test(text)) {
      return false;
    }

    return text.split(/\s+/).length <= 24;
  }

  function webChatHrefIn(row) {
    for (const anchor of Array.from(row.querySelectorAll("a[href]"))) {
      try {
        const url = new URL(anchor.getAttribute("href"), window.location.href);
        if (url.hostname === "claude.ai" && /^\/chat\/[^/]+/.test(url.pathname)) {
          return url.href;
        }
      } catch (_error) {
        continue;
      }
    }

    return "";
  }

  function collectCodeSessionButtonItems(existingElements) {
    const items = [];
    const seenRows = new Set(existingElements);

    for (const root of findSidebarRoots()) {
      const buttons = Array.from(root.querySelectorAll("button,[role='button']"));
      for (const button of buttons) {
        if (seenRows.has(button) || Core.isExtensionElement(button) || !Core.isVisible(button)) {
          continue;
        }

        const label = controlLabel(button);
        if (isCodeMoreOptionsLabel(label) || Core.isMenuAction(button) || Core.isDeleteAction(button)) {
          continue;
        }

        const title = codeSessionTitle(label || Core.readableText(button));
        if (!isLikelyCodeSessionTitle(title)) {
          continue;
        }

        const menuElement = findCodeMenuButtonForTitle(root, title, button);
        if (!menuElement && !isLikelyCodePlainSessionRow(button, root)) {
          continue;
        }

        seenRows.add(button);
        items.push({
          element: button,
          href: "",
          key: `claude-code:button:${domPath(button)}:${title}`,
          menuElement,
          source: "claude-code",
          title
        });
      }
    }

    return items;
  }

  function findCodeMenuButtonForTitle(root, title, row) {
    const normalizedTitle = normalizeComparableTitle(title);
    const buttons = Array.from(root.querySelectorAll("button,[role='button']"))
      .filter((button) => button !== row && isUsablePageControl(button));

    const exact = buttons.find((button) => {
      const label = controlLabel(button);
      return isCodeMoreOptionsLabel(label) &&
        normalizeComparableTitle(label.replace(/^more options for\s+/i, "")) === normalizedTitle;
    });
    if (exact) {
      return exact;
    }

    let current = row.nextElementSibling;
    while (current && current !== root) {
      if (isUsablePageControl(current) && isCodeMoreOptionsLabel(controlLabel(current))) {
        return current;
      }
      if (current.matches && current.matches("button,[role='button']") && !isCodeMoreOptionsLabel(controlLabel(current))) {
        break;
      }
      current = current.nextElementSibling;
    }

    return null;
  }

  function codeSessionTitle(value) {
    return normalizeText(value)
      .replace(/^(idle|running|ready|awaiting input|needs input|error)\s+/i, "")
      .trim();
  }

  function isLikelyCodeSessionTitle(title) {
    const normalized = normalizeText(title);
    return isLikelyFallbackTitle(normalized) &&
      !/^(filter|collapse sidebar|search|install|dismiss|show \d+ more)$/i.test(normalized) &&
      !/^(try the slack app|recents\s+filter\b)/i.test(normalized) &&
      !/^islam(?:\s+islam|\s+intelmatix|$)/i.test(normalized) &&
      !/\binstall\s+dismiss\b/i.test(normalized);
  }

  function isCodeMoreOptionsLabel(label) {
    return /^more options for\s+/i.test(normalizeText(label));
  }

  function controlLabel(element) {
    if (!element) {
      return "";
    }
    return normalizeText([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" "));
  }

  function normalizeComparableTitle(value) {
    return codeSessionTitle(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function collectUnlinkedSidebarItems(existingElements) {
    const roots = findSidebarRoots();
    const items = [];
    const seenRows = new Set(existingElements);
    const codeContext = Core.isCodeContext(window.location);
    const source = codeContext ? "claude-code" : "claude-web";

    for (const root of roots) {
      const candidates = Array.from(root.querySelectorAll([
        "a[href]",
        "button",
        "[role='button']",
        "[role='link']",
        "[tabindex]",
        "li",
        "div"
      ].join(",")));

      for (const candidate of candidates) {
        if (Core.isMenuAction(candidate) || Core.isDeleteAction(candidate)) {
          continue;
        }

        let row = sidebarRowFor(candidate, root);
        if (
          codeContext &&
          row &&
          row !== candidate &&
          !isLikelyFallbackTitle(Core.readableText(row)) &&
          isLikelyCodePlainSessionRow(candidate, root)
        ) {
          row = candidate;
        }
        if (!row || seenRows.has(row) || Core.isExtensionElement(row) || !Core.isVisible(row)) {
          continue;
        }

        if (Array.from(existingElements).some((element) => element.contains(row) || row.contains(element))) {
          continue;
        }

        const title = Core.readableText(row);
        if (!isLikelyFallbackTitle(title)) {
          continue;
        }

        if (codeContext && !hasFallbackMenuControl(row) && !isLikelyCodePlainSessionRow(row, root)) {
          continue;
        }

        const item = {
          element: row,
          href: "",
          key: `${source}:dom:${domPath(row)}:${title}`,
          source,
          title
        };
        if (!isLikelySidebarItem(item)) {
          continue;
        }

        seenRows.add(row);
        items.push(item);
      }
    }

    return items;
  }

  function collectCodePlainSessionRows(existingElements) {
    const items = [];
    const seenRows = new Set(existingElements);

    for (const root of findSidebarRoots()) {
      let sawRecents = false;
      const candidates = Array.from(root.querySelectorAll("button,[role='button'],[role='link'],a[href],li,div,span,p"));
      for (const candidate of candidates) {
        if (elementOverlapsSet(candidate, seenRows) || Core.isExtensionElement(candidate) || !Core.isVisible(candidate)) {
          continue;
        }

        if (Core.isMenuAction(candidate) || Core.isDeleteAction(candidate)) {
          continue;
        }

        const text = normalizeText(Core.readableText(candidate));
        if (/^recents$/i.test(text)) {
          sawRecents = true;
          continue;
        }

        if (/^(try the slack app|islam(?:\s+islam)?(?:\s+intelmatix)?)$/i.test(text)) {
          sawRecents = false;
          continue;
        }

        if (!sawRecents || hasLikelyCodeSessionDescendant(candidate)) {
          continue;
        }

        const title = codeSessionTitle(text);
        if (!isLikelyCodeSessionTitle(title)) {
          continue;
        }

        seenRows.add(candidate);
        items.push({
          element: candidate,
          href: "",
          key: `claude-code:plain:${domPath(candidate)}:${title}`,
          source: "claude-code",
          title
        });
      }
    }

    return items;
  }

  function hasLikelyCodeSessionDescendant(element) {
    const ownText = normalizeText(Core.readableText(element));
    for (const child of Array.from(element.querySelectorAll("button,[role='button'],[role='link'],a[href],li,div,span,p"))) {
      if (Core.isExtensionElement(child) || Core.isMenuAction(child) || Core.isDeleteAction(child)) {
        continue;
      }

      const childText = normalizeText(Core.readableText(child));
      if (!childText || childText === ownText && child.children.length === 0) {
        continue;
      }

      const title = codeSessionTitle(childText);
      if (isLikelyCodeSessionTitle(title)) {
        return true;
      }
    }

    return false;
  }

  function elementOverlapsSet(element, elements) {
    for (const existing of elements) {
      if (existing === element || existing.contains(element) || element.contains(existing)) {
        return true;
      }
    }
    return false;
  }

  function hasFallbackMenuControl(row) {
    return Array.from(row.querySelectorAll("button,[role='button']"))
      .some((control) => control !== row && isUsablePageControl(control) && Core.isMenuAction(control));
  }

  function isLikelyCodePlainSessionRow(row, root) {
    if (!Core.isCodeContext(window.location) || !row || row === root) {
      return false;
    }

    const title = codeSessionTitle(Core.readableText(row));
    if (!isLikelyCodeSessionTitle(title)) {
      return false;
    }

    const rect = row.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (rect.height > 80 || rect.width < 80) {
        return false;
      }

      if (rootRect.width > 0) {
        const insideRootHorizontally = rect.left >= rootRect.left - 4 && rect.right <= rootRect.right + 4;
        if (!insideRootHorizontally) {
          return false;
        }
      }
    }

    return hasRecentsAncestor(row, root);
  }

  function hasRecentsAncestor(row, root) {
    let current = row;
    while (current && current !== root.parentElement) {
      if (current !== row) {
        const label = normalizeText([
          current.getAttribute("aria-label"),
          current.getAttribute("data-testid"),
          current.id,
          current.className
        ].filter(Boolean).join(" ")).toLowerCase();
        if (label.includes("recents") || label.includes("session")) {
          return true;
        }
      }

      const previousText = previousSiblingText(current);
      if (/^recents$/i.test(previousText)) {
        return true;
      }

      if (current === root) {
        break;
      }
      current = current.parentElement;
    }

    return isAfterRecentsMarker(row, root);
  }

  function isAfterRecentsMarker(row, root) {
    let sawRecents = false;
    const nodes = Array.from(root.querySelectorAll("button,[role='button'],[aria-label],span,div,li"));
    for (const node of nodes) {
      if (node === row) {
        return sawRecents;
      }
      if (node.contains(row)) {
        continue;
      }

      const text = normalizeText(Core.readableText(node));
      if (/^recents$/i.test(text)) {
        sawRecents = true;
      } else if (/^(try the slack app|install|dismiss|islam(?:\s+islam)?(?:\s+intelmatix)?)$/i.test(text)) {
        sawRecents = false;
      }
    }

    return false;
  }

  function previousSiblingText(element) {
    let current = element.previousElementSibling;
    while (current) {
      const text = normalizeText(Core.readableText(current));
      if (text) {
        return text;
      }
      current = current.previousElementSibling;
    }
    return "";
  }

  function findSidebarRoots() {
    const roots = [];
    const selectors = [
      "aside",
      "nav",
      "[role='navigation']",
      "[aria-label]",
      "[data-testid]",
      "[id]",
      "[class]"
    ];

    for (const element of document.querySelectorAll(selectors.join(","))) {
      if (Core.isExtensionElement(element) || !Core.isVisible(element)) {
        continue;
      }

      const tagName = element.tagName.toLowerCase();
      const role = (element.getAttribute("role") || "").toLowerCase();
      if (!isPotentialSidebarRoot(tagName, role)) {
        continue;
      }

      const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
      const technicalLabel = [
        element.getAttribute("data-testid"),
        element.id,
        element.className
      ].join(" ").toLowerCase();

      if (
        tagName === "aside" ||
        tagName === "nav" ||
        role === "navigation" ||
        /\b(sidebar|history|recents|conversation|thread|chat|session)\b/.test(ariaLabel) ||
        /\b(sidebar|history|recents)\b/.test(technicalLabel)
      ) {
        roots.push(element);
      }
    }

    return uniqueElements(roots)
      .filter((root) => !roots.some((other) => other !== root && root.contains(other)));
  }

  function isPotentialSidebarRoot(tagName, role) {
    if (["a", "button", "input", "select", "textarea"].includes(tagName)) {
      return false;
    }
    if (["button", "link", "menuitem", "textbox", "searchbox", "combobox"].includes(role)) {
      return false;
    }
    return true;
  }

  function sidebarRowFor(candidate, root) {
    if (!candidate || candidate === root || Core.isExtensionElement(candidate)) {
      return null;
    }

    const firstText = Core.readableText(candidate);
    if (!firstText) {
      return null;
    }

    let current = candidate;
    let best = candidate;
    while (current.parentElement && current.parentElement !== root.parentElement) {
      const parent = current.parentElement;
      if (parent === document.body || Core.isExtensionElement(parent)) {
        break;
      }

      const parentText = Core.readableText(parent);
      if (!parentText || parentText.length > Math.max(180, firstText.length + 90)) {
        break;
      }

      if (rowGeometryLooksUsable(parent, best)) {
        best = parent;
      }

      if (parent === root) {
        break;
      }

      current = parent;
    }

    return best === root ? candidate : best;
  }

  function rowGeometryLooksUsable(candidate, previous) {
    const candidateRect = candidate.getBoundingClientRect();
    const previousRect = previous.getBoundingClientRect();

    if (candidateRect.width === 0 && candidateRect.height === 0) {
      return true;
    }

    if (candidateRect.height > 110 || candidateRect.width < previousRect.width) {
      return false;
    }

    return true;
  }

  function isLikelyFallbackTitle(title) {
    const text = Core.normalizeText(title);
    const normalized = text.toLowerCase();
    if (text.length < 3 || text.length > 160) {
      return false;
    }

    if (/^(new chat|new session|routines|customize|settings|research preview|recents|sessions|chats|projects|claude|claude code|\.{3}|···|⋯)$/i.test(text)) {
      return false;
    }

    if (/^(bulk delete|select all|\d+\s+selected|selected(?:\s+\d+\s+visible\s+chats)?|clear|delete)$/i.test(text)) {
      return false;
    }

    return text.split(/\s+/).length <= 24;
  }

  function domPath(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 5) {
      const parent = current.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(current) : 0;
      parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
      current = parent;
    }
    return parts.join("/");
  }

  function isLikelySidebarItem(item) {
    const element = item.element;
    if (!element || Core.isExtensionElement(element) || element.closest("[role='dialog'],[aria-modal='true']")) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const maxSidebarRight = Math.min(620, Math.max(300, window.innerWidth * 0.5));
      if (rect.left < maxSidebarRight && rect.width <= 620 && rect.height <= 96) {
        return true;
      }
    }

    return hasSidebarAncestor(element);
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
        tagName === "aside" ||
        tagName === "nav" ||
        role === "navigation" ||
        label.includes("sidebar") ||
        label.includes("history") ||
        label.includes("recents") ||
        testId.includes("sidebar") ||
        testId.includes("history") ||
        id.includes("sidebar") ||
        id.includes("history")
      ) {
        return true;
      }

      current = current.parentElement;
    }

    return false;
  }

  function decorateItem(item) {
    const row = item.element;
    if (!row || !row.isConnected) {
      return;
    }

    if (row.dataset.cbdDecorated === "true") {
      row.dataset.cbdKey = item.key;
      row.dataset.cbdSource = item.source;
      updateSelectorLabel(row, item);
      ensureRowSelectorHandlers(row);
      syncItemDecoration(row);
      return;
    }

    const selector = document.createElement("span");
    selector.className = `${EXT}-selector`;
    selector.dataset.cbdOwned = "true";
    selector.setAttribute("role", "checkbox");
    selector.setAttribute("aria-checked", "false");
    selector.setAttribute("aria-label", `Select ${item.title || "Claude chat"}`);
    selector.tabIndex = 0;

    row.classList.add(`${EXT}-chat-row`);
    row.dataset.cbdDecorated = "true";
    row.dataset.cbdKey = item.key;
    row.dataset.cbdSource = item.source;
    insertSelector(row, selector, item);
    ensureRowSelectorHandlers(row);
    syncItemDecoration(row);
  }

  function updateSelectorLabel(row, item) {
    const selector = selectorForRow(row);
    if (selector) {
      selector.setAttribute("aria-label", `Select ${item.title || "Claude chat"}`);
    }
  }

  function insertSelector(row, selector, item) {
    const host = item && item.selectorHost && item.selectorHost.isConnected ?
      item.selectorHost :
      defaultSelectorHost(row);

    host.insertBefore(selector, host.firstChild);
  }

  function defaultSelectorHost(row) {
    const tagName = row.tagName.toLowerCase();
    const role = (row.getAttribute("role") || "").toLowerCase();
    if (tagName === "tr" || role === "row") {
      return directRowCells(row).find((cell) => Core.isVisible(cell)) || row;
    }
    return row;
  }

  function ensureRowSelectorHandlers(row) {
    if (row.dataset.cbdSelectorHandlers === "true") {
      return;
    }

    row.dataset.cbdSelectorHandlers = "true";
    row.addEventListener("pointerdown", onRowSelectorPress, true);
    row.addEventListener("mousedown", onRowSelectorPress, true);
    row.addEventListener("pointerup", onRowSelectorPointerUp, true);
    row.addEventListener("click", onRowSelectorClick, true);
    row.addEventListener("keydown", onRowSelectorKeyDown, true);
  }

  function onRowSelectorPress(event) {
    const row = event.currentTarget;
    if (!isPrimaryMouseActivation(event) || !selectorHitByEvent(row, event)) {
      return;
    }

    consumeSelectorEvent(event);
    selectorForRow(row)?.focus({ preventScroll: true });
  }

  function onRowSelectorPointerUp(event) {
    const row = event.currentTarget;
    if (!isPrimaryMouseActivation(event) || !selectorHitByEvent(row, event)) {
      return;
    }

    row.dataset.cbdSkipNextSelectorClick = "true";
    window.setTimeout(() => {
      if (row.dataset.cbdSkipNextSelectorClick === "true") {
        delete row.dataset.cbdSkipNextSelectorClick;
      }
    }, 500);
    activateSelector(row, event);
  }

  function onRowSelectorClick(event) {
    const row = event.currentTarget;
    if (!isPrimaryMouseActivation(event) || !selectorHitByEvent(row, event)) {
      return;
    }

    if (row.dataset.cbdSkipNextSelectorClick === "true") {
      delete row.dataset.cbdSkipNextSelectorClick;
      consumeSelectorEvent(event);
      return;
    }

    activateSelector(row, event);
  }

  function onRowSelectorKeyDown(event) {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    const row = event.currentTarget;
    const selector = selectorForRow(row);
    if (!selector || event.target !== selector && !selector.contains(event.target)) {
      return;
    }

    activateSelector(row, event);
  }

  function activateSelector(row, event) {
    const key = row.dataset.cbdKey;
    if (!key) {
      return;
    }

    const item = state.items.get(key) || itemFromDecoratedRow(row, key);
    if (!item) {
      return;
    }

    consumeSelectorEvent(event);
    toggleItem(key, item, event.shiftKey);
  }

  function itemFromDecoratedRow(row, key) {
    if (!row || !key) {
      return null;
    }

    return {
      element: row,
      href: "",
      key,
      source: row.dataset.cbdSource || (Core.isCodeContext(window.location) ? "claude-code" : "claude-web"),
      title: codeSessionTitle(Core.readableText(row)) || "Untitled Claude chat"
    };
  }

  function selectorHitByEvent(row, event) {
    const selector = selectorForRow(row);
    if (!selector) {
      return false;
    }

    if (event.target === selector || selector.contains(event.target)) {
      return true;
    }

    if (typeof event.clientX !== "number" || typeof event.clientY !== "number") {
      return false;
    }

    const rect = selector.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      return false;
    }

    const padding = 6;
    return event.clientX >= rect.left - padding &&
      event.clientX <= rect.right + padding &&
      event.clientY >= rect.top - padding &&
      event.clientY <= rect.bottom + padding;
  }

  function isPrimaryMouseActivation(event) {
    return typeof event.button !== "number" || event.button === 0;
  }

  function consumeSelectorEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function toggleItem(key, item, extendRange) {
    if (extendRange && state.lastSelectedKey && state.lastSelectedKey !== key) {
      selectRange(state.lastSelectedKey, key);
      state.lastSelectedKey = key;
      return;
    }

    if (state.selected.has(key)) {
      state.selected.delete(key);
    } else {
      state.selected.set(key, getSelectionData(item));
    }

    state.lastSelectedKey = key;
    syncDecorationsForKey(key);
    updatePanel();
  }

  function selectRange(fromKey, toKey) {
    const items = Array.from(state.items.values());
    const fromIndex = items.findIndex((item) => item.key === fromKey);
    const toIndex = items.findIndex((item) => item.key === toKey);

    if (fromIndex === -1 || toIndex === -1) {
      const item = state.items.get(toKey);
      if (item) {
        state.selected.set(toKey, getSelectionData(item));
        syncDecorationsForKey(toKey);
      }
      setStatus("Range selection needs both chats to be visible.");
      updatePanel();
      return;
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    for (const item of items.slice(start, end + 1)) {
      state.selected.set(item.key, getSelectionData(item));
    }

    syncAllDecorations();
    setStatus(`Selected ${end - start + 1} visible chats.`);
    updatePanel();
  }

  function selectAllVisible() {
    if (state.items.size === 0) {
      setStatus("No visible Claude chats found.");
      return;
    }

    let added = 0;
    for (const item of state.items.values()) {
      if (!state.selected.has(item.key)) {
        added += 1;
      }
      state.selected.set(item.key, getSelectionData(item));
    }

    syncAllDecorations();
    setStatus(added > 0 ? `Selected ${added} visible chats.` : "All visible chats are already selected.");
    updatePanel();
  }

  function clearSelection() {
    state.selected.clear();
    state.lastSelectedKey = null;
    syncAllDecorations();
    setStatus("");
    updatePanel();
  }

  function getSelectionData(item) {
    return {
      element: item.element,
      conversationId: item.conversationId || extractWebConversationIdFromItem(item),
      href: item.href,
      key: item.key,
      menuElement: item.menuElement,
      sessionId: item.sessionId || extractCodeSessionIdFromItem(item),
      source: item.source,
      title: item.title || "Untitled Claude chat"
    };
  }

  function cleanupStaleDecorations(currentElements) {
    for (const row of document.querySelectorAll("[data-cbd-decorated='true']")) {
      if (currentElements.has(row)) {
        continue;
      }

      const key = row.dataset.cbdKey;
      row.classList.remove(`${EXT}-chat-row`, `${EXT}-selected`, `${EXT}-deleting`, `${EXT}-failed`);
      row.removeAttribute("data-cbd-decorated");
      row.removeAttribute("data-cbd-key");
      row.removeAttribute("data-cbd-source");
      selectorForRow(row)?.remove();
      if (key) {
        state.selected.delete(key);
      }
    }
  }

  function syncDecorationsForKey(key) {
    for (const row of document.querySelectorAll("[data-cbd-key]")) {
      if (row.dataset.cbdKey === key) {
        syncItemDecoration(row);
      }
    }
  }

  function syncAllDecorations() {
    for (const row of document.querySelectorAll("[data-cbd-key]")) {
      syncItemDecoration(row);
    }
  }

  function syncItemDecoration(row) {
    const key = row.dataset.cbdKey;
    const selected = Boolean(key && state.selected.has(key));
    const selector = selectorForRow(row);
    if (selector) {
      selector.setAttribute("aria-checked", selected ? "true" : "false");
    }
    row.classList.toggle(`${EXT}-selected`, selected);
  }

  function selectorForRow(row) {
    return row.querySelector(`:scope > .${EXT}-selector`) ||
      row.querySelector(`:scope > td .${EXT}-selector, :scope > th .${EXT}-selector, :scope > [role='cell'] .${EXT}-selector, :scope > [role='gridcell'] .${EXT}-selector`);
  }

  function updatePanel() {
    const panel = ensurePanel();
    const count = state.selected.size;
    const visibleCount = state.items.size;

    panel.querySelector("[data-cbd-count]").textContent = `${count} selected`;
    panel.querySelector("[data-cbd-action='select-all']").disabled = state.deleting || visibleCount === 0;
    panel.querySelector("[data-cbd-action='clear']").disabled = state.deleting || count === 0;
    panel.querySelector("[data-cbd-action='delete']").disabled = state.deleting || count === 0;

    panel.querySelector("[data-cbd-status]").textContent = state.status || `${visibleCount} visible chats`;
  }

  function setStatus(message) {
    state.status = message;
    updatePanel();
  }

  async function confirmAndDelete() {
    refreshDecorations();
    const items = Array.from(state.selected.values())
      .map((item) => {
        const current = state.items.get(item.key);
        return current ? getSelectionData(current) : item;
      })
      .filter((item) => item.element && item.element.isConnected);

    if (items.length === 0 || state.deleting) {
      setStatus("No selected visible chats found.");
      clearSelection();
      return;
    }

    const confirmed = window.confirm(
      `Delete ${items.length} selected Claude chat${items.length === 1 ? "" : "s"}?`
    );
    if (!confirmed) {
      return;
    }

    state.deleting = true;
    updatePanel();

    let deleted = 0;
    const failed = [];
    const codeSessionResolver = createCodeSessionResolver();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      setStatus(`Deleting ${index + 1}/${items.length}: ${truncate(item.title, 48)}`);

      try {
        await deleteSelectedItem(item, codeSessionResolver);
        deleted += 1;
        state.selected.delete(item.key);
        markDeleted(item);
      } catch (error) {
        failed.push({ item, error });
        markFailed(item);
      }

      updatePanel();
      await sleep(180);
    }

    state.deleting = false;
    scheduleRefresh();

    if (failed.length === 0) {
      setStatus(`Deleted ${deleted} chat${deleted === 1 ? "" : "s"}.`);
    } else {
      const first = failed[0];
      setStatus(`Deleted ${deleted}. Failed ${failed.length}: ${truncate(first.item.title, 32)} (${first.error.message}).`);
    }

    updatePanel();
  }

  async function deleteSelectedItem(item, codeSessionResolver) {
    if (item.source === "claude-web") {
      try {
        await deleteViaWebApi(item);
        return;
      } catch (_error) {
        // Claude Web's visible menu remains the fallback for older or unexpected page states.
      }
    }

    if (item.source === "claude-code") {
      try {
        await deleteViaCodeApi(item, codeSessionResolver);
        return;
      } catch (_error) {
        // Claude Code's visible menu remains the fallback for older or unexpected page states.
      }
    }

    await deleteViaVisibleUi(item);
  }

  async function deleteViaWebApi(item) {
    if (typeof window.fetch !== "function") {
      throw new Error("conversations API unavailable");
    }

    const conversationId = extractWebConversationIdFromItem(item);
    if (!conversationId) {
      throw new Error("conversation id not found");
    }

    const orgUuids = organizationUuidCandidates();
    if (orgUuids.length === 0) {
      throw new Error("organization uuid not found");
    }

    let lastError = null;
    for (const orgUuid of orgUuids) {
      const response = await window.fetch(
        `/api/organizations/${encodeURIComponent(orgUuid)}/chat_conversations/${encodeURIComponent(conversationId)}`,
        {
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "DELETE"
        }
      );

      if (response.ok || response.status === 204) {
        return;
      }

      lastError = new Error(`conversations API ${response.status}`);
      if (response.status !== 403 && response.status !== 404) {
        break;
      }
    }

    throw lastError || new Error("conversations API failed");
  }

  async function deleteViaCodeApi(item, codeSessionResolver) {
    if (typeof window.fetch !== "function") {
      throw new Error("sessions API unavailable");
    }

    const sessionId = extractCodeSessionIdFromItem(item) || await codeSessionResolver.resolve(item);
    if (!sessionId) {
      throw new Error("session id not found");
    }

    const response = await window.fetch(`${CODE_SESSION_API}/${encodeURIComponent(sessionId)}`, {
      body: JSON.stringify({}),
      credentials: "include",
      headers: codeApiHeaders(),
      method: "DELETE"
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`sessions API ${response.status}`);
    }

    removeCodeSessionRow(item);
  }

  function createCodeSessionResolver() {
    let mapPromise = null;

    return {
      async resolve(item) {
        const directSessionId = extractCodeSessionIdFromItem(item);
        if (directSessionId) {
          return directSessionId;
        }

        if (!mapPromise) {
          mapPromise = buildCodeSessionMap();
        }

        const map = await mapPromise;
        return map.get(item.key) || "";
      }
    };
  }

  async function buildCodeSessionMap() {
    const sessions = await fetchCodeSessions();
    const remaining = sessions.slice();
    const map = new Map();
    const visibleCodeItems = Array.from(state.items.values())
      .filter((item) => item.source === "claude-code" && item.element && item.element.isConnected);

    for (const item of visibleCodeItems) {
      const directSessionId = extractCodeSessionIdFromItem(item);
      if (directSessionId) {
        map.set(item.key, directSessionId);
        continue;
      }

      const index = remaining.findIndex((session) => codeSessionMatchesItem(session, item));
      if (index === -1) {
        continue;
      }

      const [session] = remaining.splice(index, 1);
      map.set(item.key, session.id);
    }

    return map;
  }

  async function fetchCodeSessions() {
    const sessions = [];
    let url = `${CODE_SESSION_API}?limit=100`;

    for (let page = 0; page < 4 && url; page += 1) {
      const response = await window.fetch(url, {
        credentials: "include",
        headers: codeApiHeaders(),
        method: "GET"
      });

      if (!response.ok) {
        throw new Error(`sessions API ${response.status}`);
      }

      const payload = await response.json();
      const data = Array.isArray(payload.data) ? payload.data :
        Array.isArray(payload.sessions) ? payload.sessions :
          [];

      for (const session of data) {
        const normalized = normalizeCodeSession(session);
        if (normalized) {
          sessions.push(normalized);
        }
      }

      if (!payload.has_more) {
        break;
      }

      const cursor = payload.last_id || data[data.length - 1]?.id || data[data.length - 1]?.session_id || "";
      url = cursor ? `${CODE_SESSION_API}?limit=100&cursor=${encodeURIComponent(cursor)}` : "";
    }

    return sessions;
  }

  function normalizeCodeSession(session) {
    if (!session || typeof session !== "object") {
      return null;
    }

    const id = normalizeText(session.id || session.session_id || session.sessionId || "");
    const title = codeSessionTitle(session.title || session.session_title || session.name || "");
    if (!id || !title) {
      return null;
    }

    if (session.session_status === "archived" || session.is_archived === true || session.archived === true) {
      return null;
    }

    return { id, title };
  }

  function codeSessionMatchesItem(session, item) {
    return normalizeComparableTitle(session.title) === normalizeComparableTitle(item.title);
  }

  function codeApiHeaders() {
    const orgUuid = activeOrganizationUuid();
    return {
      ...CODE_SESSION_HEADERS,
      ...(orgUuid ? { "x-organization-uuid": orgUuid } : {})
    };
  }

  function activeOrganizationUuid() {
    const candidates = organizationUuidCandidateBuckets();
    return bestUuidCandidate(candidates.preferred) || bestUuidCandidate(candidates.fallback) || "";
  }

  function organizationUuidCandidates() {
    const candidates = organizationUuidCandidateBuckets();
    return Array.from(new Set([...candidates.preferred, ...candidates.fallback]));
  }

  function organizationUuidCandidateBuckets() {
    const preferred = [];
    const fallback = [];
    for (const storage of [safeStorage("localStorage"), safeStorage("sessionStorage")]) {
      if (!storage) {
        continue;
      }

      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || "";
        const value = storage.getItem(key) || "";
        collectOrganizationUuidCandidate(key, value, preferred, fallback);
      }
    }

    for (const cookie of document.cookie.split(";")) {
      const [key, ...valueParts] = cookie.trim().split("=");
      collectOrganizationUuidCandidate(key || "", valueParts.join("="), preferred, fallback);
    }

    return {
      fallback: Array.from(new Set(fallback)),
      preferred: Array.from(new Set(preferred))
    };
  }

  function safeStorage(name) {
    try {
      return window[name];
    } catch (_error) {
      return null;
    }
  }

  function collectOrganizationUuidCandidate(key, value, preferred, fallback) {
    const haystack = `${key} ${value}`;
    const matches = haystack.match(new RegExp(UUID_PATTERN.source, "gi")) || [];
    if (matches.length === 0) {
      return;
    }

    const target = /active.*org|org.*active|current.*org|selected.*org|orguuid|org_uuid|organization_uuid/i.test(key) ?
      preferred :
      /org|organization/i.test(haystack) ? fallback : null;
    if (!target) {
      return;
    }

    for (const match of matches) {
      target.push(match.toLowerCase());
    }
  }

  function bestUuidCandidate(candidates) {
    const unique = Array.from(new Set(candidates));
    return unique.length === 1 ? unique[0] : "";
  }

  function extractCodeSessionIdFromItem(item) {
    if (!item || item.source !== "claude-code") {
      return "";
    }

    if (item.sessionId && CODE_SESSION_ID_PATTERN.test(item.sessionId)) {
      return item.sessionId;
    }

    const fromHref = codeSessionIdFromUrl(item.href);
    if (fromHref) {
      return fromHref;
    }

    const element = item.element;
    if (!element) {
      return "";
    }

    const linked = element.matches?.("a[href]") ? element : element.querySelector?.("a[href]");
    const linkedSessionId = codeSessionIdFromUrl(linked?.getAttribute?.("href"));
    if (linkedSessionId) {
      return linkedSessionId;
    }

    for (const candidate of [element, ...Array.from(element.querySelectorAll?.("*") || [])]) {
      const attributeSessionId = codeSessionIdFromAttributes(candidate);
      if (attributeSessionId) {
        return attributeSessionId;
      }
    }

    return "";
  }

  function extractWebConversationIdFromItem(item) {
    if (!item || item.source !== "claude-web") {
      return "";
    }

    if (item.conversationId && UUID_PATTERN.test(item.conversationId)) {
      return item.conversationId.match(UUID_PATTERN)[0].toLowerCase();
    }

    const fromHref = webConversationIdFromUrl(item.href);
    if (fromHref) {
      return fromHref;
    }

    const element = item.element;
    if (!element) {
      return "";
    }

    const linked = element.matches?.("a[href]") ? element : element.querySelector?.("a[href]");
    const linkedConversationId = webConversationIdFromUrl(linked?.getAttribute?.("href"));
    if (linkedConversationId) {
      return linkedConversationId;
    }

    for (const candidate of [element, ...Array.from(element.querySelectorAll?.("*") || [])]) {
      const attributeConversationId = webConversationIdFromAttributes(candidate);
      if (attributeConversationId) {
        return attributeConversationId;
      }
    }

    return "";
  }

  function webConversationIdFromAttributes(element) {
    if (!element || typeof element.getAttributeNames !== "function") {
      return "";
    }

    const direct = element.getAttribute("data-conversation-id") ||
      element.getAttribute("data-chat-id") ||
      element.getAttribute("data-thread-id") ||
      "";
    if (UUID_PATTERN.test(direct)) {
      return direct.match(UUID_PATTERN)[0].toLowerCase();
    }

    return "";
  }

  function webConversationIdFromUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, window.location.href);
      if (url.hostname !== "claude.ai" || !url.pathname.startsWith("/chat/")) {
        return "";
      }

      const match = url.pathname.match(UUID_PATTERN);
      return match ? match[0].toLowerCase() : "";
    } catch (_error) {
      return "";
    }
  }

  function codeSessionIdFromAttributes(element) {
    if (!element || typeof element.getAttributeNames !== "function") {
      return "";
    }

    const direct = element.getAttribute("data-session-id") ||
      element.getAttribute("data-conversation-id") ||
      element.getAttribute("data-chat-id") ||
      element.getAttribute("data-thread-id") ||
      "";
    if (CODE_SESSION_ID_PATTERN.test(direct)) {
      return direct.match(CODE_SESSION_ID_PATTERN)[0];
    }

    for (const name of element.getAttributeNames()) {
      const value = element.getAttribute(name) || "";
      const match = value.match(CODE_SESSION_ID_PATTERN);
      if (match) {
        return match[0];
      }
    }

    return "";
  }

  function codeSessionIdFromUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, window.location.href);
      if (url.hostname !== "claude.ai" || !url.pathname.startsWith("/code/")) {
        return "";
      }

      const match = url.pathname.match(CODE_SESSION_ID_PATTERN);
      return match ? match[0] : "";
    } catch (_error) {
      return "";
    }
  }

  function removeCodeSessionRow(item) {
    const row = item.element;
    if (item.menuElement && item.menuElement.isConnected) {
      item.menuElement.remove();
    }

    if (!row || !row.isConnected) {
      return;
    }

    removeAdjacentCodeMenu(row, item);
    row.remove();
  }

  function removeAdjacentCodeMenu(row, item) {
    const siblings = [row.previousElementSibling, row.nextElementSibling];
    for (const sibling of siblings) {
      if (!sibling || Core.isExtensionElement(sibling)) {
        continue;
      }

      const controls = sibling.matches?.("button,[role='button']") ?
        [sibling] :
        Array.from(sibling.querySelectorAll?.("button,[role='button']") || []);
      const menuControl = controls.find((control) => {
        const label = controlLabel(control);
        return isCodeMoreOptionsLabel(label) && (!item.title || menuLabelMatchesItem(label, item));
      });
      if (menuControl) {
        sibling.remove();
        return;
      }
    }
  }

  async function deleteViaVisibleUi(item) {
    const row = item.element;
    if (!row || !row.isConnected) {
      throw new Error("row is no longer visible");
    }

    row.classList.add(`${EXT}-deleting`);
    row.classList.remove(`${EXT}-failed`);
    row.scrollIntoView({ block: "center", inline: "nearest" });
    emitHover(row);
    await sleep(180);

    let action = findMenuButton(row, item);
    if (!action) {
      openContextMenu(row);
      action = await waitFor(() => Core.findDeleteAction(document), 1800);
    }

    if (!action) {
      throw new Error("menu button not found");
    }

    const actionIsDelete = Core.isDeleteAction(action);
    clickElement(action);
    await sleep(actionIsDelete ? 160 : 260);

    if (!actionIsDelete) {
      const deleteAction = await waitFor(() => Core.findDeleteAction(document), 2600);
      clickElement(deleteAction);
      await sleep(180);
    }

    const confirmButton = await waitFor(() => Core.findConfirmDeleteButton(document), 3200);
    clickElement(confirmButton);
    await waitForRemoval(item, 6500);
  }

  function findMenuButton(row, item) {
    if (item && item.menuElement && item.menuElement.isConnected && isUsablePageControl(item.menuElement)) {
      return item.menuElement;
    }

    const direct = Core.findRowActionButton(row);
    if (direct) {
      return direct;
    }

    const rowRect = row.getBoundingClientRect();
    const roots = uniqueElements([
      row,
      row.parentElement,
      row.parentElement?.parentElement,
      row.parentElement?.parentElement?.parentElement
    ]);

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button,[role='button']"))
        .filter(isUsablePageControl);
      const labeled = buttons.find((button) => {
        const text = normalizeText(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent);
        return /options|more|menu|actions/i.test(text) &&
          (menuLabelMatchesItem(text, item) || controlIsAlignedWithRow(button, rowRect));
      });

      if (labeled) {
        return labeled;
      }
    }

    return Array.from(document.querySelectorAll("button,[role='button']"))
      .filter(isUsablePageControl)
      .filter((button) => Core.isMenuAction(button) && controlIsAlignedWithRow(button, rowRect))
      .sort((first, second) => second.getBoundingClientRect().left - first.getBoundingClientRect().left)[0] || null;
  }

  function menuLabelMatchesItem(label, item) {
    if (!item || !item.title) {
      return false;
    }
    const menuLabel = normalizeText(label).toLowerCase();
    const title = normalizeText(item.title).toLowerCase();
    return title.length >= 4 && menuLabel.includes(title);
  }

  function controlIsAlignedWithRow(control, rowRect) {
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }

    const verticallyAligned = rect.top < rowRect.bottom + 10 && rect.bottom > rowRect.top - 10;
    const closeToRow = rect.left > rowRect.left && rect.left < rowRect.right + 120;
    return verticallyAligned && closeToRow;
  }

  function isUsablePageControl(element) {
    return element &&
      !Core.isExtensionElement(element) &&
      Core.isVisible(element) &&
      element.getAttribute("aria-disabled") !== "true" &&
      !element.disabled;
  }

  function openContextMenu(element) {
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  }

  function emitHover(element) {
    for (const type of ["pointerover", "mouseover", "mouseenter"]) {
      dispatchSyntheticInput(element, type);
    }
  }

  function clickElement(element) {
    if (!element) {
      return;
    }

    if (typeof element.focus === "function") {
      try {
        element.focus({ preventScroll: true });
      } catch (_error) {
        element.focus();
      }
    }

    for (const type of ["pointerover", "pointerenter", "pointermove", "pointerdown", "pointerup"]) {
      dispatchSyntheticInput(element, type);
    }

    for (const type of ["mouseover", "mouseenter", "mousemove", "mousedown", "mouseup", "click"]) {
      dispatchSyntheticInput(element, type);
    }
  }

  function dispatchSyntheticInput(element, type) {
    const isPointer = type.startsWith("pointer");
    const EventCtor = isPointer && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.min(rect.width / 2 || 1, 12));
    const clientY = rect.top + Math.max(1, Math.min(rect.height / 2 || 1, 12));
    const isDown = type === "pointerdown" || type === "mousedown";
    const isEnter = type === "mouseenter" || type === "pointerenter";
    const init = {
      bubbles: !isEnter,
      cancelable: true,
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY,
      view: window,
      button: 0,
      buttons: isDown ? 1 : 0
    };

    if (isPointer) {
      init.pointerId = 1;
      init.pointerType = "mouse";
      init.isPrimary = true;
    }

    element.dispatchEvent(new EventCtor(type, init));
  }

  async function waitForRemoval(item, timeoutMs) {
    return waitFor(() => {
      const current = state.items.get(item.key);
      if (!item.element.isConnected || !current || !current.element.isConnected) {
        return true;
      }
      if (item.href && !hrefStillPresent(item.href)) {
        return true;
      }
      return false;
    }, timeoutMs);
  }

  function hrefStillPresent(href) {
    return Array.from(document.querySelectorAll("a[href]")).some((anchor) => {
      try {
        return new URL(anchor.getAttribute("href"), window.location.href).href === href;
      } catch (_error) {
        return false;
      }
    });
  }

  function markDeleted(item) {
    for (const row of document.querySelectorAll("[data-cbd-key]")) {
      if (row.dataset.cbdKey !== item.key) {
        continue;
      }

      row.classList.add(`${EXT}-row-deleted`);
      window.setTimeout(() => {
        if (row.isConnected) {
          row.remove();
        }
      }, 260);
    }
  }

  function markFailed(item) {
    for (const row of document.querySelectorAll("[data-cbd-key]")) {
      if (row.dataset.cbdKey === item.key) {
        row.classList.remove(`${EXT}-deleting`);
        row.classList.add(`${EXT}-failed`);
      }
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

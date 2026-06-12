(function (global, factory) {
  const api = factory();
  global.ClaudeBulkDeleteCore = api;
  if (typeof window === "object" && window) {
    window.ClaudeBulkDeleteCore = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const extensionSelector = [
    "[data-cbd-owned]",
    "[data-cbd-root]",
    ".cbd-panel",
    ".cbd-selector",
    ".cbd-toolbar",
    ".cbd-row-control"
  ].join(",");
  const codeDataSelector = [
    "[data-session-id]",
    "[data-conversation-id]",
    "[data-chat-id]",
    "[data-thread-id]"
  ].join(",");
  const routeWords = new Set([
    "new chat",
    "new session",
    "routines",
    "customize",
    "settings",
    "research preview",
    "recents"
  ]);

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function ownerDocument(root) {
    return root && root.nodeType === 9 ? root : root.ownerDocument || document;
  }

  function queryAll(root, selector) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    return Array.from(root.querySelectorAll(selector));
  }

  function isElement(node) {
    return Boolean(node && node.nodeType === 1);
  }

  function isExtensionElement(element) {
    return isElement(element) && Boolean(element.closest(extensionSelector));
  }

  function isVisible(element) {
    if (!isElement(element)) return false;
    const doc = ownerDocument(element);
    const view = doc.defaultView;
    let cursor = element;
    while (cursor && isElement(cursor)) {
      if (cursor.hidden || cursor.getAttribute("aria-hidden") === "true") return false;
      if (view && typeof view.getComputedStyle === "function") {
        const style = view.getComputedStyle(cursor);
        if (style.display === "none" || style.visibility === "hidden") return false;
      }
      cursor = cursor.parentElement;
    }
    return true;
  }

  function toURL(value, location) {
    try {
      const base = location && location.href ? location.href : "https://claude.ai/";
      return new URL(value, base);
    } catch (_error) {
      return null;
    }
  }

  function isClaudeHost(url) {
    return Boolean(url && (url.hostname === "claude.ai" || url.hostname.endsWith(".claude.ai")));
  }

  function isWebChatUrl(url) {
    return isClaudeHost(url) && /^\/chat\/[^/]+/.test(url.pathname) && !/\/new\/?$/.test(url.pathname);
  }

  function isCodeContext(location) {
    const path = location && location.pathname ? location.pathname : "";
    return path === "/code" || path.startsWith("/code/");
  }

  function isCodeSessionUrl(url) {
    if (!isClaudeHost(url) || !url.pathname.startsWith("/code/")) return false;

    const path = url.pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const second = parts[1] || "";

    if (parts.length < 2) return false;
    if (["new", "settings", "customize", "routines", "projects", "project"].includes(second) && parts.length === 2) {
      return false;
    }
    if (["session", "sessions", "chat", "chats", "conversation", "conversations", "thread", "threads"].includes(second)) {
      return parts.length >= 3;
    }

    return parts.length === 2;
  }

  function hasAncestorInSet(element, elements) {
    return elements.some((candidate) => candidate !== element && candidate.contains(element));
  }

  function looksLikeActionControl(element) {
    const label = actionLabel(element).toLowerCase();
    if (!label) return false;
    return /\b(more|options|actions|menu|rename|delete|remove|archive|share|copy)\b/.test(label) ||
      label === "..." ||
      label === "···";
  }

  function readableText(element) {
    if (!isElement(element)) return "";
    const clone = element.cloneNode(true);

    queryAll(clone, [
      extensionSelector,
      "script",
      "style",
      "svg",
      "[aria-hidden='true']"
    ].join(",")).forEach((node) => node.remove());

    queryAll(clone, "button, [role='button']").forEach((node) => {
      if (node !== clone && looksLikeActionControl(node)) node.remove();
    });

    const textNodes = [];
    const walker = ownerDocument(clone).createTreeWalker(clone, 4);
    while (walker.nextNode()) {
      const text = normalizeText(walker.currentNode.nodeValue);
      if (text) textNodes.push(text);
    }
    return normalizeText(textNodes.join(" "));
  }

  function isRouteText(text) {
    const normalized = normalizeText(text).toLowerCase();
    return !normalized || routeWords.has(normalized);
  }

  function titleForElement(element) {
    const text = readableText(element);
    if (text.length <= 160) return text;
    return `${text.slice(0, 157)}...`;
  }

  function makeItem(element, source, location, href, id) {
    const title = titleForElement(element);
    if (isRouteText(title)) return null;
    const key = href || `${source}:${id || title}`;
    return { element, source, title, href, key };
  }

  function collectConversationItems(root, location) {
    const loc = location || ownerDocument(root).location || new URL("https://claude.ai/");
    const items = [];
    const seenKeys = new Set();

    queryAll(root, "a[href]").forEach((anchor) => {
      if (isExtensionElement(anchor) || !isVisible(anchor)) return;
      const url = toURL(anchor.getAttribute("href"), loc);
      if (!url) return;

      let source = null;
      if (isWebChatUrl(url)) source = "claude-web";
      if (isCodeSessionUrl(url)) source = "claude-code";
      if (!source) return;

      const item = makeItem(anchor, source, loc, url.href, "");
      if (!item || seenKeys.has(item.key)) return;
      seenKeys.add(item.key);
      items.push(item);
    });

    if (isCodeContext(loc)) {
      const anchorElements = items.map((item) => item.element);
      queryAll(root, codeDataSelector).forEach((element) => {
        if (isExtensionElement(element) || !isVisible(element) || hasAncestorInSet(element, anchorElements)) return;
        const id = element.getAttribute("data-session-id") ||
          element.getAttribute("data-conversation-id") ||
          element.getAttribute("data-chat-id") ||
          element.getAttribute("data-thread-id") ||
          "";
        const item = makeItem(element, "claude-code", loc, "", id);
        if (!item || seenKeys.has(item.key)) return;
        seenKeys.add(item.key);
        items.push(item);
      });
    }

    return items;
  }

  function actionLabel(element) {
    if (!isElement(element)) return "";
    return normalizeText([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.textContent
    ].filter(Boolean).join(" "));
  }

  function isDisabled(element) {
    return Boolean(
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.getAttribute("disabled") !== null
    );
  }

  function isDeleteAction(element) {
    if (!isElement(element) || isExtensionElement(element) || !isVisible(element) || isDisabled(element)) return false;
    const label = actionLabel(element).toLowerCase();
    if (!/\b(delete|remove)\b/.test(label)) return false;
    return !/\b(cancel|clear|bulk|selected|selection|undo)\b/.test(label);
  }

  function isMenuAction(element) {
    if (!isElement(element) || isExtensionElement(element) || !isVisible(element) || isDisabled(element)) return false;
    const label = actionLabel(element).toLowerCase();
    return /\b(more|options|actions|menu)\b/.test(label) || label === "..." || label === "···";
  }

  function interactiveCandidates(root) {
    return queryAll(root, [
      "button",
      "[role='button']",
      "[role='menuitem']",
      "[aria-label]",
      "[title]"
    ].join(","));
  }

  function findDeleteAction(root) {
    return interactiveCandidates(root).find(isDeleteAction) || null;
  }

  function findConfirmDeleteButton(root) {
    const scopes = queryAll(root, "dialog, [role='dialog'], [role='alertdialog'], [data-radix-portal]")
      .filter(isVisible);
    for (const scope of scopes) {
      const button = findDeleteAction(scope);
      if (button) return button;
    }
    return findDeleteAction(root);
  }

  function findRowActionButton(row) {
    const candidates = interactiveCandidates(row).filter((element) => element !== row);
    return candidates.find(isDeleteAction) || candidates.find(isMenuAction) || null;
  }

  return {
    collectConversationItems,
    findConfirmDeleteButton,
    findDeleteAction,
    findRowActionButton,
    isCodeContext,
    isDeleteAction,
    isExtensionElement,
    isMenuAction,
    isVisible,
    normalizeText,
    readableText
  };
});

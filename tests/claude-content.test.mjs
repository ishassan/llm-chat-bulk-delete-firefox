import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);

async function loadScript(name) {
  return readFile(new URL(name, root), "utf8");
}

async function waitFor(window, predicate, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = predicate();
    if (result) {
      return result;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

async function startSelecting(window) {
  const toggleButton = await waitFor(window, () => window.document.querySelector("[data-cbd-action='toggle']"));
  toggleButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await waitFor(window, () => window.document.querySelector("[data-cbd-action='select-all']")?.hidden === false);
  await waitFor(window, () => window.document.querySelector(".cbd-selector"));
}

test("content script matches ChatGPT selection mode behavior on Claude pages", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <a href="/chat/111"><span>Trip plan</span></a>
        <a href="/chat/222"><span>Work report</span></a>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await new Promise((resolve) => instance.window.setTimeout(resolve, 250));

    const { document } = instance.window;
    assert.equal(document.querySelectorAll(".cbd-selector").length, 0);
    assert.equal(document.querySelector("[data-cbd-action='toggle']")?.textContent, "Select chats");
    assert.equal(document.querySelector("[data-cbd-action='select-all']")?.hidden, true);
    assert.equal(document.querySelector("[data-cbd-action='clear']")?.hidden, true);
    assert.equal(document.querySelector("[data-cbd-action='delete']")?.hidden, true);
    assert.equal(document.querySelector(".cbd-status")?.textContent, "");

    await startSelecting(instance.window);

    assert.equal(instance.window.document.querySelectorAll(".cbd-selector").length, 2);
    assert.equal(document.querySelector("[data-cbd-action='toggle']")?.textContent, "Cancel");
    assert.equal(document.querySelector("[data-cbd-action='select-all']")?.hidden, false);
    assert.equal(document.querySelector("[data-cbd-action='clear']")?.hidden, false);
    assert.equal(document.querySelector("[data-cbd-action='delete']")?.hidden, false);
    assert.equal(document.querySelector(".cbd-status")?.textContent, "Select chats from the sidebar.");
    assert.equal(instance.window.document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script only decorates Claude Web chat links, not sidebar navigation", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <a href="/new"><span>New chat</span></a>
        <a href="/recents"><span>Chats</span></a>
        <a href="/projects"><span>Projects</span></a>
        <a href="/artifacts"><span>Artifacts</span></a>
        <a href="/customize"><span>Customize</span></a>
        <section aria-label="Products">
          <a href="/code"><span>Code</span></a>
          <a href="/design"><span>Design</span></a>
        </section>
        <section aria-label="Recents">
          <a href="/chat/111"><span>Trip plan</span></a>
          <a href="/chat/222"><span>Work report</span></a>
        </section>
        <button>Invite team members</button>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/new"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);

    const selectors = Array.from(instance.window.document.querySelectorAll(".cbd-selector"));
    assert.equal(selectors.length, 2);
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-label")),
      ["Select Trip plan", "Select Work report"]
    );
    assert.equal(instance.window.document.querySelector(".cbd-status")?.textContent, "Select chats from the sidebar.");
  } finally {
    instance.window.close();
  }
});

test("shift-click selects the visible range", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <a href="/chat/111"><span>First test thread</span></a>
        <a href="/chat/222"><span>Second test thread</span></a>
        <a href="/chat/333"><span>Third test thread</span></a>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);

    const selectors = instance.window.document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new instance.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new instance.window.MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));

    assert.equal(instance.window.document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "3 selected");
    assert.deepEqual(
      Array.from(selectors).map((selector) => selector.getAttribute("aria-checked")),
      ["true", "true", "true"]
    );
  } finally {
    instance.window.close();
  }
});

test("content script decorates Claude Web recents table rows", async () => {
  const instance = new JSDOM(`
    <body>
      <main>
        <h1>Chats</h1>
        <table>
          <tbody>
            <tr data-chat-row="first">
              <td></td>
              <td><span>First table thread</span></td>
              <td>just now</td>
              <td><button type="button" aria-label="More options for First table thread">...</button></td>
            </tr>
            <tr data-chat-row="second">
              <td></td>
              <td><span>Second table thread</span></td>
              <td>1 minute ago</td>
              <td><button type="button" aria-label="More options for Second table thread">...</button></td>
            </tr>
            <tr data-chat-row="third">
              <td></td>
              <td><span>Third table thread</span></td>
              <td>yesterday</td>
              <td><button type="button" aria-label="More options for Third table thread">...</button></td>
            </tr>
          </tbody>
        </table>
      </main>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/recents"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 3);

    const selectors = Array.from(document.querySelectorAll(".cbd-selector"));
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-label")),
      ["Select First table thread", "Select Second table thread", "Select Third table thread"]
    );

    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));

    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "3 selected");
    assert.equal(document.querySelector(".cbd-status")?.textContent, "Selected range of 3 chats (2 new).");
  } finally {
    instance.window.close();
  }
});

test("content script deletes selected Claude Web chats via visible menus", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <a href="/chat/111" data-thread="first">
          <span>First disposable thread</span>
          <button type="button" aria-label="More options for First disposable thread" data-menu-for="first">...</button>
        </a>
        <a href="/chat/222" data-thread="second">
          <span>Second disposable thread</span>
          <button type="button" aria-label="More options for Second disposable thread" data-menu-for="second">...</button>
        </a>
        <a href="/chat/333" data-thread="third">
          <span>Third disposable thread</span>
          <button type="button" aria-label="More options for Third disposable thread" data-menu-for="third">...</button>
        </a>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

    document.addEventListener("click", (event) => {
      const menuButton = event.target.closest("[data-menu-for]");
      if (menuButton) {
        event.preventDefault();
        document.querySelector("[role='menu']")?.remove();
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.setAttribute("role", "menuitem");
        deleteButton.setAttribute("aria-label", "Delete chat");
        deleteButton.dataset.deleteFor = menuButton.dataset.menuFor;
        deleteButton.textContent = "Delete";
        menu.append(deleteButton);
        document.body.append(menu);
      }

      const deleteButton = event.target.closest("[data-delete-for]");
      if (deleteButton) {
        event.preventDefault();
        document.querySelector("[role='dialog']")?.remove();
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.setAttribute("aria-label", "Delete chat");
        confirmButton.dataset.confirmFor = deleteButton.dataset.deleteFor;
        confirmButton.textContent = "Delete";
        dialog.append(confirmButton);
        document.body.append(dialog);
      }

      const confirmButton = event.target.closest("[data-confirm-for]");
      if (confirmButton) {
        event.preventDefault();
        document.querySelector(`[data-thread="${confirmButton.dataset.confirmFor}"]`)?.remove();
        confirmButton.closest("[role='dialog']")?.remove();
        document.querySelector("[role='menu']")?.remove();
      }
    });

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 3);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 7000);

    assert.equal(document.querySelectorAll("a[href^='/chat/']").length, 0);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script deletes selected Claude Web recents table rows via row menus", async () => {
  const instance = new JSDOM(`
    <body>
      <main>
        <table>
          <tbody>
            <tr data-thread="first">
              <td></td>
              <td><span>Bulk delete test web confirmation</span></td>
              <td>just now</td>
              <td><button type="button" aria-label="More options for Bulk delete test web confirmation" data-menu-for="first">...</button></td>
            </tr>
            <tr data-thread="second">
              <td></td>
              <td><span>Bulk delete test web confirmation</span></td>
              <td>just now</td>
              <td><button type="button" aria-label="More options for Bulk delete test web confirmation" data-menu-for="second">...</button></td>
            </tr>
            <tr data-thread="third">
              <td></td>
              <td><span>Bulk delete test web confirmation</span></td>
              <td>1 minute ago</td>
              <td><button type="button" aria-label="More options for Bulk delete test web confirmation" data-menu-for="third">...</button></td>
            </tr>
          </tbody>
        </table>
      </main>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/recents"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

    document.addEventListener("click", (event) => {
      const menuButton = event.target.closest("[data-menu-for]");
      if (menuButton) {
        event.preventDefault();
        document.querySelector("[role='menu']")?.remove();
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.setAttribute("role", "menuitem");
        deleteButton.setAttribute("aria-label", "Delete chat");
        deleteButton.dataset.deleteFor = menuButton.dataset.menuFor;
        deleteButton.textContent = "Delete";
        menu.append(deleteButton);
        document.body.append(menu);
      }

      const deleteButton = event.target.closest("[data-delete-for]");
      if (deleteButton) {
        event.preventDefault();
        document.querySelector("[role='dialog']")?.remove();
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.setAttribute("aria-label", "Delete chat");
        confirmButton.dataset.confirmFor = deleteButton.dataset.deleteFor;
        confirmButton.textContent = "Delete";
        dialog.append(confirmButton);
        document.body.append(dialog);
      }

      const confirmButton = event.target.closest("[data-confirm-for]");
      if (confirmButton) {
        event.preventDefault();
        document.querySelector(`[data-thread="${confirmButton.dataset.confirmFor}"]`)?.remove();
        confirmButton.closest("[role='dialog']")?.remove();
        document.querySelector("[role='menu']")?.remove();
      }
    });

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 3);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 7000);

    assert.equal(document.querySelectorAll("[data-thread]").length, 0);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script deletes Web rows with dynamic sibling menus without clicking unrelated buttons", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button type="button" data-wrong-click="customize">Customize</button>
        <section aria-label="Recents">
          <div data-thread="first">
            <a href="/chat/111"><span>Bulk delete test web confirmation</span></a>
            <button type="button" aria-label="More options for Bulk delete test web confirmation" data-menu-for="first">...</button>
          </div>
          <a href="/chat/222" data-thread="second"><span>Bulk delete test web confirmation</span></a>
        </section>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

    document.addEventListener("mouseover", (event) => {
      const second = event.target.closest("[data-thread='second']");
      if (!second || document.querySelector("[data-menu-for='second']")) {
        return;
      }

      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.setAttribute("aria-label", "More options for Bulk delete test web confirmation");
      menuButton.dataset.menuFor = "second";
      menuButton.textContent = "...";
      second.after(menuButton);
    });

    document.addEventListener("click", (event) => {
      const wrongButton = event.target.closest("[data-wrong-click]");
      if (wrongButton) {
        document.body.dataset.wrongClick = wrongButton.dataset.wrongClick;
      }

      const menuButton = event.target.closest("[data-menu-for]");
      if (menuButton) {
        event.preventDefault();
        document.querySelector("[role='menu']")?.remove();
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.setAttribute("role", "menuitem");
        deleteButton.setAttribute("aria-label", "Delete chat");
        deleteButton.dataset.deleteFor = menuButton.dataset.menuFor;
        deleteButton.textContent = "Delete";
        menu.append(deleteButton);
        document.body.append(menu);
      }

      const deleteButton = event.target.closest("[data-delete-for]");
      if (deleteButton) {
        event.preventDefault();
        document.querySelector("[role='dialog']")?.remove();
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.setAttribute("aria-label", "Delete chat");
        confirmButton.dataset.confirmFor = deleteButton.dataset.deleteFor;
        confirmButton.textContent = "Delete";
        dialog.append(confirmButton);
        document.body.append(dialog);
      }

      const confirmButton = event.target.closest("[data-confirm-for]");
      if (confirmButton) {
        const key = confirmButton.dataset.confirmFor;
        document.querySelector(`[data-thread="${key}"]`)?.remove();
        document.querySelector(`[data-menu-for="${key}"]`)?.remove();
        confirmButton.closest("[role='dialog']")?.remove();
        document.querySelector("[role='menu']")?.remove();
      }
    });

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 2);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 2 chats.", 5000);

    assert.equal(document.querySelectorAll("[data-thread]").length, 0);
    assert.equal(document.body.dataset.wrongClick, undefined);
  } finally {
    instance.window.close();
  }
});

test("content script deletes Claude Web sidebar chats through the conversations API", async () => {
  const orgUuid = "11111111-1111-4111-8111-111111111111";
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <section aria-label="Recents">
          <a href="/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" data-thread="first">
            <span>Bulk delete test web confirmation</span>
          </a>
          <a href="/chat/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-thread="second">
            <span>Bulk delete test web confirmation</span>
          </a>
          <a href="/chat/cccccccc-cccc-4ccc-8ccc-cccccccccccc" data-thread="third">
            <span>Bulk delete test web confirmation</span>
          </a>
          <a href="/chat/dddddddd-dddd-4ddd-8ddd-dddddddddddd" data-thread="real">
            <span>Keep this real chat</span>
          </a>
        </section>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/new"
  });

  try {
    const { document, MouseEvent } = instance.window;
    const fetchCalls = [];
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    instance.window.localStorage.setItem("activeOrganizationUuid", orgUuid);
    instance.window.fetch = async (url, init = {}) => {
      fetchCalls.push({ init, url: String(url) });
      if (init.method === "DELETE") {
        return { ok: true, status: 204 };
      }
      return { ok: false, status: 500 };
    };

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 4);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 5000);
    await waitFor(instance.window, () => document.querySelectorAll("[data-thread]:not([data-thread='real'])").length === 0, 1000);

    assert.deepEqual(
      fetchCalls.map((call) => call.url),
      [
        `/api/organizations/${orgUuid}/chat_conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        `/api/organizations/${orgUuid}/chat_conversations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
        `/api/organizations/${orgUuid}/chat_conversations/cccccccc-cccc-4ccc-8ccc-cccccccccccc`
      ]
    );
    assert.deepEqual(fetchCalls.map((call) => call.init.method), ["DELETE", "DELETE", "DELETE"]);
    assert.equal(document.querySelector("[data-thread='real']")?.isConnected, true);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script decorates unlinked Claude Code recents rows", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <div>New session</div>
        <div><span>Data sources table</span><button aria-label="More options">...</button></div>
        <div><span>Workstatus WFH command</span><button aria-label="More options">...</button></div>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);

    assert.equal(instance.window.document.querySelectorAll(".cbd-selector").length, 2);
    assert.equal(instance.window.document.querySelectorAll("button[aria-label^='More options'].cbd-chat-row").length, 0);
    assert.equal(instance.window.document.querySelector(".cbd-status")?.textContent, "Select chats from the sidebar.");
  } finally {
    instance.window.close();
  }
});

test("content script decorates fresh Claude Code recents rows before menu controls appear", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <button>Routines</button>
        <button>Customize</button>
        <div>
          <button>Recents</button>
          <button>Filter</button>
          <div data-session-row="first"><span>Bulk delete test code</span></div>
          <div data-session-row="second"><span>Bulk delete test code</span></div>
          <div data-session-row="third"><span>Bulk delete test code</span></div>
        </div>
        <div>
          <span>Try the Slack app</span>
          <button>Install</button>
          <button>Dismiss</button>
        </div>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => instance.window.document.querySelectorAll(".cbd-selector").length === 3);

    const selectors = Array.from(instance.window.document.querySelectorAll(".cbd-selector"));
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-label")),
      ["Select Bulk delete test code", "Select Bulk delete test code", "Select Bulk delete test code"]
    );
    assert.equal(instance.window.document.querySelector(".cbd-status")?.textContent, "Select chats from the sidebar.");
  } finally {
    instance.window.close();
  }
});

test("content script decorates short Claude Code recents titles", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <section aria-label="Recents">
          <div data-session-row="third"><span>T3</span></div>
          <div data-session-row="second"><span>T2</span></div>
          <div data-session-row="first"><span>T1</span></div>
          <div data-session-row="long"><span>Optimize large folder for Google Drive</span></div>
        </section>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => instance.window.document.querySelectorAll(".cbd-selector").length === 4);

    const selectors = Array.from(instance.window.document.querySelectorAll(".cbd-selector"));
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-label")),
      [
        "Select T3",
        "Select T2",
        "Select T1",
        "Select Optimize large folder for Google Drive"
      ]
    );
  } finally {
    instance.window.close();
  }
});

test("content script skips Claude Code recents group headers", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <section aria-label="Recents">
          <div>Working</div>
          <div data-session-row="working"><span>T0</span></div>
          <div>Needs input</div>
          <div data-session-row="third"><span>T3</span></div>
          <div data-session-row="second"><span>T2</span></div>
          <div data-session-row="first"><span>T1</span></div>
          <div>Completed</div>
          <div data-session-row="long"><span>Optimize large folder for Google Drive</span></div>
        </section>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => instance.window.document.querySelectorAll(".cbd-selector").length >= 4);

    const selectors = Array.from(instance.window.document.querySelectorAll(".cbd-selector"));
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-label")),
      [
        "Select T0",
        "Select T3",
        "Select T2",
        "Select T1",
        "Select Optimize large folder for Google Drive"
      ]
    );
  } finally {
    instance.window.close();
  }
});

test("content script does not decorate emptied Claude Code groups after delete", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <section aria-label="Recents">
          <div data-group="needs-input">
            <div>Needs input</div>
            <div data-session-id="session_t3" data-session-row="third"><span>T3</span></div>
            <div data-session-id="session_t2" data-session-row="second"><span>T2</span></div>
            <div data-session-id="session_t1" data-session-row="first"><span>T1</span></div>
          </div>
          <div data-group="completed">
            <div>Completed</div>
            <div data-session-row="long"><span>Optimize large folder for Google Drive</span></div>
          </div>
        </section>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.fetch = async (_url, init = {}) => {
      if (init.method === "DELETE") {
        return { ok: true, status: 204 };
      }
      return { ok: false, status: 500 };
    };

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 4);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 5000);
    await waitFor(instance.window, () => document.querySelectorAll("[data-session-id]").length === 0, 1000);
    await new Promise((resolve) => instance.window.setTimeout(resolve, 250));

    const remainingSelectors = Array.from(document.querySelectorAll(".cbd-selector"));
    assert.deepEqual(
      remainingSelectors.map((selector) => selector.getAttribute("aria-label")),
      ["Select Optimize large folder for Google Drive"]
    );
    assert.equal(document.querySelector("[data-group='needs-input'] .cbd-selector"), null);
  } finally {
    instance.window.close();
  }
});

test("content script toggles Claude Code selectors when the row receives the checkbox click", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <div>
          <button>Recents</button>
          <button>Filter</button>
          <button data-session-row="first"><span>Bulk delete test code</span></button>
          <button data-session-row="second"><span>Bulk delete test code</span></button>
          <button data-session-row="third"><span>Bulk delete test code</span></button>
        </div>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 3);

    const rows = Array.from(document.querySelectorAll("[data-session-row]"));
    const selectors = Array.from(document.querySelectorAll(".cbd-selector"));
    selectors.forEach((selector, index) => {
      selector.getBoundingClientRect = () => ({
        bottom: 28 + index * 24,
        height: 18,
        left: 10,
        right: 28,
        top: 10 + index * 24,
        width: 18
      });
    });

    rows[0].dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 18,
      clientY: 18
    }));
    rows[2].dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 18,
      clientY: 66,
      shiftKey: true
    }));

    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "3 selected");
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-checked")),
      ["true", "true", "true"]
    );
  } finally {
    instance.window.close();
  }
});

test("content script deletes fresh Claude Code rows when menus appear on hover", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <div>
          <button>Recents</button>
          <button>Filter</button>
          <div data-session-row="first"><span>Bulk delete test code</span></div>
          <div data-session-row="second"><span>Bulk delete test code</span></div>
          <div data-session-row="third"><span>Bulk delete test code</span></div>
        </div>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

    document.addEventListener("mouseover", (event) => {
      const row = event.target.closest("[data-session-row]");
      if (!row || document.querySelector(`[data-menu-for="${row.dataset.sessionRow}"]`)) {
        return;
      }

      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.setAttribute("aria-label", "More options for Bulk delete test code");
      menuButton.dataset.menuFor = row.dataset.sessionRow;
      menuButton.textContent = "...";
      row.after(menuButton);
    });

    document.addEventListener("click", (event) => {
      const menuButton = event.target.closest("[data-menu-for]");
      if (menuButton) {
        event.preventDefault();
        document.querySelector("[role='menu']")?.remove();
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.setAttribute("role", "menuitem");
        deleteButton.setAttribute("aria-label", "Delete session");
        deleteButton.dataset.deleteFor = menuButton.dataset.menuFor;
        deleteButton.textContent = "Delete";
        menu.append(deleteButton);
        document.body.append(menu);
      }

      const deleteButton = event.target.closest("[data-delete-for]");
      if (deleteButton) {
        event.preventDefault();
        document.querySelector("[role='dialog']")?.remove();
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.setAttribute("aria-label", "Delete session");
        confirmButton.dataset.confirmFor = deleteButton.dataset.deleteFor;
        confirmButton.textContent = "Delete";
        dialog.append(confirmButton);
        document.body.append(dialog);
      }

      const confirmButton = event.target.closest("[data-confirm-for]");
      if (confirmButton) {
        const key = confirmButton.dataset.confirmFor;
        document.querySelector(`[data-session-row="${key}"]`)?.remove();
        document.querySelector(`[data-menu-for="${key}"]`)?.remove();
        confirmButton.closest("[role='dialog']")?.remove();
        document.querySelector("[role='menu']")?.remove();
      }
    });

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 3);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 7000);

    assert.equal(document.querySelectorAll("[data-session-row]").length, 0);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script deletes selected Claude Code sessions through the sessions API", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <button>New session</button>
        <div>
          <button>Recents</button>
          <button>Filter</button>
          <div data-session-row="real-before"><span>Investigate Glue catalog key in Spark configuration</span></div>
          <div data-session-row="first"><span>Bulk delete test code</span></div>
          <div data-session-row="second"><span>Bulk delete test code</span></div>
          <div data-session-row="third"><span>Bulk delete test code</span></div>
          <div data-session-row="real-after"><span>Understand load-bearing extension line in MERGE INTO</span></div>
        </div>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    const fetchCalls = [];
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    instance.window.fetch = async (url, init = {}) => {
      fetchCalls.push({ init, url: String(url) });
      if (String(url).startsWith("/v1/code/sessions?")) {
        return {
          json: async () => ({
            data: [
              { id: "session_real_before", title: "Investigate Glue catalog key in Spark configuration" },
              { id: "session_code_1", title: "Bulk delete test code" },
              { id: "session_code_2", title: "Bulk delete test code" },
              { id: "session_code_3", title: "Bulk delete test code" },
              { id: "session_real_after", title: "Understand load-bearing extension line in MERGE INTO" }
            ],
            has_more: false
          }),
          ok: true,
          status: 200
        };
      }

      if (init.method === "DELETE") {
        return { ok: true, status: 204 };
      }

      return { ok: false, status: 500 };
    };

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 5);

    const rows = Array.from(document.querySelectorAll("[data-session-row]"));
    const selectors = Array.from(document.querySelectorAll(".cbd-selector"));
    selectors[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[3].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 5000);

    assert.deepEqual(
      fetchCalls
        .filter((call) => call.init.method === "DELETE")
        .map((call) => call.url),
      [
        "/v1/code/sessions/session_code_1",
        "/v1/code/sessions/session_code_2",
        "/v1/code/sessions/session_code_3"
      ]
    );
    assert.equal(fetchCalls.filter((call) => call.url.startsWith("/v1/code/sessions?")).length, 1);
    assert.equal(fetchCalls[1].init.headers["anthropic-version"], "2023-06-01");
    assert.equal(fetchCalls[1].init.headers["anthropic-beta"], "ccr-byoc-2025-07-29");
    assert.equal(fetchCalls[1].init.headers["anthropic-client-feature"], "ccr");
    assert.deepEqual(rows.map((row) => row.isConnected), [true, false, false, false, true]);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script ignores Claude Code controls and promotional cards", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Sidebar">
        <div>
          <button>New session</button>
          <button>Routines</button>
          <button>Customize</button>
        </div>
        <section aria-label="Recents">
          <button>Recents</button>
          <button>Filter</button>
          <button>Awaiting input First real session</button>
          <button aria-label="More options for First real session">...</button>
          <button>Idle Second real session</button>
          <button aria-label="More options for Second real session">...</button>
        </section>
        <aside>
          <span>Try the Slack app</span>
          <button>Install</button>
          <button>Dismiss</button>
        </aside>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);

    const selectors = Array.from(instance.window.document.querySelectorAll(".cbd-selector"));
    assert.equal(selectors.length, 2);
    assert.deepEqual(
      selectors.map((selector) => selector.getAttribute("aria-label")),
      ["Select First real session", "Select Second real session"]
    );
    assert.equal(instance.window.document.querySelector(".cbd-status")?.textContent, "Select chats from the sidebar.");
  } finally {
    instance.window.close();
  }
});

test("content script keeps Claude Code selectors scoped to the sidebar inside layout wrappers", async () => {
  const instance = new JSDOM(`
    <body>
      <div class="layout-with-sidebar">
        <aside aria-label="Sidebar">
          <section aria-label="Recents">
            <button>Awaiting input Sidebar test session</button>
            <button aria-label="More options for Sidebar test session">...</button>
          </section>
        </aside>
        <main>
          <section aria-label="Sessions">
            <button>Open session Main pane session</button>
            <button aria-label="More options for Main pane session">...</button>
          </section>
        </main>
      </div>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 1);

    const selector = document.querySelector(".cbd-selector");
    assert.equal(selector?.getAttribute("aria-label"), "Select Sidebar test session");
    selector.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.querySelector(".layout-with-sidebar").dataset.changed = "true";

    await new Promise((resolve) => instance.window.setTimeout(resolve, 250));
    assert.equal(document.querySelectorAll(".cbd-selector").length, 1);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "1 selected");
    assert.equal(document.querySelector(".cbd-status")?.textContent, "Select chats from the sidebar.");
  } finally {
    instance.window.close();
  }
});

test("content script deletes selected Claude Code sessions via paired menu buttons", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <button type="button" data-session-row="first">Idle First disposable code session</button>
        <button type="button" aria-label="More options for First disposable code session" data-menu-for="first">...</button>
        <button type="button" data-session-row="second">Needs input Second disposable code session</button>
        <button type="button" aria-label="More options for Second disposable code session" data-menu-for="second">...</button>
        <button type="button" data-session-row="third">Idle Third disposable code session</button>
        <button type="button" aria-label="More options for Third disposable code session" data-menu-for="third">...</button>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

    document.addEventListener("click", (event) => {
      const menuButton = event.target.closest("[data-menu-for]");
      if (menuButton) {
        event.preventDefault();
        document.querySelector("[role='menu']")?.remove();
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.setAttribute("role", "menuitem");
        deleteButton.setAttribute("aria-label", "Delete session");
        deleteButton.dataset.deleteFor = menuButton.dataset.menuFor;
        deleteButton.textContent = "Delete";
        menu.append(deleteButton);
        document.body.append(menu);
      }

      const deleteButton = event.target.closest("[data-delete-for]");
      if (deleteButton) {
        event.preventDefault();
        document.querySelector("[role='dialog']")?.remove();
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.setAttribute("aria-label", "Delete session");
        confirmButton.dataset.confirmFor = deleteButton.dataset.deleteFor;
        confirmButton.textContent = "Delete";
        dialog.append(confirmButton);
        document.body.append(dialog);
      }

      const confirmButton = event.target.closest("[data-confirm-for]");
      if (confirmButton) {
        const key = confirmButton.dataset.confirmFor;
        document.querySelector(`[data-session-row="${key}"]`)?.remove();
        document.querySelector(`[data-menu-for="${key}"]`)?.remove();
        confirmButton.closest("[role='dialog']")?.remove();
        document.querySelector("[role='menu']")?.remove();
      }
    });

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 3);

    const selectors = document.querySelectorAll(".cbd-selector");
    selectors[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    selectors[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 3 chats.", 7000);

    assert.equal(document.querySelectorAll("[data-session-row]").length, 0);
    assert.equal(document.querySelectorAll("[data-menu-for]").length, 0);
    assert.equal(document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

test("content script activates Claude Code menu items that require pointer events", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <button type="button" data-session-row="first">Running Bulk delete test code</button>
        <button type="button" aria-label="More options for Bulk delete test code" data-menu-for="first">...</button>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    url: "https://claude.ai/code"
  });

  try {
    const { document, MouseEvent } = instance.window;
    instance.window.confirm = () => true;
    instance.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    instance.window.PointerEvent = class PointerEvent extends MouseEvent {};

    document.addEventListener("click", (event) => {
      const menuButton = event.target.closest("[data-menu-for]");
      if (menuButton) {
        event.preventDefault();
        document.querySelector("[role='menu']")?.remove();
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const deleteItem = document.createElement("div");
        deleteItem.setAttribute("role", "menuitem");
        deleteItem.setAttribute("aria-label", "Delete session");
        deleteItem.dataset.deleteFor = menuButton.dataset.menuFor;
        deleteItem.textContent = "Delete";
        menu.append(deleteItem);
        document.body.append(menu);
      }

      const confirmButton = event.target.closest("[data-confirm-for]");
      if (confirmButton) {
        const key = confirmButton.dataset.confirmFor;
        document.querySelector(`[data-session-row="${key}"]`)?.remove();
        document.querySelector(`[data-menu-for="${key}"]`)?.remove();
        confirmButton.closest("[role='dialog']")?.remove();
        document.querySelector("[role='menu']")?.remove();
      }
    });

    document.addEventListener("pointerup", (event) => {
      const deleteItem = event.target.closest("[data-delete-for]");
      if (!deleteItem || event.constructor.name !== "PointerEvent") {
        return;
      }

      document.querySelector("[role='dialog']")?.remove();
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.setAttribute("aria-label", "Delete session");
      confirmButton.dataset.confirmFor = deleteItem.dataset.deleteFor;
      confirmButton.textContent = "Delete";
      dialog.append(confirmButton);
      document.body.append(dialog);
    });

    instance.window.eval(await loadScript("src/claude/core.js"));
    instance.window.eval(await loadScript("src/claude/content.js"));
    await startSelecting(instance.window);
    await waitFor(instance.window, () => document.querySelectorAll(".cbd-selector").length === 1);

    document.querySelector(".cbd-selector").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.querySelector("[data-cbd-action='delete']").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(instance.window, () => document.querySelector(".cbd-status")?.textContent === "Deleted 1 chat.", 5000);

    assert.equal(document.querySelectorAll("[data-session-row]").length, 0);
    assert.equal(document.querySelectorAll("[data-menu-for]").length, 0);
  } finally {
    instance.window.close();
  }
});

test("content script reads the core API from the content-script global", async () => {
  const instance = new JSDOM(`
    <body>
      <aside aria-label="Recents">
        <a href="/chat/111"><span>Firefox split global thread</span></a>
      </aside>
    </body>
  `, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
    url: "https://claude.ai/"
  });

  try {
    instance.window.eval(await loadScript("src/claude/core.js"));
    const coreApi = instance.window.ClaudeBulkDeleteCore;
    const sandbox = {
      ClaudeBulkDeleteCore: coreApi,
      document: instance.window.document,
      MutationObserver: instance.window.MutationObserver,
      MouseEvent: instance.window.MouseEvent,
      URL: instance.window.URL,
      window: instance.window
    };
    instance.window.ClaudeBulkDeleteCore = undefined;
    vm.createContext(sandbox);
    vm.runInContext(await loadScript("src/claude/content.js"), sandbox);
    await startSelecting(instance.window);

    assert.equal(instance.window.document.querySelectorAll(".cbd-selector").length, 1);
    assert.equal(instance.window.document.querySelector(".cbd-panel [data-cbd-count]")?.textContent, "0 selected");
  } finally {
    instance.window.close();
  }
});

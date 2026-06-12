import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const core = require("../src/claude/core.js");

function dom(html, url = "https://claude.ai/") {
  const instance = new JSDOM(html, { url });
  return instance.window.document;
}

test("collects Claude web chat rows and ignores navigation controls", () => {
  const document = dom(`
    <main>
      <nav aria-label="Claude navigation">
        <a href="/new"><span>New chat</span></a>
        <a href="/chat/111"><span>Trip plan</span><button aria-label="More options">...</button></a>
        <a href="/chat/222"><span>Work report</span></a>
        <a href="/settings"><span>Settings</span></a>
      </nav>
    </main>
  `);

  const rows = core.collectConversationItems(document, new URL("https://claude.ai/"));

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => ({ title: row.title, href: row.href, source: row.source })),
    [
      { title: "Trip plan", href: "https://claude.ai/chat/111", source: "claude-web" },
      { title: "Work report", href: "https://claude.ai/chat/222", source: "claude-web" }
    ]
  );
});

test("collects Claude Code session rows from anchors and data attributes", () => {
  const document = dom(`
    <aside>
      <a href="/code"><span>New session</span></a>
      <a href="/code/session/aaa"><span>Needs input</span><span>Skills</span></a>
      <a href="/code/sessions/bbb"><span>Waiting on permission</span><span>Validate cloud cost</span></a>
      <div role="button" data-session-id="ccc"><span>Data sources table</span></div>
      <button>Customize</button>
    </aside>
  `, "https://claude.ai/code");

  const rows = core.collectConversationItems(document, new URL("https://claude.ai/code"));

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => ({ title: row.title, source: row.source })),
    [
      { title: "Needs input Skills", source: "claude-code" },
      { title: "Waiting on permission Validate cloud cost", source: "claude-code" },
      { title: "Data sources table", source: "claude-code" }
    ]
  );
});

test("detects delete controls without matching extension controls", () => {
  const document = dom(`
    <body>
      <button class="cbd-button">Delete selected</button>
      <div role="menu">
        <button role="menuitem" aria-label="Rename">Rename</button>
        <button role="menuitem" aria-label="Delete chat">Delete chat</button>
      </div>
    </body>
  `);

  const button = core.findDeleteAction(document);

  assert.equal(button?.getAttribute("aria-label"), "Delete chat");
});

test("treats inline selectors and panels as extension-owned controls", () => {
  const document = dom(`
    <body>
      <section class="cbd-panel"><button>Delete selected</button></section>
      <a href="/chat/111"><span class="cbd-selector" role="checkbox"></span><span>Thread</span></a>
      <button aria-label="Delete chat">Delete chat</button>
    </body>
  `);

  assert.equal(core.isExtensionElement(document.querySelector(".cbd-panel button")), true);
  assert.equal(core.isExtensionElement(document.querySelector(".cbd-selector")), true);
  assert.equal(core.findDeleteAction(document)?.getAttribute("aria-label"), "Delete chat");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest packages ChatGPT, Claude Web, and Claude Code support in one extension", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const hostPermissions = new Set(manifest.host_permissions);
  const contentScripts = manifest.content_scripts;

  assert.equal(manifest.manifest_version, 3);
  assert.equal(hostPermissions.has("https://chatgpt.com/*"), true);
  assert.equal(hostPermissions.has("https://chat.openai.com/*"), true);
  assert.equal(hostPermissions.has("https://claude.ai/*"), true);

  assert.deepEqual(
    contentScripts.map((script) => script.matches),
    [
      ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      ["https://claude.ai/*"]
    ]
  );
  assert.deepEqual(contentScripts[0].js, ["content.js"]);
  assert.deepEqual(contentScripts[1].js, ["src/claude/core.js", "src/claude/content.js"]);
});

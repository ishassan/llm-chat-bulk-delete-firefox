# LLM Chat Bulk Delete for Firefox

This is a local Firefox 140+ WebExtension that adds a small "Bulk delete" panel to ChatGPT, Claude Web, and Claude Code on web. It lets you select multiple loaded chats or sessions, confirm once, and delete the selected items.

## Install for local use

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select the local `manifest.json` from this repo, or select `artifacts/llm-chat-bulk-delete-firefox.zip` after rebuilding the artifact.
4. Open `https://chatgpt.com/`, `https://chat.openai.com/`, `https://claude.ai/`, or `https://claude.ai/code`.

Temporary add-ons are removed when Firefox restarts. For permanent use in regular Firefox, submit/sign the add-on through Mozilla Add-ons or use a Firefox build/profile that allows unsigned extensions.

## Use

### ChatGPT, Claude Web, and Claude Code

1. Click `Select chats` in the bottom-right panel.
2. Check the chats or sessions you want to delete in the sidebar.
3. Click `Select all` to select every currently loaded sidebar item.
4. Select one item, then Shift-select another item to select the full loaded range between them.
5. Click `Delete` and confirm the browser prompt.

## Notes

- ChatGPT deletion calls ChatGPT's same-origin conversation endpoint from the active ChatGPT tab, using only your existing browser session. If that endpoint is unavailable for a chat, the extension falls back to the visible ChatGPT UI delete flow.
- Claude Web chats are deleted through Claude's same-origin `/api/organizations/<org>/chat_conversations/<chat>` request path, with visible UI deletion as a fallback.
- Claude Code sessions are deleted through Claude's same-origin `/v1/code/sessions` request path, with visible UI deletion as a fallback.
- The extension does not send data to any third-party server and does not use extension storage.
- These sites can change their web UI and private endpoints. If selection or deletion stops working, the content script selectors or endpoint calls may need an update.

## Development

Run the extension test coverage:

```sh
npm test
```

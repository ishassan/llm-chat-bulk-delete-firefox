# AI Chat Bulk Delete for Firefox

This artifact contains the combined Firefox extension for ChatGPT, Claude Web, and Claude Code on web.

## Install Temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `llm-chat-bulk-delete-firefox.zip`.
4. Open `https://chatgpt.com/`, `https://chat.openai.com/`, `https://claude.ai/`, or `https://claude.ai/code`.

## Use

- On ChatGPT, click `Select chats`, choose loaded sidebar chats, then click `Delete`.
- On Claude Web and Claude Code, use the visible checkboxes, `Select all`, and `Delete` controls in the bottom-right panel.
- Shift-select works for visible ranges on both ChatGPT and Claude.

The extension only acts from the active site's page context and uses your existing browser session. It does not send data to third-party servers or use extension storage.

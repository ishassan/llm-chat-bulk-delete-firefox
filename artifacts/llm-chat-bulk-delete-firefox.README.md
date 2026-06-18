# AI Chat Bulk Delete for Firefox

This artifact contains the combined Firefox extension for ChatGPT, Claude Web, and Claude Code on web.

## Install Temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `llm-chat-bulk-delete-firefox.zip`.
4. Open `https://chatgpt.com/`, `https://chat.openai.com/`, `https://claude.ai/`, or `https://claude.ai/code`.

## Use

- On ChatGPT, Claude Web, and Claude Code, click `Select chats`, choose loaded sidebar chats or sessions, then click `Delete`.
- Use `Select all` to select every currently loaded sidebar item.
- Shift-select works for loaded ranges on all supported platforms.

The extension only acts from the active site's page context and uses your existing browser session. It does not send data to third-party servers or use extension storage.

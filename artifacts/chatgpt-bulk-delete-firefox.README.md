# ChatGPT Bulk Chat Delete for Firefox

This is a local Firefox 140+ WebExtension that adds a small "Bulk delete" panel to ChatGPT. It lets you select multiple chats from the ChatGPT sidebar, confirm once, and delete the selected conversations.

## Install for local use

1. Download `artifacts/chatgpt-bulk-delete-firefox.zip`.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select `chatgpt-bulk-delete-firefox.zip`.
5. Open `https://chatgpt.com/` or `https://chat.openai.com/`.

For development, you can also clone the repo and select the local `manifest.json` from the repo root instead of selecting the zip.

Temporary add-ons are removed when Firefox restarts. For permanent use in regular Firefox, submit/sign the add-on through Mozilla Add-ons or use a Firefox build/profile that allows unsigned extensions.

## Use

1. Click `Select chats` in the bottom-right panel.
2. Check the chats you want to delete in the ChatGPT sidebar.
3. Click `Select all` to select every currently loaded sidebar chat.
4. Select a chat, then Shift-select another chat to select the full loaded range between them.
5. Click `Delete` and confirm the browser prompt.

## Notes

- Deletion first calls ChatGPT's same-origin conversation endpoint from the active ChatGPT tab, using only your existing browser session.
- If that endpoint is unavailable, the extension falls back to the visible ChatGPT UI delete flow.
- The extension does not send data to any third-party server and does not use extension storage.
- ChatGPT's web UI and private endpoints can change. If selection or deletion stops working, the content script selectors or endpoint may need an update.

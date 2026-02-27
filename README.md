# ChatGPT Conversation Exporter

It's super-frustrating but if you end up using a Team / Pro / Enterprise / whatever they call it version of **ChatGPT**, there's no option to export your chats. You can share, yes, but no export and definitely no bulk export.

C'mon OpenAI.

This isn't helpful when your admin decides you're shifting from ChatGPT to Claude or "insert LLM of choice here"

So, here's a free, open-source Chrome extension that bulk-exports all of your ChatGPT conversations to a single JSON file (saved in your Downloads folder), entirely within your browser, with no server involved.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/B0B41V12A1)

---

## Features

- Exports all conversations in one click
- Saves to a single JSON file in your Downloads folder
- Progress bar with estimated time remaining
- Cancel button to stop mid-export
- Runs entirely locally — your data never leaves your browser
- No account, no subscription, no server

---

## Installation

This extension is not on the Chrome Web Store. You load it directly from the source files.

**Step 1 — Download the extension**

Download or clone this repository and unzip it somewhere permanent on your computer (it needs to stay there — Chrome loads it from that folder each time).

**Step 2 — Open Chrome Extensions**

Go to `chrome://extensions` in your browser.

**Step 3 — Enable Developer Mode**

Toggle **Developer mode** on using the switch in the top-right corner of the page.

**Step 4 — Load the extension**

Click **Load unpacked** and select the folder you downloaded in Step 1.

The extension icon will appear in your Chrome toolbar. You may need to click the puzzle-piece icon and pin it to make it visible.

**Step 5 — Export**

1. Open [chatgpt.com](https://chatgpt.com) and make sure you are logged in
2. Click the extension icon in the toolbar
3. Click **Export All Conversations**
4. Wait for the progress bar to complete
5. The file `chatgpt-export-YYYY-MM-DD.json` will appear in your Downloads folder

---

## Output format

The exported file is a JSON file with this structure:

```json
{
  "export_version": "1.0",
  "exported_at": "2026-02-27T10:30:00.000Z",
  "conversation_count": 247,
  "conversations": [
    {
      "id": "...",
      "title": "Understanding Rust lifetimes",
      "create_time": 1700000000.0,
      "update_time": 1700001000.0,
      "model": "gpt-4o",
      "messages": [
        { "id": "...", "role": "user", "content": "Can you explain Rust lifetimes?", "create_time": 1700000001.5 },
        { "id": "...", "role": "assistant", "content": "Sure! Lifetimes in Rust are…", "create_time": 1700000003.2 }
      ]
    }
  ]
}
```

If any individual conversations fail to export, they are listed in an `errors` array at the end of the file. The rest of the export is unaffected.

---

## How it works / security

The extension works by reading your active ChatGPT browser session — the same session your browser is already using when you're on chatgpt.com. It does not ask for your password or any API key.

**What happens to your data:**

- A session token is read from your browser's existing chatgpt.com session
- That token is used to call ChatGPT's internal API endpoints to list and download your conversations
- The token and all conversation data stay entirely within your browser — nothing is sent to any third-party server
- The session token is fetched fresh each time you export and is never stored by the extension

You can verify all of this by reading the source code directly — there are only four files of logic: `manifest.json`, `content.js`, `background.js`, and `popup.js`.

---

## Stopping an export

Use the **Cancel** button in the popup. If you have already closed the popup without cancelling, go to `chrome://extensions` and click the reload icon on the extension card to force-stop it.

---

## Updating the extension

This extension does not auto-update. When a new version is available, download the latest source, replace the files in your folder, then go to `chrome://extensions` and click the reload icon on the extension card.

---

## Limitations and known issues

- Uses ChatGPT's internal (unofficial) API. OpenAI could change or restrict these endpoints at any time, which may break the extension without warning.
- Only exports the currently visible ("active") branch of each conversation. If you have edited messages and branched a conversation, earlier branches are not included.
- Non-text content (images, generated files, code execution outputs) is exported as a placeholder string like `[image_asset_pointer]` rather than the actual content.
- Tested on chatgpt.com. Not tested on custom enterprise ChatGPT deployments.

---

## License

MIT License

Copyright (c) 2026 [toodlepip](https://toodlepip.co.uk)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. USE THIS EXTENSION ENTIRELY AT YOUR OWN RISK.**

This extension is an independent open-source project and is not affiliated with, endorsed by, or in any way connected to OpenAI. It uses unofficial, undocumented internal API endpoints that may change or be removed at any time. There is no guarantee that it will work, continue to work, or that the data it produces is complete or accurate. The authors accept no liability for any loss of data, account restrictions, or any other consequences arising from use of this software. You are solely responsible for complying with OpenAI's Terms of Service.

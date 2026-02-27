// background.js — Manifest V3 service worker
// Core export logic: auth, paginated conversation listing,
// individual conversation fetching, message graph traversal, download.

const API_BASE = 'https://chatgpt.com/backend-api';
const PAGE_SIZE = 100;        // conversations per page (API maximum)
const REQUEST_DELAY_MS = 150; // polite delay between conversation detail fetches

// ─── Utilities ────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendToPopup(msg) {
  // Best-effort: popup may have been closed by the user — silently discard errors.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function progress(pct, text) {
  sendToPopup({ type: 'PROGRESS', pct, text });
}

function formatEta(ms) {
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `~${totalSecs}s left`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return secs > 0 ? `~${mins}m ${secs}s left` : `~${mins}m left`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `~${hrs}h ${remMins}m left` : `~${hrs}h left`;
}

// ─── Auth token ───────────────────────────────────────────────────────────────

async function getAuthToken() {
  // Find a chatgpt.com tab to target with the content script message.
  // Prefer the currently active tab, fall back to any chatgpt.com tab.
  let tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*', active: true });
  if (!tabs.length) {
    tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  }

  if (!tabs.length) {
    throw new Error('No ChatGPT tab is open. Please open chatgpt.com and try again.');
  }

  const tabId = tabs[0].id;

  // Re-inject the content script in case the extension was installed after the tab
  // was opened (already-injected tabs throw a benign error we can ignore).
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (_e) {
    // Ignore "Cannot access contents of url" or duplicate injection errors
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_TOKEN' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(
          'Could not reach the ChatGPT page. Try reloading chatgpt.com and retrying.'
        ));
        return;
      }
      if (!response || response.error) {
        reject(new Error(response?.error ?? 'No response from content script'));
        return;
      }
      resolve(response.token);
    });
  });
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) {
    throw new Error('Session expired. Please refresh chatgpt.com and try again.');
  }
  if (res.status === 429) {
    throw new Error('ChatGPT rate-limited the export. Wait a few minutes and try again.');
  }
  if (!res.ok) {
    throw new Error(`API error ${res.status} on ${path}`);
  }

  return res.json();
}

// ─── Conversation listing (paginated) ────────────────────────────────────────

async function fetchAllConversationMeta(token) {
  const conversations = [];
  let offset = 0;

  while (true) {
    const data = await apiFetch(
      `/conversations?limit=${PAGE_SIZE}&offset=${offset}`,
      token
    );

    const items = data.items ?? [];
    conversations.push(...items);

    progress(2, `Found ${conversations.length} conversation${conversations.length === 1 ? '' : 's'}…`);

    if (items.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
    await delay(REQUEST_DELAY_MS);
  }

  return conversations;
}

// ─── Message graph traversal ──────────────────────────────────────────────────
//
// ChatGPT stores messages as a directed graph in `mapping`:
//   { [nodeId]: { id, message, parent, children } }
//
// `current_node` is the active leaf (latest message in the visible branch).
// Algorithm: walk parent links from current_node to root, reverse → chronological.

function traverseMessages(conversationData) {
  const mapping = conversationData.mapping;
  if (!mapping) return [];

  const currentNodeId = conversationData.current_node;
  if (!currentNodeId) return [];

  // Walk up the parent chain from the active leaf
  const orderedIds = [];
  let nodeId = currentNodeId;
  const visited = new Set(); // guard against malformed cycles

  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    orderedIds.push(nodeId);
    const node = mapping[nodeId];
    if (!node) break;
    nodeId = node.parent ?? null;
  }

  // Reverse so root (oldest) comes first
  orderedIds.reverse();

  const messages = [];
  for (const id of orderedIds) {
    const node = mapping[id];
    if (!node?.message) continue;

    const msg = node.message;
    if (!msg.content?.parts) continue;

    const role = msg.author?.role;
    if (role === 'system') continue; // skip invisible root node

    // Flatten content parts into a single string.
    // Parts are strings, { type, text } objects, or other typed objects.
    const textContent = msg.content.parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.text) return part.text;
        if (part?.type) return `[${part.type}]`; // placeholder for non-text content
        return '';
      })
      .join('');

    messages.push({
      id: msg.id,
      role,                          // "user" | "assistant" | "tool"
      content: textContent,
      create_time: msg.create_time ?? null,
    });
  }

  return messages;
}

// ─── Fetch a single conversation with full message detail ─────────────────────

async function fetchConversation(id, token) {
  const data = await apiFetch(`/conversation/${id}`, token);

  return {
    id: data.conversation_id ?? id,
    title: data.title ?? 'Untitled',
    create_time: data.create_time ?? null,
    update_time: data.update_time ?? null,
    model: data.default_model_slug ?? null,
    messages: traverseMessages(data),
  };
}

// ─── Cancellation / guard ─────────────────────────────────────────────────────

let cancelRequested = false;
let exportInProgress = false;

// ─── Main export orchestrator ─────────────────────────────────────────────────

const TEMP_FILENAME = 'chatgpt-export-temp.json';

async function runExport() {
  if (exportInProgress) {
    sendToPopup({ type: 'ERROR', text: 'An export is already running. Use the Cancel button to stop it first.' });
    return;
  }
  exportInProgress = true;
  cancelRequested = false;
  try {
    await doExport();
  } finally {
    exportInProgress = false;
  }
}

async function doExport() {
  progress(0, 'Connecting to ChatGPT…');

  let token;
  try {
    token = await getAuthToken();
  } catch (err) {
    sendToPopup({ type: 'ERROR', text: err.message });
    return;
  }

  progress(2, 'Listing conversations…');

  let metaList;
  try {
    metaList = await fetchAllConversationMeta(token);
  } catch (err) {
    sendToPopup({ type: 'ERROR', text: err.message });
    return;
  }

  if (!metaList.length) {
    sendToPopup({ type: 'ERROR', text: 'No conversations found.' });
    return;
  }

  if (cancelRequested) {
    sendToPopup({ type: 'CANCELLED' });
    return;
  }

  progress(5, `Fetching ${metaList.length} conversation${metaList.length === 1 ? '' : 's'}…`);

  // Open a temporary file in the Origin Private File System (OPFS).
  // Each conversation is written to disk immediately after fetching, so a crash
  // or connection loss only loses conversations not yet fetched — not everything.
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(TEMP_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();

  const errors = [];
  let successCount = 0;
  let firstConv = true;
  let cancelled = false;

  try {
    // Opening brace + conversations array start — written as a single fragment
    await writable.write(
      '{"export_version":"1.0","exported_at":"' +
      new Date().toISOString() +
      '","conversations":['
    );

    const loopStart = Date.now();

    for (let i = 0; i < metaList.length; i++) {
      if (cancelRequested) {
        cancelled = true;
        break;
      }

      const meta = metaList[i];
      const pct = 5 + Math.round(((i + 1) / metaList.length) * 90);

      try {
        const conversation = await fetchConversation(meta.id, token);
        const chunk = JSON.stringify(conversation);
        // Prepend comma separator for all conversations after the first
        await writable.write(firstConv ? chunk : ',' + chunk);
        firstConv = false;
        successCount++;
      } catch (err) {
        errors.push({ id: meta.id, title: meta.title ?? 'Untitled', error: err.message });
      }

      const done = i + 1;
      const remaining = metaList.length - done;
      let statusText = `Exported ${done} / ${metaList.length}`;
      // Show ETA once we have at least 3 data points to average over
      if (done >= 3 && remaining > 0) {
        const msPerConv = (Date.now() - loopStart) / done;
        statusText += ' — ' + formatEta(msPerConv * remaining);
      }
      progress(pct, statusText + '…');

      if (i < metaList.length - 1) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    if (cancelled) {
      await writable.abort(); // discard the partial file
    } else {
      // Close conversations array and write summary fields in the footer
      const footer = errors.length
        ? '],"conversation_count":' + successCount + ',"errors":' + JSON.stringify(errors) + '}'
        : '],"conversation_count":' + successCount + '}';
      await writable.write(footer);
      await writable.close();
    }
  } catch (err) {
    try { await writable.abort(); } catch (_) {}
    await root.removeEntry(TEMP_FILENAME).catch(() => {});
    sendToPopup({ type: 'ERROR', text: 'Export failed: ' + err.message });
    return;
  }

  // Clean up the OPFS temp file (best-effort)
  const cleanup = () => root.removeEntry(TEMP_FILENAME).catch(() => {});

  if (cancelled) {
    await cleanup();
    sendToPopup({ type: 'CANCELLED' });
    return;
  }

  progress(97, 'Saving file…');

  // Read the completed OPFS file.
  // URL.createObjectURL is not available in MV3 service workers, so we encode
  // the content as a base64 data URL instead. Processed in chunks of 8 KB to
  // avoid a call stack overflow when spreading large byte arrays.
  const file = await fileHandle.getFile();
  const text = await file.text();
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const dataUrl = 'data:application/json;base64,' + btoa(binary);
  const filename = `chatgpt-export-${new Date().toISOString().slice(0, 10)}.json`;

  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });

  await cleanup();

  sendToPopup({ type: 'DONE', errorCount: errors.length });
} // end doExport

// ─── Entry point ──────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_EXPORT') {
    runExport(); // intentionally not awaited; runs as a background async task
  } else if (msg.type === 'CANCEL_EXPORT') {
    cancelRequested = true;
  }
});

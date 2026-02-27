// content.js — runs on chatgpt.com
// Sole responsibility: fetch the session auth token (same-origin request)
// and return it to the background service worker when asked.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'GET_TOKEN') return false;

  fetch('/api/auth/session', {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!data.accessToken) {
        throw new Error('Not logged in — no accessToken in session response');
      }
      sendResponse({ token: data.accessToken });
    })
    .catch((err) => {
      sendResponse({ error: err.message });
    });

  // Return true to keep the message channel open for the async response
  return true;
});

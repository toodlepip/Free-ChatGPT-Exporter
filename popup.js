// popup.js — manages UI state in the extension popup.
// Sends START_EXPORT / CANCEL_EXPORT to the background service worker, then
// listens for PROGRESS / DONE / ERROR / CANCELLED messages pushed back from it.

const btn = document.getElementById('export-btn');
const cancelBtn = document.getElementById('cancel-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const statusEl = document.getElementById('status');

function showProgress() {
  progressWrap.style.display = 'block';
}

function setProgress(pct) {
  progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

function setIdle() {
  btn.disabled = false;
  cancelBtn.style.display = 'none';
  cancelBtn.disabled = false;
}

// Listen for messages pushed from background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS') {
    showProgress();
    setProgress(msg.pct);
    setStatus(msg.text);
  } else if (msg.type === 'DONE') {
    setProgress(100);
    const note = msg.errorCount
      ? ` (${msg.errorCount} conversation${msg.errorCount === 1 ? '' : 's'} skipped — see errors[] in file)`
      : '';
    setStatus(`Export complete! Saved to your Downloads folder.${note}`, 'success');
    setIdle();
  } else if (msg.type === 'ERROR') {
    setStatus(msg.text, 'error');
    setIdle();
  } else if (msg.type === 'CANCELLED') {
    setProgress(0);
    setStatus('Export cancelled.', 'cancelled');
    setIdle();
  }
});

btn.addEventListener('click', () => {
  btn.disabled = true;
  cancelBtn.style.display = 'block';
  showProgress();
  setProgress(0);
  setStatus('Starting export…');
  chrome.runtime.sendMessage({ type: 'START_EXPORT' });
});

cancelBtn.addEventListener('click', () => {
  cancelBtn.disabled = true;
  setStatus('Cancelling…');
  chrome.runtime.sendMessage({ type: 'CANCEL_EXPORT' });
});

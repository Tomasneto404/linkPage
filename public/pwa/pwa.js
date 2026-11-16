// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
(() => {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);
  let installPrompt = null;
  let registration = null;
  let reloadRequested = false;

  const install = document.createElement('button');
  install.type = 'button';
  install.id = 'pwaInstallBtn';
  install.className = 'pwa-install';
  install.hidden = true;
  install.title = 'Install LinkPage';
  install.setAttribute('aria-label', 'Install LinkPage');
  install.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/></svg><span class="pwa-install-label">Install app</span>';
  const parent = location.pathname.startsWith('/admin')
    ? document.getElementById('openAddLinkBtn')?.parentElement
    : document.querySelector('.header-inner') || document.querySelector('.gate-card');
  parent?.appendChild(install);
  const refreshInstall = () => {
    install.hidden = standalone() || !(installPrompt || ios || safari);
    document.querySelectorAll('[data-pwa-install]').forEach(button => { button.hidden = standalone(); });
  };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    refreshInstall();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; install.hidden = true; });
  matchMedia('(display-mode: standalone)').addEventListener('change', refreshInstall);

  async function installApp() {
    if (standalone()) return;
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      refreshInstall();
      try { await prompt.prompt(); await prompt.userChoice; } catch { showInstructions(); }
    } else showInstructions();
  }
  function showInstructions() {
    let dialog = document.getElementById('pwaInstallDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'pwaInstallDialog';
      dialog.className = 'pwa-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaInstallTitle');
      const steps = ios ? '<li>Open this page in Safari.</li><li>Tap the Share button, then <strong>Add to Home Screen</strong>.</li><li>Keep <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.</li>'
        : safari ? '<li>Open the <strong>File</strong> menu in Safari.</li><li>Choose <strong>Add to Dock</strong> and confirm.</li>'
        : '<li>Open your browser’s menu.</li><li>Choose <strong>Install LinkPage</strong>, <strong>Install app</strong> or <strong>Add to Home Screen</strong>, if available.</li>';
      dialog.innerHTML = '<img src="/pwa/icon-192.png" width="60" height="60" alt=""><h2 id="pwaInstallTitle">Your workspace, one tap away.</h2><p>Install LinkPage to open it in its own window from your home screen or dock.</p><ol>' + steps + '</ol><small>A connection is needed for links, documents and changes. Your account and group permissions still apply.</small><button type="button">Done</button>';
      dialog.querySelector('button').onclick = () => dialog.close();
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      document.body.appendChild(dialog);
    }
    if (!dialog.open) dialog.showModal();
  }
  install.onclick = installApp;
  document.querySelectorAll('[data-pwa-install]').forEach(button => button.addEventListener('click', installApp));
  refreshInstall();

  const offline = document.createElement('div');
  offline.id = 'pwaOfflineStatus';
  offline.className = 'pwa-notice';
  offline.setAttribute('role', 'status');
  offline.textContent = 'You’re offline. Changes need a connection.';
  const connectionChanged = () => { offline.hidden = navigator.onLine; };
  connectionChanged();
  document.body.appendChild(offline);
  window.addEventListener('online', connectionChanged);
  window.addEventListener('offline', connectionChanged);

  function offerUpdate() {
    if (!registration?.waiting || document.getElementById('pwaUpdateNotice')) return;
    const notice = document.createElement('div');
    notice.id = 'pwaUpdateNotice';
    notice.className = 'pwa-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<span>An app update is ready.</span><button type="button" data-update>Reload</button><button type="button" data-dismiss aria-label="Dismiss update">×</button>';
    notice.querySelector('[data-update]').onclick = () => {
      if (!registration.waiting) return location.reload();
      reloadRequested = true;
      registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
    };
    notice.querySelector('[data-dismiss]').onclick = () => notice.remove();
    document.body.appendChild(notice);
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(value => {
    registration = value;
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) registration.update().catch(() => {});
    });
  }).catch(() => { /* Browsing and sign-in still work if installation is unavailable. */ });

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const refreshChrome = () => {
    const css = getComputedStyle(document.documentElement);
    const colour = css.getPropertyValue('--bg').trim();
    if (colour && themeMeta) themeMeta.content = colour;
  };
  new MutationObserver(refreshChrome).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-season', 'style'] });
  refreshChrome();
})();

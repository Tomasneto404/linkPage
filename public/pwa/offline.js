// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
document.getElementById('retry').addEventListener('click', () => location.reload());
function connectionChanged() {
  document.getElementById('connectionStatus').textContent = navigator.onLine
    ? 'Connection detected. Try again to return to your workspace.'
    : 'Waiting for a connection…';
}
window.addEventListener('online', connectionChanged);
window.addEventListener('offline', connectionChanged);
document.getElementById('connectionStatus').textContent = navigator.onLine
  ? 'The server could not be reached. Please try again shortly.'
  : 'Waiting for a connection…';

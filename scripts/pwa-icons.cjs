// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Rebuild install icons from the existing brand mark. Requires Chromium. */
const fs = require('node:fs');
const path = require('node:path');
const { launchBrowser } = require('../tests/browser/helpers/browser');
async function main() {
  const browser = await launchBrowser();
  if (!browser) throw new Error('Install Chromium or set LINKPAGE_BROWSER_PATH');
  try {
    const page = await browser.newPage();
    const logo = fs.readFileSync(path.join(__dirname, '../public/brand/icon-light.png')).toString('base64');
    const folder = path.join(__dirname, '../public/pwa');
    fs.mkdirSync(folder, { recursive: true });
    for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['icon-maskable-512', 512], ['apple-touch-icon', 180]]) {
      const data = await page.evaluate(async ({ logo, size }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + logo;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f5f7'; ctx.fillRect(0, 0, size, size);
        // The mark stays inside the central 80% safe circle for maskable icons.
        const width = size * .64, height = width * image.height / image.width;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { logo, size });
      fs.writeFileSync(path.join(folder, name + '.png'), Buffer.from(data, 'base64'));
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

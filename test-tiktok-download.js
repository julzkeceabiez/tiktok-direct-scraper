'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { downloadTikTokVideo } = require('./tiktokprofil');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttstalk-test-'));
  const url = 'https://www.tiktok.com/@nakanoriandesu/video/7674567816506264848';
  try {
    const filePath = await downloadTikTokVideo(url, dir, '/tmp/nonexistent-cookiestt.txt');
    const stat = fs.statSync(filePath);
    console.log(JSON.stringify({ ok: true, filePath, bytes: stat.size, validSize: stat.size > 0 }, null, 2));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const BIN_DIR = path.join(process.cwd(), 'bin');
const LOCAL_YTDLP = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
let ytDlpInstallPromise = null;
let ytDlpResolved = null;

function logInstall(stage, payload = {}) {
  try { console.log(`[YT-DLP][${stage}] ${JSON.stringify(payload)}`); } catch { console.log(`[YT-DLP][${stage}]`); }
}

async function executableWorks(binary) {
  try {
    const result = await execFileAsync(binary, ['--version'], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return Boolean(String(result.stdout || '').trim());
  } catch { return false; }
}

async function installYtDlpViaPip() {
  const commands = process.platform === 'win32'
    ? [['py', ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp']], ['python', ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp']]]
    : [['python3', ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp']], ['python3', ['-m', 'pip', 'install', '-U', 'yt-dlp']], ['pip3', ['install', '--user', '-U', 'yt-dlp']]];
  for (const [command, args] of commands) {
    try {
      logInstall('PIP_START', { command });
      await execFileAsync(command, args, { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
      const candidates = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp', path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp')];
      for (const candidate of candidates) if (await executableWorks(candidate)) return candidate;
    } catch (error) {
      logInstall('PIP_ERROR', { command, message: error.message.split('\\n')[0] });
    }
  }
  return null;
}

async function installYtDlpBinary() {
  if (process.platform === 'win32') return null;
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'arm' ? 'armv7l' : 'x86_64';
  const platformName = process.platform === 'darwin' ? 'macos' : 'linux';
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_${platformName}${platformName === 'linux' && arch === 'aarch64' ? '_aarch64' : ''}`;
  try {
    await fs.promises.mkdir(BIN_DIR, { recursive: true });
    logInstall('BINARY_START', { platform: platformName, arch, url: downloadUrl });
    const response = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 50 * 1024 * 1024 });
    await fs.promises.writeFile(LOCAL_YTDLP, Buffer.from(response.data));
    await fs.promises.chmod(LOCAL_YTDLP, 0o755);
    if (await executableWorks(LOCAL_YTDLP)) return LOCAL_YTDLP;
  } catch (error) {
    logInstall('BINARY_ERROR', { message: error.message.split('\\n')[0] });
  }
  return null;
}

async function ensureYtDlp() {
  if (ytDlpResolved && await executableWorks(ytDlpResolved)) return ytDlpResolved;
  if (ytDlpInstallPromise) return ytDlpInstallPromise;
  ytDlpInstallPromise = (async () => {
    const candidates = [LOCAL_YTDLP, process.env.YTDLP_PATH, 'yt-dlp'];
    for (const candidate of candidates.filter(Boolean)) {
      if (await executableWorks(candidate)) {
        ytDlpResolved = candidate;
        logInstall('READY', { binary: candidate });
        return candidate;
      }
    }
    logInstall('MISSING', { action: 'auto-install' });
    const pipBinary = await installYtDlpViaPip();
    if (pipBinary) { ytDlpResolved = pipBinary; logInstall('INSTALLED', { method: 'pip', binary: pipBinary }); return pipBinary; }
    const downloadedBinary = await installYtDlpBinary();
    if (downloadedBinary) { ytDlpResolved = downloadedBinary; logInstall('INSTALLED', { method: 'release', binary: downloadedBinary }); return downloadedBinary; }
    throw new Error('yt-dlp tidak ditemukan dan auto-install gagal. Install yt-dlp atau set YTDLP_PATH.');
  })();
  try { return await ytDlpInstallPromise; } finally { ytDlpInstallPromise = null; }
}

const TIKTOK_BASE = 'https://www.tiktok.com';
const COOKIES_FILE = path.join(process.cwd(), 'cookies', 'cookiestt.txt');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function runYtDlp(args, timeout = 120000) {
  const binary = await ensureYtDlp();
  try {
    const result = await execFileAsync(binary, args, { timeout, maxBuffer: 16 * 1024 * 1024 });
    logInstall('COMMAND_OK', { binary, args: args.filter(arg => !String(arg).includes('cookies')).slice(0, 8) });
    return result;
  } catch (err) {
    logInstall('COMMAND_ERROR', { binary, message: String(err.message || '').split('\\n').slice(0, 2).join(' | ') });
    throw err;
  }
}

async function fetchVideosWithYtDlp(profileUrl, cookiesFile, limit = 5) {
  const args = ['--flat-playlist', '--playlist-end', String(limit), '--dump-single-json', '--skip-download', '--no-warnings', '--ignore-errors'];
  if (cookiesFile && fs.existsSync(cookiesFile)) args.push('--cookies', cookiesFile);
  args.push(profileUrl);
  const { stdout } = await runYtDlp(args);
  const data = JSON.parse(String(stdout || '{}'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries.filter(Boolean).slice(0, limit).map(entry => {
    const id = String(entry.id || '').trim() || null;
    const url = entry.webpage_url || entry.original_url || (id ? `https://www.tiktok.com/@${entry.uploader_id || entry.uploader || ''}/video/${id}` : null);
    const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
    return { id, title: String(entry.title || '').trim(), url, thumbnail: entry.thumbnail || thumbs.at(-1)?.url || null, views: entry.view_count ?? null };
  }).filter(video => video.url && /\/video\/\d+/.test(video.url));
}

async function resolveVideos(profileUrl, cookiesFile, initialVideos = []) {
  const seed = Array.isArray(initialVideos) ? initialVideos.slice(0, 5) : [];
  if (seed.length >= 5) return seed;
  try {
    const videos = await fetchVideosWithYtDlp(profileUrl, cookiesFile, 5);
    ttLog('YTDLP_RESULT', { ok: true, returnedVideos: videos.length, videos });
    return videos.length ? videos : seed;
  } catch (err) {
    ttLog('YTDLP_ERROR', { ok: false, message: err.message });
    return seed;
  }
}

function findNestedKey(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  if (Array.isArray(value)) for (const item of value) { const found = findNestedKey(item, key); if (found) return found; }
  else for (const item of Object.values(value)) { const found = findNestedKey(item, key); if (found) return found; }
  return null;
}

async function fetchTikTokEmbedMediaUrl(videoId) {
  const embedUrl = `https://www.tiktok.com/embed/v2/${videoId}`;
  const res = await axios.get(embedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml' },
    timeout: 45000,
    validateStatus: () => true
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`TikTok embed HTTP ${res.status}`);
  const $ = cheerio.load(String(res.data || ''));
  const raw = $('#__FRONTITY_CONNECT_STATE__').html();
  if (!raw) throw new Error('TikTok embed state tidak ditemukan');
  const state = JSON.parse(raw);
  const videoData = findNestedKey(state, 'videoData');
  const mediaUrl = videoData?.itemInfos?.video?.urls?.[0];
  if (!mediaUrl || !/^https:\/\/[^/]*tiktokcdn\.com\//i.test(mediaUrl)) throw new Error('Signed TikTok CDN URL tidak ditemukan');
  return mediaUrl;
}

async function downloadTikTokVideo(videoUrl, outputDir = path.join(os.tmpdir(), 'ttstalk'), cookiesFile) {
  if (!/^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(videoUrl)) throw new Error('URL TikTok tidak valid');
  const id = (videoUrl.match(/\/video\/(\d+)/) || [])[1];
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `${id}.%(ext)s`);
  const baseArgs = ['--no-playlist', '--format', 'mp4/best[ext=mp4]/best', '--merge-output-format', 'mp4', '--output', output, '--no-warnings', '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'];
  const args = [...baseArgs];
  if (cookiesFile && fs.existsSync(cookiesFile)) args.push('--cookies', cookiesFile);
  args.push(videoUrl);
  try {
    await runYtDlp(args, 180000);
    ttLog('YTDLP_DIRECT_OK', { id });
  } catch (directError) {
    ttLog('YTDLP_DIRECT_ERROR', { id, message: directError.message });
    const signedUrl = await fetchTikTokEmbedMediaUrl(id);
    ttLog('EMBED_SIGNED_URL_OK', { id, host: new URL(signedUrl).hostname });
    await runYtDlp([...baseArgs, signedUrl], 180000);
    ttLog('YTDLP_EMBED_OK', { id });
  }
  const found = fs.readdirSync(outputDir).filter(name => name.startsWith(`${id}.`) && !name.endsWith('.part')).sort();
  if (!found.length) throw new Error(`yt-dlp selesai tetapi file video ${id} tidak ditemukan`);
  return path.join(outputDir, found[0]);
}

function ttLog(stage, payload = {}) {
  const safe = { ...payload };
  delete safe.cookie;
  delete safe.cookieHeader;
  delete safe.cookies;
  try { console.log(`[TTSTALK][${stage}] ${JSON.stringify(safe)}`); }
  catch { console.log(`[TTSTALK][${stage}]`, stage); }
}

function readTikTokCookieHeader(filePath = COOKIES_FILE) {
  if (!fs.existsSync(filePath)) return '';
  const values = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue;
    const parts = line.replace(/^#HttpOnly_/, '').split('\t');
    if (parts.length < 7) continue;
    const domain = parts[0].replace(/^\./, '').toLowerCase();
    if (!domain.endsWith('tiktok.com')) continue;
    values.push(`${parts[5]}=${parts[6]}`);
  }
  return [...new Map(values.map(v => [v.split('=')[0], v])).values()].join('; ');
}

function normalizeUsername(input) {
  const raw = String(input || '').trim().replace(/^https?:\/\/(?:www\.)?tiktok\.com\//i, '').replace(/^@/, '').split(/[/?#\s]/)[0];
  if (!/^[A-Za-z0-9._-]{2,50}$/.test(raw)) throw new Error('Username TikTok tidak valid');
  return raw;
}

function cleanUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value), TIKTOK_BASE);
    const host = url.hostname.toLowerCase();
    const allowed = host.endsWith('tiktok.com') || host.endsWith('tiktokcdn.com') || host.endsWith('ibytedtos.com') || host.endsWith('ibyteimg.com') || host.endsWith('muscdn.com');
    return url.protocol === 'https:' && allowed ? url.href : null;
  } catch { return null; }
}

function findUserInfo(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.userInfo && value.userInfo.user && value.userInfo.stats) return value.userInfo;
  if (value.userInfo && value.userInfo.user) return value.userInfo;
  if (value.user && value.stats) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUserInfo(item);
      if (found) return found;
    }
  } else {
    for (const item of Object.values(value)) {
      const found = findUserInfo(item);
      if (found) return found;
    }
  }
  return null;
}

function extractDataScripts(html) {
  const $ = cheerio.load(html);
  const scripts = [];
  // Coba ID khusus
  const ids = ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__NEXT_DATA__'];
  for (const id of ids) {
    const raw = $(`#${id}`).html();
    if (raw) {
      try {
        scripts.push({ id, data: JSON.parse(raw) });
      } catch {}
    }
  }
  // Coba semua script type application/json
  $('script[type="application/json"]').each((_, el) => {
    const raw = $(el).html();
    if (raw) {
      try {
        scripts.push({ id: $(el).attr('id') || 'unknown', data: JSON.parse(raw) });
      } catch {}
    }
  });
  // Coba script dengan window.__INIT_PROPS__ atau window.__UNIVERSAL_DATA_FOR_REHYDRATION__
  $('script').each((_, el) => {
    const content = $(el).html() || '';
    const match = content.match(/(?:window\.)?(?:__INIT_PROPS__|__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (match) {
      try {
        scripts.push({ id: 'inline', data: JSON.parse(match[1]) });
      } catch {}
    }
  });
  return scripts;
}

async function fetchUserInfoFromApi(username, cookieHeader) {
  // Coba beberapa endpoint API
  const endpoints = [
    `${TIKTOK_BASE}/api/user/detail/?uniqueId=${encodeURIComponent(username)}`,
    `${TIKTOK_BASE}/node/share/user/@${encodeURIComponent(username)}`
  ];
  for (const url of endpoints) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': `${TIKTOK_BASE}/@${encodeURIComponent(username)}`,
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        timeout: 30000,
        validateStatus: () => true
      });
      if (res.status >= 200 && res.status < 300) {
        const data = res.data;
        const info = findUserInfo(data);
        if (info?.user) return { info, data, source: url };
      }
    } catch (e) {}
  }
  return null;
}

const TIKTOK_USER_AGENTS = [
  USER_AGENT,
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchProfileHtml(profileUrl, username, cookieHeader, options = {}) {
  const baseVariants = [
    `${profileUrl}?lang=en`,
    `${profileUrl}?lang=en&is_from_webapp=v1`,
    `${profileUrl}?lang=en&is_copy_url=1&is_from_webapp=v1&sender_device=pc`,
    `${profileUrl}?lang=en&enter_method=live_cover&enter_from=webapp`
  ];
  const attempts = [];
  let lastHtml = '';
  let lastStatus = 0;
  let lastScripts = [];
  let lastInfo = null;
  const maxAttempts = Math.max(4, Number(options.htmlAttempts) || 8);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const baseUrl = baseVariants[(attempt - 1) % baseVariants.length];
    const requestUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_ttstalk=${Date.now()}_${attempt}`;
    const userAgent = TIKTOK_USER_AGENTS[(attempt - 1) % TIKTOK_USER_AGENTS.length];
    try {
      const response = await axios.get(requestUrl, {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': attempt % 2 ? 'en-US,en;q=0.9' : 'id-ID,id;q=0.9,en-US;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': profileUrl,
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        timeout: options.timeout || 45000,
        maxRedirects: 5,
        validateStatus: () => true
      });
      const html = String(response.data || '');
      const scripts = extractDataScripts(html);
      let info = null;
      for (const script of scripts) {
        info = findUserInfo(script.data);
        if (info?.user) break;
      }
      const record = { attempt, requestUrl, status: response.status, bytes: Buffer.byteLength(html), scriptIds: scripts.map(s => s.id), profileFound: Boolean(info?.user), userAgent: userAgent.includes('Android') ? 'android' : userAgent.includes('Chrome/140') ? 'chrome140' : 'chrome124' };
      attempts.push(record);
      ttLog('HTML_ATTEMPT', record);
      lastHtml = html;
      lastStatus = response.status;
      lastScripts = scripts;
      lastInfo = info;
      if (response.status >= 200 && response.status < 300 && info?.user) {
        ttLog('PROFILE_FOUND', { attempt, requestUrl, source: 'html', username: info.user.uniqueId || username });
        return { response, html, status: response.status, scripts, info, attempts };
      }
    } catch (err) {
      const record = { attempt, requestUrl, status: 0, profileFound: false, error: err.message };
      attempts.push(record);
      ttLog('HTML_ATTEMPT_ERROR', record);
    }
    if (attempt < maxAttempts) await sleep(Math.min(1000 + (attempt * 450), 5000));
  }
  return { response: null, html: lastHtml, status: lastStatus, scripts: lastScripts, info: lastInfo, attempts };
}

async function scrapeTikTokProfile(input, options = {}) {
  const username = normalizeUsername(input);
  const profileUrl = `${TIKTOK_BASE}/@${encodeURIComponent(username)}`;
  const cookieHeader = readTikTokCookieHeader(options.cookiesFile || COOKIES_FILE);
  ttLog('START', { username, profileUrl, cookies: Boolean(cookieHeader), cookieCount: cookieHeader ? cookieHeader.split('; ').length : 0 });

  // ─── 1. Coba endpoint API ───
  const apiResult = await fetchUserInfoFromApi(username, cookieHeader);
  ttLog('API_RESULT', { ok: Boolean(apiResult), source: apiResult?.source || null });
  if (apiResult) {
    const { info, data: apiData } = apiResult;
    const user = info.user;
    const stats = info.stats || info.statsV2 || {};
    const profile = {
      username: user.uniqueId || username,
      nickname: user.nickname || user.nickName || username,
      bio: user.signature || '',
      avatar: cleanUrl(user.avatarLarger || user.avatarMedium || user.avatarThumb),
      followers: stats.followerCount ?? stats.follower_count ?? 0,
      following: stats.followingCount ?? stats.following_count ?? 0,
      likes: stats.heartCount ?? stats.heart ?? stats.diggCount ?? 0,
      videos: stats.videoCount ?? stats.video_count ?? 0,
      verified: Boolean(user.verified),
      createdAt: user.createTime ? new Date(Number(user.createTime) * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-',
      url: profileUrl
    };
    let videos = collectVideosFromData(apiData || info, [], new Set(), username);
    videos = await resolveVideos(profileUrl, options.cookiesFile || COOKIES_FILE, videos);
    const result = normalizeTikTokResult(profile, videos, 'api');
    ttLog('SUCCESS', { username: result.username, avatar: Boolean(result.avatar), videoCount: result.videoCount, returnedVideos: result.videos.length, videos: result.videos });
    return result;
  }

  // TikTok kadang mengirim React shell kosong dengan status 200. Gunakan cache-busting,
  // beberapa query variant, rotating browser headers, dan backoff sebelum gagal.
  const htmlResult = await fetchProfileHtml(profileUrl, username, cookieHeader, options);
  const response = htmlResult.response;
  const html = htmlResult.html;
  const status = htmlResult.status;
  const scripts = htmlResult.scripts;
  const info = htmlResult.info;

  // Deteksi CAPTCHA hanya setelah semua percobaan parsing selesai.
  if (!info?.user && /captcha-verify|drag the slider|verify to continue|challenge-platform/i.test(html)) {
    throw new Error(`TikTok CAPTCHA terdeteksi. Cookies/sesi perlu diperbarui.\nURL: ${profileUrl}`);
  }

  if (!info?.user) {
    // Kumpulkan info script yang ditemukan
    const scriptIds = scripts.map(s => s.id).join(', ') || 'tidak ada';
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '-';
    const snippet = html.replace(/\s+/g, ' ').trim().slice(0, 1500);
    throw new Error(
      `Data profil TikTok tidak ditemukan.\n` +
      `Status: ${status}\n` +
      `Title: ${title}\n` +
      `Script IDs: ${scriptIds}\n` +
      `Cookies: ${cookieHeader ? 'ada' : 'tidak ada'}\n` +
      `Attempts: ${htmlResult.attempts.length}\n` +
      `Successful attempts: ${htmlResult.attempts.filter(item => item.profileFound).length}\n` +
      `Snippet: ${snippet}`
    );
  }

  const user = info.user;
  const stats = info.stats || info.statsV2 || {};
  const profile = {
    username: user.uniqueId || username,
    nickname: user.nickname || user.nickName || username,
    bio: user.signature || '',
    avatar: cleanUrl(user.avatarLarger || user.avatarMedium || user.avatarThumb),
    followers: stats.followerCount ?? stats.follower_count ?? 0,
    following: stats.followingCount ?? stats.following_count ?? 0,
    likes: stats.heartCount ?? stats.heart ?? stats.diggCount ?? 0,
    videos: stats.videoCount ?? stats.video_count ?? 0,
    verified: Boolean(user.verified),
    createdAt: user.createTime ? new Date(Number(user.createTime) * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-',
    url: profileUrl
  };

  // itemList sering berada di root hydration, bukan di userInfo.
  // Scan semua script JSON agar video tidak hilang hanya karena nesting TikTok berubah.
  let videos = collectVideosFromData(scripts.map(script => script.data), [], new Set(), profile.username);
  if (!videos.length) videos = collectVideosFromHtml(html, profile.username);
  videos = await resolveVideos(profileUrl, options.cookiesFile || COOKIES_FILE, videos);

  const result = normalizeTikTokResult(profile, videos, 'html');
  ttLog('SUCCESS', { username: result.username, avatar: Boolean(result.avatar), videoCount: result.videoCount, returnedVideos: result.videos.length, videos: result.videos });
  return result;
}

function normalizeTikTokResult(profile, videos, source = 'tiktok') {
  const normalizedVideos = videos.slice(0, 5).map(video => {
    const id = video.id || (String(video.url || '').match(/\/video\/(\d+)/) || [])[1] || null;
    return {
      id,
      title: video.title || '',
      url: video.url,
      thumbnail: video.thumbnail || null,
      views: video.views == null ? null : Number(video.views)
    };
  });
  return {
    success: true,
    type: 'tiktok_profile',
    username: profile.username,
    nickname: profile.nickname,
    bio: profile.bio,
    avatar: profile.avatar,
    followers: Number(profile.followers || 0),
    following: Number(profile.following || 0),
    likes: Number(profile.likes || 0),
    videoCount: Number(profile.videos || 0),
    verified: Boolean(profile.verified),
    createdAt: profile.createdAt || '-',
    profileUrl: profile.url,
    videos: normalizedVideos,
    totalVideos: normalizedVideos.length,
    source,
    raw: null
  };
}

function collectVideosFromData(value, out = [], seen = new Set(), fallbackUsername = '') {
  if (!value || typeof value !== 'object' || out.length >= 5) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectVideosFromData(item, out, seen, fallbackUsername);
    return out;
  }
  const id = String(value.id || value.awemeId || value.itemId || '');
  const authorCandidate = String(value.author?.uniqueId || value.author?.unique_id || value.author?.nickname || '').trim();
  const author = authorCandidate && /^[A-Za-z0-9._-]{2,50}$/.test(authorCandidate) && !/^\d{8,}$/.test(authorCandidate) ? authorCandidate : fallbackUsername;
  const videoUrl = id && author && /^\d{8,}$/.test(id) ? `https://www.tiktok.com/@${author}/video/${id}` : null;
  if (videoUrl && !seen.has(videoUrl)) {
    const thumbnail = value.video?.cover || value.video?.originCover || value.video?.dynamicCover || null;
    out.push({
      id,
      url: videoUrl,
      title: String(value.desc || value.title || '').trim(),
      thumbnail: cleanUrl(thumbnail),
      views: value.stats?.playCount ?? value.statsV2?.playCount ?? null
    });
    seen.add(videoUrl);
  }
  for (const item of Object.values(value)) collectVideosFromData(item, out, seen, fallbackUsername);
  return out;
}

function collectVideosFromHtml(html, username) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  const normalizedHtml = String(html || '').replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const directUrlPattern = /https?:\/\/www\.tiktok\.com\/@([A-Za-z0-9._-]+)\/video\/(\d+)/g;
  const relativeUrlPattern = /\/@([A-Za-z0-9._-]+)\/video\/(\d+)/g;
  for (const match of normalizedHtml.matchAll(directUrlPattern)) {
    if (out.length >= 5) break;
    const url = `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
    if (!seen.has(url)) {
      out.push({ id: match[2], url, title: '', thumbnail: null, views: null });
      seen.add(url);
    }
  }
  for (const match of normalizedHtml.matchAll(relativeUrlPattern)) {
    if (out.length >= 5) break;
    const url = `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
    if (!seen.has(url)) {
      out.push({ id: match[2], url, title: '', thumbnail: null, views: null });
      seen.add(url);
    }
  }
  $(`a[href*="/video/"]`).each((_, el) => {
    if (out.length >= 5) return false;
    const url = cleanUrl($(el).attr('href'));
    if (!url || !/\/video\/\d+/.test(url) || seen.has(url)) return;
    const img = $(el).find('img').first();
    const title = ($(el).text() || $(el).attr('aria-label') || '').replace(/\s+/g, ' ').trim();
    const id = (url.match(/\/video\/(\d+)/) || [])[1] || null;
    out.push({ id, url, title, thumbnail: cleanUrl(img.attr('src')), views: null });
    seen.add(url);
  });
  return out;
}

module.exports = { scrapeTikTokProfile, readTikTokCookieHeader, normalizeUsername, normalizeTikTokResult, fetchVideosWithYtDlp, downloadTikTokVideo, ensureYtDlp };
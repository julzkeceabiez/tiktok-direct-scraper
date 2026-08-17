'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const TIKTOK_BASE = 'https://www.tiktok.com';
const COOKIES_FILE = path.join(process.cwd(), 'cookies', 'cookiestt.txt');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function runYtDlp(args, timeout = 120000) {
  try {
    return await execFileAsync('yt-dlp', args, { timeout, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('yt-dlp tidak ditemukan di server. Install yt-dlp terlebih dahulu.');
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
        if (info?.user) return { info, source: url };
      }
    } catch (e) {}
  }
  return null;
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
    const { info } = apiResult;
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
    let videos = collectVideosFromData(info.itemList || info);
    videos = await resolveVideos(profileUrl, options.cookiesFile || COOKIES_FILE, videos);
    const result = normalizeTikTokResult(profile, videos, 'api');
    ttLog('SUCCESS', { username: result.username, avatar: Boolean(result.avatar), videoCount: result.videoCount, returnedVideos: result.videos.length, videos: result.videos });
    return result;
  }

  // ─── 2. Coba halaman HTML ───
  // TikTok kadang mengirim shell React 12 KB tanpa JSON profil pada URL polos.
  // Parameter lang=en mengembalikan hydration JSON yang dibutuhkan scraper.
  const profileFetchUrls = [
    `${profileUrl}?lang=en`,
    `${profileUrl}?lang=en&is_from_webapp=v1`,
    `${profileUrl}?lang=en&is_copy_url=1&is_from_webapp=v1&sender_device=pc`
  ];
  let response;
  let html = '';
  let status = 0;
  let scripts = [];
  let info = null;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const requestUrl = profileFetchUrls[attempt - 1];
      response = await axios.get(requestUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': profileUrl,
          'Cache-Control': 'no-cache',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        timeout: options.timeout || 45000,
        maxRedirects: 5,
        validateStatus: () => true
      });
      html = String(response.data || '');
      status = response.status;
      if (status < 200 || status >= 300) throw new Error(`TikTok HTTP ${status}`);
      scripts = extractDataScripts(html);
      for (const script of scripts) {

        info = findUserInfo(script.data);
        if (info?.user) break;
      }
      ttLog('HTML_ATTEMPT', { attempt, requestUrl, status, bytes: Buffer.byteLength(html), scriptIds: scripts.map(s => s.id), profileFound: Boolean(info?.user) });
      if (info?.user) {
        ttLog('PROFILE_FOUND', { attempt, requestUrl, source: 'html', username: info.user.uniqueId || username });
        break;
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
  } catch (err) {
    throw new Error(`Gagal menghubungi TikTok: ${err.message}`);
  }

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

  let videos = collectVideosFromData(info.itemList || info);
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

function collectVideosFromData(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || out.length >= 5) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectVideosFromData(item, out, seen);
    return out;
  }
  const id = String(value.id || value.awemeId || value.itemId || '');
  const videoUrl = id && /^\d{8,}$/.test(id) ? `https://www.tiktok.com/@${value.author?.uniqueId || value.author?.unique_id || ''}/video/${id}` : null;
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
  for (const item of Object.values(value)) collectVideosFromData(item, out, seen);
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

module.exports = { scrapeTikTokProfile, readTikTokCookieHeader, normalizeUsername, normalizeTikTokResult, fetchVideosWithYtDlp, downloadTikTokVideo };
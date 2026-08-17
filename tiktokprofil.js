'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const TIKTOK_BASE = 'https://www.tiktok.com';
const COOKIES_FILE = path.join(process.cwd(), 'cookies', 'cookiestt.txt');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

  // ─── 1. Coba endpoint API ───
  const apiResult = await fetchUserInfoFromApi(username, cookieHeader);
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
    let videos = [];
    // Coba ambil itemList dari info jika ada
    videos = collectVideosFromData(info.itemList || info);
    if (!videos.length) {
      // Fallback: tidak ada video, kembalikan kosong
    }
    return { profile, videos: videos.slice(0, 5), rawSource: 'api' };
  }

  // ─── 2. Coba halaman HTML ───
  // TikTok kadang mengirim shell React 12 KB tanpa JSON profil pada URL polos.
  // Parameter lang=en mengembalikan hydration JSON yang dibutuhkan scraper.
  const profileFetchUrl = `${profileUrl}?lang=en`;
  let response;
  let html = '';
  let status = 0;
  let scripts = [];
  let info = null;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await axios.get(profileFetchUrl, {
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
      if (info?.user) break;
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
  if (!videos.length) {
    videos = collectVideosFromHtml(html, profile.username);
  }

  return { profile, videos: videos.slice(0, 5), rawSource: 'html' };
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
  $(`a[href*="/video/"]`).each((_, el) => {
    if (out.length >= 5) return false;
    const url = cleanUrl($(el).attr('href'));
    if (!url || !/\/video\/\d+/.test(url) || seen.has(url)) return;
    const img = $(el).find('img').first();
    const title = ($(el).text() || $(el).attr('aria-label') || '').replace(/\s+/g, ' ').trim();
    out.push({ url, title, thumbnail: cleanUrl(img.attr('src')), views: null });
    seen.add(url);
  });
  return out;
}

module.exports = { scrapeTikTokProfile, readTikTokCookieHeader, normalizeUsername };
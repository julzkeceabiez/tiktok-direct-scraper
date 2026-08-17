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

function findUserInfo(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.userInfo && value.userInfo.user && value.userInfo.stats) return value.userInfo;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findUserInfo(item); if (found) return found; }
  } else {
    for (const item of Object.values(value)) { const found = findUserInfo(item); if (found) return found; }
  }
  return null;
}

function extractHydration(html) {
  const $ = cheerio.load(html);
  const raw = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').html();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function cleanUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value), TIKTOK_BASE);
    return url.protocol === 'https:' && url.hostname.endsWith('tiktok.com') ? url.href : null;
  } catch { return null; }
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

function formatNumber(value) {
  return value === null || value === undefined ? '-' : Number(value).toLocaleString('id-ID');
}

async function scrapeTikTokProfile(input, options = {}) {
  const username = normalizeUsername(input);
  const profileUrl = `${TIKTOK_BASE}/@${encodeURIComponent(username)}`;
  const cookie = readTikTokCookieHeader(options.cookiesFile || COOKIES_FILE);
  const response = await axios.get(profileUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml', ...(cookie ? { Cookie: cookie } : {}) },
    timeout: options.timeout || 45000,
    maxRedirects: 5,
    validateStatus: () => true
  });
  const html = String(response.data || '');
  if (response.status < 200 || response.status >= 300) throw new Error(`TikTok HTTP ${response.status}`);
  const hydration = extractHydration(html);
  const info = findUserInfo(hydration);
  if (!info?.user) {
    if (/captcha-verify|drag the slider|verify to continue/i.test(html)) throw new Error('TikTok meminta CAPTCHA; cookies/sesi browser perlu diperbarui');
    throw new Error('Data profil TikTok tidak ditemukan atau akun tidak publik');
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
  let videos = collectVideosFromData(info.itemList || hydration);
  if (!videos.length) videos = collectVideosFromHtml(html, profile.username);
  return { profile, videos: videos.slice(0, 5), rawHtmlBytes: Buffer.byteLength(html) };
}

module.exports = { scrapeTikTokProfile, readTikTokCookieHeader, normalizeUsername };

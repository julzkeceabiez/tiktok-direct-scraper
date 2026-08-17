'use strict';
const { scrapeTikTokProfile } = require('./tiktokprofil');
(async () => {
  const result = await scrapeTikTokProfile('nakanoriandesu', { cookiesFile: '/home/ubuntu/upload/pasted_content.txt' });
  const required = ['success', 'type', 'username', 'nickname', 'bio', 'avatar', 'followers', 'following', 'likes', 'videoCount', 'verified', 'createdAt', 'profileUrl', 'videos', 'totalVideos', 'source'];
  const missing = required.filter(key => !(key in result));
  if (missing.length) throw new Error(`Missing flat fields: ${missing.join(', ')}`);
  if (!Array.isArray(result.videos) || result.videos.length > 5) throw new Error('videos must be an array of at most five items');
  for (const video of result.videos) {
    for (const key of ['id', 'title', 'url', 'thumbnail', 'views']) if (!(key in video)) throw new Error(`Missing video field: ${key}`);
  }
  console.log(JSON.stringify({ success: result.success, type: result.type, username: result.username, totalVideos: result.totalVideos, avatar: Boolean(result.avatar), fields: required }, null, 2));
})();

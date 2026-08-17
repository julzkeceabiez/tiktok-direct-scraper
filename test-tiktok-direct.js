'use strict';
const { scrapeTikTokProfile } = require('./tiktok-direct-scraper');
(async () => {
  const result = await scrapeTikTokProfile('nakanoriandesu', { cookiesFile: '/home/ubuntu/upload/pasted_content.txt' });
  console.log(JSON.stringify({
    profile: result.profile,
    videoCountReturned: result.videos.length,
    videos: result.videos.map(v => ({ url: v.url, title: v.title, thumbnail: Boolean(v.thumbnail) }))
  }, null, 2));
  if (result.videos.length > 5) throw new Error('More than 5 videos returned');
})();

// Ganti case 'testtiktokrich' / buat case baru 'stalktt' dengan blok ini.
// Dependensi scraper: require('./tiktok-direct-scraper')
case 'stalktt': {
  try {
    const MB = require('baileys-mbuilder');
    const { scrapeTikTokProfile } = require('./tiktok-direct-scraper');
    const query = (args?.join(' ') || text || '').trim();
    if (!query) return Reply('Contoh: .stalktt nakanoriandesu');

    const result = await scrapeTikTokProfile(query, {
      cookiesFile: require('path').join(process.cwd(), 'cookies', 'cookiestt.txt')
    });
    const { profile, videos } = result;
    const ai = new MB.AIRich(alip);
    const avatar = profile.avatar || 'https://www.tiktok.com/favicon.ico';

    ai.addProduct({
      title: '〔 ✦ DATA AKUN TIKTOK ✦ 〕',
      brand: 'TikTok', price: '', sale_price: '', url: profile.url, image: avatar
    });

    ai.addText(`⁀➴ *Nickname* : ${profile.nickname}\n\n⁀➴ *Username* : @${profile.username}\n\n⁀➴ *Bio* : ${profile.bio || '-'}\n\n⁀➴ *Followers* : ${Number(profile.followers).toLocaleString('id-ID')}\n\n⁀➴ *Likes* : ${Number(profile.likes).toLocaleString('id-ID')}\n\n⁀➴ *Videos* : ${Number(profile.videos).toLocaleString('id-ID')}\n\n⁀➴ *Following* : ${Number(profile.following).toLocaleString('id-ID')}\n\n⁀➴ *Verified* : ${profile.verified ? '✅ Yes' : '❌ No'}\n\n⁀➴ *Akun Dibuat* : ${profile.createdAt || '-'}`);

    if (videos.length) {
      ai.addPost(videos.slice(0, 5).map(video => ({
        profile: avatar,
        username: profile.nickname,
        title: profile.nickname,
        subtitle: `@${profile.username}`,
        caption: video.title || 'Video TikTok terbaru',
        verified: profile.verified,
        url: video.url,
        thumbnail: video.thumbnail || avatar,
        source: 'TIKTOK', footer: 'TikTok', deeplink: video.url, icon: avatar
      })));
    }

    await ai.send(m.chat, { forwarded: true, mentions: [m.sender] });
  } catch (err) {
    console.error('[STALKTT_ERROR]', err);
    Reply(`❌ *Gagal mengambil profil TikTok!*\n\n\\`\\`\\`${err.stack || err.message}\\`\\`\\``);
  }
}
break;

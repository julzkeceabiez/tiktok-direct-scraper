// Ganti case 'testtiktokrich' / buat case baru 'stalktt' dengan blok ini.
// Dependensi scraper: require('./tiktok-direct-scraper')
case 'stalktt': {
  try {
    const MB = require('baileys-mbuilder');
    const { scrapeTikTokProfile } = require('./tiktokprofil');
    const query = (args?.join(' ') || text || '').trim();
    if (!query) return Reply('Contoh: .stalktt nakanoriandesu');

    const result = await scrapeTikTokProfile(query, {
      cookiesFile: require('path').join(process.cwd(), 'cookies', 'cookiestt.txt')
    });
    const ai = new MB.AIRich(alip);
    const avatar = result.avatar || 'https://www.tiktok.com/favicon.ico';

    ai.addProduct({
      title: '〔 ✦ DATA AKUN TIKTOK ✦ 〕',
      brand: 'TikTok', price: '', sale_price: '', url: result.profileUrl, image: avatar
    });

    ai.addText(`⁀➴ *Nickname* : ${result.nickname}\n\n⁀➴ *Username* : @${result.username}\n\n⁀➴ *Bio* : ${result.bio || '-'}\n\n⁀➴ *Followers* : ${Number(result.followers).toLocaleString('id-ID')}\n\n⁀➴ *Likes* : ${Number(result.likes).toLocaleString('id-ID')}\n\n⁀➴ *Videos* : ${Number(result.videoCount).toLocaleString('id-ID')}\n\n⁀➴ *Following* : ${Number(result.following).toLocaleString('id-ID')}\n\n⁀➴ *Verified* : ${result.verified ? '✅ Yes' : '❌ No'}\n\n⁀➴ *Akun Dibuat* : ${result.createdAt || '-'}`);

    if (result.videos.length) {
      ai.addPost(result.videos.slice(0, 5).map(video => ({
        profile: avatar,
        username: result.nickname,
        title: result.nickname,
        subtitle: `@${result.username}`,
        caption: video.title || 'Video TikTok terbaru',
        verified: result.verified,
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

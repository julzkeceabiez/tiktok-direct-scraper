case 'ttstalk':
case 'tiktokstalk':
case 'stalktt': {
  const tag = '[TTSTALK]';
  const log = (stage, data = {}) => {
    try {
      const safe = { ...data };
      delete safe.cookie;
      delete safe.cookieHeader;
      delete safe.cookies;
      console.log(`${tag}[${stage}] ${JSON.stringify(safe, null, 2)}`);
    } catch (e) {
      console.log(`${tag}[${stage}]`, stage);
    }
  };

  if (!isRegistered(m.sender) && !isCreator) return daftar(global.mess.verifikasi);
  if (checkLimit(m.sender, isPremium, isCreator)) return Reply(global.mess.limit);

  const query = String(text || '').trim();
  if (!query) return Reply(`Contoh: .${command} nakanoriandesu`);

  log('START', { sender: m.sender.split('@')[0], query });
  addLimit(m.sender, isPremium, isCreator);
  await alip.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });

  try {
    const { scrapeTikTokProfile } = require('./scraper/tiktokprofil');
    const result = await scrapeTikTokProfile(query, {
      cookiesFile: path.join(process.cwd(), 'cookies', 'cookiestt.txt')
    });

    if (!result || result.success === false) {
      throw new Error(result?.message || 'Scraper tidak mengembalikan data profil.');
    }

    const username = result.username || query.replace(/^@/, '');
    const nickname = result.nickname || username;
    const avatar = result.avatar || global.image?.reply;
    const videos = Array.isArray(result.videos) ? result.videos : [];
    const validVideos = [];
    const rejectedVideos = [];

    for (const [index, video] of videos.slice(0, 5).entries()) {
      if (!video || typeof video !== 'object' || !/^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(String(video.url || ''))) {
        rejectedVideos.push({ index: index + 1, reason: 'URL video tidak valid', video });
        continue;
      }
      validVideos.push({
        id: video.id || ((String(video.url).match(/\/video\/(\d+)/) || [])[1] || null),
        profile: avatar,
        profile_url: avatar,
        username: nickname,
        title: nickname,
        subtitle: `@${username}`,
        caption: video.title || 'Video TikTok terbaru',
        verified: Boolean(result.verified),
        url: video.url,
        deeplink: video.url,
        thumbnail: video.thumbnail || avatar,
        icon: avatar,
        source: 'TIKTOK',
        footer: 'TikTok',
        view: Number(video.views) || 0,
        views: Number(video.views) || 0,
        like: Number(video.likes) || 0,
        share: Number(video.shares) || 0
      });
    }

    log('SCRAPER_RESULT', {
      success: result.success,
      type: result.type,
      username: result.username,
      nickname: result.nickname,
      avatar: Boolean(result.avatar),
      followers: result.followers,
      following: result.following,
      likes: result.likes,
      videoCount: result.videoCount,
      returnedByScraper: videos.length,
      validVideos: validVideos.length,
      rejectedVideos,
      source: result.source
    });

    const MB = require('baileys-mbuilder');
    const ai = new MB.AIRich(alip);
    const profileUrl = result.profileUrl || `https://www.tiktok.com/@${encodeURIComponent(username)}`;

    ai.addProduct({
      title: '〔 ✦ DATA AKUN TIKTOK ✦ 〕',
      brand: 'TikTok', price: '', sale_price: '', url: profileUrl,
      image: avatar
    });

    const number = value => Number(value || 0).toLocaleString('id-ID');
    ai.addText(`╭───────〔 🎵 TIKTOK STALK 〕───────╮

│ *Nickname* : ${nickname}
│ *Username* : @${username}
│ *Bio* : ${result.bio || '-'}
│ *Followers* : ${number(result.followers)}
│ *Likes* : ${number(result.likes)}
│ *Videos* : ${number(result.videoCount)}
│ *Following* : ${number(result.following)}
│ *Verified* : ${result.verified ? '✅ Ya' : '❌ No'}
│ *Akun Dibuat* : ${result.createdAt || '-'}

╰───────〔 © ${global.botname || 'Bot'} 〕───────╯`);

    let mediaMode = 'none';
    if (validVideos.length && typeof ai.addPost === 'function') {
      // addPost adalah API yang sudah dipakai pada contoh Anda dan paling konsisten.
      ai.addPost(validVideos);
      mediaMode = 'addPost';
    } else if (validVideos.length && typeof ai.addReels === 'function') {
      ai.addReels(validVideos);
      mediaMode = 'addReels';
    } else if (validVideos.length && typeof ai.addReel === 'function') {
      for (const reel of validVideos) ai.addReel(reel);
      mediaMode = 'addReel';
    }
    log('MEDIA_MODE', { mediaMode, sentVideos: validVideos.length, addPost: typeof ai.addPost, addReels: typeof ai.addReels, addReel: typeof ai.addReel });

    if (!validVideos.length) log('MEDIA_SKIPPED', { reason: 'Tidak ada URL video valid dari TikTok' });
    await ai.send(m.chat, { forwarded: true, mentions: [m.sender] });
    log('SEND_OK', { mediaMode, sentVideos: validVideos.length });
    await alip.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
  } catch (err) {
    log('ERROR', { message: err.message, stack: err.stack });
    await alip.sendMessage(m.chat, { react: { text: '❌', key: m.key } }).catch(() => {});
    Reply('❌ *Gagal mengambil profil TikTok!*\n\n```' + err.message + '```');
  }
}
break;

# Direct TikTok Profile Scraper

Scraper ini membaca halaman web TikTok secara langsung, tanpa TikWM. Data yang diambil hanya data publik yang tersedia pada halaman profil: nickname, username, bio, statistik akun, status verified, tanggal pembuatan bila tersedia, avatar, serta maksimal lima link video publik yang berhasil dirender TikTok.

## Instalasi

Salin `tiktok-direct-scraper.js` ke project bot dan pasang dependensi `axios` serta `cheerio`. Simpan cookie Netscape pada:

```text
cookies/cookiestt.txt
```

Parser hanya memakai baris cookie untuk domain TikTok. Cookie Google, YouTube, TikWM, dan domain lain tidak dikirim ke TikTok.

## Handler WhatsApp

Gunakan isi `tiktok-rich-handler.js` sebagai pengganti blok handler, lalu sesuaikan nama variabel bot apabila project Anda memakai nama berbeda. Contoh perintah:

```text
.stalktt nakanoriandesu
.stalktt @nakanoriandesu
.stalktt https://www.tiktok.com/@nakanoriandesu
```

Handler mengirim satu kartu data profil dan maksimal lima kartu video melalui `AIRich`.

## Batasan TikTok

TikTok dapat menampilkan CAPTCHA atau mengosongkan endpoint daftar video untuk request server-side. Jika itu terjadi, data profil mungkin masih terbaca tetapi daftar video tidak tersedia. Cookies tidak menjamin CAPTCHA dapat dilewati karena TikTok mengikat sebagian validasi pada konteks browser dan request signature. Jangan memasukkan cookies ke repository, log, atau pesan error.

Repository ini sengaja tidak menyertakan cookies, token, atau file sesi apa pun.

## yt-dlp untuk URL video dan download

Untuk enumerasi maksimal lima URL video profil dan mengunduh video berdasarkan URL tersebut, install `yt-dlp` dan `ffmpeg` pada server:

```bash
sudo pip3 install -U yt-dlp
sudo apt-get install -y ffmpeg
```

Scraper akan mencoba membaca video dari response TikTok terlebih dahulu. Jika `itemList` kosong, scraper menggunakan `yt-dlp --flat-playlist --playlist-end 5` pada URL profil, sehingga response tetap berupa URL halaman video, bukan file video. Handler `ttstalk` pada `ttstalk-handler-stable.js` kemudian mengirim kartu profil, mengunduh setiap URL dengan `yt-dlp`, dan mengirim maksimal lima file video secara berurutan.

Log per video menggunakan tahap `YTDLP_RESULT`, `DOWNLOAD_START`, `DOWNLOAD_OK`, `VIDEO_SEND_OK`, atau `DOWNLOAD_ERROR`. Cookie tidak pernah dicetak ke log.

## Validasi download sementara tanpa mengirim video

Handler `ttstalk-handler-stable.js` tetap menjalankan `downloadTikTokVideo()` untuk memastikan setiap URL benar-benar dapat diunduh, tetapi file ditulis ke folder temporary dan dihapus dalam blok `finally`. Tidak ada file video yang dikirim ke WhatsApp.

Jika halaman video TikTok langsung terkena challenge yt-dlp, helper mengambil signed media URL dari halaman resmi `https://www.tiktok.com/embed/v2/<video_id>`, menjalankan yt-dlp terhadap URL CDN tersebut, lalu menghapus hasilnya setelah validasi. Log membedakan `YTDLP_DIRECT_ERROR`, `EMBED_SIGNED_URL_OK`, `YTDLP_EMBED_OK`, `DOWNLOAD_OK`, `DOWNLOAD_ERROR`, dan `DOWNLOAD_CLEANUP`.

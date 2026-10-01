/**
 * Vercel Serverless Function: proxy upload ke 8upload.com
 *
 * Kenapa proxy: respons 8upload.com tidak mengirim header Access-Control-Allow-Origin,
 * jadi browser tidak diizinkan membaca responsnya secara langsung. Fungsi ini jalan
 * di server (tanpa batasan CORS), lalu mengembalikan URL gambar ke frontend.
 *
 * Dipakai oleh tombol "Upload link" di halaman. Di preview statis AutoClaw fungsi ini
 * tidak tersedia; tombol akan menampilkan pesan error. Jalan penuh setelah deploy ke Vercel.
 */

const API = 'https://8upload.com';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

function parseUploadPath(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();

  // Respons normal: string JSON berisi path dengan slash ter-escape, mis. "\/uploads\/abc"
  try {
    const parsed = JSON.parse(t);
    if (typeof parsed === 'string') {
      const m = parsed.match(/\/uploads\/[a-zA-Z0-9]+/);
      if (m) return m[0];
    }
  } catch (e) { }

  // Cadangan: cari pola dengan atau tanpa backslash escape
  const m = t.match(/\\?\/uploads\\?\/[a-zA-Z0-9]+/);
  return m ? m[0].replace(/\\/g, '') : null;
}

function parseHotlink(html) {
  const m = String(html || '').match(/https:\/\/i\.8upload\.com\/image\/[^"'\s<\[\]\\]+/);
  return m ? m[0] : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  // Tolak permintaan lintas situs dari browser (embed/link checker jahat).
  // Catatan: ini pelindung tingkat browser; klien tanpa browser (curl)
  // tetap bisa lewat tanpa autentikasi, jadi jangan andalkan ini sendirian.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ ok: false, error: 'Permintaan lintas situs ditolak' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const dataUrl = String(body.image || '');
    // Batas kasar: base64 3 juta karakter ~ 2,2 MB biner, jauh di bawah
    // limit body Vercel (4,5 MB) supaya endpoint tidak jadi tempat numpuk file.
    if (dataUrl.length > 3000000) {
      res.status(413).json({ ok: false, error: 'Gambar terlalu besar (maksimal sekitar 2 MB)' });
      return;
    }
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
    if (!m) {
      res.status(400).json({ ok: false, error: 'Payload gambar tidak valid' });
      return;
    }

    const mime = m[1] === 'jpg' ? 'jpeg' : m[1];
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const buf = Buffer.from(m[2], 'base64');
    const filename = 'cost-qr-' + Date.now() + '.' + ext;

    // 1. Buka sesi, ambil cookie
    const homeRes = await fetch(API + '/', { headers: { 'user-agent': UA, accept: 'text/html' } });
    let cookies = '';
    if (typeof homeRes.headers.getSetCookie === 'function') {
      cookies = homeRes.headers.getSetCookie().map(function (c) { return c.split(';')[0]; }).join('; ');
    } else {
      const raw = homeRes.headers.get('set-cookie');
      if (raw) cookies = raw.split(',').map(function (c) { return c.split(';')[0]; }).join('; ');
    }

    // 2. Upload gambar
    const form = new FormData();
    form.append('images[]', new Blob([buf], { type: 'image/' + mime }), filename);
    const upRes = await fetch(API + '/upload/mt/', {
      method: 'POST',
      body: form,
      headers: Object.assign({
        'user-agent': UA,
        accept: 'application/json, text/javascript, */*; q=0.01',
        origin: API,
        referer: API + '/',
        'x-requested-with': 'XMLHttpRequest'
      }, cookies ? { cookie: cookies } : {})
    });
    const upText = await upRes.text();
    const uploadPath = parseUploadPath(upText);
    if (!uploadPath) {
      res.status(502).json({ ok: false, error: 'Upload ditolak oleh 8upload', raw: String(upText).slice(0, 200) });
      return;
    }

    // 3. Buka halaman preview, ambil hotlink
    const pvRes = await fetch(API + uploadPath, {
      headers: Object.assign({
        'user-agent': UA,
        referer: API + '/'
      }, cookies ? { cookie: cookies } : {})
    });
    const html = await pvRes.text();
    const url = parseHotlink(html);
    if (!url) {
      res.status(502).json({ ok: false, error: 'Link gambar tidak ditemukan', uploadPath: uploadPath });
      return;
    }

    res.status(200).json({ ok: true, url: url, uploadPath: uploadPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
};

# COST QR Generator (Prototype)

QR generator client-side ala situs COST (cost.biz.id) buat kebutuhan sekolah: link, WiFi, kontak (vCard), dan teks.
Tanpa login, semua diproses di browser. Ada juga halaman `scan.html` untuk membaca QR code dan barcode
lewat kamera, berkas gambar, atau tautan.

## Jalanin lokal

Buka `index.html` langsung di browser, atau pakai static server:

```
python -m http.server 8080
npx serve .
```

Lalu buka http://localhost:8080

Catatan: fitur "Upload link" tidak jalan lewat static server biasa, karena butuh runtime server (lihat di bawah).

## Deploy ke Vercel

1. Push folder ini ke repo GitHub, atau buka https://vercel.com/new lalu drag & drop foldernya.
2. Tidak ada build step dan tidak ada environment variable.
3. Folder `api/` otomatis kebaca sebagai Serverless Function.

Atau lewat CLI:

```
npm i -g vercel
vercel --prod
```

## Struktur

```
index.html                     Halaman utama (single page)
scan.html                      Halaman pembaca QR & barcode (kamera / berkas / tautan)
api/host.js                    Serverless Function: proxy upload gambar ke 8upload
assets/css/fonts.css           @font-face font lokal
assets/css/style.css           Styling (token COST, light theme)
assets/css/scan.css            Styling khusus halaman pembaca
assets/js/app.js               Logika app (builder payload, render, histori, export)
assets/js/scan.js              Logika pembaca (kamera, file, URL, daftar hasil)
assets/fonts/*.woff2           Font COST (Chakra Petch + Atkinson Hyperlegible), latin subset
assets/favicon.svg             Favicon
assets/icon-192.png            Ikon PWA 192
assets/icon-512.png            Ikon PWA 512
assets/apple-touch-icon.png    Ikon iOS
assets/og-image.png            Gambar Open Graph 1200x630
vendor/qr-code-styling.min.js  Library QR (qr-code-styling 1.9.2, MIT)
vendor/html5-qrcode.min.js     Library pindai (html5-qrcode 2.3.8, MIT)
site.webmanifest               Manifest PWA
robots.txt                     Aturan crawler
vercel.json                    Header cache untuk Vercel
```

## Halaman pembaca (scan.html)

Memindai QR code dan barcode (EAN, UPC, Code 128, dll.) lewat tiga cara:

- **Kamera**: live scan lewat `getUserMedia`. Wajib HTTPS atau localhost.
- **Berkas**: pilih atau seret gambar (JPG/PNG/WebP), hasil langsung terbaca.
- **Tautan**: ambil gambar dari URL. Situs asal harus mengirim header CORS;
  kalau tidak, pesan error di halaman menyarankan simpan gambar lalu pilih lewat Berkas.

Pustaka html5-qrcode di-bundle lokal (tanpa CDN). Semua pemrosesan jalan di browser,
tidak ada gambar yang dikirim ke server manapun. Hasil pemindaian hanya tampil
di sesi halaman (tidak disimpan ke localStorage).

## Fitur upload link (hosting gambar)

Tombol **Upload link** mengirim QR (PNG 1024px) ke `api/host.js`, yang mem-proxy unggahan ke 8upload.com lalu mengembalikan URL gambarnya.

- **Wajib jalan di Vercel.** Fungsi ini butuh runtime server. Di preview statis tombol akan menampilkan pesan error.
- Proxy diperlukan karena 8upload.com tidak mengirim header `Access-Control-Allow-Origin`, jadi browser tidak diizinkan membaca responsnya secara langsung.
- Body request dibatasi default Vercel (4.5 MB). QR PNG 1024px jauh di bawah itu.

## Catatan teknis

- Library QR: [qr-code-styling](https://github.com/kozakdenys/qr-code-styling) 1.9.2 (MIT), di-bundle lokal supaya jalan offline tanpa CDN.
- `hideBackgroundDots: false`. Kalau dinyalakan, library menghapus modul QR dalam area kotak, bukan mengikuti bentuk logo.
- Logo di tengah: dibentuk bulat / rounded + ring putih 13%, sehingga logo punya ruang sendiri dan tidak menempel ke modul QR.
- Export PNG selalu 1024px. Kalau ada logo, error correction naik ke level H.
- Histori di `localStorage` (`qrgen_history_v1`), maksimal 50 item, perangkat saja.
- Font dilokalkan (bukan CDN). Preload 2 font kritis ada di `index.html`.

## Keamanan

- Header keamanan diatur di `vercel.json`: CSP (script tanpa `unsafe-inline`, JSON-LD
  dikunci lewat hash), `X-Content-Type-Options`, `X-Frame-Options` / `frame-ancestors 'none'`,
  `Referrer-Policy`, HSTS, dan `Permissions-Policy` yang hanya mengizinkan kamera untuk
  situs sendiri.
- `api/host.js` menolak permintaan lintas situs (`Sec-Fetch-Site`), membatasi payload
  ~2 MB, dan hanya menerima tipe gambar. Endpoint masih tanpa autentikasi: klien
  non-browser (curl) bisa memakainya. Kalau mulai disalahgunakan, tambahkan API key
  atau rate limit.
- Halaman pembaca memindai gambar lewat `fetch` dari browser kamu. Tidak ada pemanggilan
  otomatis lewat parameter URL, jadi tidak ada pemindaian sendiri-dari-luar.
- Isi riwayat (termasuk password WiFi di payload QR) tersimpan di `localStorage` per
  browser. Pakai "Hapus semua" di perangkat yang dibagikan.

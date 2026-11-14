/* Konfigurasi runtime.
   Di web (Vercel/static server) biarkan kosong: fetch pakai path relatif.
   Di APK, build script mengisi ini dengan domain Vercel. */
window.QRCONFIG = { apiBase: '' };

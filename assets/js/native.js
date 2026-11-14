/* Penyesuaian saat jalan sebagai APK (Capacitor).
   Di browser biasa file ini tidak melakukan apa-apa.
   Catatan: halaman ini tanpa bundler, jadi window.Capacitor.Plugins kosong.
   Pakai addListener()/nativePromise() dari native bridge. */

(function () {
  'use strict';

  var cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  // Tombol back Android: kembali ke halaman sebelumnya, bukan langsung keluar.
  if (typeof cap.addListener === 'function') {
    cap.addListener('App', 'backButton', function () {
      if (window.history.length > 1) {
        window.history.back();
      } else if (typeof cap.nativePromise === 'function') {
        cap.nativePromise('App', 'exitApp', {});
      }
    });
  }
})();

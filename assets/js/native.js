/* Penyesuaian saat jalan sebagai APK (Capacitor).
   Di browser biasa file ini tidak melakukan apa-apa. */

(function () {
  'use strict';

  var cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  // Tombol back Android: kembali ke halaman sebelumnya, bukan langsung keluar.
  var app = cap.Plugins && cap.Plugins.App;
  if (app && app.addListener) {
    app.addListener('backButton', function () {
      if (window.history.length > 1) window.history.back();
      else app.exitApp();
    });
  }
})();

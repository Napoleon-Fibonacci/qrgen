/* Pembaca QR & Barcode - COST QR Generator
   Kamera / berkas / tautan, semua lewat html5-qrcode (vendor lokal). */

(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var FORMAT_LABEL = {
    QR_CODE: 'QR Code',
    AZTEC: 'Aztec',
    DATA_MATRIX: 'Data Matrix',
    PDF_417: 'PDF417',
    UPC_A: 'UPC-A',
    UPC_E: 'UPC-E',
    EAN_8: 'EAN-8',
    EAN_13: 'EAN-13',
    CODE_39: 'Kode 39',
    CODE_93: 'Kode 93',
    CODE_128: 'Kode 128',
    CODABAR: 'Codabar',
    ITF: 'ITF',
    RSS_14: 'RSS-14',
    RSS_EXPANDED: 'RSS Expanded'
  };

  var EMPTY_TEXT = {
    cam: 'Kamera mati.<br>Tekan Mulai kamera.',
    file: 'Belum ada gambar.<br>Pilih gambar untuk mulai.',
    url: 'Belum ada gambar.<br>Masukkan tautan lalu pindai.'
  };

  function fmtLabel(name) {
    if (!name) return 'Kode';
    return FORMAT_LABEL[name] || String(name).replace(/_/g, ' ');
  }

  function readFormat(res) {
    if (!res) return null;
    var inner = res.result || res;
    var f = inner.format;
    if (f && typeof f === 'object') return f.formatName || null;
    if (typeof f === 'string') return f;
    return null;
  }

  var mode = 'cam';
  var scanner = null;
  var camRunning = false;
  var results = [];
  var objectUrl = null;
  var hitTimer = 0;
  var toastTimer = 0;

  /* ---------- Umpan balik ---------- */

  function status(text, kind) {
    var el = $('#stage-status');
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-busy', kind === 'busy');
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
      el.hidden = true;
    }, 2400);
  }

  function flash() {
    var stage = $('#scan-stage');
    clearTimeout(hitTimer);
    stage.classList.add('hit');
    hitTimer = setTimeout(function () { stage.classList.remove('hit'); }, 600);
  }

  function updateStage() {
    var img = $('#stage-img');
    var empty = $('#stage-empty');
    if (camRunning) {
      img.hidden = true;
      empty.hidden = true;
      return;
    }
    if (img.getAttribute('src')) {
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.hidden = true;
      empty.hidden = false;
    }
  }

  /* ---------- Tab ---------- */

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var next = tab.getAttribute('data-mode');
      if (next === mode) return;
      if (mode === 'cam') stopCam();
      mode = next;
      $$('.tab').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $$('.tabpane').forEach(function (pane) {
        var on = pane.id === 'panel-' + mode;
        pane.classList.toggle('is-active', on);
        pane.hidden = !on;
      });
      $('#stage-empty').innerHTML = '<p>' + EMPTY_TEXT[mode] + '</p>';
      status('');
      updateStage();
    });
  });

  /* ---------- Kamera ---------- */

  function setCamUi(running) {
    camRunning = running;
    $('#cam-toggle').textContent = running ? 'Berhenti' : 'Mulai kamera';
    $('#scan-stage').classList.toggle('is-live', running);
    updateStage();
  }

  function getScanner() {
    if (!scanner) scanner = new Html5Qrcode('qr-reader', { verbose: false });
    return scanner;
  }

  function startCam() {
    if (typeof Html5Qrcode === 'undefined') {
      status('Baca pustaka gagal dimuat. Muat ulang halaman.', 'error');
      return;
    }
    status('');
    var box = Math.max(160, Math.min(240, $('#scan-stage').clientWidth - 40));
    getScanner()
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: function () { return { width: box, height: box }; } },
        function (text, res) {
          var d = onDetect(text, readFormat(res));
          if (d.isNew) status('Terbaca: ' + d.label);
        },
        function () { }
      )
      .then(function () {
        setCamUi(true);
        status('Kamera aktif. Arahkan ke kode.');
      })
      .catch(function (err) {
        camFail(err);
      });
  }

  function stopCam() {
    var wasRunning = camRunning;
    setCamUi(false);
    if (wasRunning && scanner) {
      scanner.stop().then(function () { scanner.clear(); }).catch(function () { });
    }
    if (mode === 'cam' || wasRunning) status('');
  }

  function camFail(err) {
    var n = err && err.name;
    var msg;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') {
      msg = 'Izin kamera ditolak. Ubah izin situs di browser, lalu coba lagi.';
    } else if (n === 'NotFoundError' || n === 'OverconstrainedError') {
      msg = 'Kamera tidak ditemukan di perangkat ini.';
    } else if (n === 'NotReadableError' || n === 'TrackStartError') {
      msg = 'Kamera sedang dipakai aplikasi lain.';
    } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg = 'Kamera butuh halaman HTTPS atau localhost.';
    } else {
      msg = 'Kamera gagal dimulai: ' + (err && err.message ? err.message : err);
    }
    setCamUi(false);
    status(msg, 'error');
  }

  $('#cam-toggle').addEventListener('click', function () {
    if (camRunning) stopCam();
    else startCam();
  });

  window.addEventListener('pagehide', function () {
    if (camRunning) stopCam();
  });

  /* ---------- Deteksi ---------- */

  function onDetect(text, formatName) {
    var label = fmtLabel(formatName);
    var isNew = addResult(text, label);
    if (isNew) flash();
    return { label: label, isNew: isNew };
  }

  function addResult(text, label) {
    for (var i = 0; i < results.length; i++) {
      if (results[i].text === text) return false;
    }
    results.unshift({ text: text, label: label, t: Date.now() });
    if (results.length > 30) results.pop();
    renderResults();
    return true;
  }

  function renderResults() {
    var list = $('#result-list');
    list.innerHTML = '';
    results.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'result-item';

      var main = document.createElement('div');
      main.className = 'result-main';
      var kind = document.createElement('span');
      kind.className = 'result-kind';
      kind.textContent = item.label;
      var txt = document.createElement('span');
      txt.className = 'result-text';
      txt.textContent = item.text;
      txt.title = item.text;
      main.appendChild(kind);
      main.appendChild(txt);
      li.appendChild(main);

      var acts = document.createElement('div');
      acts.className = 'result-actions';

      if (/^https?:\/\//i.test(item.text)) {
        var a = document.createElement('a');
        a.className = 'btn btn-mini';
        a.href = item.text;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Buka';
        acts.appendChild(a);
      }

      var cp = document.createElement('button');
      cp.type = 'button';
      cp.className = 'btn btn-mini';
      cp.textContent = 'Salin';
      cp.addEventListener('click', function () {
        navigator.clipboard.writeText(item.text)
          .then(function () { toast('Hasil ke-copy'); })
          .catch(function () { toast('Gagal copy, salin manual'); });
      });
      acts.appendChild(cp);

      li.appendChild(acts);
      list.appendChild(li);
    });

    var empty = results.length === 0;
    $('#res-empty').hidden = !empty;
    $('#res-clear').hidden = empty;
  }

  $('#res-clear').addEventListener('click', function () {
    results = [];
    renderResults();
  });

  /* ---------- Pindai dari berkas / tautan ---------- */

  function showPreview(blob) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    var img = $('#stage-img');
    img.src = objectUrl;
    updateStage();
  }

  function scanBlob(file) {
    var s = getScanner();
    if (typeof s.scanFileV2 === 'function') {
      return s.scanFileV2(file, false);
    }
    return s.scanFile(file, false).then(function (text) {
      return { decodedText: text };
    });
  }

  function handleImageBlob(blob, where) {
    showPreview(blob);
    status('Membaca gambar…', 'busy');
    var file;
    try {
      file = new File([blob], 'pindai', { type: blob.type || 'image/png' });
    } catch (e) {
      file = blob;
    }
    scanBlob(file)
      .then(function (r) {
        var text = r && (r.decodedText || r.text);
        if (!text) throw new Error('empty');
        var d = onDetect(text, readFormat(r));
        status('Terbaca: ' + d.label);
      })
      .catch(function () {
        status('Tidak ada kode terbaca di ' + where + '.', 'error');
      });
  }

  $('#file-input').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      status('File itu bukan gambar.', 'error');
      return;
    }
    $('#file-name').textContent = f.name;
    handleImageBlob(f, 'gambar ini');
  });

  // Tarik-lepas berkas ke area pilih gambar
  var dropZone = $('#file-drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropZone.classList.remove('is-drag');
    });
  });
  dropZone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      status('File itu bukan gambar.', 'error');
      return;
    }
    $('#file-name').textContent = f.name;
    handleImageBlob(f, 'gambar ini');
  });

  function scanUrl() {
    var v = $('#url-input').value.trim();
    if (!v) {
      status('Isi tautan gambar dulu.', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    status('Mengambil gambar…', 'busy');
    fetch(v)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        if (!/^image\//.test(blob.type)) throw new Error('bukan-gambar');
        handleImageBlob(blob, 'gambar itu');
      })
      .catch(function (err) {
        var msg = (err && err.message) || '';
        if (/^HTTP \d+$/.test(msg)) {
          status('Gambar gagal diunduh (' + msg + ').', 'error');
        } else if (msg === 'bukan-gambar') {
          status('Tautan itu bukan gambar.', 'error');
        } else {
          status('Gambar tidak bisa diambil dari situs itu. Simpan gambarnya, lalu pilih lewat Berkas.', 'error');
        }
      });
  }

  $('#url-go').addEventListener('click', scanUrl);
  $('#url-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      scanUrl();
    }
  });

  /* ---------- Init ---------- */

  renderResults();
  updateStage();
})();

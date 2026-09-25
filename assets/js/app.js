/* QR Generator Sekolah - prototype MVP */

(function () {
  'use strict';

  /* ---------- Fungsi murni (bisa dites langsung di Node) ---------- */

  // Escape karakter khusus sesuai spec format WIFI:
  function escWifi(s) {
    return String(s).replace(/([\\;,:"])/g, '\\$1');
  }

  function wifiString(opts) {
    var t = opts.enc === 'nopass' ? 'nopass' : opts.enc; // 'WPA' | 'WEP' | 'nopass'
    var parts = ['T:' + t, 'S:' + escWifi(opts.ssid)];
    if (opts.enc !== 'nopass' && opts.password) parts.push('P:' + escWifi(opts.password));
    if (opts.hidden) parts.push('H:true');
    return 'WIFI:' + parts.join(';') + ';;';
  }

  // Escape sesuai spec vCard: backslash, koma, titik koma, newline
  function escVcf(s) {
    return String(s).replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
  }

  function vcardString(f) {
    var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + escVcf(f.name), 'FN:' + escVcf(f.name)];
    if (f.tel) lines.push('TEL;TYPE=CELL:' + f.tel);
    if (f.email) lines.push('EMAIL:' + escVcf(f.email));
    if (f.title) lines.push('TITLE:' + escVcf(f.title));
    lines.push('END:VCARD');
    return lines.join('\n');
  }

  // Auto https:// kalau user tidak nulis skema
  function normalizeUrl(v) {
    var s = String(v).trim();
    if (!s) return '';
    if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(s)) s = 'https://' + s;
    return s;
  }

  function slugify(s) {
    var out = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    var words = out.split('-').filter(Boolean).slice(0, 3);
    return words.length ? words.join('-') : 'qr';
  }

  function fileName(info) {
    var d = info.now ? new Date(info.now) : new Date();
    var ds = d.toISOString().slice(0, 10);
    return 'qr-' + info.type + '-' + slugify(info.label) + '-' + ds + '.' + info.ext;
  }

  // Rasio kontras warna QR terhadap latar putih (WCAG relative luminance)
  function contrastAgainstWhite(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return 21;
    var n = parseInt(m[1], 16);
    function ch(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    var L = 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
    return 1.05 / (L + 0.05);
  }

  /* ---------- Batas Node/browser: di Node, export fungsi murni untuk test ---------- */

  var api = {
    escWifi: escWifi,
    wifiString: wifiString,
    escVcf: escVcf,
    vcardString: vcardString,
    normalizeUrl: normalizeUrl,
    slugify: slugify,
    fileName: fileName,
    contrastAgainstWhite: contrastAgainstWhite
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  /* ---------- Aplikasi browser ---------- */

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var HKEY = 'qrgen_history_v1';
  var EXPORT_SIZE = 1024;
  var state = { type: 'url', color: '#111111', logo: null, logoSource: null, logoShape: 'circle', logoFit: 'cover', imageUrl: null };

  var qr = null;          // instance preview
  var debounceTimer = 0;

  // Tiap builder balikin { data, label } atau null kalau belum ada isi
  var builders = {
    url: function () {
      var v = $('#url-input').value.trim();
      if (!v) return null;
      var url = normalizeUrl(v);
      return { data: url, label: url.replace(/^https?:\/\//i, '') };
    },
    text: function () {
      var v = $('#text-input').value;
      if (!v.trim()) return null;
      return { data: v, label: v.trim().split(/\s+/).slice(0, 3).join(' ') };
    },
    wifi: function () {
      var ssid = $('#wifi-ssid').value.trim();
      if (!ssid) return null;
      return {
        data: wifiString({
          ssid: ssid,
          password: $('#wifi-pass').value,
          enc: $('#wifi-enc').value,
          hidden: $('#wifi-hidden').checked
        }),
        label: ssid
      };
    },
    contact: function () {
      var name = $('#c-name').value.trim();
      if (!name) return null;
      return {
        data: vcardString({
          name: name,
          tel: $('#c-tel').value.trim(),
          email: $('#c-email').value.trim(),
          title: $('#c-title').value.trim()
        }),
        label: name
      };
    },
    image: function () {
      if (!state.imageUrl) return null;
      var name = $('#image-name').textContent || 'gambar';
      return { data: state.imageUrl, label: name };
    }
  };

  function currentPayload() {
    var b = builders[state.type];
    return b ? b() : null;
  }

  function baseOptions(data, size, margin) {
    return {
      width: size,
      height: size,
      type: 'canvas',
      data: data,
      image: state.logo || undefined,
      imageOptions: { hideBackgroundDots: false, imageSize: 0.4, margin: 2, crossOrigin: 'anonymous' },
      margin: margin,
      qrOptions: { typeNumber: 0, mode: 'Byte', errorCorrectionLevel: state.logo ? 'H' : 'M' },
      dotsOptions: { color: state.color, type: 'extra-rounded' },
      cornersSquareOptions: { color: state.color, type: 'extra-rounded' },
      cornersDotOptions: { color: state.color },
      backgroundOptions: { color: '#ffffff' }
    };
  }

  function exportOptions(data, ext) {
    var o = baseOptions(data, EXPORT_SIZE, Math.round(EXPORT_SIZE * 0.045));
    o.type = ext === 'svg' ? 'svg' : 'canvas';
    return o;
  }

  function histOptions(item, size, margin, ext) {
    return {
      width: size,
      height: size,
      type: ext === 'svg' ? 'svg' : 'canvas',
      data: item.payload,
      image: item.logo || undefined,
      imageOptions: { hideBackgroundDots: false, imageSize: 0.4, margin: 2, crossOrigin: 'anonymous' },
      margin: margin,
      qrOptions: { typeNumber: 0, mode: 'Byte', errorCorrectionLevel: item.logo ? 'H' : 'M' },
      dotsOptions: { color: item.color, type: 'extra-rounded' },
      cornersSquareOptions: { color: item.color, type: 'extra-rounded' },
      cornersDotOptions: { color: item.color },
      backgroundOptions: { color: '#ffffff' }
    };
  }

  /* ---------- Render preview ---------- */

  function apply() {
    var p = currentPayload();
    var emptyEl = $('#qr-empty');
    var wrapEl = $('#qr-canvas');
    var hint = $('#scan-hint');
    var disabled = !p;

    ['#btn-png', '#btn-svg', '#btn-copy', '#btn-share', '#btn-host'].forEach(function (id) {
      $(id).disabled = disabled;
    });

    updateTextMeta();
    updateContrastWarn();

    if (!p) {
      emptyEl.hidden = false;
      wrapEl.hidden = true;
      hint.hidden = true;
      $('.qr-stage').classList.remove('has-qr');
      qr = null;
      wrapEl.innerHTML = '';
      return;
    }

    emptyEl.hidden = true;
    wrapEl.hidden = false;
    hint.hidden = false;
    $('.qr-stage').classList.add('has-qr');

    try {
      var opts = baseOptions(p.data, 320, 14);
      var firstRender = !qr;
      if (!qr) {
        qr = new QRCodeStyling(opts);
        wrapEl.innerHTML = '';
        qr.append(wrapEl);
      } else {
        qr.update(opts);
      }
      // Animasi pop cuma saat QR pertama muncul: hindari forced reflow tiap ketikan
      if (firstRender) wrapEl.classList.add('pop');
    } catch (err) {
      emptyEl.hidden = true;
      wrapEl.hidden = true;
      hint.hidden = true;
      $('.qr-stage').classList.remove('has-qr');
      toast('Isi terlalu panjang buat dijadiin QR');
    }
  }

  function schedule() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(apply, 180);
  }

  function updateTextMeta() {
    var v = $('#text-input').value;
    $('#text-counter').textContent = v.length + ' karakter';
    $('#text-warn').hidden = v.length <= 800;
  }

  function updateContrastWarn() {
    $('#contrast-warn').hidden = contrastAgainstWhite(state.color) >= 3;
  }

  /* ---------- Tab ---------- */

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      state.type = tab.getAttribute('data-type');
      $$('.tabpane').forEach(function (pane) {
        var on = pane.id === 'panel-' + state.type;
        pane.classList.toggle('is-active', on);
        pane.hidden = !on;
      });
      apply();
    });
  });

  /* ---------- Form ---------- */

  $('#qr-form').addEventListener('input', schedule);

  // WiFi: toggle password
  var passInput = $('#wifi-pass');
  $('#wifi-toggle').addEventListener('click', function () {
    var show = passInput.type === 'password';
    passInput.type = show ? 'text' : 'password';
    this.textContent = show ? 'Sembunyikan' : 'Tampilkan';
    this.setAttribute('aria-pressed', show ? 'true' : 'false');
  });

  // WiFi: enkripsi tanpa password = password disabled
  $('#wifi-enc').addEventListener('change', function () {
    passInput.disabled = this.value === 'nopass';
    schedule();
  });

  /* ---------- Warna ---------- */

  var colorInput = $('#color-input');
  colorInput.addEventListener('input', function () {
    state.color = colorInput.value;
    syncChips();
    schedule();
  });

  $$('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.color = chip.getAttribute('data-color');
      colorInput.value = state.color;
      syncChips();
      apply();
    });
  });

  function syncChips() {
    $$('.chip').forEach(function (c) {
      var on = c.getAttribute('data-color').toLowerCase() === String(state.color).toLowerCase();
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- Logo ---------- */

  function loadLogoFile(f) {
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      toast('File harus berupa gambar');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        state.logoSource = downscaleSource(img, 512);
        state.logo = makeLogo(img, 256, state.logoShape, state.logoFit);
        $('#logo-name').textContent = f.name;
        $('#logo-remove').hidden = false;
        $('#logo-shape').hidden = false;
        $('#logo-fit').hidden = false;
        syncShape();
        apply();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }

  $('#logo-input').addEventListener('change', function (e) {
    loadLogoFile(e.target.files && e.target.files[0]);
  });

  // Tarik-lepas file logo ke area tombol
  var dropZone = $('#logo-drop');
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
    if (f) loadLogoFile(f);
  });

  $('#logo-remove').addEventListener('click', function () {
    state.logo = null;
    state.logoSource = null;
    $('#logo-input').value = '';
    $('#logo-name').textContent = 'Belum ada file';
    $('#logo-remove').hidden = true;
    $('#logo-shape').hidden = true;
    $('#logo-fit').hidden = true;
    apply();
  });

  // Pilih bentuk & ukuran logo
  $$('#logo-shape .btn').forEach(function (b) {
    b.addEventListener('click', function () { setShape(b.getAttribute('data-shape')); });
  });
  $$('#logo-fit .btn').forEach(function (b) {
    b.addEventListener('click', function () { setFit(b.getAttribute('data-fit')); });
  });

  // Logo dibentuk (bulat / rounded) + dikasih ring putih, jadi logo punya
  // ruang sendiri dan gak nempel langsung ke modul QR.
  function makeLogo(srcImg, size, shape, fit) {
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var ctx = c.getContext('2d');
    var aspect = srcImg.naturalWidth / srcImg.naturalHeight;
    var pad = size * 0.13;
    var inner = size - pad * 2;

    shapePath(ctx, 0, 0, size, size, shape);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.save();
    shapePath(ctx, pad, pad, inner, inner, shape);
    ctx.clip();

    var W, H;
    if (fit === 'contain') {
      var box = inner * 0.92;
      if (aspect >= 1) { W = box; H = box / aspect; } else { H = box; W = box * aspect; }
    } else {
      if (aspect >= 1) { H = inner; W = inner * aspect; } else { W = inner; H = inner / aspect; }
    }
    ctx.drawImage(srcImg, (size - W) / 2, (size - H) / 2, W, H);
    ctx.restore();

    return c.toDataURL('image/png');
  }

  function shapePath(ctx, x, y, w, h, shape) {
    ctx.beginPath();
    if (shape === 'rounded') {
      var r = Math.min(w, h) * 0.22;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
    } else {
      ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    }
    ctx.closePath();
  }

  // Simpan versi kecil dari gambar asli buat re-render saat bentuk logo diganti
  function downscaleSource(img, max) {
    var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  }

  // Ganti bentuk / ukuran logo tanpa minta user upload ulang
  function setShape(shape) {
    state.logoShape = shape;
    try { localStorage.setItem('qrgen_logo_shape', shape); } catch (e) { }
    syncShape();
    rebuildLogo();
  }

  function setFit(fit) {
    state.logoFit = fit;
    try { localStorage.setItem('qrgen_logo_fit', fit); } catch (e) { }
    syncShape();
    rebuildLogo();
  }

  function rebuildLogo() {
    if (!state.logoSource) return;
    var img = new Image();
    img.onload = function () {
      state.logo = makeLogo(img, 256, state.logoShape, state.logoFit);
      apply();
    };
    img.src = state.logoSource;
  }

  function syncShape() {
    $$('#logo-shape .btn').forEach(function (b) {
      var on = b.getAttribute('data-shape') === state.logoShape;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('#logo-fit .btn').forEach(function (b) {
      var on = b.getAttribute('data-fit') === state.logoFit;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- Export: PNG / SVG / Salin / Bagikan ---------- */

  function makeTmp(ext) {
    var p = currentPayload();
    if (!p) return null;
    return new QRCodeStyling(exportOptions(p.data, ext));
  }

  function downloadExt(ext) {
    var p = currentPayload();
    if (!p) return;
    try {
      var tmp = makeTmp(ext);
      tmp.download({
        name: fileName({ type: state.type, label: p.label, ext: ext }),
        extension: ext
      }).then(function () { addHistory(p); })
        .catch(function () { toast('Gagal download'); });
    } catch (err) {
      toast('Gagal bikin file QR');
    }
  }

  $('#btn-png').addEventListener('click', function () { downloadExt('png'); });
  $('#btn-svg').addEventListener('click', function () { downloadExt('svg'); });

  $('#btn-copy').addEventListener('click', function () {
    var tmp = makeTmp('png');
    if (!tmp) return;
    tmp.getRawData('png')
      .then(function (blob) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      })
      .then(function () {
        toast('QR ke-copy ke clipboard');
        addHistory(currentPayload());
      })
      .catch(function () {
        toast('Browser kamu belum dukung copy gambar. Pakai Download PNG aja.');
      });
  });

  $('#btn-share').addEventListener('click', function () {
    var p = currentPayload();
    if (!p) return;
    var tmp = makeTmp('png');
    tmp.getRawData('png')
      .then(function (blob) {
        var file = new File([blob], fileName({ type: state.type, label: p.label, ext: 'png' }), { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], text: 'QR code: ' + p.label });
        }
        if (navigator.share) {
          return navigator.share({ title: 'COST QR Generator', text: p.data });
        }
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          .then(function () { toast('Share gak tersedia, QR ke-copy ke clipboard'); });
      })
      .then(function () { addHistory(p); })
      .catch(function (err) {
        if (err && err.name !== 'AbortError') toast('Gagal membagikan');
      });
  });

  /* ---------- Upload gambar (mode Gambar) ---------- */

  function setImageStatus(text, kind) {
    var el = $('#image-status');
    el.textContent = text;
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-busy', kind === 'busy');
  }

  // Kecilkan + normalisasi gambar dulu, biar hemat kuota dan aman batas body Vercel
  function prepareImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        var png = /image\/png/i.test(file.type);
        cb(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function uploadImageFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      setImageStatus('File harus berupa gambar', 'error');
      return;
    }
    $('#image-name').textContent = file.name;
    $('#image-result').hidden = true;
    state.imageUrl = null;
    setImageStatus('Mengunggah...', 'busy');
    apply();

    prepareImage(file, function (dataUrl) {
      if (!dataUrl) {
        setImageStatus('Gagal membaca gambar', 'error');
        return;
      }
      fetch('api/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      }).then(function (res) {
        if (res.status === 404 || res.status === 405) {
          throw new Error('butuh deploy di Vercel dulu (preview ini statis)');
        }
        return res.text().then(function (text) {
          var data;
          try { data = JSON.parse(text); } catch (e) { data = null; }
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || ('server balas ' + res.status));
          }
          return data;
        });
      }).then(function (data) {
        state.imageUrl = data.url;
        $('#image-url').value = data.url;
        $('#image-result').hidden = false;
        setImageStatus('Berhasil di-upload. Link-nya jadi isi QR.');
        apply();
      }).catch(function (err) {
        setImageStatus('Upload gagal: ' + ((err && err.message) || 'coba lagi'), 'error');
        apply();
      });
    });
  }

  $('#image-input').addEventListener('change', function (e) {
    uploadImageFile(e.target.files && e.target.files[0]);
  });

  var imageDrop = $('#image-drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    imageDrop.addEventListener(ev, function (e) {
      e.preventDefault();
      imageDrop.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    imageDrop.addEventListener(ev, function (e) {
      e.preventDefault();
      imageDrop.classList.remove('is-drag');
    });
  });
  imageDrop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) uploadImageFile(f);
  });

  $('#image-copy').addEventListener('click', function () {
    var url = $('#image-url').value;
    if (!url) return;
    navigator.clipboard.writeText(url)
      .then(function () { toast('Link ke-copy'); })
      .catch(function () { toast('Gagal copy, salin manual ya'); });
  });

  /* ---------- Histori (localStorage) ---------- */

  function loadHist() {
    try {
      var v = JSON.parse(localStorage.getItem(HKEY));
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function saveHist(list) {
    try {
      localStorage.setItem(HKEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Gagal membaca gambar')); };
      r.readAsDataURL(blob);
    });
  }

  // Upload QR ke hosting gambar lewat proxy serverless (api/host).
  // Proxy perlu karena 8upload tidak mengirim header CORS.
  $('#btn-host').addEventListener('click', function () {
    var p = currentPayload();
    if (!p) return;
    var btn = this;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Upload...';

    var tmp = new QRCodeStyling(exportOptions(p.data, 'png'));
    tmp.getRawData('png')
      .then(blobToDataUrl)
      .then(function (dataUrl) {
        return fetch('api/host', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl })
        });
      })
      .then(function (res) {
        if (res.status === 404 || res.status === 405) {
          throw new Error('butuh deploy di Vercel dulu (preview ini statis)');
        }
        return res.text().then(function (text) {
          var data;
          try { data = JSON.parse(text); } catch (e) { data = null; }
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || ('server balas ' + res.status));
          }
          return data;
        });
      })
      .then(function (data) {
        $('#host-url').value = data.url;
        $('#host-result').hidden = false;
        toast('Link gambar siap');
        addHistory(p);
      })
      .catch(function (err) {
        toast('Upload gagal: ' + ((err && err.message) || 'coba lagi'));
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
  });

  $('#host-copy').addEventListener('click', function () {
    var url = $('#host-url').value;
    if (!url) return;
    navigator.clipboard.writeText(url)
      .then(function () { toast('Link ke-copy'); })
      .catch(function () { toast('Gagal copy, salin manual ya'); });
  });

  function makeThumb(data) {
    var o = baseOptions(data, 96, 4);
    o.type = 'canvas';
    var tmp = new QRCodeStyling(o);
    return tmp.getRawData('png').then(function (blob) {
      return new Promise(function (resolve) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { resolve(null); };
        r.readAsDataURL(blob);
      });
    });
  }

  function addHistory(p) {
    if (!p) return;
    makeThumb(p.data).then(function (thumb) {
      var list = loadHist();
      list.unshift({
        t: Date.now(),
        type: state.type,
        label: p.label,
        payload: p.data,
        color: state.color,
        logo: state.logo,
        thumb: thumb
      });
      if (!saveHist(list)) {
        // Kuota localStorage penuh: buang logo dulu, lalu thumbnail, lalu item lama
        list.forEach(function (it) { delete it.logo; });
        if (!saveHist(list)) {
          list.forEach(function (it) { delete it.thumb; });
          while (list.length && !saveHist(list)) list.pop();
        }
      }
      renderHist();
    }).catch(function () { });
  }

  function renderHist() {
    var list = loadHist();
    var grid = $('#hist-grid');
    grid.innerHTML = '';
    $('#hist-empty').hidden = list.length > 0;
    $('#hist-clear').hidden = list.length === 0;

    list.forEach(function (item, idx) {
      var card = document.createElement('div');
      card.className = 'hist-item';
      card.style.setProperty('--i', String(idx % 12));

      if (item.thumb) {
        var im = document.createElement('img');
        im.src = item.thumb;
        im.alt = 'QR ' + item.label;
        im.width = 96;
        im.height = 96;
        card.appendChild(im);
      }

      var lab = document.createElement('p');
      lab.className = 'hist-label';
      lab.textContent = item.label;
      card.appendChild(lab);

      var meta = document.createElement('p');
      meta.className = 'hist-date';
      var d = new Date(item.t);
      meta.textContent = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) +
        ', ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      card.appendChild(meta);

      var row = document.createElement('div');
      row.className = 'hist-actions';

      var bRedo = document.createElement('button');
      bRedo.type = 'button';
      bRedo.className = 'btn btn-mini';
      bRedo.textContent = 'Download ulang';
      bRedo.addEventListener('click', function () {
        var tmp = new QRCodeStyling(histOptions(item, EXPORT_SIZE, Math.round(EXPORT_SIZE * 0.045), 'png'));
        tmp.download({
          name: fileName({ type: item.type, label: item.label, ext: 'png' }),
          extension: 'png'
        }).catch(function () { toast('Gagal download'); });
      });
      row.appendChild(bRedo);

      var bDel = document.createElement('button');
      bDel.type = 'button';
      bDel.className = 'btn btn-mini btn-danger';
      bDel.textContent = 'Hapus';
      bDel.addEventListener('click', function () {
        var l = loadHist();
        l.splice(idx, 1);
        saveHist(l);
        renderHist();
      });
      row.appendChild(bDel);

      card.appendChild(row);
      grid.appendChild(card);
    });
  }

  $('#hist-clear').addEventListener('click', function () {
    $('#confirm-clear').hidden = false;
  });
  $('#hist-clear-no').addEventListener('click', function () {
    $('#confirm-clear').hidden = true;
  });
  $('#hist-clear-yes').addEventListener('click', function () {
    saveHist([]);
    $('#confirm-clear').hidden = true;
    renderHist();
  });

  /* ---------- Toast ---------- */

  var toastTimer = 0;
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

  /* ---------- Init ---------- */

  syncChips();
  renderHist();
  apply();

  // Preferensi bentuk & ukuran logo terakhir
  try {
    var savedShape = localStorage.getItem('qrgen_logo_shape');
    var savedFit = localStorage.getItem('qrgen_logo_fit');
    if (savedShape === 'rounded' || savedShape === 'circle') state.logoShape = savedShape;
    if (savedFit === 'contain' || savedFit === 'cover') state.logoFit = savedFit;
  } catch (e) { }
  syncShape();

  // Kelas boot: animasi masuk saja, lalu dilepas biar pindah tab tetap instan
  document.body.classList.add('boot');
  setTimeout(function () { document.body.classList.remove('boot'); }, 1500);
})();

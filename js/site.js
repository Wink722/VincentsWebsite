// Gemeinsames Verhalten: Sprache, Projektkarten, Einblenden, Zähler, Videos, Kipp-Effekt.
(function () {
  'use strict';
  var root = document.documentElement;
  var ruhig = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var basis = document.body.dataset.basis || '';
  var projekte = window.PROJEKTE || [];

  function sprache() { return root.dataset.lang === 'en' ? 'en' : 'de'; }
  function el(tag, klasse, html) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function beide(obj) {
    return '<span lang="de">' + obj.de + '</span><span lang="en">' + obj.en + '</span>';
  }

  /* ---------- Projektkarten auf der Startseite ---------- */
  var liste = document.getElementById('karten');
  if (liste) {
    projekte.forEach(function (p, i) {
      var a = el('a', 'karte rein');
      a.href = basis + 'projekte/' + p.slug + '/';
      a.style.setProperty('--akzent', p.farbe);
      a.style.setProperty('--d', (i % 2) * 0.12 + 's');
      var medien = el('div', 'karte-medien');
      medien.appendChild(el('span', 'karte-nr', String(i + 1).padStart(2, '0')));
      if (p.vorschau && p.vorschau.video) {
        var v = el('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
        v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.dataset.auto = '';
        v.poster = basis + 'projekte/' + p.slug + '/' + p.vorschau.poster;
        v.src = basis + 'projekte/' + p.slug + '/' + p.vorschau.video;
        v.setAttribute('aria-hidden', 'true');
        medien.appendChild(v);
      } else {
        var c = el('canvas', 'netz');
        c.dataset.netz = ''; c.dataset.zelle = '46'; c.dataset.ziele = '8';
        c.style.setProperty('--akzent', p.farbe);
        c.setAttribute('aria-hidden', 'true');
        medien.appendChild(c);
      }
      a.appendChild(medien);
      var text = el('div', 'karte-text');
      text.appendChild(el('h3', '', p.titel));
      text.appendChild(el('p', '', beide(p.slogan)));
      text.appendChild(el('div', 'chips', p.tags.map(function (t) { return '<span>' + t + '</span>'; }).join('')));
      var fuss = el('div', 'karte-fuss');
      fuss.appendChild(el('div', 'karte-zahl', '<b>' + beide(p.zahl.wert) + '</b>' + beide(p.zahl.text)));
      fuss.appendChild(el('span', 'karte-pfeil', '→'));
      text.appendChild(fuss);
      a.appendChild(text);
      liste.appendChild(a);
    });
  }

  /* ---------- "Nächstes Projekt" auf Projektseiten ---------- */
  var weiter = document.getElementById('weiter');
  var slug = document.body.dataset.slug;
  if (weiter && slug && projekte.length > 1) {
    var idx = projekte.findIndex(function (p) { return p.slug === slug; });
    var n = projekte[(idx + 1) % projekte.length];
    weiter.href = basis + 'projekte/' + n.slug + '/';
    weiter.style.setProperty('--akzent-n', n.farbe);
    weiter.innerHTML = '<div class="wrap"><span class="mono"><span lang="de">Nächstes Projekt</span><span lang="en">Next project</span></span>' +
      '<strong>' + n.titel + ' <i>→</i></strong><p class="unterzeile">' + beide(n.slogan) + '</p></div>';
  }

  /* ---------- Sprache ---------- */
  function zahlFormat(z) {
    var dez = +(z.dataset.dez || 0);
    return function (x) {
      return x.toLocaleString(sprache() === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: dez, maximumFractionDigits: dez });
    };
  }
  function setzeSprache(l) {
    root.dataset.lang = l; root.lang = l;
    try { localStorage.setItem('lang', l); } catch (e) {}
    var t = root.getAttribute('data-titel-' + l);
    if (t) document.title = t;
    document.querySelectorAll('[data-setlang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.setlang === l));
    });
    document.querySelectorAll('.zahl[data-fertig]').forEach(function (z) { z.textContent = zahlFormat(z)(+z.dataset.wert); });
  }
  document.querySelectorAll('[data-setlang]').forEach(function (b) {
    b.addEventListener('click', function () { setzeSprache(b.dataset.setlang); });
  });
  setzeSprache(sprache());

  /* ---------- Zähler ---------- */
  function zaehle(z) {
    var ziel = +z.dataset.wert, f = zahlFormat(z);
    if (ruhig) { z.textContent = f(ziel); z.dataset.fertig = '1'; return; }
    var start = performance.now(), dauer = 1400;
    (function schritt(t) {
      var k = Math.min(1, (t - start) / dauer), e = 1 - Math.pow(1 - k, 4);
      z.textContent = zahlFormat(z)(ziel * e);
      if (k < 1) requestAnimationFrame(schritt); else z.dataset.fertig = '1';
    })(start);
  }

  /* ---------- Einblenden, Zähler und Videos per IntersectionObserver ---------- */
  var kannIO = 'IntersectionObserver' in window;
  if (kannIO) {
    var sicht = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('da');
        e.target.querySelectorAll('.zahl:not([data-los])').forEach(function (z) { z.dataset.los = '1'; zaehle(z); });
        sicht.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.rein').forEach(function (r) { sicht.observe(r); });

    var filme = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting && !ruhig) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      });
    }, { threshold: 0.35 });
    document.querySelectorAll('video[data-auto]').forEach(function (v) {
      if (ruhig && !v.closest('.karte')) v.controls = true;
      filme.observe(v);
    });
  } else {
    document.querySelectorAll('.rein').forEach(function (r) { r.classList.add('da'); });
    document.querySelectorAll('.zahl').forEach(function (z) { z.textContent = zahlFormat(z)(+z.dataset.wert); z.dataset.fertig = '1'; });
    document.querySelectorAll('video[data-auto]').forEach(function (v) { v.controls = true; });
  }

  /* ---------- Scroll-Fortschritt ---------- */
  var balken = document.querySelector('.fortschritt');
  if (balken) {
    var wartet = false;
    var messen = function () {
      wartet = false;
      var h = root.scrollHeight - innerHeight;
      balken.style.setProperty('--scroll', h > 0 ? (scrollY / h).toFixed(4) : 0);
    };
    addEventListener('scroll', function () { if (!wartet) { wartet = true; requestAnimationFrame(messen); } }, { passive: true });
    messen();
  }

  /* ---------- Kipp-Effekt und Lichtfleck (nur mit Maus) ---------- */
  if (!ruhig && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.karte').forEach(function (k) {
      k.addEventListener('pointermove', function (e) {
        var r = k.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        k.style.setProperty('--ry', ((x - 0.5) * 7).toFixed(2) + 'deg');
        k.style.setProperty('--rx', ((0.5 - y) * 7).toFixed(2) + 'deg');
        k.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        k.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      });
      k.addEventListener('pointerleave', function () {
        k.style.setProperty('--rx', '0deg'); k.style.setProperty('--ry', '0deg');
      });
    });
    var hero = document.querySelector('.hero');
    if (hero) hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }

  /* ---------- Umbau mit Ameisen (lädt erst beim Klick, js/ameisen.js) ---------- */
  var los = document.getElementById('ameisen-los');
  if (los) {
    var umbau = null, laedt = false;
    var ui = {
      hinweis: document.getElementById('ameisen-hinweis'),
      stand: document.getElementById('ameisen-stand')
    };
    var zeige = function (an) { los.setAttribute('aria-pressed', String(an)); };
    los.addEventListener('click', function () {
      if (laedt) return;
      if (umbau && !umbau.beendet) {
        if (ui.hinweis.hidden) umbau.an(); else umbau.aus();
        zeige(!ui.hinweis.hidden);
        return;
      }
      laedt = true; los.setAttribute('aria-busy', 'true');
      import(new URL('js/ameisen.js', document.baseURI + basis).href).then(function (m) {
        return m.start(ui);
      }).then(function (g) {
        umbau = g; window.ameisen = g; zeige(true);
      }).catch(function (e) {
        console.warn('Ameisen:', e);
      }).then(function () { laedt = false; los.removeAttribute('aria-busy'); });
    });
    document.getElementById('ameisen-zurueck').addEventListener('click', function () {
      if (umbau && !umbau.beendet) umbau.um.reset();
    });
    document.getElementById('ameisen-ende').addEventListener('click', function () {
      if (umbau && !umbau.beendet) umbau.aus();
      zeige(false);
      los.focus();
    });
  }

  /* ---------- Straßennetz-Animationen ---------- */
  if (window.Netz) {
    document.querySelectorAll('canvas[data-netz]').forEach(function (c) {
      var api = window.Netz.mount(c, {
        zelle: +(c.dataset.zelle || 64),
        ziele: +(c.dataset.ziele || 10),
        interaktiv: c.hasAttribute('data-interaktiv')
      });
      if (c.id) document.querySelectorAll('[data-netz-neu="' + c.id + '"]').forEach(function (b) {
        b.addEventListener('click', function () { api.neu(); });
      });
    });
  }
})();

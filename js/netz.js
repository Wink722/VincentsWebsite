// Animiertes Straßennetz: zufälliges Netz, Ziele, kürzeste Wege (Dijkstra),
// Reihenfolge per Nearest Neighbour + 2-opt. Reine Illustration im Browser.
window.Netz = (function () {
  'use strict';

  function mount(canvas, opt) {
    opt = opt || {};
    var ctx = canvas.getContext('2d');
    var ruhig = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, dpr = 1;
    var knoten = [], nachbarn = [], kanten = [];
    var ziele = [], route = [], laenge = [], gesamt = 0, zielBei = [];
    var start = 0, sichtbar = false, laeuft = false, farben = {};

    function liesFarben() {
      var cs = getComputedStyle(canvas);
      farben.akzent = (cs.getPropertyValue('--akzent') || cs.getPropertyValue('--accent')).trim() || '#2f5bff';
      farben.linie = cs.getPropertyValue('--line').trim() || '#dcdad2';
      farben.fg = cs.getPropertyValue('--fg').trim() || '#0d0e12';
      farben.bg = cs.getPropertyValue('--surface').trim() || '#fff';
    }

    function baueNetz() {
      var zelle = opt.zelle || 64;
      var cols = Math.max(4, Math.round(W / zelle) + 1), rows = Math.max(3, Math.round(H / zelle) + 1);
      var dx = W / (cols - 1), dy = H / (rows - 1);
      knoten = []; nachbarn = []; kanten = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        knoten.push({
          x: c * dx + (Math.random() - 0.5) * dx * 0.5,
          y: r * dy + (Math.random() - 0.5) * dy * 0.5,
          rand: r === 0 || c === 0 || r === rows - 1 || c === cols - 1
        });
        nachbarn.push([]);
      }
      function verbinde(a, b) {
        var d = Math.hypot(knoten[a].x - knoten[b].x, knoten[a].y - knoten[b].y);
        nachbarn[a].push([b, d]); nachbarn[b].push([a, d]); kanten.push([a, b]);
      }
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
        var i = r * cols + c;
        if (c < cols - 1 && Math.random() < 0.8) verbinde(i, i + 1);
        if (r < rows - 1 && Math.random() < 0.8) verbinde(i, i + cols);
        if (c < cols - 1 && r < rows - 1 && Math.random() < 0.1) verbinde(i, i + cols + 1);
      }
    }

    function dijkstra(q) {
      var n = knoten.length, dist = new Float64Array(n).fill(Infinity), vor = new Int32Array(n).fill(-1);
      var offen = new Uint8Array(n).fill(1);
      dist[q] = 0;
      for (var k = 0; k < n; k++) {
        var u = -1, best = Infinity;
        for (var i = 0; i < n; i++) if (offen[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0) break;
        offen[u] = 0;
        var nb = nachbarn[u];
        for (var j = 0; j < nb.length; j++) {
          var v = nb[j][0], d = best + nb[j][1];
          if (d < dist[v]) { dist[v] = d; vor[v] = u; }
        }
      }
      return { dist: dist, vor: vor };
    }

    function plane(feste) {
      var K = opt.ziele || 10, innen = [];
      for (var i = 0; i < knoten.length; i++) if (!knoten[i].rand && nachbarn[i].length) innen.push(i);
      if (innen.length < 3) { ziele = []; route = []; gesamt = 0; return; }
      var ersterBaum = dijkstra(feste && feste.length ? feste[0] : innen[Math.floor(Math.random() * innen.length)]);
      var erreichbar = innen.filter(function (k) { return isFinite(ersterBaum.dist[k]); });
      ziele = (feste || []).filter(function (k) { return isFinite(ersterBaum.dist[k]); });
      var versuche = 0;
      while (ziele.length < Math.min(K, erreichbar.length) && versuche++ < 500) {
        var k = erreichbar[Math.floor(Math.random() * erreichbar.length)];
        if (ziele.indexOf(k) < 0) ziele.push(k);
      }
      var baeume = ziele.map(dijkstra), n = ziele.length;
      function D(a, b) { return baeume[a].dist[ziele[b]]; }

      // Reihenfolge: Nearest Neighbour, danach 2-opt für einen offenen Pfad
      var tour = [0], frei = [];
      for (i = 1; i < n; i++) frei.push(i);
      while (frei.length) {
        var letzter = tour[tour.length - 1], bi = 0;
        for (i = 1; i < frei.length; i++) if (D(letzter, frei[i]) < D(letzter, frei[bi])) bi = i;
        tour.push(frei.splice(bi, 1)[0]);
      }
      var besser = true, runden = 0;
      while (besser && runden++ < 40) {
        besser = false;
        for (var a = 1; a < n - 1; a++) for (var b = a + 1; b < n; b++) {
          var alt = D(tour[a - 1], tour[a]) + (b + 1 < n ? D(tour[b], tour[b + 1]) : 0);
          var neu = D(tour[a - 1], tour[b]) + (b + 1 < n ? D(tour[a], tour[b + 1]) : 0);
          if (neu < alt - 1e-6) {
            var teil = tour.slice(a, b + 1).reverse();
            for (var t = 0; t < teil.length; t++) tour[a + t] = teil[t];
            besser = true;
          }
        }
      }

      // Polylinie entlang der Straßen zusammensetzen
      route = [knoten[ziele[tour[0]]]]; laenge = [0]; gesamt = 0; zielBei = [0];
      for (i = 0; i < n - 1; i++) {
        var pfad = [], u = ziele[tour[i + 1]], baum = baeume[tour[i]];
        while (u !== -1 && u !== ziele[tour[i]]) { pfad.push(u); u = baum.vor[u]; }
        pfad.reverse();
        for (var p = 0; p < pfad.length; p++) {
          var q = knoten[pfad[p]], vorher = route[route.length - 1];
          gesamt += Math.hypot(q.x - vorher.x, q.y - vorher.y);
          route.push(q); laenge.push(gesamt);
        }
        zielBei.push(gesamt);
      }
      ziele = tour.map(function (t) { return ziele[t]; });
      start = performance.now();
    }

    function zeichne(jetzt) {
      var tempo = Math.max(260, gesamt / 7);           // Pixel pro Sekunde
      var zeit = (jetzt - start) / 1000;
      var weg = ruhig ? gesamt : Math.min(gesamt, zeit * tempo);
      var ende = gesamt / tempo, pause = 2.2;
      var blende = ruhig ? 1 : Math.max(0, Math.min(1, zeit / 0.5, (ende + pause - zeit) / 0.6));

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      ctx.strokeStyle = farben.linie; ctx.lineWidth = 1.2; ctx.beginPath();
      for (var i = 0; i < kanten.length; i++) {
        var a = knoten[kanten[i][0]], b = knoten[kanten[i][1]];
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      if (route.length > 1) {
        ctx.globalAlpha = blende;
        ctx.strokeStyle = farben.akzent; ctx.lineWidth = 3.4; ctx.beginPath();
        ctx.moveTo(route[0].x, route[0].y);
        var kopf = route[0];
        for (i = 1; i < route.length; i++) {
          if (laenge[i] <= weg) { ctx.lineTo(route[i].x, route[i].y); kopf = route[i]; }
          else {
            var f = (weg - laenge[i - 1]) / (laenge[i] - laenge[i - 1]);
            kopf = { x: route[i - 1].x + (route[i].x - route[i - 1].x) * f, y: route[i - 1].y + (route[i].y - route[i - 1].y) * f };
            ctx.lineTo(kopf.x, kopf.y); break;
          }
        }
        ctx.stroke();

        for (i = 0; i < ziele.length; i++) {
          var z = knoten[ziele[i]], besucht = zielBei[i] <= weg + 0.5;
          ctx.beginPath(); ctx.arc(z.x, z.y, besucht ? 6 : 5, 0, 6.2832);
          ctx.fillStyle = besucht ? farben.akzent : farben.bg; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = besucht ? farben.akzent : farben.fg; ctx.stroke();
        }
        if (!ruhig && weg < gesamt) {
          ctx.beginPath(); ctx.arc(kopf.x, kopf.y, 11, 0, 6.2832);
          ctx.globalAlpha = blende * 0.25; ctx.fillStyle = farben.akzent; ctx.fill();
          ctx.globalAlpha = blende;
          ctx.beginPath(); ctx.arc(kopf.x, kopf.y, 4.5, 0, 6.2832); ctx.fillStyle = farben.fg; ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      return !ruhig && zeit > ende + pause;
    }

    function schleife(jetzt) {
      if (!sichtbar) { laeuft = false; return; }
      if (zeichne(jetzt)) plane();
      requestAnimationFrame(schleife);
    }
    function los() {
      if (ruhig) { zeichne(performance.now()); return; }
      if (!laeuft && sichtbar) { laeuft = true; requestAnimationFrame(schleife); }
    }

    function groesse() {
      var r = canvas.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      if (Math.abs(r.width - W) < 2 && Math.abs(r.height - H) < 2) return;
      W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      liesFarben(); baueNetz(); plane(); los();
    }

    if ('ResizeObserver' in window) new ResizeObserver(groesse).observe(canvas);
    else addEventListener('resize', groesse);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { sichtbar = es[0].isIntersecting; los(); }).observe(canvas);
    } else sichtbar = true;
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { liesFarben(); los(); });
    groesse();

    if (opt.interaktiv) {
      canvas.addEventListener('click', function (e) {
        var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = Infinity;
        for (var i = 0; i < knoten.length; i++) {
          if (!nachbarn[i].length) continue;
          var d = Math.hypot(knoten[i].x - x, knoten[i].y - y);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) return;
        var feste = ziele.slice(), pos = feste.indexOf(best);
        if (pos >= 0) { if (feste.length > 3) feste.splice(pos, 1); } else feste.push(best);
        var alt = opt.ziele; opt.ziele = feste.length; plane(feste); opt.ziele = alt; los();
      });
    }

    return {
      neu: function () { baueNetz(); plane(); los(); }
    };
  }

  return { mount: mount };
})();

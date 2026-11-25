// Gimmick der Startseite: gelernte Ameisen aus Ant Movers tragen ein Abzeichen durch den Hero.
// Lädt erst beim Klick auf „Ameisen loslassen“ (js/site.js), nichts läuft von selbst. Physik,
// Policy, Renderer und Tragemodus sind dieselben Dateien wie auf der Projektseite
// (projekte/ant-movers/sim/, Kopie aus dem Projekt Ant Movers, siehe HERKUNFT.txt).
//
// Die Texte und Knöpfe des Hero sind Wände (bei Überschriften nur die Ausdehnung des Texts),
// das Abzeichen ist eine Scheibe, das Ziel ist die Stelle, die man anklickt. Eine Spielwiese
// außerhalb der Auswertung: Die gemessenen Zahlen von Ant Movers gelten für das T-Rätsel.

import { CarryMode, FREE_RING, loadPolicy } from "../projekte/ant-movers/sim/carrymode.js";

const SIM = new URL("../projekte/ant-movers/sim/", import.meta.url);

/** Maßstab und Ameisenzahl (Journal Ant Movers, M5 Teil 8). */
export const VORGABE = { bl: 10, durchmesser: 150, jePlatz: 16, faktor: 4, maxAnts: 800 };

let geladen = null; // Policy (Gewichte Seed 0), einmal je Seitenaufruf

const t2 = (de, en) => `<span lang="de">${de}</span><span lang="en">${en}</span>`;
const zahl = (x, d = 0) => ({
  de: x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }),
  en: x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
});

/** Freie Stelle für ein Abzeichen mit Radius r (Pixel, relativ zum Hero): größter Abstand zu allen Wänden. */
function freieStelle(hero, waende, r, rand) {
  const h = hero.getBoundingClientRect();
  const boxen = waende.map((b) => [b.left - h.left, b.top - h.top, b.right - h.left, b.bottom - h.top]);
  let best = null;
  for (let y = r + rand; y <= h.height - r - rand; y += 12) {
    for (let x = r + rand; x <= h.width - r - rand; x += 12) {
      let d = Math.min(x - r, h.width - x - r, y - r, h.height - y - r) * 1.5; // Rand zählt weniger
      for (const [x0, y0, x1, y1] of boxen) {
        d = Math.min(d, Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)) - r);
      }
      // bei gleichem Platz lieber rechts oben (dort ist der Hero leer)
      const wert = d + 0.02 * x - 0.02 * y;
      if (!best || wert > best.wert) best = { x, y, d, wert };
    }
  }
  return best;
}

/**
 * Startet das Gimmick im Hero. ui: { hinweis, stand, zurueck } (Elemente der Seite).
 * Rückgabe { cm, abzeichen, beenden, messen }.
 */
export async function start(hero, ui, opts = {}) {
  const o = { ...VORGABE, ...opts };
  geladen ??= loadPolicy(new URL("policies/m4a_s0.json", SIM).href);
  const { policy } = await geladen;

  const textWaende = ".hero .mono > span, .hero h1 b, .hero .lead > span, .hero .unter > span";
  const elWaende = ".hero .aktionen > *, #ameisen-hinweis";

  // Abzeichen an die freieste Stelle des Hero
  const abzeichen = document.createElement("div");
  abzeichen.className = "ameisen-abzeichen";
  abzeichen.dataset.carry = "";
  abzeichen.dataset.carryShape = "disc";
  abzeichen.setAttribute("aria-hidden", "true");
  abzeichen.innerHTML = "<span>Ant<br>Movers</span>";
  abzeichen.style.width = abzeichen.style.height = o.durchmesser + "px";
  ui.hinweis.hidden = false; // ist selbst eine Wand
  const waende = [];
  for (const e of hero.querySelectorAll(textWaende)) {
    if (e.offsetParent === null) continue;
    const r = document.createRange();
    r.selectNodeContents(e);
    waende.push(r.getBoundingClientRect());
  }
  for (const e of hero.querySelectorAll(elWaende)) if (e.offsetParent !== null) waende.push(e.getBoundingClientRect());
  const r = o.durchmesser / 2;
  const stelle = freieStelle(hero, waende, r, FREE_RING * o.bl);
  if (!stelle) { ui.hinweis.hidden = true; throw new Error("kein Platz im Hero"); }
  abzeichen.style.left = stelle.x - r + "px";
  abzeichen.style.top = stelle.y - r + "px";
  hero.appendChild(abzeichen);

  const cm = new CarryMode(hero, policy, {
    bl: o.bl, perSlot: o.jePlatz, maxAnts: o.maxAnts, minPerSlot: 2, factor: o.faktor, tMaxS: 300,
    carry: ".ameisen-abzeichen", walls: elWaende, textWalls: textWaende, canvasClass: "ameisen-leinwand",
    seed: (Date.now() >>> 0) ^ 0x5a17,
    onStatus: (s) => anzeigen(s),
  });

  function anzeigen(s) {
    hero.classList.toggle("ameisen-ziel", ["target", "run", "done"].includes(s.phase));
    let t = "";
    if (s.nAnts) {
      const n = zahl(s.nAnts);
      t += t2(`${n.de} Ameisen`, `${n.en} ants`);
    }
    const f = s.actual !== undefined && s.actual < 0.9 * s.factor ? zahl(s.actual, 1) : zahl(s.factor);
    t += " · " + t2(`Zeitfaktor ${f.de}×`, `time factor ${f.en}×`);
    if (s.t !== undefined) {
      const at = zahl(Math.round(s.t));
      t += " · " + t2(`Ameisenzeit ${at.de} s`, `ant time ${at.en} s`);
    }
    if (s.phase === "target") t += "<br>" + t2("Klick auf eine freie Stelle: Dorthin tragen sie das Abzeichen.",
      "Click a free spot: that is where they carry the badge.");
    else if (s.outcome?.kind === "nest") {
      const z = zahl(Math.round(s.outcome.t));
      t += "<br>" + t2(`Am Ziel nach ${z.de} s Ameisenzeit. Neue Stelle anklicken.`,
        `At the goal after ${z.en} s of ant time. Click a new spot.`);
    } else if (s.outcome) t += "<br>" + t2("Zeit abgelaufen. Neue Stelle anklicken oder zurücksetzen.",
      "Time is up. Click a new spot or reset.");
    else if (s.phase === "run") t += "<br>" + t2("Ein neuer Klick versetzt das Ziel.", "Another click moves the goal.");
    if (s.msg && !s.msg.startsWith("nicht")) t += "<br>" + t2("Zu nah an Text oder Rand.", "Too close to text or the edge.");
    ui.stand.innerHTML = t;
  }

  const a = cm.select(abzeichen);
  if (!a.ok) { cm.destroy(); abzeichen.remove(); ui.hinweis.hidden = true; throw new Error(a.why); }

  // Pause, solange der Hero nicht zu sehen ist (verdeckter Tab: requestAnimationFrame ruht ohnehin)
  const sicht = new IntersectionObserver(([e]) => cm.setPaused(!e.isIntersecting), { threshold: 0 });
  sicht.observe(hero);
  const beiGroesse = () => beenden();
  addEventListener("resize", beiGroesse);

  function beenden() {
    sicht.disconnect();
    removeEventListener("resize", beiGroesse);
    cm.destroy();
    abzeichen.remove();
    hero.classList.remove("ameisen-ziel");
    ui.hinweis.hidden = true;
    ui.stand.innerHTML = "";
  }

  /** Rechenzeit und Bildrate über ms Millisekunden (für das Journal, aus der Konsole). */
  function messen(ms = 10000) {
    return new Promise((fertig) => {
      const bilder = [], rechnen = [], zeichnen = [];
      const draw = cm._draw;
      cm._draw = function (alpha) {
        const c = performance.now();
        draw.call(cm, alpha);
        zeichnen.push(performance.now() - c);
      };
      const t0 = performance.now();
      let last = t0;
      const f = (now) => {
        bilder.push(now - last);
        last = now;
        if (cm.cpuMs !== undefined) rechnen.push(cm.cpuMs);
        if (now - t0 < ms) requestAnimationFrame(f);
        else {
          cm._draw = draw;
          const mittel = (xs) => xs.reduce((p, x) => p + x, 0) / Math.max(1, xs.length);
          const sortiert = [...bilder].sort((p, q) => p - q);
          fertig({ n: cm.sim?.n, bilder: bilder.length, fps: 1000 * bilder.length / (now - t0),
            bildMs: mittel(bilder), bildMs95: sortiert[Math.floor(0.95 * sortiert.length)],
            rechnenMs: mittel(rechnen), zeichnenMs: mittel(zeichnen), faktor: cm.status().actual });
        }
      };
      requestAnimationFrame(f);
    });
  }

  return { cm, abzeichen, beenden, messen };
}

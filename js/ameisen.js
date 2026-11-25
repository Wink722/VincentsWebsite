// Umbau mit Ameisen: gelernte Ameisen aus Ant Movers tragen Teile der Startseite an eine andere
// Stelle. Lädt erst beim Klick auf „Umbau mit Ameisen“ (js/site.js), nichts läuft von selbst.
// Physik, Policy, Renderer und Ablauf sind dieselben Dateien wie auf der Projektseite
// (projekte/ant-movers/sim/, Kopie aus dem Projekt Ant Movers, siehe HERKUNFT.txt).
//
// Gelernt ist das Tragen. Der Anmarsch vom Rand ist ebenfalls die gelernte Policy, nur das Ziel
// liegt dabei vorübergehend auf dem Element; Einrasten und Abzug sind Animation. Eine Spielwiese
// außerhalb der Auswertung: Die gemessenen Zahlen von Ant Movers gelten für das T-Rätsel.

import { Umbau, loadPolicy } from "../projekte/ant-movers/sim/umbau.js";

const SIM = new URL("../projekte/ant-movers/sim/", import.meta.url);

/** Maßstab und Ameisenzahl (Journal Ant Movers, Nachtrag M5). */
export const VORGABE = { bl: 10, perSlot: 16, maxAnts: 800, factor: 4 };

/** Wählbare Blöcke der Startseite (text: Ausdehnung des Texts statt der Box). */
const KANDIDATEN = [
  { sel: ".hero h1", text: true }, { sel: ".hero p.mono", text: true }, { sel: ".hero .lead", text: true },
  { sel: ".hero .unter", text: true }, { sel: ".hero .aktionen > .knopf" },
  { sel: ".abschnitt-kopf h2", text: true }, { sel: ".abschnitt-kopf p.mono", text: true },
  { sel: ".karte" }, { sel: ".profil p.gross", text: true }, { sel: ".fakt" }, { sel: ".fuss .wrap > *", text: true },
];
const WAENDE = ["#ameisen-los", ".laufband", "#ameisen-hinweis"];

let geladen = null; // Policy (Gewichte Seed 0), einmal je Seitenaufruf

const t2 = (de, en) => `<span lang="de">${de}</span><span lang="en">${en}</span>`;
const zahl = (x, d = 0) => ({
  de: x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }),
  en: x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
});

const GRUND = {
  aspect: ["Zu schmal für die Ameisen (länger als 6 : 1).", "Too narrow for the ants (longer than 6 : 1)."],
  size: ["Zu groß für die Ameisen.", "Too large for the ants."],
  outside: ["Nicht ganz zu sehen: erst so scrollen, dass es ganz im Bild ist.", "Not fully visible: scroll until all of it is on screen."],
  noroom: ["Dafür gibt es in diesem Ausschnitt keinen Platz mit freiem, geradem Weg.", "In this view there is no spot it could be carried to in a free straight line."],
  target: ["Dort geht es nicht: Das Ziel braucht Platz, einen geraden freien Weg und mindestens 100 Pixel Abstand.",
    "Not there: the goal needs room, a free straight path and at least 100 pixels of distance."],
  busy: ["Erst wenn die Ameisen dieses Element abgesetzt haben.", "Wait until the ants have set this element down."],
};

/**
 * Startet den Umbau. ui: { hinweis, stand, zurueck, beenden } (Elemente der Seite).
 * Rückgabe { um, an, aus, beenden, messen }.
 */
export async function start(ui, opts = {}) {
  const o = { ...VORGABE, ...opts };
  geladen ??= loadPolicy(new URL("policies/m4a_s0.json", SIM).href);
  const { policy } = await geladen;
  ui.hinweis.hidden = false; // ist selbst eine Wand

  const um = new Umbau(policy, {
    bl: o.bl, perSlot: o.perSlot, maxAnts: o.maxAnts, factor: o.factor,
    candidates: KANDIDATEN, walls: WAENDE, ignore: "#ameisen-hinweis, .kopf, #ameisen-los", header: ".kopf",
    canvasClass: "ameisen-leinwand", seed: (Date.now() >>> 0) ^ 0x5a17,
    onStatus: (s) => anzeigen(s),
  });

  function anzeigen(s) {
    document.documentElement.classList.toggle("umbau-ziel", s.selected || s.phase === "anmarsch" || s.phase === "tragen");
    let t = "";
    if (s.nAnts) t += t2(`${zahl(s.nAnts).de} Ameisen`, `${zahl(s.nAnts).en} ants`) + " · ";
    const f = s.actual !== undefined && s.actual < 0.9 * s.factor ? zahl(s.actual, 1) : zahl(s.factor);
    t += t2(`Zeitfaktor ${f.de}×`, `time factor ${f.en}×`);
    if (s.t !== undefined) t += " · " + t2(`Ameisenzeit ${zahl(Math.round(s.t)).de} s`, `ant time ${zahl(Math.round(s.t)).en} s`);
    t += "<br>";
    const grund = s.msg ? GRUND[s.msg.replace("no:", "")] : null;
    if (grund) {
      t += t2(grund[0], grund[1]);
    } else if (s.phase === "anmarsch") {
      t += t2(`Anmarsch vom Rand. Es greifen ${zahl(s.grip).de} an ${zahl(s.slots).de} Plätzen.`,
        `Coming in from the edge. ${zahl(s.grip).en} ants grip at ${zahl(s.slots).en} places.`);
    } else if (s.phase === "tragen") {
      t += t2("Sie tragen. Ein Klick auf eine freie Stelle versetzt das Ziel.", "Carrying. Click a free spot to move the goal.");
    } else if ((s.phase === "einrasten" || s.phase === "abzug") && s.outcome?.kind === "nest") {
      const z = zahl(Math.round(s.outcome.t));
      t += t2(`Angekommen nach ${z.de} s Ameisenzeit. Einrasten und Abzug sind Animation.`,
        `Arrived after ${z.en} s of ant time. Snapping into place and leaving are animation.`);
    } else if (s.phase === "abzug" && s.outcome?.kind === "timeout") {
      t += t2("Zeit abgelaufen, das Element bleibt, wo es ist.", "Time is up; the element stays where it is.");
    } else if (s.phase === "idle" && !s.selected && s.outcome?.kind === "nest") {
      const z = zahl(Math.round(s.outcome.t));
      t += t2(`Abgesetzt nach ${z.de} s Ameisenzeit. Nächstes umrandetes Element anklicken.`,
        `Set down after ${z.en} s of ant time. Click the next outlined element.`);
    } else if (s.selected) {
      t += t2("Jetzt eine freie Stelle anklicken: Dorthin tragen sie es. Esc hebt die Wahl auf.",
        "Now click a free spot: that is where they carry it. Esc cancels.");
    } else {
      t += t2("Ein umrandetes Element anklicken, dann eine freie Stelle.", "Click an outlined element, then a free spot.");
    }
    ui.stand.innerHTML = t;
  }

  const beiSprache = () => setTimeout(() => um.relayout(), 0);
  const sprachKnoepfe = [...document.querySelectorAll("[data-setlang]")];
  for (const b of sprachKnoepfe) b.addEventListener("click", beiSprache);
  const breite = innerWidth;
  const beiGroesse = () => { if (innerWidth !== breite) beenden(); };
  addEventListener("resize", beiGroesse);

  /** Umbaumodus an (Kasten zeigen). */
  function an() {
    ui.hinweis.hidden = false;
    um.start();
  }

  /** Umbaumodus aus: verschobene Elemente bleiben und sind normal klickbar. */
  function aus() {
    um.stop();
    ui.hinweis.hidden = true;
    document.documentElement.classList.remove("umbau-ziel");
  }

  /** Alles weg: zurücksetzen und abbauen (etwa wenn sich die Fensterbreite ändert). */
  function beenden() {
    for (const b of sprachKnoepfe) b.removeEventListener("click", beiSprache);
    removeEventListener("resize", beiGroesse);
    um.destroy();
    ui.hinweis.hidden = true;
    ui.stand.innerHTML = "";
    document.documentElement.classList.remove("umbau-ziel");
    g.beendet = true;
  }

  /** Rechenzeit und Bildrate über ms Millisekunden (für das Journal, aus der Konsole). */
  function messen(ms = 8000) {
    return new Promise((fertig) => {
      const bilder = [], rechnen = [], phasen = new Set();
      const t0 = performance.now();
      let last = t0;
      const f = (now) => {
        bilder.push(now - last);
        last = now;
        if (um.tr) { rechnen.push(um.cpuMs ?? 0); phasen.add(um.tr.phase); }
        if (now - t0 < ms) requestAnimationFrame(f);
        else {
          const mittel = (xs) => xs.reduce((p, x) => p + x, 0) / Math.max(1, xs.length);
          const sortiert = [...bilder].sort((p, q) => p - q);
          fertig({ n: um.tr?.n, phasen: [...phasen], bilder: bilder.length, fps: (1000 * bilder.length) / (now - t0),
            bildMs: mittel(bilder), bildMs95: sortiert[Math.floor(0.95 * sortiert.length)], bildMax: sortiert[sortiert.length - 1],
            rechnenMs: mittel(rechnen), rechnenMax: Math.max(0, ...rechnen), faktor: um.status().actual });
        }
      };
      requestAnimationFrame(f);
    });
  }

  const g = { um, an, aus, beenden, messen, beendet: false };
  an();
  return g;
}

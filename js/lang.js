// Läuft früh im <head>: setzt die Sprache, bevor die Seite gezeichnet wird.
(function () {
  var root = document.documentElement, l = null;
  try { l = localStorage.getItem('lang'); } catch (e) {}
  if (l !== 'de' && l !== 'en') {
    l = (navigator.language || 'de').toLowerCase().indexOf('de') === 0 ? 'de' : 'en';
  }
  root.dataset.lang = l;
  root.lang = l;
  root.classList.add('js');
})();

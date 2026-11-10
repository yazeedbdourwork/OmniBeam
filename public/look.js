// Runs before the page is drawn (a plain <script> in <head>): puts the saved Theme (Light/Dark) and Style (Liquid
// Glass) on <html>, so the page doesn't flash in the default look first. app.js does the same again and handles changes.
(function () {
  try {
    var d = document.documentElement, theme = localStorage.getItem('omnibeam-theme'), look = localStorage.getItem('omnibeam-look');
    if (theme === 'light' || theme === 'dark') d.dataset.theme = theme;
    if (look === 'glass') d.dataset.look = look;
  } catch (e) {}
})();

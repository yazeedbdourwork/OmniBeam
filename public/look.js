// Runs before the page is drawn (a plain <script> in <head>): puts the saved Theme (Light/Dark) and Style (Liquid
// Glass) on <html>, so the page doesn't flash in the default look first. app.js does the same again and handles changes.
// Also Text size (data-text: large, xl) and Contrast (data-contrast: more; Automatic follows the device's own
// "increase contrast" setting).
// With App lock on, it also hides the page (data-locked) until app.js shows the lock screen and the PIN is typed.
(function () {
  try {
    var d = document.documentElement, theme = localStorage.getItem('omnibeam-theme'), look = localStorage.getItem('omnibeam-look');
    if (theme === 'light' || theme === 'dark') d.dataset.theme = theme;
    if (look === 'glass') d.dataset.look = look;
    var text = localStorage.getItem('omnibeam-text'), contrast = localStorage.getItem('omnibeam-contrast');
    if (text === 'large' || text === 'xl') d.dataset.text = text;
    if (contrast === 'more' || (!contrast && window.matchMedia && matchMedia('(prefers-contrast: more)').matches)) d.dataset.contrast = 'more';
    if (localStorage.getItem('omnibeam-lock')) d.dataset.locked = '1';
  } catch (e) {}
})();

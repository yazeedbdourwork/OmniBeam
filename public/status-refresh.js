// The status page (/status) gets fresh numbers when you come back to it: once it has been out of sight (another tab,
// the phone locked) for 2 minutes or more. It never reloads while you are reading it, which screen readers and
// people who read slowly need (WCAG 2.2.1); it used to reload itself every 2 minutes.
(function () {
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= 120000) location.reload();
  });
})();

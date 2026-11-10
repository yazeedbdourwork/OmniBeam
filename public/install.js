// OmniBeam: "Install OmniBeam" bar at the bottom of the page, so phones (and Chrome/Edge on computers) can add
// OmniBeam like an app. Chrome, Edge and Android hand us an install prompt (beforeinstallprompt); iPhone Safari
// has none, so there the bar explains Share → Add to Home Screen. It appears on a second visit or right after a
// send, never in the installed app, and "not now" hides it for 30 days.
'use strict';
(function () {
  const bar = $('#install-bar');
  const KEY = 'omnibeam-install';
  const SNOOZE = 30 * 24 * 3600 * 1000;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!bar || standalone) return;
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  state.visits = (state.visits || 0) + 1;
  save();
  const snoozed = () => state.installed || (state.dismissed && Date.now() - state.dismissed < SNOOZE);
  // Safari on iPhone/iPad (other iOS browsers have their own menus, and in-app browsers can't add to the home screen)
  const iosSafari = typeof isIOS !== 'undefined' && isIOS && /Safari\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(navigator.userAgent);
  let deferred = null;

  function show() {
    if (snoozed() || !bar.hidden || (!deferred && !iosSafari)) return;
    if (iosSafari) {
      $('#install-hint').textContent = t('In Safari, tap Share, then Add to Home Screen.');
      $('#install-yes').hidden = true;
    }
    bar.hidden = false;
    requestAnimationFrame(() => bar.classList.add('show'));
  }
  function hide() {
    bar.classList.remove('show');
    setTimeout(() => { bar.hidden = true; }, 250);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (state.visits >= 2) setTimeout(show, 4000);
  });
  window.addEventListener('appinstalled', () => {
    state.installed = true;
    save();
    hide();
  });
  // Right after a successful send is a good moment: the visitor just saw it work
  window.addEventListener('omnibeam-sent', () => setTimeout(show, 2500));
  // "Install OmniBeam" in the card under received files: show the bar now, even if it was snoozed
  window.addEventListener('omnibeam-install', () => {
    state.dismissed = 0;
    if (!deferred && !iosSafari) return toast(t('Tap Install at the bottom (Android, Chrome, Edge), or on iPhone tap Share and then Add to Home Screen.'));
    show();
  });
  if (iosSafari && state.visits >= 2) setTimeout(show, 4000);

  $('#install-yes').onclick = async () => {
    if (!deferred) return hide();
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (choice && choice.outcome === 'accepted') { state.installed = true; save(); }
    else { state.dismissed = Date.now(); save(); }
    hide();
  };
  $('#install-no').onclick = () => {
    state.dismissed = Date.now();
    save();
    hide();
  };
})();

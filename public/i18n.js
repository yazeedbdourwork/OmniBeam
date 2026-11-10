// OmniBeam translations.
// English is written directly in index.html and app.js. Each other language has its own file in lang/
// (lang/ar.js, lang/fr.js…) that maps that English text to its own. Pages like /fr/ are sent by the server
// already translated, with that language's file loaded before this one for the text the app adds later.
// To add a language: copy a file in lang/, translate it, and add its code and name to LANGUAGES below.
// Text in {braces} is filled in by the app (a name, a number, a code) and must be kept as is.
(function () {
  const LANGUAGES = { en: 'English', ar: 'العربية', fr: 'Français', es: 'Español', tr: 'Türkçe', de: 'Deutsch', pt: 'Português', hi: 'हिन्दी', id: 'Bahasa Indonesia',
    ru: 'Русский', ja: '日本語', zh: '简体中文', ko: '한국어', it: 'Italiano', ur: 'اردو' };

  // The server reads the same translations to send pages like /ar/ already translated
  if (typeof module === 'object' && module.exports) {
    module.exports = Object.fromEntries(Object.keys(LANGUAGES).map((code) => [code,
      code === 'en' ? { code, name: LANGUAGES.en, dir: 'ltr', strings: {} } : require(`./lang/${code}.js`)]));
    return;
  }

  const KEY = 'omnibeam-lang';
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const browserLang = (navigator.languages || [navigator.language || 'en'])
    .map((l) => String(l).slice(0, 2).toLowerCase())
    .find((l) => LANGUAGES[l]);
  // A language in the address (/ar/) always wins; then the visitor's own choice, then the browser's language.
  // The home page in another language has its own address, so go there (search engines stay on the English one).
  const pathLang = Object.keys(LANGUAGES).find((l) => l !== 'en' && location.pathname.startsWith(`/${l}/`));
  const urlFor = (l) => (l === 'en' ? '/' : `/${l}/`) + location.search + location.hash;
  const wanted = LANGUAGES[saved] ? saved : browserLang || 'en';
  if (!pathLang && wanted !== 'en' && location.pathname === '/' && !/bot|crawl|spider|slurp|lighthouse|inspectiontool/i.test(navigator.userAgent)) {
    location.replace(urlFor(wanted));
    return;
  }
  const loaded = window.OB_LANGS || {};
  const lang = pathLang || (loaded[wanted] ? wanted : 'en');
  const pack = (lang !== 'en' && loaded[lang]) || { strings: {}, dir: lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr' };
  const strings = pack.strings;
  const dir = pack.dir;

  // Translate the page's built-in text: text nodes and a few attributes whose English text has a translation
  function apply(root) {
    if (lang === 'en') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (n.parentElement.closest('script, style, code')) continue;
      const key = norm(n.textContent);
      const tr = key && strings[key];
      if (tr) n.textContent = n.textContent.replace(/^(\s*)[\s\S]*?(\s*)$/, (m, a, b) => a + tr + b);
    }
    for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
      for (const attr of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v && strings[norm(v)]) el.setAttribute(attr, strings[norm(v)]);
      }
    }
  }

  window.I18N = {
    lang,
    languages: LANGUAGES,
    lookup: (text) => strings[text],
    apply,
    set(next) {
      try { localStorage.setItem(KEY, next); } catch {}
      if (location.pathname === '/' || location.pathname.startsWith(`/${lang}/`)) location.href = urlFor(next);
      else location.reload();
    },
  };

  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  apply(document.body);
  if (strings[norm(document.title)]) document.title = strings[norm(document.title)];
})();

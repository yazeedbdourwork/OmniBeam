// OmniBeam translations.
// English is written directly in index.html and app.js. Each other language has its own file in lang/
// (lang/ar.js, lang/fr.js…) that maps that English text to its own. Pages like /fr/ are sent by the server
// already translated, with that language's file loaded before this one for the text the app adds later.
// To add a language: copy a file in lang/, translate it, and add its code and name to LANGUAGES below.
// Text in {braces} is filled in by the app (a name, a number, a code) and must be kept as is.
(function () {
  const LANGUAGES = { en: 'English', ar: 'العربية', fr: 'Français', es: 'Español', tr: 'Türkçe', de: 'Deutsch', pt: 'Português', hi: 'हिन्दी', id: 'Bahasa Indonesia',
    ru: 'Русский', ja: '日本語', zh: '简体中文', ko: '한국어', it: 'Italiano', ur: 'اردو',
    fa: 'فارسی', bn: 'বাংলা', vi: 'Tiếng Việt', th: 'ไทย', pl: 'Polski' };

  // The server reads the same translations to send pages like /ar/ already translated
  if (typeof module === 'object' && module.exports) {
    module.exports = Object.fromEntries(Object.keys(LANGUAGES).map((code) => [code,
      code === 'en' ? { code, name: LANGUAGES.en, dir: 'ltr', strings: {} } : require(`./lang/${code}.js`)]));
    return;
  }

  const KEY = 'omnibeam-lang';
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const browserLang = (navigator.languages || [navigator.language || 'en'])
    .map((l) => String(l).slice(0, 2).toLowerCase())
    .find((l) => LANGUAGES[l]);

  // The visitor's country (from Cloudflare's /cdn-cgi/trace, which answers on every Cloudflare site and is never
  // cached), saved on the device as {cc, t}. A first visit with no language of its own gets the country's language,
  // and the footer shows the country's flag beside the language menu.
  const COUNTRY_KEY = 'omnibeam-country';
  const COUNTRY_LANG = {};
  for (const [l, list] of Object.entries({
    ar: 'SA AE EG JO IQ KW QA BH OM YE SY LB PS LY TN DZ MA SD MR SO DJ KM',
    fr: 'FR MC BE LU SN CI ML BF NE TG BJ GN CM CD CG GA MG HT TD CF BI',
    es: 'ES MX AR CO PE VE CL EC GT CU BO DO HN PY SV NI CR PA UY PR GQ',
    tr: 'TR', de: 'DE AT CH LI', pt: 'PT BR AO MZ CV GW ST TL', id: 'ID', ru: 'RU BY KZ KG',
    ja: 'JP', zh: 'CN TW HK MO', ko: 'KR', it: 'IT SM VA', ur: 'PK', fa: 'IR AF', bn: 'BD', vi: 'VN', th: 'TH', pl: 'PL',
  })) for (const cc of list.split(' ')) COUNTRY_LANG[cc] = l;
  const isBot = /bot|crawl|spider|slurp|lighthouse|inspectiontool/i.test(navigator.userAgent);
  // Search engines and test tools are never sent somewhere by where they run from
  const geoOn = !isBot && !navigator.webdriver;
  let geo = null;
  try { geo = JSON.parse(localStorage.getItem(COUNTRY_KEY)); } catch {}
  if (!geo || !/^[A-Z]{2}$/.test(geo.cc)) geo = null;
  // The visitor's own choice wins, then a browser set to a language other than English (someone abroad who reads
  // French), then the country's language, then the browser's (English), then English.
  const pick = (cc) => {
    let own = null;
    try { own = localStorage.getItem(KEY); } catch {}
    if (LANGUAGES[own]) return own;
    if (browserLang && browserLang !== 'en') return browserLang;
    return (geoOn && COUNTRY_LANG[cc]) || browserLang || 'en';
  };

  // A language in the address (/ar/) always wins; then the pick above.
  // The home page in another language has its own address, so go there (search engines stay on the English one).
  const pathLang = Object.keys(LANGUAGES).find((l) => l !== 'en' && location.pathname.startsWith(`/${l}/`));
  const urlFor = (l) => (l === 'en' ? '/' : `/${l}/`) + location.search + location.hash;
  const wanted = pick(geo && geo.cc);
  if (!pathLang && wanted !== 'en' && location.pathname === '/' && !isBot) {
    location.replace(urlFor(wanted));
    return;
  }
  const loaded = window.OB_LANGS || {};
  const lang = pathLang || (loaded[wanted] ? wanted : 'en');
  const pack = (lang !== 'en' && loaded[lang]) || { strings: {}, dir: ['ar', 'ur', 'fa'].includes(lang) ? 'rtl' : 'ltr' };
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

  // The country's flag beside the language menu, named in the page's language ("Jordan")
  function showFlag(cc) {
    const sel = document.getElementById('btn-lang');
    if (!sel || !/^[A-Z]{2}$/.test(cc)) return;
    let name = cc;
    try { name = new Intl.DisplayNames([lang], { type: 'region' }).of(cc) || cc; } catch {}
    let box = document.getElementById('lang-flag');
    if (!box) {
      box = document.createElement('label');
      box.id = 'lang-flag';
      box.className = 'lang-flag';
      box.htmlFor = 'btn-lang';
      box.appendChild(document.createElement('img'));
      sel.parentNode.insertBefore(box, sel);
    }
    const img = box.firstChild;
    img.alt = name;
    img.width = 20;
    img.height = 15;
    img.onerror = () => box.remove();
    img.src = `/flags/${cc.toLowerCase()}.svg`;
    box.title = name;
  }
  if (geo) showFlag(geo.cc);
  // Asked again once a day (someone who travels gets the new flag); a first visit waits for it to pick the language
  if (geoOn && (!geo || !(Date.now() - geo.t < 86400000)) && window.fetch) {
    const ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(() => ctl.abort(), 2500);
    fetch('/cdn-cgi/trace', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        const m = /^loc=([A-Z]{2})$/m.exec(text);
        if (!m || m[1] === 'XX' || m[1] === 'T1') return;
        const cc = m[1];
        try { localStorage.setItem(COUNTRY_KEY, JSON.stringify({ cc, t: Date.now() })); } catch {}
        // Only the very first visit changes language, so the page never switches under someone using it
        if (!geo && !pathLang && location.pathname === '/') {
          const next = pick(cc);
          if (next !== lang) { location.replace(urlFor(next)); return; }
        }
        showFlag(cc);
      })
      .catch(() => {});
  }
})();

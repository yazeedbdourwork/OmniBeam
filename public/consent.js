// OmniBeam visitor statistics: the cookie banner for Google Analytics.
// When GA_ID is set in server.js, the server puts Google's tag at the top of every page in "consent mode" (no
// cookies yet) and adds this file with the ID in data-ga. "Allow" lets Google Analytics use cookies; "No thanks"
// stops it sending anything. The choice is kept in this browser.
// Visiting any page with ?analytics=off turns statistics off for good on that browser (for the site owner's own devices).
(function () {
  const script = document.currentScript;
  const id = script && script.dataset.ga;
  if (!id) return;
  const KEY = 'omnibeam-analytics';
  const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  if (/[?&]analytics=off\b/.test(location.search)) set('off');

  const TEXT = {
    en: ['OmniBeam counts visits with Google Analytics to see how the site is used. Your files and messages are never included.', 'Allow', 'No thanks', 'Privacy', 'Cookie settings'],
    ar: ['يحصي OmniBeam الزيارات باستخدام Google Analytics لمعرفة كيفية استخدام الموقع. لا تُضمَّن ملفاتك ورسائلك أبدًا.', 'سماح', 'لا، شكرًا', 'الخصوصية', 'إعدادات ملفات تعريف الارتباط'],
    fr: ['OmniBeam compte les visites avec Google Analytics pour voir comment le site est utilisé. Vos fichiers et messages n\'en font jamais partie.', 'Autoriser', 'Non merci', 'Confidentialité', 'Paramètres des cookies'],
    es: ['OmniBeam cuenta las visitas con Google Analytics para ver cómo se usa el sitio. Tus archivos y mensajes nunca se incluyen.', 'Permitir', 'No, gracias', 'Privacidad', 'Configuración de cookies'],
    tr: ['OmniBeam, sitenin nasıl kullanıldığını görmek için ziyaretleri Google Analytics ile sayar. Dosyalarınız ve mesajlarınız asla dahil edilmez.', 'İzin ver', 'Hayır, teşekkürler', 'Gizlilik', 'Çerez ayarları'],
    de: ['OmniBeam zählt Besuche mit Google Analytics, um zu sehen, wie die Website genutzt wird. Deine Dateien und Nachrichten sind nie dabei.', 'Erlauben', 'Nein, danke', 'Datenschutz', 'Cookie-Einstellungen'],
    pt: ['O OmniBeam conta as visitas com o Google Analytics para ver como o site é usado. Seus arquivos e mensagens nunca são incluídos.', 'Permitir', 'Não, obrigado', 'Privacidade', 'Configurações de cookies'],
    hi: ['साइट कैसे इस्तेमाल होती है, यह देखने के लिए OmniBeam Google Analytics से विज़िट गिनता है। आपकी फ़ाइलें और संदेश कभी शामिल नहीं होते।', 'अनुमति दें', 'नहीं, धन्यवाद', 'गोपनीयता', 'कुकी सेटिंग'],
    id: ['OmniBeam menghitung kunjungan dengan Google Analytics untuk melihat cara situs dipakai. File dan pesan Anda tidak pernah disertakan.', 'Izinkan', 'Tidak, terima kasih', 'Privasi', 'Pengaturan cookie'],
    ru: ["OmniBeam считает посещения с помощью Google Analytics, чтобы понять, как используется сайт. Ваши файлы и сообщения туда никогда не попадают.", "Разрешить", "Нет, спасибо", "Конфиденциальность", "Настройки cookie"],
    ja: ["OmniBeamは、サイトの使われ方を知るためにGoogle Analyticsで訪問数を数えます。ファイルやメッセージが含まれることはありません。", "許可", "許可しない", "プライバシー", "Cookieの設定"],
    zh: ["OmniBeam 使用 Google Analytics 统计访问量，以了解网站的使用情况。你的文件和消息永远不会包含在内。", "允许", "不用了，谢谢", "隐私", "Cookie 设置"],
    ko: ["OmniBeam은 사이트 이용 방식을 파악하기 위해 Google Analytics로 방문 수를 셉니다. 파일과 메시지는 절대 포함되지 않습니다.", "허용", "괜찮습니다", "개인정보", "쿠키 설정"],
    it: ["OmniBeam conta le visite con Google Analytics per capire come viene usato il sito. I tuoi file e messaggi non vengono mai inclusi.", "Consenti", "No, grazie", "Privacy", "Impostazioni dei cookie"],
    ur: ["OmniBeam سائٹ کے استعمال کو سمجھنے کے لیے Google Analytics سے وزٹ گنتا ہے۔ آپ کی فائلیں اور پیغامات کبھی شامل نہیں ہوتے۔", "اجازت دیں", "نہیں، شکریہ", "رازداری", "کوکی سیٹنگز"],
  };
  // Added to the message when the Meta Pixel is on (FB_PIXEL_ID in server.js)
  const PIXEL_TEXT = {
    en: 'If you allow it, the Meta Pixel also measures visits that come from our ads on Facebook and Instagram.',
    ar: 'إذا سمحت بذلك، يقيس Meta Pixel أيضًا الزيارات القادمة من إعلاناتنا على فيسبوك وإنستغرام.',
    fr: 'Si vous l\'autorisez, le pixel Meta mesure aussi les visites venant de nos publicités sur Facebook et Instagram.',
    es: 'Si lo permites, el píxel de Meta también mide las visitas que llegan desde nuestros anuncios en Facebook e Instagram.',
    tr: 'İzin verirseniz Meta Pixel, Facebook ve Instagram\'daki reklamlarımızdan gelen ziyaretleri de ölçer.',
    de: 'Wenn du es erlaubst, misst das Meta-Pixel auch Besuche, die über unsere Anzeigen auf Facebook und Instagram kommen.',
    pt: 'Se você permitir, o Pixel da Meta também mede as visitas que chegam pelos nossos anúncios no Facebook e no Instagram.',
    hi: 'अगर आप अनुमति देते हैं, तो Meta Pixel Facebook और Instagram पर हमारे विज्ञापनों से आने वाली विज़िट भी मापता है।',
    id: 'Jika Anda mengizinkan, Meta Pixel juga mengukur kunjungan yang datang dari iklan kami di Facebook dan Instagram.',
    ru: "Если вы разрешите, пиксель Meta также будет измерять посещения, пришедшие из нашей рекламы в Facebook и Instagram.",
    ja: "許可すると、FacebookやInstagramの広告から来た訪問もMetaピクセルで計測します。",
    zh: "如果你允许，Meta Pixel 还会统计来自我们在 Facebook 和 Instagram 上广告的访问。",
    ko: "허용하면 Meta 픽셀이 Facebook과 Instagram 광고를 통해 온 방문도 측정합니다.",
    it: "Se lo consenti, il pixel di Meta misura anche le visite che arrivano dai nostri annunci su Facebook e Instagram.",
    ur: "اگر آپ اجازت دیں تو Meta Pixel ہمارے Facebook اور Instagram اشتہارات سے آنے والے وزٹ بھی ناپتا ہے۔",
  };
  const lang = (document.documentElement.lang || 'en').slice(0, 2);
  const [baseMessage, allow, deny, privacy, settings] = TEXT[lang] || TEXT.en;
  const pixel = script && script.dataset.pixel === '1';
  const message = pixel ? `${baseMessage} ${PIXEL_TEXT[lang] || PIXEL_TEXT.en}` : baseMessage;

  const gtag = window.gtag || function () {};
  function grant(on) {
    window['ga-disable-' + id] = !on;
    gtag('consent', 'update', { analytics_storage: on ? 'granted' : 'denied' });
    // Google's script is only fetched now (server.js: obLoadGa); before, nothing was sent to Google
    if (on && window.obLoadGa) window.obLoadGa();
    if (on && pixel && window.obLoadPixel) window.obLoadPixel();
  }

  // Turning statistics off again: remove Google's cookies for this site
  function clearCookies() {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (!/^_ga/.test(name)) continue;
      for (const domain of ['', '; domain=' + location.hostname, '; domain=.' + location.hostname.replace(/^www\./, '')]) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + domain;
      }
    }
  }

  const style = `
    .ob-consent { position: fixed; z-index: 2147483000; left: 50%; bottom: 16px; transform: translateX(-50%);
      width: min(560px, calc(100% - 32px)); box-sizing: border-box; padding: 14px 16px; border-radius: 16px;
      background: #2b2e38; color: #f1f3f8; box-shadow: 0 10px 30px rgba(0, 0, 0, .3);
      font: 14px/1.45 "Plus Jakarta Sans", system-ui, sans-serif; display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: center; }
    .ob-consent p { margin: 0; flex: 1 1 260px; }
    .ob-consent a { color: inherit; }
    .ob-consent .ob-buttons { display: flex; gap: 8px; margin-inline-start: auto; }
    .ob-consent button { font: inherit; font-weight: 700; border: 0; border-radius: 999px; padding: 8px 16px; cursor: pointer; }
    .ob-consent .ob-allow { background: linear-gradient(135deg, #8b7bff, #6a5cff); color: #fff; }
    .ob-consent .ob-deny { background: transparent; color: inherit; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .35); }
    @media (prefers-color-scheme: light) {
      .ob-consent { background: #fff; color: #1f2230; box-shadow: 0 10px 30px rgba(20, 30, 60, .18); }
      .ob-consent .ob-deny { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .25); }
    }`;

  let banner = null;
  function show() {
    if (banner) return;
    if (!document.getElementById('ob-consent-style')) {
      const el = document.createElement('style');
      el.id = 'ob-consent-style';
      el.textContent = style;
      document.head.appendChild(el);
    }
    banner = document.createElement('div');
    banner.className = 'ob-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', settings);
    banner.dir = document.documentElement.dir || 'ltr';
    const p = document.createElement('p');
    p.textContent = message + ' ';
    const link = document.createElement('a');
    link.href = '/privacy';
    link.textContent = privacy;
    p.appendChild(link);
    const buttons = document.createElement('div');
    buttons.className = 'ob-buttons';
    const no = document.createElement('button');
    no.className = 'ob-deny';
    no.textContent = deny;
    const yes = document.createElement('button');
    yes.className = 'ob-allow';
    yes.textContent = allow;
    buttons.append(no, yes);
    banner.append(p, buttons);
    document.body.appendChild(banner);
    yes.onclick = () => { set('yes'); hide(); grant(true); };
    no.onclick = () => { set('no'); hide(); grant(false); clearCookies(); };
  }
  function hide() {
    if (banner) banner.remove();
    banner = null;
  }

  window.OBConsent = { show };
  function start() {
    // "Cookie settings" links on the pages are hidden until statistics are switched on in server.js
    for (const el of document.querySelectorAll('[data-cookie-settings]')) {
      el.hidden = false;
      if (el.style.display === 'none') el.style.display = '';
      el.addEventListener('click', (e) => { e.preventDefault(); show(); });
    }
    const choice = get();
    if (choice !== 'yes' && choice !== 'no' && choice !== 'off') show();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

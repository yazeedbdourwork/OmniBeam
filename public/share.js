// OmniBeam share buttons ("Share OmniBeam" under the app). The links already work without this script;
// it points them at this page's own address and language, and adds the phone share menu and Copy link.
(function () {
  const box = document.getElementById('share');
  if (!box) return;
  const canonical = document.querySelector('link[rel="canonical"]');
  const url = canonical ? canonical.href : location.origin + '/';
  const og = document.querySelector('meta[property="og:title"]');
  const text = og ? og.content : document.title;
  const t = (s) => (window.I18N && I18N.lookup(s)) || s;
  const q = encodeURIComponent;
  const links = {
    whatsapp: `https://api.whatsapp.com/send?text=${q(text + ' ' + url)}`,
    x: `https://x.com/intent/post?text=${q(text)}&url=${q(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`,
    telegram: `https://t.me/share/url?url=${q(url)}&text=${q(text)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${q(url)}`,
    snapchat: `https://www.snapchat.com/scan?attachmentUrl=${q(url)}`,
    email: `mailto:?subject=${q(text)}&body=${q(url)}`,
  };
  for (const a of box.querySelectorAll('a[data-share]')) if (links[a.dataset.share]) a.href = links[a.dataset.share];

  // Phones and tablets: the system share sheet (Messages, Instagram, Snapchat, …)
  const native = box.querySelector('[data-share="native"]');
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    native.hidden = false;
    native.onclick = () => navigator.share({ title: 'OmniBeam', text, url }).catch(() => {});
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = Object.assign(document.createElement('input'), { value: url });
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
  };
  const flash = (btn, text, ms) => {
    const label = btn.querySelector('span');
    const before = label.textContent;
    label.textContent = text;
    btn.classList.add('done');
    setTimeout(() => { label.textContent = before; btn.classList.remove('done'); }, ms);
  };

  const copy = box.querySelector('[data-share="copy"]');
  copy.onclick = async () => {
    await copyLink();
    flash(copy, t('Link copied'), 2000);
  };

  // Instagram has no share address for web links. Phones: the share sheet, where Instagram (Direct, Story) is
  // listed. Computers: copy the link and open Instagram's messages to paste it.
  const insta = box.querySelector('[data-share="instagram"]');
  if (insta) insta.onclick = async () => {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: 'OmniBeam', text, url }).catch(() => {});
      return;
    }
    await copyLink();
    flash(insta, t('Link copied. Paste it in Instagram'), 4000);
    window.open('https://www.instagram.com/direct/inbox/', '_blank', 'noopener');
  };
})();

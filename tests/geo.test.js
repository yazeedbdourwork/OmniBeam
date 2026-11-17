// GEO (answers in AI search): AI crawlers welcome in robots.txt, llms.txt + llms-full.txt, the FAQ, OmniBeam vs
// WeTransfer and PC to Android pages in all 15 languages, and FAQPage / HowTo structured data
const { test, expect } = require('@playwright/test');

const LANGS = ['', 'ar/', 'fr/', 'es/', 'tr/', 'de/', 'pt/', 'hi/', 'id/', 'ru/', 'ja/', 'zh/', 'ko/', 'it/', 'ur/'];
const NEW = ['faq', 'omnibeam-vs-wetransfer', 'send-files-pc-to-android'];
const ld = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];

test('robots.txt names the AI crawlers and keeps private paths out for them too', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) expect(robots).toContain(`User-agent: ${bot}`);
  const aiGroup = robots.slice(robots.indexOf('User-agent: GPTBot'));
  expect(aiGroup).toContain('Disallow: /api/');
  expect(aiGroup).toContain('Allow: /llms-full.txt');
});

test('llms.txt has the key facts and llms-full.txt has the text of every English page', async ({ request }) => {
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toContain('## Key facts');
  expect(llms).toContain('GPL-3.0');
  expect(llms).toContain('/llms-full.txt');
  const res = await request.get('/llms-full.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const full = await res.text();
  expect(full.startsWith('# OmniBeam')).toBe(true);
  for (const h of ['# OmniBeam FAQ', '# OmniBeam vs WeTransfer', '# How to Send Files from PC to Android']) expect(full).toContain(h);
  expect(full).toContain('| How the file travels |');
  expect(full).not.toMatch(/<(p|li|h\d|a)\b/);
});

test('the new answer pages exist in all 15 languages, with Q&A, enough text, hreflang and sitemap entries', async ({ page, request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const l of LANGS) {
    for (const slug of NEW) {
      const r = await page.goto(`/${l}${slug}`);
      expect(r.status(), `/${l}${slug}`).toBe(200);
      const info = await page.evaluate(() => ({
        title: document.title, desc: document.querySelector('meta[name=description]').content,
        qa: document.querySelectorAll('section.qa h3').length, hreflang: document.querySelectorAll('link[hreflang]').length,
        amp: !!document.querySelector('link[rel=amphtml]'),
        words: document.querySelector('main').innerText.split(/\s+/).filter(Boolean).length,
        chars: document.querySelector('main').innerText.replace(/\s+/g, '').length,
      }));
      expect(info.title.length, `/${l}${slug} title`).toBeLessThanOrEqual(65);
      expect(info.desc.length, `/${l}${slug} description`).toBeLessThanOrEqual(165);
      expect(info.qa, `/${l}${slug} Q&A`).toBeGreaterThanOrEqual(5);
      expect(info.hreflang, `/${l}${slug} hreflang`).toBe(16);
      expect(info.amp).toBe(true);
      if (['ja/', 'zh/', 'ko/'].includes(l)) expect(info.chars, `/${l}${slug} characters`).toBeGreaterThan(1000);
      else expect(info.words, `/${l}${slug} words`).toBeGreaterThan(500);
      expect(sitemap).toContain(`/${l}${slug}<`);
      expect((await request.get(`/amp/${l}${slug}`)).status(), `/amp/${l}${slug}`).toBe(200);
    }
  }
});

test('structured data: FAQPage on the FAQ, HowTo on guides, footer links the FAQ', async ({ request }) => {
  const faq = await (await request.get('/faq')).text();
  const faqGraph = ld(faq);
  const faqPage = faqGraph.find((n) => n['@type'] === 'FAQPage');
  expect(faqPage.mainEntity.length).toBeGreaterThanOrEqual(15);
  expect(faqPage.mainEntity[0].name).toBe('What is OmniBeam?');
  const guide = ld(await (await request.get('/ar/send-files-pc-to-android')).text());
  const howto = guide.find((n) => n['@type'] === 'HowTo');
  expect(howto.inLanguage).toBe('ar');
  expect(howto.step.length).toBe(4);
  expect(howto.step[0]['@type']).toBe('HowToStep');
  expect(howto.step[0].text).toContain('omnibeam.site');
  // An older guide gets it too, and a comparison page does not
  expect(ld(await (await request.get('/send-files-iphone-to-pc')).text()).some((n) => n['@type'] === 'HowTo')).toBe(true);
  expect(ld(await (await request.get('/omnibeam-vs-wetransfer')).text()).some((n) => n['@type'] === 'HowTo')).toBe(false);
  const fr = await (await request.get('/fr/send-files-iphone-to-pc')).text();
  expect(fr).toContain('<a href="/fr/faq">FAQ</a>');
});

test('the PairDrop and LocalSend comparisons say OmniBeam is open source', async ({ request }) => {
  for (const l of LANGS) {
    for (const slug of ['omnibeam-vs-pairdrop', 'omnibeam-vs-localsend']) {
      expect(await (await request.get(`/${l}${slug}`)).text(), `/${l}${slug}`).toContain('GPL-3.0');
    }
  }
});

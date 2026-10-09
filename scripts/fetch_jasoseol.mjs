// 자소설닷컴 공개 사이트맵에서 현재 채용공고를 모아 postings.json으로 저장해요.
// 새로 올라온 공고만 천천히(1.2초 간격) 가져오고, 마감이 지난 공고는 지워요.
import fs from 'node:fs/promises';

const OUT = 'postings.json';
const BASE = 'https://jasoseol.com';
const UA = 'Mozilla/5.0 (compatible; job-notebook-personal/1.0; +https://github.com/nakyoung-naya/dfddf)';
const MAX_NEW = 250;
const DELAY = 1200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
  return m ? decode(m[1]).trim() : '';
};
const pad = n => String(n).padStart(2, '0');
const kstToday = () => { const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

export function parsePosting(html, id) {
  const ogTitle = meta(html, 'og:title') || (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '');
  const desc = meta(html, 'og:description') || meta(html, 'description');
  let company = '', title = ogTitle;
  const m = ogTitle.match(/^(.*?)\s*채용공고\s*[-–:|]\s*(.*)$/);
  if (m) { company = m[1].trim(); title = m[2].trim(); }
  else if (ogTitle.includes(' - ')) { [company, title] = ogTitle.split(' - ', 2).map(s => s.trim()); }
  title = title.replace(/\s*[|-]\s*자소설닷컴.*$/, '').trim();

  const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

  const dates = [];
  const re = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*\([^)]*\))?\s*(\d{1,2}:\d{2})?/g;
  let d; while ((d = re.exec(text)) && dates.length < 6) dates.push({ date: `${d[1]}-${pad(d[2])}-${pad(d[3])}`, time: d[4] || '' });
  let start = dates[0] || null, end = dates[1] || null;
  if (start && end && end.date < start.date) end = null;
  if (start && !end) { end = start; start = null; }

  let duties = '';
  const di = text.search(/모집\s*(직무|분야|부문)/);
  if (di >= 0) duties = text.slice(di).replace(/^모집\s*(직무|분야|부문)\s*/, '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4).join(' · ');
  duties = duties.slice(0, 220);
  const career = /인턴/.test(ogTitle + duties) ? '인턴' : /신입/.test(ogTitle + duties) ? '신입' : /경력/.test(ogTitle + duties) ? '경력' : '';

  return {
    id: String(id), url: `${BASE}/recruit/${id}`, company, title, duties, desc: desc.slice(0, 200), career,
    start: start?.date || '', startTime: start?.time || '', end: end?.date || '', endTime: end?.time || ''
  };
}

async function main() {
  let prev = { postings: [] };
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}
  const byId = new Map((prev.postings || []).map(p => [p.id, p]));

  const index = await get(`${BASE}/sitemap.xml`);
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()).filter(u => /employment/i.test(u));
  console.log('공고 사이트맵:', maps);
  const live = new Map();
  for (const sm of maps) {
    const xml = await get(sm); await sleep(DELAY);
    for (const m of xml.matchAll(/<url>\s*<loc>[^<]*\/recruit\/(\d+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) live.set(m[1], m[2] || '');
  }
  console.log('사이트맵에 있는 공고 수:', live.size);

  let fetched = 0, failed = 0;
  for (const [id, lastmod] of live) {
    const old = byId.get(id);
    if (old && (!lastmod || old.lastmod === lastmod)) continue;
    if (fetched >= MAX_NEW) break;
    try {
      const html = await get(`${BASE}/recruit/${id}`);
      const p = parsePosting(html, id);
      p.lastmod = lastmod; p.firstSeen = old?.firstSeen || Date.now();
      if (p.company || p.title) byId.set(id, p);
      if (fetched === 0) console.log('예시:', JSON.stringify(p));
      fetched++;
    } catch (e) { failed++; console.log('실패', id, e.message); }
    await sleep(DELAY);
  }

  const today = kstToday();
  const postings = [...byId.values()]
    .filter(p => live.has(p.id) && (!p.end || p.end >= today))
    .sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
  await fs.writeFile(OUT, JSON.stringify({ source: '자소설닷컴', updated: new Date().toISOString(), count: postings.length, postings }, null, 1));
  console.log(`새로 가져옴 ${fetched}, 실패 ${failed}, 저장된 진행 중 공고 ${postings.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });

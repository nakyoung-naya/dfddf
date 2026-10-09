// 공고에 나온 회사(와 companies.txt에 적은 회사)의 최근 뉴스 제목을 Google 뉴스 RSS에서 모아 news.json으로 저장해요.
import fs from 'node:fs/promises';

const UA = 'Mozilla/5.0 (compatible; job-notebook-personal/1.0; +https://github.com/nakyoung-naya/dfddf)';
const MAX_COMPANIES = 300, PER = 6, DAYS = 45, DELAY = 700;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/<[^>]+>/g, '').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
export const clean = n => n.replace(/\(주\)|㈜|주식회사|\s+/g, '').trim();

export function parseRss(xml) {
  const cut = Date.now() - DAYS * 864e5;
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1]; const source = tag(it, 'source');
    let title = tag(it, 'title'); if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const d = new Date(tag(it, 'pubDate'));
    return { title, url: tag(it, 'link'), source, date: isNaN(d) ? '' : d.toISOString().slice(0, 10), t: isNaN(d) ? 0 : +d };
  }).filter(x => x.title && x.t >= cut).sort((a, b) => b.t - a.t).slice(0, PER).map(({ t, ...x }) => x);
}

async function main() {
  let postings = [];
  try { postings = JSON.parse(await fs.readFile('postings.json', 'utf8')).postings || []; } catch {}
  let extra = [];
  try { extra = (await fs.readFile('companies.txt', 'utf8')).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')); } catch {}
  const names = [...new Set([...extra, ...postings.map(p => p.company)].map(s => (s || '').trim()).filter(Boolean))].slice(0, MAX_COMPANIES);
  console.log('뉴스를 찾을 회사 수:', names.length);
  const companies = {}; let ok = 0, fail = 0;
  for (const name of names) {
    const q = encodeURIComponent(`"${name.replace(/\(주\)|㈜|주식회사/g, '').trim()}" when:${DAYS}d`);
    try {
      const r = await fetch(`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(String(r.status));
      const items = parseRss(await r.text());
      if (items.length) companies[clean(name)] = { name, items };
      ok++;
    } catch (e) { fail++; if (fail <= 5) console.log('실패', name, e.message); }
    await sleep(DELAY);
  }
  await fs.writeFile('news.json', JSON.stringify({ source: 'Google 뉴스', updated: new Date().toISOString(), companies }, null, 1));
  console.log(`성공 ${ok}, 실패 ${fail}, 뉴스가 있는 회사 ${Object.keys(companies).length}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });

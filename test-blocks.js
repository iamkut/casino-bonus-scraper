import { checkRobots, fetchHtml, detectBotWall, htmlToText } from './scraper.js';

const deterministic = [
  {
    name: 'robots.txt disallows (google /search)',
    url: 'https://www.google.com/search?q=casino+bonuses',
    expect: 'robots-denied',
  },
  { name: 'HTTP 403 (httpbin)', url: 'https://httpbin.org/status/403', expect: 'fetch-error' },
  { name: 'HTTP 429 (httpbin)', url: 'https://httpbin.org/status/429', expect: 'fetch-error' },
  { name: 'HTTP 503 (httpbin)', url: 'https://httpbin.org/status/503', expect: 'fetch-error' },
  {
    name: 'Baseline allowed source (vegasslotsonline)',
    url: 'https://www.vegasslotsonline.com/casino-bonuses/',
    expect: 'passes',
  },
];

const realWorld = [
  { name: 'askgamblers (Cloudflare)', url: 'https://www.askgamblers.com/casino-bonuses' },
  { name: 'casino.org (Cloudflare)', url: 'https://www.casino.org/bonuses/' },
  { name: 'lcb.org', url: 'https://www.lcb.org/lcb-casino-bonuses' },
];

async function run(url) {
  const allowed = await checkRobots(url);
  if (!allowed) return { outcome: 'robots-denied' };
  let html;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    return { outcome: 'fetch-error', detail: e.message };
  }
  const text = htmlToText(html);
  const wall = detectBotWall(html, text);
  if (wall) return { outcome: 'bot-wall', detail: wall, textLen: text.length };
  return { outcome: 'passes', textLen: text.length };
}

function describe(result) {
  const detail = result.detail ? ` (${result.detail})` : '';
  const len = result.textLen != null ? ` [text=${result.textLen}]` : '';
  return `${result.outcome}${detail}${len}`;
}

console.log('Block-detection tests. Hits the network, does NOT call the LLM.\n');
console.log('--- Deterministic (exit code reflects these) ---\n');

let pass = 0, fail = 0;
for (const c of deterministic) {
  process.stdout.write(`• ${c.name}\n  ${c.url}\n`);
  try {
    const result = await run(c.url);
    const ok = c.expect === result.outcome;
    console.log(`  expected: ${c.expect}  got: ${describe(result)}`);
    console.log(ok ? '  PASS\n' : '  FAIL\n');
    ok ? pass++ : fail++;
  } catch (e) {
    console.log(`  THREW: ${e.message}\n  FAIL\n`);
    fail++;
  }
}

console.log('--- Real-world sites (informational — behavior drifts) ---\n');
for (const c of realWorld) {
  process.stdout.write(`• ${c.name}\n  ${c.url}\n`);
  try {
    const result = await run(c.url);
    const blocked = result.outcome !== 'passes';
    console.log(`  ${blocked ? 'BLOCKED' : 'ALLOWED'}: ${describe(result)}\n`);
  } catch (e) {
    console.log(`  THREW: ${e.message}\n`);
  }
}

console.log(`${pass} passed, ${fail} failed of ${deterministic.length} deterministic.`);
process.exit(fail === 0 ? 0 : 1);

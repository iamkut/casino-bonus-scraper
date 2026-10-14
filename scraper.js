import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import OpenAI from 'openai';

const DEFAULT_SOURCE = 'https://www.vegasslotsonline.com/casino-bonuses/';
const USER_AGENT = 'CasinoBonusScraper/1.0 (+contact: kutlom@aissa.co.za)';
const OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_CASINOS = 20;
const MAX_TEXT_CHARS = 20000;

async function checkRobots(url) {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  const res = await fetch(robotsUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return true;
  const parser = robotsParser(robotsUrl, await res.text());
  const allowed = parser.isAllowed(url, USER_AGENT);
  return allowed ?? true;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

function htmlToText(html) {
  const $ = load(html);
  $('script, style, noscript, svg, iframe, header, footer, nav').remove();
  $('img[alt]').replaceWith((_, el) => ` ${$(el).attr('alt')} `);
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

const BOT_WALL_MARKERS = [
  'cf-chl',
  'cf_chl_',
  'cf-browser-verification',
  'cf_captcha_kind',
  'Just a moment...',
  'Attention Required',
  'challenge-platform',
  'Please verify you are a human',
  'px-captcha',
  '/_Incapsula_Resource',
  'DDoS protection by Cloudflare',
];

function detectBotWall(html, text) {
  const marker = BOT_WALL_MARKERS.find(m => html.includes(m));
  if (marker) return `anti-bot page detected (marker: "${marker}")`;
  if (text.length < 500) return `page body too short (${text.length} chars) — likely a block or empty page`;
  return null;
}

function stripJsonFence(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (match ? match[1] : text).trim();
}

function buildPrompt(pageText, maxCasinos) {
  return `Extract up to ${maxCasinos} online casinos from the page text below.

For each casino, extract these four fields:
- name: casino brand name (string)
- welcome_bonus: the welcome/sign-up bonus offer, e.g. "100% up to 500 EUR" (string, or null if not stated)
- wagering_requirement: the wagering multiplier as a number, e.g. 35 for "35x" (number, or null if not stated)
- min_deposit: minimum deposit including currency, e.g. "20 EUR" (string, or null if not stated)

Return STRICT JSON only, no prose, no code fences:
{"casinos":[{"name":"...","welcome_bonus":"...","wagering_requirement":35,"min_deposit":"..."}]}

Page text:
"""
${pageText}
"""`;
}

async function callOpenAI(prompt) {
  const client = new OpenAI();
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  return res.choices[0]?.message?.content ?? '';
}

async function extractCasinos(pageText, maxCasinos) {
  const prompt = buildPrompt(pageText, maxCasinos);
  const raw = await callOpenAI(prompt);
  const parsed = JSON.parse(stripJsonFence(raw));
  if (!Array.isArray(parsed.casinos)) throw new Error('LLM did not return casinos array');
  return parsed.casinos.slice(0, maxCasinos);
}

export { checkRobots, fetchHtml, htmlToText, detectBotWall };

export async function scrape({ source = DEFAULT_SOURCE, maxCasinos = DEFAULT_MAX_CASINOS, log = () => {} } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in the environment.');
  }

  log(`Source: ${source}`);
  log(`Model: ${OPENAI_MODEL}`);

  log('Checking robots.txt...');
  const allowed = await checkRobots(source);
  if (!allowed) {
    throw new Error(`robots.txt disallows ${USER_AGENT} on ${source}.`);
  }

  log('Fetching page...');
  const html = await fetchHtml(source);
  const text = htmlToText(html);
  log(`Extracted ${text.length} chars of text.`);

  const wall = detectBotWall(html, text);
  if (wall) throw new Error(`Blocked: ${wall}. Switch source.`);

  log('Parsing with LLM...');
  const casinos = await extractCasinos(text, maxCasinos);
  if (casinos.length === 0) {
    throw new Error('LLM returned 0 casinos — source may be blocking or structurally changed. Switch source.');
  }

  return {
    scraped_at: new Date().toISOString(),
    source,
    casinos: casinos.map(c => ({ ...c, source_url: source })),
  };
}

async function main() {
  const source = process.argv[2] || DEFAULT_SOURCE;
  const output = await scrape({ source, log: console.log });
  await writeFile('data.json', JSON.stringify(output, null, 2));
  console.log(`Wrote ${output.casinos.length} casinos to data.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
}

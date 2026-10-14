import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { scrape } from './scraper.js';

const PORT = Number(process.env.PORT || 8080);
const ROOT = resolve('.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = normalize(join(ROOT, rel));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404); res.end('Not Found');
    } else {
      res.writeHead(500); res.end('Server error');
    }
  }
}

async function handleScrape(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const url = (body.url || '').trim();
  if (url) {
    try { new URL(url); } catch {
      return sendJson(res, 400, { error: 'Invalid URL' });
    }
    if (!/^https?:$/.test(new URL(url).protocol)) {
      return sendJson(res, 400, { error: 'Only http(s) URLs are allowed' });
    }
  }

  const maxCasinos = Math.min(Math.max(Number(body.maxCasinos) || 20, 1), 50);

  try {
    const output = await scrape({
      source: url || undefined,
      maxCasinos,
      log: msg => console.log('[scrape]', msg),
    });
    await writeFile('data.json', JSON.stringify(output, null, 2));
    sendJson(res, 200, output);
  } catch (err) {
    console.error('[scrape] error:', err.message);
    sendJson(res, 500, { error: err.message });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/scrape') {
    return handleScrape(req, res);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res);
  }
  res.writeHead(405, { 'Allow': 'GET, HEAD, POST' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}`);
});

#!/usr/bin/env node
'use strict';

function parseArgs(argv) {
  const out = { url: '', text: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) out.url = argv[++i];
    else if (argv[i] === '--text' && argv[i + 1]) out.text = argv[++i];
  }
  return out;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 12000);
}

async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AI-Content-Factory/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();
  if (!ct.includes('text/html') && !body.includes('<html')) {
    return normalize(body);
  }
  const cleaned = stripHtml(body);
  if (cleaned.length < 80) throw new Error('too_short');
  return cleaned;
}

async function main() {
  try {
    const { url, text } = parseArgs(process.argv.slice(2));
    if (text) {
      console.log(JSON.stringify({ ok: true, text: normalize(text), source: 'text' }));
      return;
    }
    if (!url) {
      console.log(JSON.stringify({ ok: false, error: 'need --url or --text' }));
      process.exit(1);
    }
    try {
      const scraped = await fetchUrl(url);
      console.log(JSON.stringify({ ok: true, text: scraped, source: 'url', url }));
    } catch (e) {
      const fallback = `URL: ${url}\n(скрейп не вдався: ${e.message})`;
      console.log(JSON.stringify({ ok: true, text: fallback, source: 'url_fallback', url }));
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message || 'unknown' }));
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'groq.json');
const SYSTEM_FILE = path.join(ROOT, 'prompts', 'system_min.txt');
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function parseArgs(argv) {
  const out = { input: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) out.input = argv[++i];
  }
  return out;
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function saveCache(cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0));
  } catch (_) {}
}

function hashKey(system, input) {
  return crypto.createHash('sha256').update(system + '\n' + input).digest('hex');
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no_json');
  const parsed = JSON.parse(m[0]);
  if (!parsed.theses || !parsed.short_post || !parsed.expert_opinion) {
    throw new Error('bad_shape');
  }
  return parsed;
}

async function callGroq(system, input) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const user = `Джерело:\n${input.slice(0, 10000)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`groq ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('empty_response');
  return extractJson(text);
}

async function main() {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    if (!input) {
      console.log(JSON.stringify({ ok: false, error: 'need --input' }));
      process.exit(1);
    }

    let system = 'UA JSON theses,short_post,expert_opinion';
    try {
      system = fs.readFileSync(SYSTEM_FILE, 'utf8').trim() || system;
    } catch (_) {}

    const cache = loadCache();
    const key = hashKey(system, input);
    if (cache[key]) {
      console.log(JSON.stringify({ ok: true, cached: true, ...cache[key] }));
      return;
    }

    const result = await callGroq(system, input);
    cache[key] = result;
    saveCache(cache);
    console.log(JSON.stringify({ ok: true, cached: false, ...result }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message || 'unknown' }));
    process.exit(1);
  }
}

main();

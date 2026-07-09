#!/usr/bin/env node
'use strict';
// Phase 3 — 로컬 웹앱 서버 (기획서 4장·6장, 9.6 스택)
// 의존성 없는 내장 http: web/ 정적 서빙 + JSON API. 규칙엔진·사전 쓰기·엔진 호출은
// 전부 서버 측(브라우저 번들 불필요, File System Access API 불필요).
// 사용법: node server.js [--port 8300] [--url http://127.0.0.1:50021]

const http = require('http');
const fs = require('fs');
const path = require('path');

const { convert } = require('./src/rules');
const { sentencePlain, sentenceMarkup } = require('./src/accent');
const vv = require('./src/voicevox');
const { BOOKS, KEY_SHAPE, loadBooks, saveBook, valueError, buildWords, convertOpts } = require('./src/books');
const { appendHold } = require('./src/hold');

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_CONFIG = { styleId: 3, jp: false, autoPlay: true };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const opt = { port: 8300, url: vv.DEFAULT_URL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opt.port = Number(argv[++i]);
    else if (argv[i] === '--url') opt.url = argv[++i];
  }
  return opt;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error('요청 본문이 너무 큽니다')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON 본문을 해석할 수 없습니다')); }
    });
    req.on('error', reject);
  });
}

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// 문장 직렬화 (클라이언트용) — phrases 원본 대신 표시에 필요한 값만
function serializeSentences(sentences) {
  return sentences.map((s) => ({
    plain: sentencePlain(s),
    markup: sentenceMarkup(s),
    adjustments: s.adjustments,
    wordSpans: s.wordSpans,
    question: s.question,
  }));
}

// ── 어절 타이밍 계산 (재생 중 하이라이트) ─────────────────────────────
// 보정 적용 후 accent_phrases의 모라 길이를 누적해, 문장의 wordSpans(전역 모라 인덱스)를
// 초 단위 [start, end)로 변환한다. pause_mora는 시간에는 더해지되 모라 인덱스에는 없음
// (applyAdjustments와 같은 인덱스 공간). speedScale=1.0 고정 전제(buildAudioQuery).
function moraTimes(phrases, baseOffset) {
  const starts = [];
  const ends = [];
  let t = baseOffset;
  for (const p of phrases) {
    for (const m of p.moras) {
      starts.push(t);
      t += (m.consonant_length ?? 0) + (m.vowel_length ?? 0);
      ends.push(t);
    }
    if (p.pause_mora) t += (p.pause_mora.consonant_length ?? 0) + (p.pause_mora.vowel_length ?? 0);
  }
  return { starts, ends, total: t - baseOffset };
}

// ── API 핸들러 ────────────────────────────────────────────────────────
// 화자 프로필 아이콘 (엔진 /speaker_info의 스타일별 base64) — 화자 수만큼 요청이 필요해
// 첫 호출에 모아서 메모리 캐시. 개별 화자 실패는 건너뜀 (아이콘 없는 행은 UI가 placeholder)
let speakerIconCache = null;

async function apiSpeakerIcons(engineUrl) {
  if (speakerIconCache) return { code: 200, data: speakerIconCache };
  const speakers = await vv.speakers(engineUrl);
  const icons = {};
  for (const sp of speakers) {
    try {
      const info = await vv.speakerInfo(sp.speaker_uuid, engineUrl);
      for (const si of info.style_infos) icons[si.id] = `data:image/png;base64,${si.icon}`;
    } catch { /* 이 화자만 아이콘 생략 */ }
  }
  speakerIconCache = { icons };
  return { code: 200, data: speakerIconCache };
}
async function apiConvert(body) {
  const text = String(body.text ?? '').trim();
  if (!text) return { code: 400, data: { error: '변환할 텍스트가 없습니다' } };
  const state = loadBooks(); // 매 요청 로드 — 파일이 작아 충분히 빠르고, 외부 편집 즉시 반영
  const opt = { jp: !!body.jp };
  const conv = convert(text, convertOpts(state, opt));
  return {
    code: 200,
    data: {
      sentences: serializeSentences(conv.sentences),
      words: buildWords(text, state, opt),
      warnings: conv.warnings,
      dictHits: conv.dictHits,
      enHits: conv.enHits,
    },
  };
}

async function apiSynth(body, engineUrl) {
  const text = String(body.text ?? '').trim();
  if (!text) return { code: 400, data: { error: '합성할 텍스트가 없습니다' } };
  const speaker = Number.isInteger(body.speaker) && body.speaker >= 0 ? body.speaker : DEFAULT_CONFIG.styleId;
  const state = loadBooks();
  const conv = convert(text, convertOpts(state, { jp: !!body.jp }));
  if (!conv.sentences.length) return { code: 400, data: { error: '발음할 내용이 없습니다', warnings: conv.warnings } };

  const buffers = [];
  const timings = []; // 어절(wordSpans) 순서대로 {start, end} (초) — 문장 경계 넘어 누적
  let offset = 0;
  for (const sen of conv.sentences) {
    const markup = sentenceMarkup(sen);
    let phrases;
    try {
      phrases = await vv.accentPhrases(markup, speaker, engineUrl);
    } catch (e) {
      if (e.status === 400) {
        return { code: 400, data: { error: '가나 파스 실패 (엔진 400)', markup, engineBody: e.body } };
      }
      throw e;
    }
    vv.applyAdjustments(phrases, sen.adjustments);
    const query = vv.buildAudioQuery(phrases);
    // 문장 오디오 = prePhonemeLength + 모라들(+pause) + postPhonemeLength
    const times = moraTimes(phrases, offset + query.prePhonemeLength);
    for (const span of sen.wordSpans) {
      timings.push({
        start: times.starts[span.start] ?? null,
        end: times.ends[span.end - 1] ?? null,
      });
    }
    offset += query.prePhonemeLength + times.total + query.postPhonemeLength;
    buffers.push(await vv.synthesis(query, speaker, engineUrl));
  }
  const wav = vv.concatWav(buffers);
  return {
    code: 200,
    data: {
      audio: wav.toString('base64'),
      timings,
      warnings: conv.warnings,
    },
  };
}

function apiDicts() {
  const state = loadBooks();
  const out = {};
  for (const id of Object.keys(BOOKS)) out[id] = { file: state[id].file, entries: state[id].dict };
  return { code: 200, data: out };
}

function apiDictPut(body) {
  const id = String(body.book ?? '');
  if (!BOOKS[id]) return { code: 400, data: { error: `사전이 아닙니다: ${id} (main|en|jp)` } };
  let key = String(body.key ?? '').trim().replace(/\*$/, '');
  if (/^[A-Za-z]/.test(key)) key = key.toLowerCase(); // routeOf와 같은 정규화
  if (!key || !KEY_SHAPE.test(key)) {
    return { code: 400, data: { error: '키는 한글(자모 포함) 어절 또는 영어 단어여야 합니다' } };
  }
  const value = String(body.value ?? '').trim();
  const state = loadBooks();
  const book = state[id];
  const err = valueError(book, value);
  if (err) return { code: 400, data: { error: err } };
  book.raw[key] = value;
  saveBook(book);
  return { code: 200, data: { book: book.file, key, value } };
}

function apiDictDelete(body) {
  const id = String(body.book ?? '');
  if (!BOOKS[id]) return { code: 400, data: { error: `사전이 아닙니다: ${id} (main|en|jp)` } };
  const key = String(body.key ?? '').trim();
  const state = loadBooks();
  const book = state[id];
  if (book.raw[key] === undefined) return { code: 404, data: { error: `사전에 없는 키: ${key}` } };
  const old = book.raw[key];
  delete book.raw[key];
  saveBook(book);
  return { code: 200, data: { book: book.file, key, deleted: old } };
}

function apiHold(body) {
  const note = String(body.note ?? '').trim();
  if (!note) return { code: 400, data: { error: '메모가 비어 있습니다' } };
  appendHold(String(body.text ?? ''), String(body.kana ?? ''), note);
  return { code: 200, data: { ok: true } };
}

// ── 정적 서빙 (web/ 안으로 제한) ─────────────────────────────────────
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep) && file !== path.join(WEB_DIR, 'index.html')) {
    return sendJson(res, 403, { error: '허용되지 않는 경로' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: `없음: ${urlPath}` });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

// ── 라우터 ────────────────────────────────────────────────────────────
async function handle(req, res, opt) {
  const { pathname } = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
  try {
    if (pathname.startsWith('/api/')) {
      let result;
      if (req.method === 'GET' && pathname === '/api/speakers') {
        result = { code: 200, data: await vv.speakers(opt.url) };
      } else if (req.method === 'GET' && pathname === '/api/speaker_icons') {
        result = await apiSpeakerIcons(opt.url);
      } else if (req.method === 'POST' && pathname === '/api/convert') {
        result = await apiConvert(await readJson(req));
      } else if (req.method === 'POST' && pathname === '/api/synth') {
        result = await apiSynth(await readJson(req), opt.url);
      } else if (req.method === 'GET' && pathname === '/api/dicts') {
        result = apiDicts();
      } else if (req.method === 'PUT' && pathname === '/api/dict') {
        result = apiDictPut(await readJson(req));
      } else if (req.method === 'DELETE' && pathname === '/api/dict') {
        result = apiDictDelete(await readJson(req));
      } else if (req.method === 'GET' && pathname === '/api/config') {
        result = { code: 200, data: loadConfig() };
      } else if (req.method === 'PUT' && pathname === '/api/config') {
        const cfg = { ...loadConfig(), ...(await readJson(req)) };
        saveConfig(cfg);
        result = { code: 200, data: cfg };
      } else if (req.method === 'POST' && pathname === '/api/hold') {
        result = apiHold(await readJson(req));
      } else {
        result = { code: 404, data: { error: `API 없음: ${req.method} ${pathname}` } };
      }
      return sendJson(res, result.code, result.data);
    }
    if (req.method === 'GET') return serveStatic(res, pathname);
    return sendJson(res, 405, { error: '허용되지 않는 메서드' });
  } catch (e) {
    if (e.connectionFailed) return sendJson(res, 502, { error: e.message, engineDown: true });
    return sendJson(res, 500, { error: e.message });
  }
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const server = http.createServer((req, res) => { handle(req, res, opt); });
  // 로컬 전용 도구 — 루프백에만 바인딩
  server.listen(opt.port, '127.0.0.1', () => {
    console.log(`k2v 웹 UI: http://127.0.0.1:${opt.port} (엔진: ${opt.url})`);
  });
}

if (require.main === module) main();
module.exports = { moraTimes }; // 테스트용

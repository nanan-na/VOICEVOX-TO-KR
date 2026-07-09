#!/usr/bin/env node
'use strict';
// 대화형 청취·사전 축적 도구 (기획서 3.6의 사전을 귀로 채우는 CLI — Phase 3 UI의 선행판)
//
// 사용법:
//   node tools/audition.js                            대화형: 문장 입력 → 즉시 재생 → 교정 → 사전 저장
//   node tools/audition.js tools/청취목록_1단계.txt    목록 배치 청취
//   옵션: --speaker N (기본 3), --url http://127.0.0.1:50021, --jp (외래어 전역 일본어식)
//
// 입력: 한국어 문장 (영어 단어·일본어식 마커 `커피*` 혼용 가능 — 3.7).
// 가타카나를 직접 쓰면 규칙을 우회하고 그대로 발음(자동 핵 부여).
// 목록 파일: 빈 줄 무시, `#` 설명(출력만), `=` 접두는 가나 라인(이제 일반 입력과 동일 처리).
//
// 항목마다: [Enter]=다음  [r]=다시 듣기  [f]=발음 교정(사전 저장 후 재청취 — 마커 맥락 라우팅:
//           `단어*`→dict_jp.json, 한글→dict.json, 영어→dict_en.json)
//           [d]=사전 항목 삭제  [m]=보류 메모(지금 수단으로 해결 안 되는 것 → 보류목록.md)  [q]=종료

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');
const { stdin, stdout } = require('process');

const { convert } = require('../src/rules');
const { preprocess } = require('../src/numbers');
const { sentencePlain, sentenceMarkup } = require('../src/accent');
const vv = require('../src/voicevox');
// 사전 3권·보류 메모 공용 로직 (Phase 3에서 웹 UI server.js와 공유하도록 src/로 추출)
const { WORD_RUN, KEY_SHAPE, loadBooks, saveBook, routeOf, convertOpts, valueError } = require('../src/books');
const { appendHold } = require('../src/hold');

const TMP_WAV = path.join(os.tmpdir(), 'k2v_audition.wav');
const MARKS = /['‘’´`]/g;

function parseArgs(argv) {
  const opt = { list: null, speaker: 3, url: vv.DEFAULT_URL, jp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--speaker') opt.speaker = Number(argv[++i]);
    else if (a === '--url') opt.url = argv[++i];
    else if (a === '--jp') opt.jp = true;
    else if (!opt.list) opt.list = a;
  }
  return opt;
}

// 입력 큐. terminal:false 고정 — Windows에서 한글 IME 조합이 readline 자체 에코와
// 충돌해 "한 글자씩만 보이는" 문제가 있어, 콘솔의 기본 줄 편집(에코 포함)을 사용한다.
// 합성·재생 중에 미리 입력한 줄도 버리지 않는다.
function makeAsk() {
  const rl = readline.createInterface({ input: stdin, terminal: false });
  const queue = [];
  let pending = null;
  let closed = false;
  rl.on('line', (l) => {
    if (pending) { const r = pending; pending = null; r(l); } else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    if (pending) { const r = pending; pending = null; r(null); }
  });
  const ask = (prompt) => {
    stdout.write(prompt);
    if (queue.length) { const l = queue.shift(); stdout.write(`${l}\n`); return Promise.resolve(l); }
    if (closed) { stdout.write('\n'); return Promise.resolve(null); }
    return new Promise((res) => { pending = res; });
  };
  return { ask, close: () => rl.close() };
}

// Windows 내장 재생 (의존성 없음). PlaySync가 끝날 때까지 블록됨
function play() {
  spawnSync('powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${TMP_WAV}').PlaySync()`], { stdio: 'ignore' });
}

async function synthToTmp(items, opt) {
  const buffers = [];
  for (const { markup, adjustments } of items) {
    const phrases = await vv.accentPhrases(markup, opt.speaker, opt.url);
    vv.applyAdjustments(phrases, adjustments ?? []);
    buffers.push(await vv.synthesis(vv.buildAudioQuery(phrases), opt.speaker, opt.url));
  }
  fs.writeFileSync(TMP_WAV, vv.concatWav(buffers));
}

// 어절 하나의 현재 발음 표시용 (마커 토큰은 마커째 변환해 일본어식 표시)
function wordKana(word, state, opt) {
  const conv = convert(word, convertOpts(state, opt));
  return conv.sentences.map(sentencePlain).join(' ');
}

// [f] 교정 입력 → 마커 맥락 라우팅으로 dict/dict_en/dict_jp 저장. 저장했으면 true
async function fixFlow(ask, text, state, opt) {
  const words = [...new Set(preprocess(text).match(WORD_RUN) ?? [])];
  if (words.length === 0) {
    console.log('  교정할 어절이 없습니다 (가나 직접 입력은 이미 지정 발음입니다)');
    return false;
  }
  let token;
  if (words.length === 1) {
    token = words[0];
  } else {
    for (const w of words) {
      const r = routeOf(w, state);
      const cur = r.book.dict[r.key] !== undefined ? `  [${r.book.file}: ${r.book.dict[r.key]}]` : '';
      console.log(`    ${w} → ${wordKana(w, state, opt)}${cur}`);
    }
    token = ((await ask('  교정할 어절 > ')) ?? '').trim();
    token = preprocess(token).replace(MARKS, ''); // 숫자 포함 입력도 사전 키로 정규화
  }
  if (!KEY_SHAPE.test(token)) {
    console.log('  키는 한글(자모 포함) 어절 또는 영어 단어여야 합니다 (일본어식은 뒤에 *) — 취소');
    return false;
  }
  const { book, key, label } = routeOf(token, state);
  if (book.dict[key] !== undefined) {
    console.log(`  현재 사전 값: ${key} → ${book.dict[key]} (${book.file}, 새 값으로 덮어씁니다)`);
  }
  const value = ((await ask(`  '${key}'의 ${label} 발음 (한글/가타카나, '=핵 /=구분리 <초>=모라 길이 지정, 빈 입력=취소) > `)) ?? '').trim();
  if (!value) {
    console.log('  취소');
    return false;
  }
  const err = valueError(book, value);
  if (err) {
    console.log(`  ${err}. 취소`);
    return false;
  }
  book.raw[key] = value;
  saveBook(book);
  console.log(`  저장됨: ${key} → ${value}  (${book.file})`);
  return true;
}

// [m] 보류 메모: 지금 수단(한글 재표기·가나 값·핵 마크업)으로 해결 안 되는 것을
// 보류목록.md에 축적 — 쌓이면 검토해 규칙 승격 / 사전 등록 /
// 10장(인토네이션·길이 손튜닝) 재개 여부를 판단한다.
async function holdFlow(ask, text, lastKana) {
  const note = ((await ask('  보류 메모 (무엇이 아쉬운지 한 줄, 빈 입력=취소) > ')) ?? '').trim();
  if (!note) {
    console.log('  취소');
    return false;
  }
  appendHold(text, lastKana, note);
  console.log(`  기록됨 → 보류목록.md`);
  return true;
}

// [d] 사전 항목 삭제 (잘못 저장한 교정 되돌리기) — 토큰의 마커 맥락으로 대상 사전 결정
async function deleteFlow(ask, text, state) {
  const registered = [...new Set(preprocess(text).match(WORD_RUN) ?? [])]
    .map((w) => ({ token: w, ...routeOf(w, state) }))
    .filter((r) => r.book.dict[r.key] !== undefined);
  if (registered.length === 0) {
    console.log('  이 문장의 어절 중 사전에 등록된 것이 없습니다');
    return false;
  }
  let target;
  if (registered.length === 1) {
    target = registered[0];
  } else {
    console.log(`  등록된 어절: ${registered.map((r) => `${r.token}→${r.book.dict[r.key]} (${r.book.file})`).join('  |  ')}`);
    const input = ((await ask('  삭제할 키 > ')) ?? '').trim().replace(MARKS, '');
    target = registered.find((r) => r.token === input || r.key === input) ?? { token: input, ...routeOf(input, state) };
  }
  const { book, key } = target;
  if (book.raw[key] === undefined) {
    console.log('  사전에 없는 키 — 취소');
    return false;
  }
  const old = book.raw[key];
  delete book.raw[key];
  saveBook(book);
  console.log(`  삭제됨: ${key} → ${old}  (${book.file})`);
  return true;
}

// 항목 하나 처리. 'next' | 'quit' 반환
async function runItem(ask, input, state, opt) {
  // '=' 접두(구버전 가나 라인)는 이제 일반 입력과 동일 — 가나가 파이프라인에서 직접 처리됨
  const t = input.startsWith('=') ? input.slice(1).trim() : input;
  let lastKana = '';
  try {
    const speak = async () => {
      const conv = convert(t, convertOpts(state, opt));
      if (!conv.sentences.length) {
        console.log('  (발음할 내용 없음 — 건너뜀)');
        return false;
      }
      for (const w of conv.warnings) console.log(`  경고  : ${w}`);
      if (conv.enHits.length) console.log(`  영어  : ${conv.enHits.join(', ')}`);
      if (conv.dictHits.length) console.log(`  사전  : ${conv.dictHits.join(', ')}`);
      lastKana = conv.sentences.map(sentenceMarkup).join(' ');
      console.log(`  가나  : ${conv.sentences.map(sentencePlain).join(' ')}`);
      console.log(`  마크업: ${lastKana}`);
      await synthToTmp(conv.sentences.map((s) => ({ markup: sentenceMarkup(s), adjustments: s.adjustments })), opt);
      play();
      return true;
    };

    console.log(`\n♪ ${t}`);
    if (!(await speak())) return 'next';
    for (;;) {
      const a = ((await ask('  [Enter다음/r다시/f교정/d사전삭제/m보류/q종료] > ')) ?? 'q').trim();
      if (a === '') return 'next';
      if (a === 'r') { play(); continue; }
      if (a === 'q') return 'quit';
      if (a === 'f') {
        if (await fixFlow(ask, t, state, opt)) await speak(); // 교정 반영해 바로 다시 듣기
        continue;
      }
      if (a === 'd') {
        if (await deleteFlow(ask, t, state)) await speak();
        continue;
      }
      if (a === 'm') {
        await holdFlow(ask, t, lastKana);
        continue;
      }
      console.log('  (Enter/r/f/d/m/q 중 하나)');
    }
  } catch (e) {
    console.log(`  !! ${String(e.message).slice(0, 200)}`);
    return 'next';
  }
}

(async () => {
  const opt = parseArgs(process.argv.slice(2));
  try {
    await vv.version(opt.url);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const state = loadBooks();
  const { ask, close } = makeAsk();

  if (opt.list) {
    const lines = fs.readFileSync(opt.list, 'utf8').split(/\r?\n/);
    const count = lines.filter((l) => l.trim() && !l.trim().startsWith('#')).length;
    console.log(`목록 청취: ${opt.list} — 항목 ${count}개 (화자 ${opt.speaker})`);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('#')) { console.log(`\n${t}`); continue; }
      if ((await runItem(ask, t, state, opt)) === 'quit') break;
    }
    console.log('\n목록 끝. 결정 사항(규칙 변경 필요 등)은 보류목록.md에 남겨두세요.');
  } else {
    console.log(`대화형 모드 (화자 ${opt.speaker}${opt.jp ? ', 전역 일본어식' : ''}) — 문장을 입력하면 바로 재생됩니다. q로 종료.`);
    console.log('  영어 단어·일본어식 마커(커피*)·가타카나 직접 입력 가능. 항목 후: Enter=다음 r=다시 f=교정 d=사전삭제 m=보류메모 q=종료');
    for (;;) {
      const t = ((await ask('\n문장 > ')) ?? 'q').trim();
      if (!t) continue;
      if (t === 'q') break;
      if ((await runItem(ask, t, state, opt)) === 'quit') break;
    }
  }
  close();
})();

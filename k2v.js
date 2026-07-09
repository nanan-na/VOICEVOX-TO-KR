#!/usr/bin/env node
'use strict';
// 한국어 → VOICEVOX 합성 CLI (Phase 1)
// 사용법: node k2v.js "안녕하세요" [--speaker 3] [--out out.wav] [--dry] [--url http://127.0.0.1:50021] [--speakers]

const fs = require('fs');
const { convert } = require('./src/rules');
const { sentenceMarkup, sentencePlain } = require('./src/accent');
const vv = require('./src/voicevox');

const DEFAULT_STYLE_ID = 3; // ずんだもん ノーマル (Phase 3에서 드롭다운화 예정)

function usage() {
  console.log('사용법: node k2v.js "한국어 텍스트" [옵션]');
  console.log('  --speaker <id>  화자 style_id (기본 3)');
  console.log('  --out <path>    출력 wav 경로 (기본 out.wav)');
  console.log('  --dry           변환 결과만 출력 (엔진 호출 없음)');
  console.log('  --jp            외래어를 일본어식 가타카나로 (기본은 한국어식 — 3.7)');
  console.log('  --url <url>     엔진 주소 (기본 http://127.0.0.1:50021)');
  console.log('  --speakers      화자 목록 출력');
}

function parseArgs(argv) {
  const opt = { text: null, speaker: DEFAULT_STYLE_ID, out: 'out.wav', dry: false, jp: false, url: vv.DEFAULT_URL, listSpeakers: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--speaker') opt.speaker = Number(argv[++i]);
    else if (a === '--out') opt.out = argv[++i];
    else if (a === '--dry') opt.dry = true;
    else if (a === '--jp') opt.jp = true;
    else if (a === '--url') opt.url = argv[++i];
    else if (a === '--speakers') opt.listSpeakers = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (opt.text === null) opt.text = a;
  }
  return opt;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));

  if (opt.listSpeakers) {
    const list = await vv.speakers(opt.url);
    for (const sp of list) {
      for (const st of sp.styles) console.log(`${String(st.id).padStart(4)}  ${sp.name} (${st.name})`);
    }
    return;
  }

  if (!opt.text) { usage(); process.exit(1); }
  if (!Number.isInteger(opt.speaker) || opt.speaker < 0) {
    console.error(`--speaker 값이 올바르지 않습니다: ${opt.speaker}`);
    process.exit(1);
  }

  const { sentences, warnings, dictHits, enHits } = convert(opt.text, { jp: opt.jp });
  for (const w of warnings) console.warn(`[경고] ${w}`);
  if (enHits.length) console.log(`영어   : ${enHits.join(', ')}`);
  if (dictHits.length) console.log(`사전   : ${dictHits.join(', ')}`);
  if (sentences.length === 0) {
    console.error('변환할 한글이 없습니다.');
    process.exit(1);
  }

  for (const sen of sentences) {
    console.log(`가나   : ${sentencePlain(sen)}`);
    console.log(`마크업 : ${sentenceMarkup(sen)}`);
    if (sen.adjustments.length) {
      console.log(`보정   : ${sen.adjustments.map((a) => `${a.type}@${a.index}`).join(' ')}`);
    }
  }
  if (opt.dry) return;

  const ver = await vv.version(opt.url);
  console.log(`엔진   : VOICEVOX ENGINE ${ver} / 화자 style_id=${opt.speaker}`);

  const buffers = [];
  for (const sen of sentences) {
    const markup = sentenceMarkup(sen);
    let phrases;
    try {
      phrases = await vv.accentPhrases(markup, opt.speaker, opt.url);
    } catch (e) {
      if (e.status === 400) {
        console.error(`가나 파스 실패 (400) — 마크업: ${markup}`);
        console.error(`엔진 응답: ${e.body}`);
        process.exit(1);
      }
      throw e;
    }
    vv.applyAdjustments(phrases, sen.adjustments);
    const query = vv.buildAudioQuery(phrases);
    buffers.push(await vv.synthesis(query, opt.speaker, opt.url));
  }

  const wav = vv.concatWav(buffers);
  fs.writeFileSync(opt.out, wav);
  console.log(`완료   : ${opt.out} (${(wav.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

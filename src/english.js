'use strict';
// 영어(로마자)·일본어식 발음 스테이지 (기획서 3.7)
// 파이프라인 위치: 숫자 전처리 → [여기] → 예외사전(3.6) → 자모 규칙
//
// 기본(한국어식): 라틴 토큰 → 한글 —
//   ① dict_en.json 관용 표기 → ② 전대문자 2~4자는 letter-name(USA→유에스에이, IT→아이티)
//   → ③ CMUdict+외래어표기법(cake→케이크) → ④ 전대문자 letter-name → ⑤ 철자 폴백(+경고)
//   ②를 CMUdict 앞에 두는 건 짧은 약어가 일반 단어에 가로채이는 것 방지(it→잇, usa→유에세이).
//   5자+ 전대문자(HELLO 등 강조 표기)는 CMUdict가 먼저라 에이치이엘엘오가 되지 않음.
// 일본어식: 토큰 마커 `커피*`/`meeting*` 또는 전역 --jp → 가타카나 —
//   한글 토큰은 dict_jp.json 조회(어휘 지식), 라틴 토큰은 dict_jp → CMUdict→가타카나 자동.
//   가타카나 런은 기존 파이프라인이 kana 어절로 그대로 발음(3.6 확장).
//   일본어식 가나 출력엔 `*`를 붙여 내보냄 — 규칙엔진(parseSentence)이 이 마커를 보고
//   한국어식 받침 길이 보정(ル·ム 단축 등)을 건너뛴다. 마커 없는 가나(dict.json 값 등)는
//   한국어 발음의 일부이므로 보정을 받는다.

const fs = require('fs');
const path = require('path');
const { arpabetToKorean, arpabetToKatakana } = require('./loanword');

const DICT_EN_PATH = path.join(__dirname, '..', 'dict_en.json');
const DICT_JP_PATH = path.join(__dirname, '..', 'dict_jp.json');
const CMUDICT_PATH = path.join(__dirname, '..', 'data', 'cmudict.json');

// 한글/라틴 토큰 + 선택적 일본어식 마커 `*` (3.10 확장)
const TOKEN = /([가-힣]+|[A-Za-z][A-Za-z0-9']*)(\*?)/g;

const LETTER_NAMES = {
  A: '에이', B: '비', C: '시', D: '디', E: '이', F: '에프', G: '지', H: '에이치',
  I: '아이', J: '제이', K: '케이', L: '엘', M: '엠', N: '엔', O: '오', P: '피',
  Q: '큐', R: '알', S: '에스', T: '티', U: '유', V: '브이', W: '더블유', X: '엑스',
  Y: '와이', Z: '제트',
};
const DIGIT_NAMES = { 0: '공', 1: '일', 2: '이', 3: '삼', 4: '사', 5: '오', 6: '육', 7: '칠', 8: '팔', 9: '구' };

// dict.json과 같은 로더 패턴 (dict.js 미러) — 없거나 깨져도 앱은 계속 동작
function makeLoader(file, label) {
  let cached = null;
  return () => {
    if (cached) return cached;
    let dict = {};
    let warning = null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(raw)) {
        if (!key.startsWith('_')) dict[key] = value;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') warning = `${label}을 읽지 못해 무시함: ${e.message}`;
    }
    cached = { dict, warning };
    return cached;
  };
}
const loadEnglishDict = makeLoader(DICT_EN_PATH, '영어 사전(dict_en.json)');
const loadJpDict = makeLoader(DICT_JP_PATH, '일본어식 사전(dict_jp.json)');

// CMUdict — 지연 로드 (~4MB: 라틴 토큰이 사전에 없을 때 처음 필요해지는 시점에만)
let cmuCached = null;
let cmuFailed = false;
function cmuLookup(lower, warnings) {
  if (cmuFailed) return undefined;
  if (!cmuCached) {
    try {
      cmuCached = JSON.parse(fs.readFileSync(CMUDICT_PATH, 'utf8'));
    } catch (e) {
      cmuFailed = true;
      warnings.add(`발음사전(data/cmudict.json)을 읽지 못함 — 철자 폴백만 사용: ${e.message}`);
      return undefined;
    }
  }
  return cmuCached[lower];
}

const isAcronym = (word) => /^[A-Z]{2,4}$/.test(word); // 짧은 전대문자 = 약어로 간주
const isAllCaps = (word) => /^[A-Z]{2,}$/.test(word);
const hasKatakana = (v) => typeof v === 'string' && /[ァ-ヺ]/.test(v) && !/[가-힣]/.test(v);

function spellOut(word) {
  return [...word.toUpperCase()].map((ch) => LETTER_NAMES[ch] ?? DIGIT_NAMES[ch] ?? '').join('');
}

// 라틴 토큰 → 한국어식 한글 (파일 헤더의 ①~⑤ 폴백)
function renderKorean(word, dictEn, warnings, hits) {
  const lower = word.toLowerCase();
  const seeded = dictEn[word] ?? dictEn[lower]; // 대문자 키(전용 표기)가 있으면 우선
  if (seeded !== undefined) { hits.push(`${word}→${seeded}`); return seeded; }
  if (isAcronym(word)) { const s = spellOut(word); hits.push(`${word}→${s}`); return s; }
  const phones = cmuLookup(lower, warnings);
  if (phones) { const h = arpabetToKorean(phones); hits.push(`${word}→${h}`); return h; }
  if (isAllCaps(word)) { const s = spellOut(word); hits.push(`${word}→${s}`); return s; }
  const s = spellOut(word);
  warnings.add(`영어 '${word}' 발음 미상 — 철자(${s})로 읽음. dict_en.json 등록 권장`);
  return s;
}

// 라틴 토큰 → 일본어식 가타카나 (dict_jp → dict_en 가타카나 값 → CMUdict→가타카나 → 한국어식 폴백)
function renderKatakana(word, dictEn, dictJp, warnings, hits) {
  const lower = word.toLowerCase();
  const seeded = dictJp[word] ?? dictJp[lower];
  if (seeded !== undefined) { hits.push(`${word}*→${seeded}`); return seeded; }
  const en = dictEn[word] ?? dictEn[lower];
  if (hasKatakana(en)) { hits.push(`${word}*→${en}`); return en; }
  const phones = cmuLookup(lower, warnings);
  if (phones) { const k = arpabetToKatakana(phones); hits.push(`${word}*→${k}`); return k; }
  warnings.add(`영어 '${word}'의 일본어식 발음 미상 — 한국어식으로 폴백. dict_jp.json 등록 권장`);
  return renderKorean(word, dictEn, warnings, hits);
}

// 스테이지 엔트리. 한글/가타카나 혼합 문자열을 반환 (공백·구두점 보존)
// opt: { dictEn, dictJp, jp, warnings(Set), hits(Array) }
function englishStage(text, opt = {}) {
  const { dictEn = {}, dictJp = {}, jp = false } = opt;
  const warnings = opt.warnings ?? new Set();
  const hits = opt.hits ?? [];
  if (!jp && !/[A-Za-z*]/.test(text)) return text; // 한국어 전용 입력은 무비용 통과
  return text.replace(TOKEN, (run, word, mark) => {
    const isJp = mark === '*' || jp;
    if (/[가-힣]/.test(word)) {
      if (!isJp) return run;
      const v = dictJp[word];
      if (v !== undefined) { hits.push(`${word}*→${v}`); return v + '*'; }
      if (mark === '*') {
        warnings.add(`'${word}*'의 일본어식 읽기가 dict_jp.json에 없음 — audition f로 등록하세요 (한국어식으로 발음)`);
      }
      return word; // 전역 --jp의 미등록 한글은 조용히 통과 (외래어 여부 판별 불가)
    }
    const out = isJp
      ? renderKatakana(word, dictEn, dictJp, warnings, hits)
      : renderKorean(word, dictEn, warnings, hits);
    // 가타카나 출력 = 일본어식 발음 의도 (dict_en의 가나 값 포함) → 마커를 남김
    return /[ァ-ヺ]/.test(out) ? out + '*' : out;
  });
}

module.exports = { englishStage, loadEnglishDict, loadJpDict };

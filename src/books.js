'use strict';
// 사전 3권(dict/dict_en/dict_jp) 공용 로직 (기획서 3.6/3.7)
// audition.js(CLI 청취 도구)와 server.js(Phase 3 웹 UI)가 공유한다.
// 저장처 라우팅은 토큰의 마커 맥락 기준: `단어*`→dict_jp, 한글→dict.json, 라틴→dict_en.

const fs = require('fs');
const path = require('path');
const { convert } = require('./rules');
const { preprocess } = require('./numbers');
const { sentencePlain } = require('./accent');

const ROOT = path.join(__dirname, '..');

const BOOKS = {
  main: { id: 'main', file: 'dict.json', path: path.join(ROOT, 'dict.json'), comment: '예외사전 (기획서 3.6)' },
  en: { id: 'en', file: 'dict_en.json', path: path.join(ROOT, 'dict_en.json'), comment: '영어→한국어 관용 표기 사전 (기획서 3.7)' },
  jp: { id: 'jp', file: 'dict_jp.json', path: path.join(ROOT, 'dict_jp.json'), comment: '일본어식 읽기 사전 (기획서 3.7)' },
};

// 교정 가능 토큰: 한글·자모 어절 / 라틴 단어, 각각 일본어식 마커 `*` 허용 (3.7)
const WORD_RUN = /(?:[가-힣ㄱ-ㅎㅏ-ㅣ]+|[A-Za-z][A-Za-z0-9']*)\*?/g;
// 사전 키로 쓸 수 있는 토큰 전체 형태 (WORD_RUN의 ^$ 버전)
const KEY_SHAPE = /^(?:[가-힣ㄱ-ㅎㅏ-ㅣ]+|[A-Za-z][A-Za-z0-9']*)\*?$/;

// `_` 접두 키(주석)를 뺀 실사용 사전
function activeDict(raw) {
  const d = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith('_')) d[k] = v;
  return d;
}

function loadBook(spec) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(spec.path, 'utf8'));
  } catch {
    raw = { _comment: spec.comment };
  }
  return { ...spec, raw, dict: activeDict(raw) };
}

// 3권을 한 번에 로드 — routeOf/convert 옵션 주입에 쓰는 state
function loadBooks() {
  return { main: loadBook(BOOKS.main), en: loadBook(BOOKS.en), jp: loadBook(BOOKS.jp) };
}

function saveBook(book) {
  fs.writeFileSync(book.path, JSON.stringify(book.raw, null, 2) + '\n', 'utf8');
  book.dict = activeDict(book.raw);
}

// 토큰 → 저장 대상 사전과 정규화 키 (마커 맥락 기준 라우팅 — 3.7 검토 확정)
// `*` 붙은 토큰 → dict_jp (마커/--jp일 때만 적용), 마커 없는 한글 → dict.json(무조건 치환),
// 마커 없는 라틴 → dict_en (기본 한국어식 발음)
function routeOf(token, state) {
  if (token.endsWith('*')) {
    const bare = token.slice(0, -1);
    return { book: state.jp, key: /^[A-Za-z]/.test(bare) ? bare.toLowerCase() : bare, label: '일본어식' };
  }
  if (/^[A-Za-z]/.test(token)) return { book: state.en, key: token.toLowerCase(), label: '영어' };
  return { book: state.main, key: token, label: '예외' };
}

// convert(rules.js)에 사전 3권 + 전역 jp를 주입하는 공통 옵션
function convertOpts(state, opt) {
  return { dict: state.main.dict, dictEn: state.en.dict, dictJp: state.jp.dict, jp: opt?.jp ?? false };
}

// 사전 값 검증 (audition f / 웹 교정·사전 브라우저 공용)
// 통과하면 null, 아니면 사유 문자열 (표시 문구는 호출부가 그대로 사용)
function valueError(book, value) {
  if (!value) return '값이 비어 있습니다';
  if (value.includes('ー')) {
    return '장음 ー는 엔진 파서 미지원 — 같은 모음 반복으로 쓰세요 (예: ロオマ)';
  }
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣァ-ヺ'‘’´`/ ]+$/.test(value.replace(/<[0-9.]+>/g, ''))) {
    return "허용되지 않는 문자 — 한글·가타카나·'·/·공백·<초> 형태만 가능";
  }
  if (book.id === 'jp' && /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(value)) {
    return '일본어식(*) 값은 가타카나로 적어 주세요 (한국어식 발음은 마커 없이 교정)';
  }
  return null;
}

// ── 병기 테이블용 어절 분해 (Phase 3 웹 UI /api/convert) ──────────────
// 표시 토큰: 교정 가능 토큰(WORD_RUN) + 직접 입력 가나 런(`<초>` 내포 허용, 교정 불가).
// 순서 유지·중복 유지 — 클라이언트가 spanCount 누적으로 wordSpans(하이라이트 타이밍)와 정렬한다.
const DISPLAY_RUN = /(?:[가-힣ㄱ-ㅎㅏ-ㅣ]+|[A-Za-z][A-Za-z0-9']*|[ァ-ヺ]+(?:<\d+(?:\.\d+)?>[ァ-ヺ]+)*)\*?/g;

// 어절 하나의 표시 정보. 단독 변환이므로 어절 경계 동화(밥 먹어→パム)와는 다를 수 있으나
// audition.js의 wordKana와 같은 표시 기준. spanCount = 이 토큰이 만드는 파이프라인 어절 수
// (사전 값의 '/'·공백·가나+조사 혼합값이면 1 토큰 → n 어절).
function wordInfo(token, state, opt) {
  const opts = convertOpts(state, opt);
  const conv = convert(token, opts);
  const kana = conv.sentences.map(sentencePlain).join(' ');
  const spanCount = conv.sentences.reduce((n, s) => n + s.wordSpans.length, 0);
  const isKana = /^[ァ-ヺ]/.test(token);
  if (isKana) {
    return { token, kana, ruleKana: kana, spanCount, correctable: false };
  }
  const { book, key, label } = routeOf(token, state);
  const current = book.dict[key];
  // 원본 변환(교정 팝오버 비교용): 이 토큰의 사전 항목만 뺀 규칙 엔진 결과
  let ruleKana = kana;
  if (current !== undefined) {
    const bare = { ...book.dict };
    delete bare[key];
    const bareOpts = { ...opts };
    if (book.id === 'main') bareOpts.dict = bare;
    else if (book.id === 'en') bareOpts.dictEn = bare;
    else bareOpts.dictJp = bare;
    ruleKana = convert(token, bareOpts).sentences.map(sentencePlain).join(' ');
  }
  return { token, kana, ruleKana, spanCount, correctable: true, book: book.file, bookId: book.id, key, label, current: current ?? null };
}

// 문장 → 표시 어절 목록 (숫자 전처리 후 토큰화 — audition fixFlow와 동일 기준)
function buildWords(text, state, opt) {
  return (preprocess(text).match(DISPLAY_RUN) ?? []).map((t) => wordInfo(t, state, opt));
}

module.exports = {
  BOOKS, WORD_RUN, KEY_SHAPE,
  activeDict, loadBook, loadBooks, saveBook, routeOf, convertOpts, valueError,
  buildWords, wordInfo,
};

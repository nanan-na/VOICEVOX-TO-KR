'use strict';
// 규칙엔진: 한글 → 가타카나 모라 배열 (기획서 3장)
// 처리 순서(3.8): 조사'의' → ㅎ 통합 처리(약화·탈락·격음화) → 연음/절음 → 중화 → 자음동화(유음화→비음화) → 가나 조립

const { isHangulSyllable, decompose } = require('./hangul');
const { preprocess } = require('./numbers');
const { loadDefaultDict, substitute } = require('./dict');
const { englishStage, loadEnglishDict, loadJpDict } = require('./english');

// 수동 악센트 핵 마크업 변형 (3.10)
const ACCENT_MARKS = new Set(["'", '‘', '’', '´', '`']);

// ── 3.8.1 (a) 단일 받침 중화 ──────────────────────────────
const NEUT = {
  'ㄱ': 'ㄱ', 'ㄲ': 'ㄱ', 'ㅋ': 'ㄱ',
  'ㄷ': 'ㄷ', 'ㅅ': 'ㄷ', 'ㅆ': 'ㄷ', 'ㅈ': 'ㄷ', 'ㅊ': 'ㄷ', 'ㅌ': 'ㄷ', 'ㅎ': 'ㄷ',
  'ㅂ': 'ㅂ', 'ㅍ': 'ㅂ',
  'ㄴ': 'ㄴ', 'ㄹ': 'ㄹ', 'ㅁ': 'ㅁ', 'ㅇ': 'ㅇ',
};

// ── 3.8.1 (b) 겹받침 대표음 ──────────────────────────────
const CLUSTER_REP = {
  'ㄱㅅ': 'ㄱ', 'ㄴㅈ': 'ㄴ', 'ㄴㅎ': 'ㄴ', 'ㄹㄱ': 'ㄱ', 'ㄹㅁ': 'ㅁ', 'ㄹㅂ': 'ㄹ',
  'ㄹㅅ': 'ㄹ', 'ㄹㅌ': 'ㄹ', 'ㄹㅍ': 'ㅂ', 'ㄹㅎ': 'ㄹ', 'ㅂㅅ': 'ㅂ',
};

function codaRep(coda) {
  if (coda.length === 0) return null;
  if (coda.length === 2) return CLUSTER_REP[coda.join('')] ?? NEUT[coda[1]];
  return NEUT[coda[0]];
}

// ── 3.8.1 (e) 격음화 ─────────────────────────────────────
const ASPIRATE_ONSET = { 'ㄱ': 'ㅋ', 'ㄷ': 'ㅌ', 'ㅂ': 'ㅍ', 'ㅈ': 'ㅊ' };
// 역방향: 받침 원음 기준 (ㅈ→ㅊ 꽂히다→꼬치다, ㅅㅆㅊㅌ→ㅌ 못 해→모태)
const ASPIRATE_FROM_CODA = {
  'ㄱ': 'ㅋ', 'ㄲ': 'ㅋ', 'ㅋ': 'ㅋ',
  'ㅂ': 'ㅍ', 'ㅍ': 'ㅍ',
  'ㅈ': 'ㅊ',
  'ㄷ': 'ㅌ', 'ㅅ': 'ㅌ', 'ㅆ': 'ㅌ', 'ㅊ': 'ㅌ', 'ㅌ': 'ㅌ',
};

const TENSE = new Set(['ㄲ', 'ㄸ', 'ㅃ', 'ㅆ', 'ㅉ']);

// `<초>` 모라 길이 오버라이드 (3.6 확장) — 정확히 이 형태일 때만 문법으로 해석.
// 짝 없는 `<`나 `<abc>` 같은 일반 텍스트를 스펙으로 오인해 삼키지 않도록 (3.10: 무시 문자)
const LEN_SPEC = /^<(\d+(?:\.\d+)?)>/;

// ── 문장 분리 (3.10: . ! → 문장 분리, ? → 상승 억양) ──────
// `<초>` 안의 '.'은 소수점이지 마침표가 아니므로 스펙 구간은 통째로 건너뛴다
// (parseSentence가 나중에 다시 해석).
function splitSentences(text) {
  const parts = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') {
      const m = LEN_SPEC.exec(text.slice(i));
      if (m) {
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if ('.。!！'.includes(ch)) {
      if (buf.trim()) parts.push({ text: buf, question: false });
      buf = '';
    } else if ('?？'.includes(ch)) {
      if (buf.trim()) parts.push({ text: buf, question: true });
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push({ text: buf, question: false });
  return parts;
}

// ── 토큰화: 어절(word) 배열 ──────────────────────────────
// 한글 어절: { syls: [{onset, vowel, coda, manualAccent}], raw, sepBefore }
// 가나 어절: { kana: true, moras: [...], manualKernel, jpStyle, lenOverrides, raw, syls: [], sepBefore }
//   — 예외사전 값의 가나 직접 지정(3.9③: 레퀴엠→レクイエム)이나 가나 직접 입력용.
//   음운 규칙을 우회하며, 앞뒤 어절과의 동화도 일어나지 않는다.
//   jpStyle(`*` 마커 — englishStage가 dict_jp 경유 출력에 자동 부착)이 아니면
//   한국어 발음의 일부로 보고 받침 유사 모라 길이 보정을 받는다 (kanaWordAdjs).
//   lenOverrides(3.6 확장, 2026-07-08): 모라 직후 `<초>` (예: `ブル<0.02>レッ`)로
//   그 모라의 vowel_length(초)를 직접 지정 — 사전 축적 단계에서 단어 하나만 튜닝할 때 사용.
//   자동 보정(kanaWordAdjs)보다 나중에 적용되어 항상 우선한다.
const KANA_CHAR = /[ァ-ヺ]/;      // ァ-ヺ (ー 장음은 파서 미지원 — 같은 모음 반복으로)
const KANA_SMALL = new Set([...'ァィゥェォャュョヮ']);

function parseSentence(text, warnings) {
  const words = [];
  let cur = null;      // 조립 중인 한글 어절
  let curKana = null;  // 조립 중인 가나 어절
  let pendingPause = false;
  const sep = () => (words.length === 0 ? null : (pendingPause ? '、' : '/'));
  const push = () => {
    if (cur && cur.syls.length) {
      cur.sepBefore = sep();
      words.push(cur);
      pendingPause = false;
    }
    cur = null;
    if (curKana && curKana.moras.length) {
      curKana.sepBefore = sep();
      words.push(curKana);
      pendingPause = false;
    }
    curKana = null;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') {
      const m = LEN_SPEC.exec(text.slice(i));
      if (m) {
        // `<초>` 길이 오버라이드 — 직전 가나 모라에만 유효
        if (curKana && curKana.moras.length) {
          curKana.lenOverrides[curKana.moras.length - 1] = parseFloat(m[1]);
        } else {
          warnings.add(`길이 지정 ${m[0]}는 가나 모라 바로 뒤에서만 유효 — 무시됨 (예: ブル<0.02>レッ)`);
        }
        i += m[0].length - 1;
      }
      // 스펙 형태가 아닌 '<'는 일반 무시 문자 (3.10)
      continue;
    }
    if (isHangulSyllable(ch)) {
      if (curKana) push(); // 가나↔한글 전환은 어절 경계 (레퀴엠은 → レクイエム + 은[조사 병합])
      if (!cur) cur = { syls: [], raw: '' };
      cur.syls.push({ ...decompose(ch), manualAccent: false });
      cur.raw += ch;
    } else if (KANA_CHAR.test(ch)) {
      if (cur) push();
      if (!curKana) curKana = { kana: true, moras: [], manualKernel: null, jpStyle: false, lenOverrides: {}, raw: '', syls: [] };
      if (KANA_SMALL.has(ch) && curKana.moras.length) curKana.moras[curKana.moras.length - 1] += ch;
      else curKana.moras.push(ch);
      curKana.raw += ch;
    } else if (ch === ',' || ch === '、' || ch === '，') {
      push();
      pendingPause = true;
    } else if (/\s/.test(ch) || ch === '/') {
      // '/'는 명시적 억양구 경계 — 예외사전 값의 마크업(3.9③)이 주 용도
      push();
    } else if (ACCENT_MARKS.has(ch)) {
      if (curKana && curKana.moras.length) curKana.manualKernel = curKana.moras.length;
      else if (cur && cur.syls.length) cur.syls[cur.syls.length - 1].manualAccent = true;
    } else if (ch === '*') {
      // 일본어식 마커 (3.7): 이 가나 어절은 한국어식 길이 보정 없이 엔진 기본값 그대로.
      // englishStage가 dict_jp 경유 출력에 자동으로 붙이며, 가나 직접 입력에도 쓸 수 있다.
      const w = curKana ?? (words.length && words[words.length - 1].kana ? words[words.length - 1] : null);
      if (w) w.jpStyle = true;
    } else if (ch === 'ー') {
      warnings.add('장음 ー는 엔진 파서 미지원 — 같은 모음 반복으로 쓰세요 (예: ロオマ)');
    } else if (/[ㄱ-ㅎㅏ-ㅣ]/.test(ch)) {
      warnings.add(`미등록 자모 '${ch}' 제거됨 — dict.json에 발음을 등록하세요 (예: "ㅋ": "크")`);
      push();
    } else if (/[0-9A-Za-z]/.test(ch)) {
      // 영어 스테이지(3.7)가 로마자 토큰을 모두 소진하므로 정상적으론 도달하지 않음 — 방어
      warnings.add(`잔여 로마자/숫자 '${ch}' 제거됨 — dict_en.json 등록을 검토하세요`);
    }
    // 그 외 문자(한자·이모지 등)는 무시 (3.10)
  }
  push();
  return words;
}

// ── 음절 쌍 순회 (어절 경계·pause 정보 포함) ──────────────
function* pairs(words) {
  for (let w = 0; w < words.length; w++) {
    const syls = words[w].syls;
    for (let s = 0; s < syls.length; s++) {
      const cur = syls[s];
      let next = null, boundary = false, pause = false;
      if (s + 1 < syls.length) {
        next = syls[s + 1];
      } else if (w + 1 < words.length) {
        next = words[w + 1].syls[0];
        boundary = true;
        pause = words[w + 1].sepBefore === '、';
      }
      yield { cur, next, boundary, pause };
    }
  }
}

// ── (0.5) 1음절 조사 어절의 억양구 병합 (3.9①) ──────────
// 조사 상수 목록 — 형태소 분석 없이 목록 대조만으로 결정론적 처리.
// '이/가'는 관형사·수사와 겹칠 수 있으나, 절음이 어차피 경계 너머로 발음을
// 붙이므로 병합해도 자연스러움(3.9① 설계 의도). Phase 2에서 목록 가감.
const JOSA_1SYL = new Set(['은', '는', '이', '가', '을', '를', '에', '의', '도', '만', '과', '와', '랑']);

function applyJosaMerge(words) {
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    // '、'(pause) 너머로는 병합하지 않음
    if (w.sepBefore !== '/' || !JOSA_1SYL.has(w.raw)) continue;
    w.mergeIntoPrev = true;
    // 단독 어절 '의'도 조사이므로 [에] (3.3.1 — 붙여 쓴 경우는 applyUiJosa가 처리)
    if (w.raw === '의') w.syls[0].vowel = 'ㅔ';
  }
}

// ── (1) 조사 '의' → 에 (어절 끝 '의'이면서 어두 아닐 때) ──
function applyUiJosa(words) {
  for (const word of words) {
    if (word.syls.length < 2) continue;
    const last = word.syls[word.syls.length - 1];
    if (last.onset === 'ㅇ' && last.vowel === 'ㅢ' && last.coda.length === 0) {
      last.vowel = 'ㅔ';
    }
  }
}

// ── (2) ㅎ 통합 처리: 약화·탈락·격음화 — 중화보다 먼저 ────
function applyHRules(words) {
  for (const { cur, next, boundary, pause } of pairs(words)) {
    if (!next || pause) continue;
    const codaLast = cur.coda[cur.coda.length - 1];
    // (c) ㅎ계 받침 + ㄱㄷㅂㅈ → 격음화 (경계 무관)
    if (codaLast === 'ㅎ' && ASPIRATE_ONSET[next.onset]) {
      next.onset = ASPIRATE_ONSET[next.onset];
      cur.coda.pop();
      continue;
    }
    // (b) ㅎ·ㄶ·ㅀ 받침 + 모음 → ㅎ 탈락 (어절 내부만)
    if (codaLast === 'ㅎ' && next.onset === 'ㅇ' && !boundary) {
      cur.coda.pop();
      continue;
    }
    // (c-역) 장애음 받침 + ㅎ → 격음화 (경계 무관, 받침 원음 기준)
    if (next.onset === 'ㅎ' && codaLast && ASPIRATE_FROM_CODA[codaLast]) {
      next.onset = ASPIRATE_FROM_CODA[codaLast];
      cur.coda.pop();
      continue;
    }
    // (a) 공명음 받침 뒤 초성 ㅎ 약화는 미적용 — 골든 #1(안녕하세요→ハセヨ)과 충돌,
    //     표준발음법상 수의적 규칙이므로 ㅎ 유지가 안전 (기획서 3.8 결정)
  }
}

// ── (3) 연음 / 절음 ───────────────────────────────────────
function applyLiaison(words) {
  for (const { cur, next, boundary, pause } of pairs(words)) {
    if (!next || pause || next.onset !== 'ㅇ' || cur.coda.length === 0) continue;
    if (!boundary) {
      // 연음: 원음 이동 (겹받침은 뒷자음만), 구개음화 적용
      const moved = cur.coda[cur.coda.length - 1];
      if (moved === 'ㅇ') continue;
      cur.coda.pop();
      let onset = moved;
      if (next.vowel === 'ㅣ') {
        if (onset === 'ㄷ') onset = 'ㅈ';
        else if (onset === 'ㅌ') onset = 'ㅊ';
      }
      next.onset = onset;
    } else {
      // 절음: 대표음화 후 이동 (ㅇ은 이동 안 함, 구개음화 미적용)
      const rep = codaRep(cur.coda);
      if (rep === 'ㅇ') continue;
      cur.coda = [];
      next.onset = rep;
    }
  }
}

// ── (4) 종성 중화 (겹받침 대표음 포함) ───────────────────
function applyNeutralize(words) {
  for (const word of words) {
    for (const syl of word.syls) {
      if (syl.coda.length) syl.coda = [codaRep(syl.coda)];
    }
  }
}

// ── (5) 자음동화: 유음화 → ㄹ비음화 → 비음화 (경계 너머 적용) ─
function applyAssimilation(words) {
  // 유음화 — 어절 내부만 (경계 너머는 미적용: 길 너머→キン/ノモ, 2026-07-04 청취 확정)
  for (const { cur, next, boundary, pause } of pairs(words)) {
    if (!next || pause || boundary) continue;
    if (cur.coda[0] === 'ㄹ' && next.onset === 'ㄴ') next.onset = 'ㄹ';
    else if (cur.coda[0] === 'ㄴ' && next.onset === 'ㄹ') cur.coda = ['ㄹ'];
  }
  // ㄹ의 비음화
  for (const { cur, next, pause } of pairs(words)) {
    if (!next || pause) continue;
    if (next.onset === 'ㄹ' && ['ㄱ', 'ㄷ', 'ㅂ', 'ㅁ', 'ㅇ'].includes(cur.coda[0])) {
      next.onset = 'ㄴ';
    }
  }
  // 비음화
  const NASALIZE = { 'ㄱ': 'ㅇ', 'ㄷ': 'ㄴ', 'ㅂ': 'ㅁ' };
  for (const { cur, next, pause } of pairs(words)) {
    if (!next || pause) continue;
    if (['ㄴ', 'ㅁ'].includes(next.onset) && NASALIZE[cur.coda[0]]) {
      // ㅂ→ㅁ 유래 표시: 원래 ㅁ받침(감)보다 ム를 더 짧게 (2단계 청취: 합·립 < 감)
      if (cur.coda[0] === 'ㅂ') cur.nasalCoda = true;
      cur.coda = [NASALIZE[cur.coda[0]]];
    }
  }
}

// ── (6) 가나 조립 (3.2~3.4, 3.3.2, 3.3.3) ─────────────────
// 중성 → { g: 활음(y/w), n: 핵모음(a/i/u/e/o) }
const VOWEL = {
  'ㅏ': { n: 'a' }, 'ㅐ': { n: 'e' },
  'ㅑ': { g: 'y', n: 'a' }, 'ㅒ': { g: 'y', n: 'e' },
  'ㅓ': { n: 'o' }, 'ㅔ': { n: 'e' },
  'ㅕ': { g: 'y', n: 'o' }, 'ㅖ': { g: 'y', n: 'e' },
  'ㅗ': { n: 'o' },
  'ㅘ': { g: 'w', n: 'a' }, 'ㅙ': { g: 'w', n: 'e' }, 'ㅚ': { g: 'w', n: 'e' },
  'ㅛ': { g: 'y', n: 'o' },
  'ㅜ': { n: 'u' },
  'ㅝ': { g: 'w', n: 'o' }, 'ㅞ': { g: 'w', n: 'e' }, 'ㅟ': { g: 'w', n: 'i' },
  'ㅠ': { g: 'y', n: 'u' },
  'ㅡ': { n: 'u' },
  // ㅢ는 3.3.1 별도 처리
  'ㅣ': { n: 'i' },
};

const BARE = { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ' };
const BARE_Y = { a: 'ヤ', u: 'ユ', o: 'ヨ', e: 'イェ' };
const BARE_W = { a: 'ワ', o: 'ウォ', e: 'ウェ', i: 'ウィ' };

const ROWS = {
  k: { a: 'カ', i: 'キ', u: 'ク', e: 'ケ', o: 'コ' },
  g: { a: 'ガ', i: 'ギ', u: 'グ', e: 'ゲ', o: 'ゴ' },
  // 외래음 보정(3.3.3): ㄷ·ㅌ + ㅣ/ㅜ/ㅡ → ティ·トゥ (유성은 ディ·ドゥ)
  t: { a: 'タ', i: 'ティ', u: 'トゥ', e: 'テ', o: 'ト' },
  d: { a: 'ダ', i: 'ディ', u: 'ドゥ', e: 'デ', o: 'ド' },
  p: { a: 'パ', i: 'ピ', u: 'プ', e: 'ペ', o: 'ポ' },
  b: { a: 'バ', i: 'ビ', u: 'ブ', e: 'ベ', o: 'ボ' },
  s: { a: 'サ', i: 'シ', u: 'ス', e: 'セ', o: 'ソ' },
  z: { a: 'ザ', i: 'ジ', u: 'ズ', e: 'ゼ', o: 'ゾ' },   // ㅈ 고정 (3.2)
  ch: { a: 'チャ', i: 'チ', u: 'チュ', e: 'チェ', o: 'チョ' },
  j: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ' },
  n: { a: 'ナ', i: 'ニ', u: 'ヌ', e: 'ネ', o: 'ノ' },
  m: { a: 'マ', i: 'ミ', u: 'ム', e: 'メ', o: 'モ' },
  r: { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ' },
  h: { a: 'ハ', i: 'ヒ', u: 'フ', e: 'ヘ', o: 'ホ' },
};
const SMALL_Y = { a: 'ャ', u: 'ュ', o: 'ョ', e: 'ェ' };

// w활음 유지용 작은 가나 — クァ·グァ·ファ행은 엔진 실측(0.25.2, tools/probe-moras.js)으로
// 1모라 지원 확인. ムォ·ブァ류는 복수 모라로 쪼개져 미지원 → 그 외 자음은 w 탈락 유지 (3.3.2)
const SMALL_W = { a: 'ァ', i: 'ィ', e: 'ェ', o: 'ォ' };

function onsetRow(onset, voiced) {
  switch (onset) {
    case 'ㄱ': return voiced ? ROWS.g : ROWS.k;
    case 'ㅋ': case 'ㄲ': return ROWS.k;
    case 'ㄷ': return voiced ? ROWS.d : ROWS.t;
    case 'ㅌ': case 'ㄸ': return ROWS.t;
    case 'ㅂ': return voiced ? ROWS.b : ROWS.p;
    case 'ㅍ': case 'ㅃ': return ROWS.p;
    case 'ㅅ': case 'ㅆ': return ROWS.s;
    // ㅈ 위치 분기 (2026-07-04 청취 확정): 어두 チャ행 / 유성 환경 ジャ행 — ㄱㄷㅂ과 같은 구조
    case 'ㅈ': return voiced ? ROWS.j : ROWS.ch;
    case 'ㅊ': case 'ㅉ': return ROWS.ch;
    case 'ㄴ': return ROWS.n;
    case 'ㅁ': return ROWS.m;
    case 'ㄹ': return ROWS.r;
    case 'ㅎ': return ROWS.h;
    default: return null;
  }
}

// 어두 경음 → 유성행 (청취 확정: 깜=ガ, 딸=ダ — 무기음성이 경음의 긴장감에 더 가까움)
// ㅉ은 ジャ가 '자다'처럼 들려 ザ행으로 (2단계 청취 확정: 짜다=ザ'ダ)
const TENSE_HEAD_ROW = { 'ㄲ': 'g', 'ㄸ': 'd', 'ㅃ': 'b', 'ㅆ': 's', 'ㅉ': 'z' };
// 억양구 첫 자음이 격음·경음이면 핵을 1번째 모라로 (K-ToBI H-초성 근사 — 3.9②)
const HEAD_KERNEL_ONSETS = new Set(['ㅋ', 'ㅌ', 'ㅍ', 'ㅊ', 'ㄲ', 'ㄸ', 'ㅃ', 'ㅆ', 'ㅉ']);

// 음절 하나 → { moras, adjs: [{offset, type}], prevAfter }
// prev: 'none'(어두/、직후) | 'vowel' | 'sonorant' | 'obstruent'
// adjs type: 'tense'(자음 길이 확대) | 'ru'/'mu'(받침 모음 짧게) | 'nLong'/'nShort'(ン 길이차)
//            | 'ye'(자음+ㅖ의 ェ 모음 연장)
function syllableToMoras(syl, prev, nextOnset, isWordInitialSyl) {
  const moras = [];
  const adjs = [];
  let yeAdj = false;
  const isUi = syl.vowel === 'ㅢ';
  const vinfo = isUi ? null : VOWEL[syl.vowel];
  let body;

  if (syl.onset === 'ㅇ') {
    if (isUi) body = isWordInitialSyl ? 'ウィ' : 'イ'; // 3.3.1
    else if (vinfo.g === 'y') body = BARE_Y[vinfo.n];
    else if (vinfo.g === 'w') body = BARE_W[vinfo.n];
    else body = BARE[vinfo.n];
  } else {
    // 유성음화 판정 (3.2): 직전이 모음·비음·유음이면 유성
    const voiced = prev === 'vowel' || prev === 'sonorant';
    let tenseHead = false;
    // 경음 처리 (3.2.1)
    if (TENSE.has(syl.onset)) {
      if (prev === 'vowel') moras.push('ッ');
      else if (prev === 'none' || prev === 'sonorant') {
        adjs.push({ offset: moras.length, type: 'tense' });
        if (prev === 'none') tenseHead = true; // 어두 경음 → 유성행
      }
      // 장애음(ッ) 뒤는 촉음이 이미 있으므로 추가 없음
    }
    const nucleus = isUi ? 'i' : vinfo.n;   // 자음+ㅢ → ㅣ (3.3.1)
    const glide = isUi ? null : (vinfo.g ?? null);
    let row = onsetRow(syl.onset, voiced);
    if (tenseHead) row = ROWS[TENSE_HEAD_ROW[syl.onset]];
    if (glide === 'y') {
      // 자음+y활음 (3.3.2): い단 + 작은 가나 (キェ류 포함 — 엔진 0.25.2 실측 지원 확인)
      if (row === ROWS.t || row === ROWS.d) {
        if (nucleus === 'u') {
          body = (row === ROWS.d ? 'デ' : 'テ') + 'ュ'; // 튜→テュ, 듀→デュ (실측 지원)
        } else {
          row = row === ROWS.d ? ROWS.j : ROWS.ch;     // 뎌→져 구개화와 일치
          body = row[nucleus];
        }
      } else if (row === ROWS.ch || row === ROWS.j) {
        body = row[nucleus];
      } else if (nucleus === 'e') {
        body = row.i + 'ェ';   // 계→キェ/ギェ, 혜→ヒェ (실측 지원 확인)
        yeAdj = true;          // ェ가 짧게 들려 모음 연장 (2026-07-07 청취 — 관계)
      } else {
        body = row.i + SMALL_Y[nucleus];
      }
    } else if (glide === 'w') {
      // 자음+w활음 (3.3.2 개정): 1모라 지원이 실측 확인된 조합만 활음 유지
      if (row === ROWS.k || row === ROWS.g) {
        body = (row === ROWS.g ? 'グ' : 'ク') + SMALL_W[nucleus]; // 과→クァ, 귀→クィ
      } else if (row === ROWS.h) {
        body = 'フ' + SMALL_W[nucleus];                            // 화→ファ, 회→フェ
      } else {
        body = row[nucleus];   // 그 외는 활음 탈락 (뭐→モ — ムォ는 2모라로 분해됨)
      }
    } else {
      body = row[nucleus];
    }
  }
  moras.push(body);
  if (yeAdj) adjs.push({ offset: moras.length - 1, type: 'ye' });

  // 종성 (3.4 — 2026-07-04 청취 확정: ㄹ→ル(모음 짧게), ㅁ→ム(모음 짧게), ㄴ/ㅇ은 ン 길이차)
  let prevAfter = 'vowel';
  if (syl.coda.length) {
    const c = syl.coda[0];
    if (c === 'ㄱ' || c === 'ㄷ' || c === 'ㅂ') {
      moras.push('ッ');
      prevAfter = 'obstruent';
    } else if (c === 'ㄹ') {
      // 기본 ル (U를 0.032로 축소 — 사용자 실측). 어절 경계 ㄴ 앞에서만 ン (길 너머→キンノモ)
      if (nextOnset === 'ㄴ') {
        adjs.push({ offset: moras.length, type: 'nLong' });
        moras.push('ン');
      } else {
        adjs.push({ offset: moras.length, type: 'ru' });
        moras.push('ル');
      }
      prevAfter = 'sonorant';
    } else if (c === 'ㅁ') {
      adjs.push({ offset: moras.length, type: syl.nasalCoda ? 'muShort' : 'mu' });
      moras.push('ム');
      prevAfter = 'sonorant';
    } else {
      // ㄴ→ン 길게, ㅇ→ン 짧게 (엔진 기본값 대비 배율)
      adjs.push({ offset: moras.length, type: c === 'ㄴ' ? 'nLong' : 'nShort' });
      moras.push('ン');
      prevAfter = 'sonorant';
    }
  }
  return { moras, adjs, prevAfter };
}

// ── 한국어 맥락 가나 어절의 받침 유사 모라 길이 보정 (3.6 확장) ──
// 사전 가나 값(블랙→ブルレッ)·직접 입력 가나도 한국어 발음의 일부이므로 규칙엔진과
// 같은 길이 보정을 받는다 (2026-07-08 청취: 보정 없인 ル가 엔진 기본 길이로 길게 들림).
// ル·ム가 어절 끝이나 모음으로 시작하지 않는 모라 앞에 오면 받침으로 간주.
// ン은 ㄴ(×1.35)/ㅇ(×0.8)을 가나만으로 구별할 수 없어 엔진 기본값 유지.
// 일본어식(`*` 마커 — dict_jp 경유 출력에 자동 부착)은 jpStyle이라 이 보정을 건너뜀.
const KANA_VOWEL_HEAD = new Set([...'アイウエオヤユヨワヲ']);
const KANA_YE_HEAD = new Set([...'キギシヒニミリピビ']); // syllableToMoras의 row.i+ェ 조합과 일치

function kanaWordAdjs(moras) {
  const adjs = [];
  for (let i = 0; i < moras.length; i++) {
    const m = moras[i];
    const next = i + 1 < moras.length ? moras[i + 1] : null;
    const codaLike = i > 0 && (next === null || !KANA_VOWEL_HEAD.has(next[0]));
    if (m === 'ル' && codaLike) adjs.push({ offset: i, type: 'ru' });
    else if (m === 'ム' && codaLike) adjs.push({ offset: i, type: 'mu' });
    else if (m.length === 2 && m[1] === 'ェ' && KANA_YE_HEAD.has(m[0])) adjs.push({ offset: i, type: 'ye' });
  }
  return adjs;
}

function assemble(words) {
  // 병합(3.9①) 반영: mergeIntoPrev 어절은 새 억양구를 만들지 않고 앞 구에 합류
  const phrases = [];
  const phraseOf = []; // word idx → phrase idx
  for (const w of words) {
    if (w.mergeIntoPrev && phrases.length > 0) {
      phraseOf.push(phrases.length - 1);
    } else {
      phrases.push({ sepBefore: w.sepBefore, moras: [], manualKernel: null, headKernel: false });
      phraseOf.push(phrases.length - 1);
    }
  }
  const adjustments = [];
  // 어절별 전역 모라 스팬 [start, end) — 웹 UI의 재생 중 어절 하이라이트용 (Phase 3).
  // adjustments와 같은 전역 모라 인덱스 공간(pause_mora 제외)을 쓴다.
  const wordSpans = words.map((w) => ({ text: w.raw, start: 0, end: 0 }));
  // 문장 내 음절 평탄화 (nextOnset 룩어헤드용 — pause 너머는 차단)
  const flat = [];
  words.forEach((w, wi) => {
    if (w.kana) {
      flat.push({ kind: 'kana', word: w, wi, pauseBefore: w.sepBefore === '、' });
      return;
    }
    w.syls.forEach((syl, si) => {
      flat.push({ kind: 'syl', syl, wi, first: si === 0, pauseBefore: si === 0 && w.sepBefore === '、' });
    });
  });
  let prev = 'none';
  let globalMora = 0;
  for (let i = 0; i < flat.length; i++) {
    const entry = flat[i];
    if (entry.pauseBefore) prev = 'none'; // 、 직후는 어두 취급 (3.2)
    if (entry.kind === 'kana') {
      // 가나 어절: 모라를 그대로 억양구에 투입 (음운 규칙 없음).
      // 한국어 맥락(마커 없음)이면 받침 유사 모라 길이 보정만 추가 (kanaWordAdjs)
      const phrase = phrases[phraseOf[entry.wi]];
      if (entry.word.manualKernel != null) {
        phrase.manualKernel = phrase.moras.length + entry.word.manualKernel;
      }
      if (!entry.word.jpStyle) {
        for (const a of kanaWordAdjs(entry.word.moras)) {
          adjustments.push({ index: globalMora + a.offset, type: a.type });
        }
      }
      // 수동 길이 오버라이드(`<초>`)는 자동 보정 뒤에 적용 — 항상 우선
      for (const [offsetStr, seconds] of Object.entries(entry.word.lenOverrides)) {
        adjustments.push({ index: globalMora + Number(offsetStr), type: 'customLen', value: seconds });
      }
      wordSpans[entry.wi].start = globalMora;
      phrase.moras.push(...entry.word.moras);
      globalMora += entry.word.moras.length;
      wordSpans[entry.wi].end = globalMora;
      const last = entry.word.moras[entry.word.moras.length - 1];
      prev = last === 'ン' ? 'sonorant' : last === 'ッ' ? 'obstruent' : 'vowel';
      continue;
    }
    const { syl, wi, first } = entry;
    const nextEntry = i + 1 < flat.length && !flat[i + 1].pauseBefore ? flat[i + 1] : null;
    const nextOnset = nextEntry && nextEntry.kind === 'syl' ? nextEntry.syl.onset : null;
    const r = syllableToMoras(syl, prev, nextOnset, first);
    const phrase = phrases[phraseOf[wi]];
    // 억양구 첫 자음이 격음·경음이면 핵을 1번째 모라로 (3.9② 확장 — 청취 확정)
    if (phrase.moras.length === 0 && HEAD_KERNEL_ONSETS.has(syl.onset)) phrase.headKernel = true;
    for (const a of r.adjs) adjustments.push({ index: globalMora + a.offset, type: a.type });
    if (first) wordSpans[wi].start = globalMora;
    phrase.moras.push(...r.moras);
    globalMora += r.moras.length;
    wordSpans[wi].end = globalMora;
    if (syl.manualAccent) phrase.manualKernel = phrase.moras.length; // 그 음절 마지막 모라 뒤
    prev = r.prevAfter;
  }
  return { phrases, adjustments, wordSpans };
}

// ── 엔트리 ────────────────────────────────────────────────
// convert(text, options?) → { sentences: [{ question, phrases, boosts }], warnings, dictHits, enHits }
// options.dict/dictEn/dictJp: 사전 주입 (기본은 각 json 파일 — 테스트·향후 UI용)
// options.jp: 전역 일본어식 토글 (3.7 — 한글은 dict_jp 조회, 라틴은 가타카나 렌더)
function convert(text, options = {}) {
  const warnings = new Set();
  const sentences = [];
  let dict = options.dict;
  if (dict === undefined) {
    const loaded = loadDefaultDict();
    dict = loaded.dict;
    if (loaded.warning) warnings.add(loaded.warning);
  }
  let dictEn = options.dictEn;
  if (dictEn === undefined) {
    const loaded = loadEnglishDict();
    dictEn = loaded.dict;
    if (loaded.warning) warnings.add(loaded.warning);
  }
  let dictJp = options.dictJp;
  if (dictJp === undefined) {
    const loaded = loadJpDict();
    dictJp = loaded.dict;
    if (loaded.warning) warnings.add(loaded.warning);
  }
  // (0) 숫자 전처리 (7장) → (0.5) 영어/일본어식 (3.7) → (1) 예외사전 치환 (3.6) → 문장 분리
  // 순서 중요: "16년"→(숫자)→"십육년"→(사전)→"심뉵년". 소수점 '.'은 숫자 단계에서 소진됨
  const dictHits = [];
  const enHits = [];
  const romajiDone = englishStage(preprocess(text),
    { dictEn, dictJp, jp: !!options.jp, warnings, hits: enHits });
  const prepared = substitute(romajiDone, dict, dictHits);
  for (const sen of splitSentences(prepared)) {
    const words = parseSentence(sen.text, warnings);
    if (words.length === 0) continue;
    applyJosaMerge(words);
    applyUiJosa(words);
    applyHRules(words);
    applyLiaison(words);
    applyNeutralize(words);
    applyAssimilation(words);
    const { phrases, adjustments, wordSpans } = assemble(words);
    sentences.push({ question: sen.question, phrases, adjustments, wordSpans });
  }
  return { sentences, warnings: [...warnings], dictHits, enHits };
}

module.exports = { convert, splitSentences };

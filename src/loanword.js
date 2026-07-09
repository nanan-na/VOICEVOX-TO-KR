'use strict';
// ARPABET 음소열 → 한글(외래어 표기법) / 가타카나(일본어 관용) 렌더러 (기획서 3.7)
// - 한글: 국립국어원 외래어 표기법 제3장 제1절(영어) 세칙 이식 — 기본(한국어식) 발음
// - 가타카나: 일본어 외래어 관용 규칙 근사 — 마커 `*`/--jp 전용.
//   장음 ー는 엔진 파서 미지원(3.6 실측) → 같은 모음 반복으로 출력 (ミイティング)
// - CMUdict(cmudict.json) 값을 입력으로 받는 순수 함수. 강세 숫자는 버림

const { CHO, JUNG, JONG } = require('./hangul');

// ── ARPABET 모음 (15개) ──────────────────────────────────
// v: 한글 모음 자모열(이중모음은 2블록), short: 짧은 모음 여부(무성 파열음 받침 판정 — 표기법 제1항)
// k: 가타카나 모음열 (장모음·이중모음은 2문자 — ー 대신 반복)
const VOWELS = {
  AA: { v: ['ㅏ'], short: true, k: 'ア' },        // hot→핫
  AE: { v: ['ㅐ'], short: true, k: 'ア' },        // cat→캣
  AH: { v: ['ㅓ'], short: true, k: 'ア' },        // 슈와 포함 → 어
  AO: { v: ['ㅗ'], short: false, k: 'オオ' },     // caught→코트 ([ɔː] 장모음 취급)
  AW: { v: ['ㅏ', 'ㅜ'], short: false, k: 'アウ' }, // scout→스카우트
  AY: { v: ['ㅏ', 'ㅣ'], short: false, k: 'アイ' }, // strike→스트라이크
  EH: { v: ['ㅔ'], short: true, k: 'エ' },        // internet→인터넷
  ER: { v: ['ㅓ'], short: false, k: 'アア' },      // r-색채 모음 = 장모음 취급 (part→파트)
  EY: { v: ['ㅔ', 'ㅣ'], short: false, k: 'エイ' }, // cake→케이크
  IH: { v: ['ㅣ'], short: true, k: 'イ' },        // milk→밀크
  IY: { v: ['ㅣ'], short: false, k: 'イイ' },      // meeting→미팅
  OW: { v: ['ㅗ'], short: false, k: 'オオ' },      // boat→보트 ([ou]→오)
  OY: { v: ['ㅗ', 'ㅣ'], short: false, k: 'オイ' }, // boy→보이
  UH: { v: ['ㅜ'], short: true, k: 'ウ' },        // book→북
  UW: { v: ['ㅜ'], short: false, k: 'ウウ' },      // school→스쿨
};

// ── ARPABET 자음 (24개) ──────────────────────────────────
// onset: 한글 초성, coda: 받침(가능한 것만), su: '으' 대신 쓸 삽입 모음 (치/지)
// type: pstop=무성 파열음, bstop=유성 파열음, fric=마찰음, aff=파찰음, nasal=비음, liq=유음
// kRow: 가타카나 행(ア이ウエオ단 5칸), kSolo: 모음 없이 홀로 설 때
const CONS = {
  P: { onset: 'ㅍ', coda: 'ㅂ', type: 'pstop', kRow: ['パ', 'ピ', 'プ', 'ペ', 'ポ'], kSolo: 'プ' },
  T: { onset: 'ㅌ', coda: 'ㅅ', type: 'pstop', kRow: ['タ', 'ティ', 'トゥ', 'テ', 'ト'], kSolo: 'ト' },
  K: { onset: 'ㅋ', coda: 'ㄱ', type: 'pstop', kRow: ['カ', 'キ', 'ク', 'ケ', 'コ'], kSolo: 'ク' },
  B: { onset: 'ㅂ', type: 'bstop', kRow: ['バ', 'ビ', 'ブ', 'ベ', 'ボ'], kSolo: 'ブ' },
  D: { onset: 'ㄷ', type: 'bstop', kRow: ['ダ', 'ディ', 'ドゥ', 'デ', 'ド'], kSolo: 'ド' },
  G: { onset: 'ㄱ', type: 'bstop', kRow: ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ'], kSolo: 'グ' },
  CH: { onset: 'ㅊ', su: 'ㅣ', type: 'aff', kRow: ['チャ', 'チ', 'チュ', 'チェ', 'チョ'], kSolo: 'チ' },
  JH: { onset: 'ㅈ', su: 'ㅣ', type: 'aff', kRow: ['ジャ', 'ジ', 'ジュ', 'ジェ', 'ジョ'], kSolo: 'ジ' },
  ZH: { onset: 'ㅈ', su: 'ㅣ', type: 'aff', kRow: ['ジャ', 'ジ', 'ジュ', 'ジェ', 'ジョ'], kSolo: 'ジュ' },
  F: { onset: 'ㅍ', type: 'fric', kRow: ['ファ', 'フィ', 'フ', 'フェ', 'フォ'], kSolo: 'フ' },
  V: { onset: 'ㅂ', type: 'fric', kRow: ['バ', 'ビ', 'ブ', 'ベ', 'ボ'], kSolo: 'ブ' },
  TH: { onset: 'ㅅ', type: 'fric', kRow: ['サ', 'シ', 'ス', 'セ', 'ソ'], kSolo: 'ス' },  // thrill→스릴
  DH: { onset: 'ㄷ', type: 'fric', kRow: ['ザ', 'ジ', 'ズ', 'ゼ', 'ゾ'], kSolo: 'ズ' },
  S: { onset: 'ㅅ', type: 'fric', kRow: ['サ', 'シ', 'ス', 'セ', 'ソ'], kSolo: 'ス' },
  Z: { onset: 'ㅈ', type: 'fric', kRow: ['ザ', 'ジ', 'ズ', 'ゼ', 'ゾ'], kSolo: 'ズ' },
  SH: { onset: 'ㅅ', type: 'sh', kRow: ['シャ', 'シ', 'シュ', 'シェ', 'ショ'], kSolo: 'シュ' }, // 모음앞 샤/셔…, 어말 시, 자음앞 슈
  HH: { onset: 'ㅎ', type: 'fric', kRow: ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'], kSolo: '' }, // 음절말 [h] 없음
  M: { onset: 'ㅁ', coda: 'ㅁ', type: 'nasal', kRow: ['マ', 'ミ', 'ム', 'メ', 'モ'], kSolo: 'ム' },
  N: { onset: 'ㄴ', coda: 'ㄴ', type: 'nasal', kRow: ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'], kSolo: 'ン' },
  NG: { coda: 'ㅇ', type: 'nasal', kSolo: 'ング' }, // 온셋 불가 (singer→싱어)
  L: { onset: 'ㄹ', coda: 'ㄹ', type: 'liq', kRow: ['ラ', 'リ', 'ル', 'レ', 'ロ'], kSolo: 'ル' },
  R: { onset: 'ㄹ', type: 'r', kRow: ['ラ', 'リ', 'ル', 'レ', 'ロ'], kSolo: '' }, // 모음 앞이 아니면 탈락 (car→카)
};

// [w]/[j] 활음 + 모음 결합 (표기법 제3항·제4항)
const W_COMB = { 'ㅏ': 'ㅘ', 'ㅐ': 'ㅙ', 'ㅓ': 'ㅝ', 'ㅔ': 'ㅞ', 'ㅣ': 'ㅟ', 'ㅗ': 'ㅝ', 'ㅜ': 'ㅜ' };
const Y_COMB = { 'ㅏ': 'ㅑ', 'ㅐ': 'ㅒ', 'ㅓ': 'ㅕ', 'ㅔ': 'ㅖ', 'ㅗ': 'ㅛ', 'ㅜ': 'ㅠ', 'ㅣ': 'ㅣ' };
// 자음+[w]가 한 음절로 붙는 초성 (표기법 제3항: [gw][hw][kw]만 — 그 외는 두 음절: twist→트위스트)
const W_ONE_SYL = new Set(['ㄱ', 'ㅋ', 'ㅎ']);

// ── 한글 조립 (decompose의 역산) ─────────────────────────
const CHO_I = new Map(CHO.map((c, i) => [c, i]));
const JUNG_I = new Map(JUNG.map((c, i) => [c, i]));
const JONG_I = new Map(JONG.map((c, i) => [c, i]));
function composeBlock({ o, v, c }) {
  return String.fromCodePoint(0xAC00 + CHO_I.get(o) * 588 + JUNG_I.get(v) * 28 + JONG_I.get(c || ''));
}

// ── 공통: 음소열 → 단위열 (활음은 뒤 모음에 병합) ─────────
// [{ type:'v', ph, glide? } | { type:'c', ph }]
function parseUnits(phones) {
  const toks = phones.trim().split(/\s+/).map((p) => p.replace(/[0-9]/g, ''));
  const units = [];
  for (let i = 0; i < toks.length; i++) {
    const p = toks[i];
    if (VOWELS[p]) units.push({ type: 'v', ph: p });
    else if ((p === 'W' || p === 'Y') && VOWELS[toks[i + 1]]) {
      units.push({ type: 'v', ph: toks[++i], glide: p });
    } else if (p === 'W') units.push({ type: 'v', ph: 'UW' }); // 모음 없는 활음(희귀) → 우/이
    else if (p === 'Y') units.push({ type: 'v', ph: 'IY' });
    else if (CONS[p]) units.push({ type: 'c', ph: p });
    // 미지 토큰은 무시 (0.7b의 39음소 밖 — 방어)
  }
  return units;
}

// ── 한글 렌더 (외래어 표기법) ─────────────────────────────
function arpabetToKorean(phones) {
  const units = parseUnits(phones);
  const blocks = []; // { o, v, c, short } — short는 "진짜 짧은 모음"만 (삽입 '으'는 false)
  let pending = null; // 다음 모음의 온셋 후보 자음
  const last = () => (blocks.length ? blocks[blocks.length - 1] : null);

  // 온셋이 못 된 자음의 처리: 받침 가능하면 받침, 아니면 '으'(치·지는 '이') 삽입
  // nextPh: 뒤따르는 자음(끝이면 null) — 무성 파열음 받침 판정에 사용 (표기법 제1항)
  const settle = (ph, nextPh) => {
    const c = CONS[ph];
    const lb = last();
    if (ph === 'R' || ph === 'HH') return; // 모음 앞이 아니면 탈락
    if (ph === 'NG') { if (lb && !lb.c) lb.c = 'ㅇ'; return; }
    if (ph === 'SH') { blocks.push({ o: 'ㅅ', v: nextPh ? 'ㅠ' : 'ㅣ', c: '', short: false }); return; } // 슈/시
    if (c.type === 'nasal' || c.type === 'liq') {
      if (lb && !lb.c) { lb.c = c.coda; return; }
    } else if (c.type === 'pstop') {
      // 짧은 모음 뒤 + (어말 또는 유음·비음·활음 이외의 자음 앞) → 받침 (cat→캣, act→액트 / network→네트워크)
      const blocked = nextPh && ['liq', 'nasal', 'r', 'glide'].includes(CONS[nextPh]?.type ?? 'glide');
      if (lb && !lb.c && lb.short && !blocked) { lb.c = c.coda; return; }
    }
    blocks.push({ o: c.onset, v: c.su ?? 'ㅡ', c: '', short: false });
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.type === 'c') {
      if (pending) { settle(pending, u.ph); pending = null; }
      const next = units[i + 1];
      if (u.ph === 'NG') settle('NG', next?.type === 'c' ? next.ph : null);
      else if (next?.type === 'v') pending = u.ph;
      else settle(u.ph, next ? next.ph : null);
      continue;
    }
    // 모음 단위 — 활음 결합, 온셋 결정
    const vu = VOWELS[u.ph];
    const vjamo = [...vu.v];
    if (u.glide === 'W') {
      if (pending && !W_ONE_SYL.has(CONS[pending].onset)) { settle(pending, 'W'); pending = null; } // 트위스트
      vjamo[0] = W_COMB[vjamo[0]] ?? vjamo[0];
    } else if (u.glide === 'Y') {
      vjamo[0] = Y_COMB[vjamo[0]] ?? vjamo[0];
    }
    let onset = 'ㅇ';
    if (pending) {
      onset = CONS[pending].onset;
      if (pending === 'SH') vjamo[0] = Y_COMB[vjamo[0]] ?? vjamo[0]; // 샤·셔·쇼 (fashion→패션)
      if (pending === 'L') { const lb = last(); if (lb && !lb.c) lb.c = 'ㄹ'; } // 어중 [l]→ㄹㄹ (hello→헬로)
      pending = null;
    }
    blocks.push({ o: onset, v: vjamo[0], c: '', short: vu.short && vjamo.length === 1 });
    for (let k = 1; k < vjamo.length; k++) blocks.push({ o: 'ㅇ', v: vjamo[k], c: '', short: false });
    if (u.ph === 'ER' && units[i + 1]?.type === 'v') pending = 'R'; // 모음 앞 r-색채 → ㄹ 온셋 (battery→배터리)
  }
  if (pending) settle(pending, null);
  return blocks.map(composeBlock).join('');
}

// ── 가타카나 렌더 (일본어 외래어 관용 근사) ────────────────
const K_COL = { 'ア': 0, 'イ': 1, 'ウ': 2, 'エ': 3, 'オ': 4 };
const K_SMALL = { 'ア': 'ャ', 'ウ': 'ュ', 'オ': 'ョ', 'エ': 'ェ' }; // 자음+[j]+모음 (ピュ 등)
const K_W = { 'ア': 'ワ', 'イ': 'ウィ', 'ウ': 'ウ', 'エ': 'ウェ', 'オ': 'ウォ' };
const K_Y = { 'ア': 'ヤ', 'イ': 'イ', 'ウ': 'ユ', 'エ': 'イェ', 'オ': 'ヨ' };
// 짧은 모음 + 어말 파열음·파찰음·[ʃ][f] → 촉음 ッ (cap→キャップ, catch→キャッチ)
const K_SOKUON = new Set(['P', 'T', 'K', 'B', 'D', 'G', 'CH', 'JH', 'SH', 'F']);

function arpabetToKatakana(phones) {
  const units = parseUnits(phones);
  const out = [];
  let pending = null;
  let afterShortVowel = false; // 직전 출력이 짧은 모음으로 끝났는지 (촉음은 모음 직후만)

  const solo = (ph) => { const s = CONS[ph].kSolo; if (s) out.push(s); };
  const settle = (ph, atEnd) => {
    if (ph === 'M' && !atEnd) { out.push('ン'); afterShortVowel = false; return; } // 어중 m+자음 → ン
    if (atEnd && afterShortVowel && K_SOKUON.has(ph) && out.length) out.push('ッ'); // cap→キャップ
    solo(ph);
    afterShortVowel = false;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.type === 'c') {
      if (pending) { settle(pending, false); pending = null; }
      const next = units[i + 1];
      if (u.ph !== 'NG' && next?.type === 'v') pending = u.ph;
      else if (u.ph === 'NG' && next?.type === 'v') { out.push('ン'); pending = 'G'; afterShortVowel = false; } // singer→シンガ
      else settle(u.ph, !next);
      continue;
    }
    const kv = VOWELS[u.ph].k;
    if (u.glide === 'W' && pending) { settle(pending, false); pending = null; } // 자음+w → 두 음절 (トウィスト)
    let kana = '';
    if (pending) {
      const row = CONS[pending].kRow;
      if (u.glide === 'Y' && K_COL[kv[0]] !== 1) kana = row[1] + (K_SMALL[kv[0]] ?? kv[0]); // ピュ·キャ
      else kana = row[K_COL[kv[0]]];
      pending = null;
    } else if (u.glide === 'W') kana = K_W[kv[0]];
    else if (u.glide === 'Y') kana = K_Y[kv[0]];
    else kana = kv[0];
    out.push(kana + kv.slice(1));
    afterShortVowel = VOWELS[u.ph].short;
    if (u.ph === 'ER' && units[i + 1]?.type === 'v') pending = 'R'; // 모음 앞 r-색채 → ラ행 (バタアリイ)
  }
  if (pending) settle(pending, true);
  return out.join('');
}

module.exports = { arpabetToKorean, arpabetToKatakana };

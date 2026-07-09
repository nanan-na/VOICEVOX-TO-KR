'use strict';
// 숫자 읽기 전처리 (기획서 7장): 아라비아 숫자 → 한글 수사
// 규칙엔진(3.1)의 (0)단계 — 문장 분리보다 먼저 실행해야 소수점 '.'이 문장 분리로 오인되지 않음.
// 단위 분류는 units.json (사람이 읽고 편집 가능, 9.6)

const UNITS = require('../units.json');

const SINO = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const DIGIT = ['공', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']; // 자릿수 읽기 (0=공)
const NATIVE_ONES = { 1: '한', 2: '두', 3: '세', 4: '네', 5: '다섯', 6: '여섯', 7: '일곱', 8: '여덟', 9: '아홉' };
const NATIVE_TENS = { 10: '열', 20: '스물', 30: '서른', 40: '마흔', 50: '쉰', 60: '예순', 70: '일흔', 80: '여든', 90: '아흔' };
const GROUP_UNITS = ['', '만', '억', '조'];

// 최장일치용: 긴 단위 우선 (개월>개, 시간>시, 번째>번)
const ALL_UNITS = [...new Set([...UNITS.native, ...UNITS.sino])].sort((a, b) => b.length - a.length);
const NATIVE_SET = new Set(UNITS.native);
const SYMBOLS = Object.entries(UNITS.symbols).sort((a, b) => b[0].length - a[0].length);

// 자릿수 읽기: 010 → 공일공
function digitRead(numStr) {
  return [...numStr].map((d) => DIGIT[Number(d)]).join('');
}

// 한자어 4자리 그룹(1~9999): 일 생략 규칙(십백천 앞)
function readGroup(v) {
  let out = '';
  const th = Math.floor(v / 1000);
  const hu = Math.floor((v % 1000) / 100);
  const te = Math.floor((v % 100) / 10);
  const on = v % 10;
  if (th) out += (th === 1 ? '' : SINO[th]) + '천';
  if (hu) out += (hu === 1 ? '' : SINO[hu]) + '백';
  if (te) out += (te === 1 ? '' : SINO[te]) + '십';
  if (on) out += SINO[on];
  return out;
}

// 한자어 읽기 — 문자열 기반, 조(10^15)까지. 그 이상은 자릿수 읽기 폴백
function sinoRead(numStr) {
  const s = numStr.replace(/^0+(?=\d)/, '');
  if (s === '0') return '영';
  if (s.length > 16) return digitRead(s);
  const groups = [];
  for (let end = s.length; end > 0; end -= 4) groups.unshift(s.slice(Math.max(0, end - 4), end));
  const parts = [];
  groups.forEach((g, i) => {
    const v = Number(g);
    if (v === 0) return;
    const unit = GROUP_UNITS[groups.length - 1 - i];
    // 만은 일 생략(만원), 억·조는 일 유지(일억)
    const body = unit === '만' && v === 1 ? '' : readGroup(v);
    parts.push(body + unit);
  });
  return parts.join('');
}

// 고유어 관형형 1~99: 한 두 세 … 스무(딱 20) 스물한(21)
function nativeRead(n) {
  if (n === 20) return '스무';
  const tens = n >= 10 ? NATIVE_TENS[Math.floor(n / 10) * 10] : '';
  const ones = n % 10 ? NATIVE_ONES[n % 10] : '';
  return tens + ones;
}

// 본 전처리: 텍스트의 숫자를 전부 한글 수사로 치환 (단위 문자는 건드리지 않음)
function preprocess(text) {
  // (0) 가나 값의 `<초>` 길이 오버라이드(3.6 확장)는 사전 값이 아닌 원문에도 그대로
  //     쓸 수 있어야 하는데, 그 안의 숫자(0.02 등)가 아래 소수/정수 규칙에 먼저
  //     걸리면 깨진다. 임시로 사유 영역(PUA) 문자로 치환해두고 맨 끝에 복원한다.
  //     정확히 `<숫자>` 형태만 — 일반 텍스트의 `<`를 오인하지 않도록 (rules.js LEN_SPEC과 동일 문법)
  const lenSpecs = [];
  let t = text.replace(/<\d+(?:\.\d+)?>/g, (m) => {
    lenSpecs.push(m);
    return String.fromCodePoint(0xE000 + lenSpecs.length - 1);
  });

  // (1) 자릿수 구분 쉼표 제거: 1,234,567 → 1234567 (쉼표는 pause 기호라 오인 방지)
  t = t.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');

  // (2) 기호 단위 풀기 (숫자 뒤에 붙은 경우만, 뒤에 로마자가 이어지면 제외): 3kg → 3킬로그램
  for (const [sym, rep] of SYMBOLS) {
    const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(?<=\\d\\s?)${esc}(?![A-Za-z])`, 'g'), rep);
  }

  // (3) 전화번호류: 하이픈 숫자열 → 자릿수 읽기, 그룹 사이는 어절 경계(공백)
  t = t.replace(/\d+(?:-\d+)+/g, (m) => m.split('-').map(digitRead).join(' '));

  // (4) 소수: 3.5 → 삼점오 (소수부는 자릿수 읽기)
  t = t.replace(/(\d+)\.(\d+)/g, (_, int, frac) => sinoRead(int) + '점' + digitRead(frac));

  // (5) 정수: 뒤 단위를 보고 고유어/한자어 판정 (단위 자체는 원문 그대로 둠)
  t = t.replace(/\d+/g, (num, offset, str) => {
    const prev = offset > 0 ? str[offset - 1] : '';
    const rest = str.slice(offset + num.length);
    // 로마자 인접(mp3, Windows11)은 영어 처리(3.7)의 몫 — 건드리지 않음
    if (/[A-Za-z]/.test(prev) || /^[A-Za-z]/.test(rest)) return num;
    const afterUnit = rest.startsWith(' ') ? rest.slice(1) : rest;
    const unit = ALL_UNITS.find((u) => afterUnit.startsWith(u)) ?? null;
    if (unit === '월' && UNITS.monthIrregular[num]) return UNITS.monthIrregular[num]; // 6월→유월, 10월→시월
    const n = Number(num);
    if (unit && NATIVE_SET.has(unit) && n >= 1 && n <= 99 && num.length <= 2) {
      if (unit === '번째' && UNITS.ordinalNative[num]) return UNITS.ordinalNative[num]; // 1번째→첫번째
      return nativeRead(n);
    }
    return sinoRead(num);
  });

  if (lenSpecs.length) {
    t = t.replace(/[-]/g, (ch) => lenSpecs[ch.codePointAt(0) - 0xE000] ?? ch);
  }
  return t;
}

module.exports = { preprocess, sinoRead, nativeRead, digitRead };

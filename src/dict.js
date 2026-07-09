'use strict';
// 예외사전 (기획서 3.6): "한글 어절 → 교정된 한글 발음" 치환
// - 숫자 전처리 뒤, 자모 분해 앞에 실행 (3.1 ①②)
// - 어절 정확 일치만 (부분일치 없음), 조사 붙은 형태는 별도 키
// - 매칭 키 조회 시 수동 마크업 문자는 제거 (3.10)
// - 값에는 악센트 핵(')·억양구 경계(/) 마크업 허용 (3.9③)

const fs = require('fs');
const path = require('path');

const DICT_PATH = path.join(__dirname, '..', 'dict.json');

// 어절 스캔: 한글·자모(ㅋㅋ 등 신조어 토큰) 덩어리 + 사이에 낀 수동 마크업 문자까지 한 런으로
const WORD_RUN = /[가-힣ㄱ-ㅎㅏ-ㅣ'‘’´`]+/g;
const MARKS = /['‘’´`]/g;
const SINGLE_JAMO = /^[ㄱ-ㅎㅏ-ㅣ]$/;

let cached = null;

// dict.json 로드 — 없거나 깨져도 앱은 계속 동작 (빈 사전 + 경고)
function loadDefaultDict() {
  if (cached) return cached;
  let dict = {};
  let warning = null;
  try {
    const raw = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
    for (const [key, value] of Object.entries(raw)) {
      if (!key.startsWith('_')) dict[key] = value;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') warning = `예외사전(dict.json)을 읽지 못해 무시함: ${e.message}`;
    // 파일 없음은 정상 (사전은 부가 기능)
  }
  cached = { dict, warning };
  return cached;
}

// 텍스트의 어절을 사전으로 치환. 적용 내역을 hits 배열로 반환
function substitute(text, dict, hits = []) {
  if (!dict || Object.keys(dict).length === 0) return text;
  return text.replace(WORD_RUN, (run) => {
    const key = run.replace(MARKS, '');
    let value = dict[key];
    // 반복 자모 폴백: ㅋㅋㅋㅋ처럼 같은 자모의 반복은 단일 키(ㅋ→크)를 반복해 커버
    if (value === undefined && key.length > 1 && SINGLE_JAMO.test(key[0])
      && [...key].every((c) => c === key[0]) && dict[key[0]] !== undefined) {
      value = dict[key[0]].repeat(key.length);
    }
    if (value === undefined) return run;
    hits.push(`${key}→${value}`);
    return value; // 사전 값이 수동 마크업보다 우선 (3.9③)
  });
}

module.exports = { loadDefaultDict, substitute };

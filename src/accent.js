'use strict';
// 악센트 자동 생성 (기획서 3.9)
// - 억양구 = 어절 (조사 병합 3.9① 적용), 경계는 / 또는 、
// - 핵('): 3모라 이상 → 끝에서 2번째 모라 뒤, 1~2모라 → 마지막 모라 뒤
// - 핵 자리가 ッ이면 한 모라 앞으로 (그래도 ッ이면 뒤로)
// - 핵이 자음+ㅖ(キェ류) 모라인데 마지막 모라가 아니면 한 모라 뒤로
//   (관계로→クァンギェロ' — 2026-07-07 청취 확정. ェ가 핵이면 하강이 급해져 어색)
// - 의문문은 마지막에 ？

const YE_MORA = /^[キギニヒミリピビ]ェ$/; // 자음+ㅖ 결합 모라 (ウェ·フェ·チェ류는 제외)

function kernelIndex(moras, manualKernel, headKernel) {
  // headKernel: 억양구 첫 자음이 격음·경음 → 핵을 1번째 모라로 (頭高 — K-ToBI H-초성 근사)
  let k;
  if (manualKernel != null) {
    k = manualKernel;
  } else if (headKernel) {
    k = 1;
  } else if (moras.length >= 4 && moras[moras.length - 2] === 'ニ' && moras[moras.length - 1] === 'ダ') {
    // 종결형 ~니다 악센트 패턴 (3.9③): 핵을 ニ 앞으로 — カムサハム'ニダ (2단계 청취 확정)
    k = moras.length - 2;
  } else {
    k = moras.length >= 3 ? moras.length - 1 : moras.length;
    // 비말단 キェ류 핵 회피 (시계처럼 ェ가 마지막이면 그대로)
    if (k < moras.length && YE_MORA.test(moras[k - 1])) k++;
  }
  while (k > 1 && moras[k - 1] === 'ッ') k--;
  while (k < moras.length && moras[k - 1] === 'ッ') k++;
  return k;
}

function phraseText(phrase, withKernel) {
  const moras = phrase.moras;
  if (!withKernel) return moras.join('');
  const k = kernelIndex(moras, phrase.manualKernel, phrase.headKernel);
  return moras.slice(0, k).join('') + "'" + moras.slice(k).join('');
}

function sentenceText(sentence, withKernel) {
  let out = '';
  sentence.phrases.forEach((p, i) => {
    if (i > 0) out += p.sepBefore === '、' ? '、' : '/';
    out += phraseText(p, withKernel);
  });
  if (sentence.question) out += '？';
  return out;
}

// is_kana 전송용 (핵 포함)
function sentenceMarkup(sentence) {
  return sentenceText(sentence, true);
}

// 표시·테스트용 (핵 제외 — 9.5 골든 테스트 형식)
function sentencePlain(sentence) {
  return sentenceText(sentence, false);
}

module.exports = { sentenceMarkup, sentencePlain, kernelIndex };

'use strict';
// 보류 메모 기록 (보류목록.md) — audition.js의 m 커맨드와 웹 UI(/api/hold)가 공유.
// 지금의 규칙·사전 수단으로 해결되지 않는 발음 문제를 쌓아두는 곳. 쌓이면 검토해
// ① 규칙 개선 ② 사전 등록 방법 고안 ③ 기획서 10장(인토네이션·길이 손튜닝) 재개를 판단한다.

const fs = require('fs');
const path = require('path');

const HOLD_PATH = path.join(__dirname, '..', '보류목록.md');

const HEADER = '# 보류 목록\n\n'
  + '지금의 규칙·사전 수단으로 해결되지 않는 발음 문제를 쌓아두는 곳 (audition.js의 m 커맨드가 기록).\n'
  + '쌓이면 검토해 ① 규칙 개선 ② 사전 등록 방법 고안 ③ 기획서 10장(인토네이션·길이 손튜닝) 재개를 판단한다.\n\n';

function appendHold(text, kana, note) {
  if (!fs.existsSync(HOLD_PATH)) fs.writeFileSync(HOLD_PATH, HEADER, 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(HOLD_PATH, `- ${date} | 입력: ${text} | 가나: ${kana} | 메모: ${note}\n`, 'utf8');
}

module.exports = { HOLD_PATH, appendHold };

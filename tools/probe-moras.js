'use strict';
// VOICEVOX 엔진의 is_kana 파서가 인식하는 확장 모라를 실제 API로 검증 (기획서 11장 미해결 항목)
// 실행: node tools/probe-moras.js  (엔진 기동 필요)
// 각 후보를 "후보'" 형태(핵 포함 단일 억양구)로 POST /accent_phrases?is_kana=true → 200이면 지원

const BASE = process.argv[2] || 'http://127.0.0.1:50021';
const SPEAKER = 3;

const CANDIDATES = [
  // 자음+w활음 (한국어 ㅘㅝㅙㅟ 대응 후보)
  'クァ', 'クヮ', 'グァ', 'グヮ', 'クィ', 'クェ', 'クォ', 'グォ',
  'ムァ', 'ムォ', 'ヌァ', 'ブァ', 'プァ', 'スァ', 'ズォ', 'ルォ',
  // ファ행 (ㅎ+w 후보)
  'ファ', 'フィ', 'フェ', 'フォ', 'フュ',
  // 자음+ㅖ 후보 (ェ 결합)
  'キェ', 'ギェ', 'ニェ', 'ヒェ', 'ミェ', 'リェ', 'ピェ', 'ビェ', 'チェ', 'シェ', 'ジェ', 'イェ',
  // 외래음·기타
  'ティ', 'ディ', 'トゥ', 'ドゥ', 'テュ', 'デュ', 'スィ', 'ズィ',
  'ツァ', 'ツィ', 'ツェ', 'ツォ', 'ウィ', 'ウェ', 'ウォ', 'ヴ', 'ヴァ',
];

async function probe(mora) {
  const text = encodeURIComponent(mora + "'");
  const res = await fetch(`${BASE}/accent_phrases?text=${text}&speaker=${SPEAKER}&is_kana=true`, { method: 'POST' });
  if (!res.ok) return { mora, ok: false };
  const phrases = await res.json();
  // 단일 모라로 파싱됐는지도 확인 (2모라로 쪼개지면 다른 소리)
  const moraCount = phrases.reduce((n, p) => n + p.moras.length, 0);
  return { mora, ok: true, single: moraCount === 1 };
}

(async () => {
  const supported = [], multi = [], rejected = [];
  for (const c of CANDIDATES) {
    const r = await probe(c);
    if (!r.ok) rejected.push(c);
    else if (r.single) supported.push(c);
    else multi.push(c);
  }
  console.log('지원(1모라):', supported.join(' '));
  console.log('파싱되나 복수 모라:', multi.join(' ') || '(없음)');
  console.log('미지원(400):', rejected.join(' ') || '(없음)');
})();

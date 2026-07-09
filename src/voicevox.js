'use strict';
// VOICEVOX ENGINE API 연동 (기획서 3.11)
// STEP 1: POST /accent_phrases?is_kana=true → STEP 2: 길이 보정
// → STEP 3: AudioQuery 수동 조립 → STEP 4: POST /synthesis

const DEFAULT_URL = 'http://127.0.0.1:50021';
const INTONATION_SCALE = 0.8;   // 확정값 (기획서 9장)

// 모라 길이 보정 상수 (3.5 — 2026-07-04 청취 결과 반영, 재청취로 튜닝 가능)
const TENSE_BOOST = 1.75;       // 경음 consonant_length 배율
const CODA_RU_VOWEL = 0.032;    // ㄹ받침 ル의 모음 길이(초) — 사용자 실측(서울·하늘)
const CODA_MU_VOWEL = 0.045;      // ㅁ받침 ム의 모음 길이(초) — 감=적당 판정(2단계)
const CODA_MU_NASAL_VOWEL = 0.03; // ㅂ→ㅁ 비음화 유래 ム — 더 짧게 (합니다·립니다, 2단계)
const CODA_N_LONG = 1.35;         // ㄴ받침 ン 길이 배율 (2단계: 반의 ン 소폭 상향)
const CODA_N_SHORT = 0.8;         // ㅇ받침 ン 길이 배율 (2단계: 사랑 ン 소폭 상향)
const YE_VOWEL_SCALE = 1.35;      // 자음+ㅖ(キェ·ギェ류) ェ 모음 연장 배율 (2026-07-07: 관계 청취)

async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    const err = new Error(`VOICEVOX ENGINE에 연결할 수 없습니다 (${url}). VOICEVOX를 먼저 실행해주세요.`);
    err.cause = e;
    err.connectionFailed = true;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`HTTP ${res.status}: ${body}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res;
}

async function version(base = DEFAULT_URL) {
  return (await request(`${base}/version`)).json();
}

async function speakers(base = DEFAULT_URL) {
  return (await request(`${base}/speakers`)).json();
}

// 화자 상세 (스타일별 아이콘 base64 포함) — 웹 UI 화자 선택 프로필용
async function speakerInfo(uuid, base = DEFAULT_URL) {
  return (await request(`${base}/speaker_info?speaker_uuid=${encodeURIComponent(uuid)}`)).json();
}

// STEP 1 — 마크업 가나 → AccentPhrase[] (길이·피치 자동 계산됨)
async function accentPhrases(markup, styleId, base = DEFAULT_URL) {
  const url = `${base}/accent_phrases?text=${encodeURIComponent(markup)}&speaker=${styleId}&is_kana=true`;
  return (await request(url, { method: 'POST' })).json();
}

// STEP 2 — 보정 대상 모라의 음소 길이 조정 (3.5)
// 규칙엔진이 넘긴 { index(전역 모라), type, value? } 목록을 accent_phrases 응답에 적용
const ADJUSTERS = {
  tense: (m) => { if (m.consonant_length != null) m.consonant_length *= TENSE_BOOST; },
  ru: (m) => { if (m.vowel_length != null) m.vowel_length = CODA_RU_VOWEL; },
  ye: (m) => { if (m.vowel_length != null) m.vowel_length *= YE_VOWEL_SCALE; },
  mu: (m) => { if (m.vowel_length != null) m.vowel_length = Math.min(m.vowel_length, CODA_MU_VOWEL); },
  muShort: (m) => { if (m.vowel_length != null) m.vowel_length = Math.min(m.vowel_length, CODA_MU_NASAL_VOWEL); },
  nLong: (m) => { if (m.vowel_length != null) m.vowel_length *= CODA_N_LONG; },
  nShort: (m) => { if (m.vowel_length != null) m.vowel_length *= CODA_N_SHORT; },
  // 사전 값의 `<초>` 수동 오버라이드 (3.6 확장) — 단어 하나만 튜닝할 때, 항상 최우선 적용
  customLen: (m, adj) => { if (m.vowel_length != null) m.vowel_length = adj.value; },
};

function applyAdjustments(phrases, adjustments) {
  if (!adjustments.length) return;
  const flat = [];
  for (const p of phrases) for (const m of p.moras) flat.push(m);
  for (const adj of adjustments) {
    const mora = flat[adj.index];
    if (!mora) {
      console.warn(`[경고] 보정 인덱스 ${adj.index}가 엔진 모라 수(${flat.length})를 벗어남 — 건너뜀`);
      continue;
    }
    ADJUSTERS[adj.type]?.(mora, adj);
  }
}

// STEP 3 — AudioQuery 수동 조립 (엔진 공식 기본값 + intonationScale만 우리 값)
function buildAudioQuery(accentPhrasesResult, intonationScale = INTONATION_SCALE) {
  return {
    accent_phrases: accentPhrasesResult,
    speedScale: 1.0,
    pitchScale: 0.0,
    intonationScale,
    volumeScale: 1.0,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.1,
    pauseLength: null,
    pauseLengthScale: 1.0,
    outputSamplingRate: 24000,
    outputStereo: false,
  };
}

// STEP 4 — 합성 → wav Buffer
async function synthesis(audioQuery, styleId, base = DEFAULT_URL) {
  const res = await request(`${base}/synthesis?speaker=${styleId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(audioQuery),
  });
  return Buffer.from(await res.arrayBuffer());
}

// ── WAV 이어붙이기 (여러 문장 → 한 파일) ──────────────────
function findDataChunk(buf) {
  let off = 12; // 'RIFF' + size + 'WAVE'
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return { start: off, size };
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV data 청크를 찾을 수 없습니다');
}

function concatWav(buffers) {
  if (buffers.length === 1) return buffers[0];
  const first = buffers[0];
  const d0 = findDataChunk(first);
  const datas = buffers.map((b) => {
    const d = findDataChunk(b);
    return b.subarray(d.start + 8, d.start + 8 + d.size);
  });
  const total = datas.reduce((sum, d) => sum + d.length, 0);
  const header = Buffer.from(first.subarray(0, d0.start + 8));
  const out = Buffer.concat([header, ...datas]);
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(total, d0.start + 4);
  return out;
}

module.exports = {
  DEFAULT_URL, INTONATION_SCALE, TENSE_BOOST,
  version, speakers, speakerInfo, accentPhrases, applyAdjustments, buildAudioQuery, synthesis, concatWav,
};

'use strict';
// 골든 테스트 (기획서 9.5) — 규칙엔진·악센트 검증. 합성은 수동 확인.
// 실행: node test.js

const { convert } = require('./src/rules');
const { sentencePlain, sentenceMarkup } = require('./src/accent');
const { preprocess } = require('./src/numbers');
const { englishStage } = require('./src/english');
const { routeOf, valueError, KEY_SHAPE, buildWords, loadBook, saveBook } = require('./src/books');
const { moraTimes } = require('./server');

// [입력, 기대 가나(핵 제외), 옵션]
const GOLDEN = [
  ['안녕하세요', 'アンニョンハセヨ'],                   // #1 기본 조립, ㅇ받침→ン
  ['학교', 'ハッキョ'],                                 // #2 ㄱ받침→ッ, 경음화 흡수
  ['신라', 'シルラ'],                                   // #3 유음화, ㄹㄹ→ル
  ['입니다', 'イムニダ'],                               // #4 비음화(ㅂ→ㅁ→ム), 어중 ㄷ 유성화
  ['국물', 'クンムル'],                                 // #5 비음화, 어말 ㄹ→ル
  ['좋다', 'チョタ'],                                   // #6 격음화 + 어두 ㅈ→チャ행
  ['좋아요', 'チョアヨ'],                               // #7 ㅎ받침+모음 탈락
  ['입학', 'イパッ'],                                   // #8 역격음화
  ['같이', 'カチ'],                                     // #9 연음+구개음화
  ['옷이', 'オシ'],                                     // #10 연음 원음 이동
  ['옷 안에', 'オ/ダネ'],                               // #11 절음, 경계 유지
  ['닭이', 'タルギ'],                                   // #12 겹받침 연음, ㄹ→ル
  ['닭', 'タッ'],                                       // #13 겹받침 대표음
  ['무늬', 'ムニ'],                                     // #14 자음+ㅢ→イ
  ['나의', 'ナエ'],                                     // #15 조사 의→에
  ['의사', 'ウィサ'],                                   // #16 어두 의→ウィ
  ['파티', 'パティ'],                                   // #17 외래음 ティ
  ['두부', 'トゥブ'],                                   // #18 외래음 トゥ, 어중 유성
  ['아까', 'アッカ'],                                   // #19 어중 경음→촉음
  ['까치', 'ガチ', { adjust: 'tense@0' }],              // #20 어두 경음: 유성행 + 자음 길이 보정
  ['몰라', 'モルラ'],                                   // #21 ㄹㄹ→ル
  ['밥 먹어', 'パム/モゴ', { adjust: 'muShort@1' }],    // #22 경계 너머 비음화(ㅂ→ㅁ→짧은 ム)
  ['3개 있어요', 'セゲ/イッソヨ'],                       // #23 (숫자 전처리로 원 입력 활성화)
  ['2024년', 'イチョニシッサニョン'],                    // #24 — 연음 규칙상 천+이→처니
  ['뭐 해?', 'モ/ヘ？'],                                // #25 w활음 탈락, 물음표→？
  // 추가 검증 (기획서 본문 예시)
  ['나 봐', 'ナ/バ'],                                   // 3.2: /경계 너머 유성음화 (ㅘ→w탈락 a)
  ['정말 이상하다', 'チョンマ/リサンハダ'],             // 3.8.1(c): 절음, 어두 ㅈ→チャ행
  ['많이', 'マニ'],                                     // ㄶ+모음 → ㅎ탈락+연음
  ['싫다', 'シルタ'],                                   // ㅀ+ㄷ → 격음화 (실타, ㄹ받침→ル)
  ['못 해', 'モ/テ'],                                   // 3.8.1(e): 경계 너머 역격음화 (모태)
  // w활음 유지 격상 (3.3.2 개정 — 엔진 0.25.2 실측: クァ·グァ·ファ행 1모라 지원)
  ['사과', 'サグァ'],                                    // ㄱ+ㅘ 유성 → グァ
  ['귀', 'クィ'],                                        // 어두 ㄱ+ㅟ → クィ
  ['전화', 'チョンファ'],                                // ㅎ+ㅘ → ファ, 어두 ㅈ→チャ행
  ['회사', 'フェサ'],                                    // ㅎ+ㅚ → フェ
  ['시계', 'シギェ', { adjust: 'ye@1' }],                // 자음+ㅖ → い단+ェ (유성 ギェ) + ェ 모음 연장
  ['관계로', 'クァンギェロ', { adjust: 'nLong@1 ye@2' }], // w활음+ㅖ 조합, ェ 연장 (2026-07-07)
  ['튜브', 'テュブ'],                                    // ㅌ+ㅠ → テュ (실측 지원)
  ['뭐', 'モ'],                                          // ㅁ+ㅝ은 탈락 유지 (ムォ 미지원)
  // 조사 어절 병합 (3.9①)
  ['밥 을 먹어', 'パブル/モゴ'],                         // 을이 앞 구에 병합 (절음 ㅂ 이동 포함)
  ['학교 에 는', 'ハッキョエヌン'],                      // 연쇄 병합 → 한 억양구
  ['나 의 집', 'ナエ/ジッ'],                             // 단독 어절 '의'도 조사 → [에]
  // 예외사전 (3.6, 기본 dict.json 항목)
  ['회의', 'フェイ'],                                    // 회이 (조사 의→에 과적용 교정)
  ['회의를', 'フェイルル'],                              // 조사형 별도 키, ㄹ받침→ル
  ['의의', 'ウィイ'],                                    // 의이
  ['십육', 'シムニュッ'],                                // 심뉵 (ㄴ첨가 사전 보정, ㅁ→ム)
  ['16년', 'シムニュンニョン'],                          // 숫자→사전→비음화 3단 합성
  // 사용자 사전 확장: 가나 값 + 자모 토큰 (3.6/3.9③)
  ['레퀴엠', 'レクイエム', { adjust: 'mu@4' }],          // 사전 값 가나 직접 지정 + 어말 ム 받침 보정
  ['레퀴엠은', 'レクイエムウン', { adjust: 'mu@4 nLong@6' }], // 가나 어절 + 조사 병합
  ['カナ', 'カナ'],                                      // 가나 직접 입력 통과
  ['ㅋㅋ', 'クク'],                                      // 자모 토큰 (ㅋ→크 반복 폴백)
  ['ㅋㅋㅋㅋ', 'クククク'],                              // 〃 임의 길이
  ['ㄹㅇ', 'レアル'],                                    // 신조어 사전
  ['ㅇㅇ', 'ウン'],                                      // 〃 (응)
  ['ㄷㄷ', 'トルドル'],                                  // 〃 (덜덜)
  // 1단계 청취 확정 (2026-07-04): 받침 개선 + ㅈ 분기 + 어두 경음 유성행
  ['감', 'カム'],                                        // ㅁ받침→ム (ㄴ/ㅇ의 ン과 분리)
  ['감사합니다', 'カムサハムニダ'],                      // ㅁ받침 ム 종합
  ['날씨', 'ナルシ'],                                    // ㄹ받침→ル (모음 0.032)
  ['서울', 'ソウル'],                                    // 어말 ㄹ→ル
  ['길 너머', 'キン/ノモ'],                              // 경계 유음화 미적용 + ㄴ 앞 ㄹ→ン
  ['자주', 'チャジュ'],                                  // ㅈ: 어두 チャ행 / 유성 ジャ행
  ['아주', 'アジュ'],                                    // ㅈ 유성 환경
  ['앉아', 'アンジャ'],                                  // ㄵ 연음 + ㅈ 유성
  ['짜다', 'ザダ'],                                      // 어두 ㅉ → ザ행 (2단계: ジャ는 '자다'처럼 들림)
];

// 숫자 전처리 (7장) — 텍스트 레벨 검증: [입력, 기대 한글]
const NUMBERS = [
  ['3개', '세개'],                              // 고유어 단위
  ['2024년', '이천이십사년'],                   // 한자어 단위
  ['1시 30분', '한시 삼십분'],                  // 시=고유어, 분=한자어 (기본값)
  ['6월 10일', '유월 십일'],                    // 월 불규칙
  ['12월', '십이월'],                           // 규칙 월
  ['010-1234-5678', '공일공 일이삼사 오육칠팔'], // 전화번호 자릿수 읽기
  ['15%', '십오퍼센트'],                        // 기호 단위
  ['3kg', '삼킬로그램'],                        // 〃
  ['1,000원', '천원'],                          // 자릿수 쉼표
  ['3.5', '삼점오'],                            // 소수
  ['20개', '스무개'],                           // 딱 20 → 스무
  ['21개', '스물한개'],                         // 21 → 스물한
  ['100개', '백개'],                            // 고유어 상한(99) 초과 → 한자어
  ['0개', '영개'],                              // 0 → 한자어
  ['1번째', '첫번째'],                          // 서수 불규칙
  ['10000원', '만원'],                          // 만은 일 생략
  ['1억', '일억'],                              // 억은 일 유지
  ['110000', '십일만'],                         // 그룹 합성
  ['mp3', 'mp3'],                               // 숫자 단계는 불변 — 영어 처리(3.7)가 엠피쓰리로
  ['세 번', '세 번'],                           // 숫자 없음 → 불변
];

// 영어/일본어식 처리 (3.7) — 텍스트 레벨 검증: [입력, 기대 텍스트, 주입 옵션]
// 사전 경로는 주입으로 고정, CMUdict 경로는 번들(data/cmudict.json)을 그대로 사용
const ENGLISH = [
  // CMUdict + 외래어 표기법 (기본 한국어식)
  ['cake', '케이크'],
  ['strike', '스트라이크'],
  ['milk', '밀크'],
  ['hotel', '호텔'],
  ['internet 없이', '인터넷 없이'],                       // 한글·공백 보존
  ['HELLO', '헐로'],                                      // 5자+ 전대문자 = 강조 표기 → CMUdict 우선
  ['USA', '유에스에이'],                                  // 2~4자 전대문자 = 약어 → letter-name
  ['AI', '에이아이'],
  ['IT', '아이티'],                                       // CMUdict의 it(잇)에 가로채이지 않음
  ['qqqq', '큐큐큐큐'],                                   // OOV → 철자 폴백 (+경고)
  // dict_en 관용 표기 우선
  ['coffee', '커피', { dictEn: { coffee: '커피' } }],
  ['mp3 파일', '엠피쓰리 파일', { dictEn: { mp3: '엠피쓰리' } }],
  // 일본어식 마커 * — 한글은 dict_jp 조회, 라틴은 CMUdict→가타카나 자동.
  // 가나 출력엔 `*`가 다시 붙음(jpStyle 표시 — 규칙엔진이 한국어식 길이 보정을 건너뜀)
  ['커피* 한잔', 'コオヒイ* 한잔', { dictJp: { '커피': 'コオヒイ' } }],
  ['커피 한잔', '커피 한잔', { dictJp: { '커피': 'コオヒイ' } }],  // 마커 없으면 한국어식
  ['meeting*', 'ミイティング*'],
  // 전역 --jp — 미등록 한글은 조용히 통과
  ['커피 마시자', 'コオヒイ* 마시자', { jp: true, dictJp: { '커피': 'コオヒイ' } }],
  ['meeting 하자', 'ミイティング* 하자', { jp: true }],
];

// [입력, 기대 마크업(핵 포함)] — 3.9 악센트 규칙 검증
const ACCENT = [
  ['안녕하세요', "アンニョンハセ'ヨ"],      // 7모라, 끝에서 2번째
  ['아까', "ア'ッカ"],                      // 핵이 ッ 자리 → 한 모라 앞으로
  ['옷 안에', "オ'/ダネ'"],                 // 1모라 구도 반드시 핵
  ['뭐 해?', "モ'/ヘ'？"],                  // 의문 ？
  ['밥 먹어', "パム'/モゴ'"],               // 2모라 구는 2번째 모라 뒤 (ㅁ받침→ム)
  ["안녕'하세요", "アンニョン'ハセヨ"],     // 수동 마크업이 자동 규칙을 덮어씀
  ['아, 바다', "ア'、パダ'"],               // 쉼표→、 + pause 직후 무성(パ)
  ['밥 을 먹어', "パブ'ル/モゴ'"],          // 병합된 구 전체 기준으로 핵 계산
  ['학교 에 는', "ハッキョエヌ'ン"],        // 연쇄 병합 후 6모라 구의 핵
  ['나 봐', "ナ'/バ'"],                     // 조사 목록에 없는 1음절은 병합 안 함
  // 1단계 청취 확정: 격음·경음 어두 → 핵 1모라(頭高), 평음 → 기존 규칙
  ['까치', "ガ'チ"],                        // 경음: 유성행 + 頭高
  ['가치', "カチ'"],                        // 평음: 무성행 + 기존 핵 (경음·격음과 3중 구분)
  ['탈', "タ'ル"],                          // 격음 頭高
  ['달', "タル'"],                          // 평음
  ['깜', "ガ'ム"],                          // 어두 경음 유성행 + 頭高
  ['캄', "カ'ム"],                          // 격음 頭高
  ['감', "カム'"],                          // 평음
  // 2단계 청취 확정 (2026-07-04)
  ['차다', "チャ'ダ"],                      // 격음 頭高 유지 확정
  ['짜다', "ザ'ダ"],                        // ㅉ 어두 ザ행 + 頭高
  ['빨리', "バ'ルリ"],                      // ㅃ 어두 유성행 확정
  ['입니다', "イム'ニダ"],                  // ~니다 종결 패턴: 핵을 ニ 앞으로
  ['감사합니다', "カムサハム'ニダ"],        // 〃
  ['잘 부탁드립니다', "チャル'/ブタットゥリム'ニダ"], // 격음 頭高... 잘=チャル'(2모라), ~니다 패턴
  ['닭이 울어요', "タル'ギ/ウロ'ヨ"],       // ㄹ→ル 파생 확정
  ['물 좀 주세요', "ムル'/ジョム'/ジュセ'ヨ"], // 받침 단축 종합 확정
  ['레퀴엠', "レクイエ'ム"],                // 가나 어절도 자동 핵 규칙(끝-2) 적용
  // 비말단 キェ류 핵 회피 (2026-07-07 청취 확정: 관계로는 D안=끝모라가 자연스러움)
  ['관계로', "クァンギェロ'"],              // 핵이 ギェ에 오면 한 모라 뒤로
  ['관계도', "クァンギェド'"],              // 같은 패턴 파생
  ['시계', "シギェ'"],                      // ェ가 마지막 모라면 그대로 (기존 확정 유지)
];

let pass = 0, fail = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ok   ${label} → ${actual}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n       기대: ${expected}\n       실제: ${actual}`);
  }
}

console.log('── 골든 테스트 (가나 변환, 핵 제외) ──');
for (const [input, expected, opts] of GOLDEN) {
  const { sentences } = convert(input);
  const actual = sentences.map(sentencePlain).join(' ');
  check(input, actual, expected);
  if (opts?.adjust) {
    const a = sentences.flatMap((s) => s.adjustments).map((x) => `${x.type}@${x.index}`).join(' ');
    check(`${input} (보정)`, a, opts.adjust);
  }
}

console.log('── 악센트 마크업 (핵 포함) ──');
for (const [input, expected] of ACCENT) {
  const { sentences } = convert(input);
  const actual = sentences.map(sentenceMarkup).join(' ');
  check(input, actual, expected);
}

console.log('── 숫자 전처리 (텍스트 레벨) ──');
for (const [input, expected] of NUMBERS) {
  check(input, preprocess(input), expected);
}

console.log('── 영어/일본어식 처리 (3.7, 텍스트 레벨) ──');
for (const [input, expected, opts] of ENGLISH) {
  check(input, englishStage(input, opts ?? {}), expected);
}

console.log('── 영어 처리 종단 (convert 가나, 기본 사전 파일) ──');
{
  const plainOf = (t, o) => convert(t, o).sentences.map(sentencePlain).join(' ');
  check('meeting 하자', plainOf('meeting 하자'), 'ミティン/ハジャ');        // dict_en 미팅 → 규칙 파이프라인
  check('strike', plainOf('strike'), 'ストゥライク');                        // CMUdict → 스트라이크 → 규칙
  check('커피* 한잔', plainOf('커피* 한잔'), 'コオヒイ/ハンジャン');         // dict_jp 씨드 (마커)
  check('커피 한잔', plainOf('커피 한잔'), 'コピ/ハンジャン');               // 마커 없으면 한국어식
  check('meeting 하자 (--jp)', plainOf('meeting 하자', { jp: true }), 'ミイティング/ハジャ');
  // 한국어 전용 입력은 영어 스테이지 무비용 통과 (enHits 없음)
  const kr = convert('안녕하세요');
  check('한국어 전용 enHits=0', String(kr.enHits.length), '0');
}

console.log('── 예외사전 메커니즘 (3.6, 커스텀 사전 주입) ──');
{
  const d = { '가나다': '하하하', '하나둘': '하나/둘', '테스트': "테'스트" };
  const plainOf = (t) => convert(t, { dict: d }).sentences.map(sentencePlain).join(' ');
  const markupOf = (t) => convert(t, { dict: d }).sentences.map(sentenceMarkup).join(' ');
  check('치환: 가나다', plainOf('가나다'), 'ハハハ');
  check('부분일치 없음: 가나다라', plainOf('가나다라'), 'カナダラ');
  check("마크업 제거 조회: 가'나다", plainOf("가'나다"), 'ハハハ');
  check('값의 /로 억양구 분할: 하나둘', plainOf('하나둘'), 'ハナ/ドゥル');
  check("값의 '가 자동 핵을 덮어씀: 테스트", markupOf('테스트'), "テ'ストゥ");
  const noDict = (t) => convert(t, { dict: {} }).sentences.map(sentencePlain).join(' ');
  check('빈 사전이면 규칙만 적용: 회의', noDict('회의'), 'フェエ');
  // 가나 값 사전
  const kd = { '피자': 'ピッツァ', '로마': "ロ'オマ" };
  const kPlain = (t) => convert(t, { dict: kd }).sentences.map(sentencePlain).join(' ');
  const kMarkup = (t) => convert(t, { dict: kd }).sentences.map(sentenceMarkup).join(' ');
  check('가나 값 치환: 피자', kPlain('피자'), 'ピッツァ');
  check('가나 값 핵 회피(ッ): 피자', kMarkup('피자'), "ピ'ッツァ");
  check('가나 값 수동 핵: 로마', kMarkup('로마'), "ロ'オマ");
}

console.log('── 가나 값의 한국어식 길이 보정 (3.6/3.7 — 받침 유사 모라, 2026-07-08) ──');
{
  const adjOf = (t, o) => convert(t, o).sentences
    .flatMap((s) => s.adjustments).map((x) => `${x.type}@${x.index}`).join(' ');
  // 한국어 맥락 가나 값(마커 없음) → 규칙엔진과 같은 받침 보정
  check('사전 가나 값 ル 받침: 블랙', adjOf('블랙', { dict: { '블랙': "ブルレッ'" } }), 'ru@1');
  check('사전 가나 값 ム 받침: 게임', adjOf('게임', { dict: { '게임': 'ゲエム' } }), 'mu@2');
  check('사전 가나 값 キェ류 ェ 연장', adjOf('망계', { dict: { '망계': 'マンギェ' } }), 'ye@2');
  check('모음 앞 ル는 받침 아님(보정 없음)', adjOf('나루아', { dict: { '나루아': 'ナルア' } }), '');
  check('직접 입력 가나도 한국어식 보정', adjOf('ブルレッ'), 'ru@1');
  // 일본어식(`*`·dict_jp 경유)은 엔진 기본 길이 그대로
  check('일본어식 마커 *: 게임*', adjOf('게임*', { dictJp: { '게임': 'ゲエム' } }), '');
  check('전역 --jp의 dict_jp 값도 기본값', adjOf('게임', { jp: true, dictJp: { '게임': 'ゲエム' } }), '');
  check('직접 입력 가나 + *도 기본값', adjOf('ブルレッ*'), '');
}

console.log('── 가나 값의 수동 길이 오버라이드 `<초>` (3.6 확장, 2026-07-08) ──');
{
  const adjOf = (t, o) => convert(t, o).sentences
    .flatMap((s) => s.adjustments).map((x) => `${x.type}@${x.index}${x.type === 'customLen' ? `=${x.value}` : ''}`).join(' ');
  const plainOf = (t, o) => convert(t, o).sentences.map(sentencePlain).join(' ');
  // <초>는 파싱만 되고 결과 가나 문자열엔 남지 않음, 자동 보정(ru) 뒤에 적용되어 우선
  check('오버라이드는 가나에서 제거됨', plainOf('블랙', { dict: { '블랙': "ブル<0.02>レッ'" } }), 'ブルレッ');
  check('오버라이드가 자동 ru 보정을 덮어씀', adjOf('블랙', { dict: { '블랙': "ブル<0.02>レッ'" } }), 'ru@1 customLen@1=0.02');
  check('직접 입력 가나도 오버라이드 적용', adjOf('ブル<0.015>レッ'), 'ru@1 customLen@1=0.015');
  // 일본어식(jpStyle)이어도 명시적 오버라이드는 항상 적용 (자동 보정은 건너뜀)
  check('일본어식이어도 오버라이드는 적용', adjOf('게임*', { dictJp: { '게임': 'ゲ<0.05>エム' } }), 'customLen@0=0.05');
  // 정확히 `<숫자>` 형태만 문법 — 일반 텍스트의 `<`를 삼키지 않음 (2026-07-08 버그 수정)
  check('짝 없는 <는 무시, 뒷부분 유지', plainOf('가격 < 만원'), 'カギョン/マノン');
  check('짝 없는 < 뒤 문장 분리 유지', plainOf('안녕 < 반가워. 잘가'), 'アンニョン/バンガウォ チャルガ');
  const misuse = convert('블<0.02>랙');
  check('한글 뒤 <초>는 경고 + 텍스트 무결', misuse.sentences.map(sentencePlain).join(' '), 'プルレッ');
  check('한글 뒤 <초> 경고 발생', String(misuse.warnings.some((w) => w.includes('가나 모라'))), 'true');
}

console.log('── 어절별 모라 스팬 wordSpans (Phase 3 — 재생 중 어절 하이라이트) ──');
{
  const spansOf = (t, o) => convert(t, o).sentences
    .flatMap((s) => s.wordSpans).map((w) => `${w.text}@${w.start}-${w.end}`).join(' ');
  const morasOf = (t, o) => convert(t, o).sentences
    .flatMap((s) => s.phrases).reduce((n, p) => n + p.moras.length, 0);
  // 기본: 어절 순서·경계 (안녕하세요=7모라 アンニョンハセヨ, 커피=コピ 2모라)
  check('스팬: 두 어절', spansOf('안녕하세요 커피'), '안녕하세요@0-7 커피@7-9');
  // 조사 병합(3.9①)은 억양구만 합치고 어절 스팬은 유지 (절음으로 ㅂ이 을로 이동: パ+ブル)
  check('스팬: 조사 병합 유지', spansOf('밥 을 먹어'), '밥@0-1 을@1-3 먹어@3-5');
  // 가나 어절(사전 가나 값) + 조사 — 한 토큰이 두 어절이 되는 케이스
  check('스팬: 가나+조사 분리', spansOf('레퀴엠은'), 'レクイエム@0-5 은@5-7');
  // `*` 마커 가나 어절
  check('스팬: 일본어식 가나 어절', spansOf('커피* 한잔', { dictJp: { '커피': 'コオヒイ' } }), 'コオヒイ@0-4 한잔@4-8');
  // 스팬 끝 = 전체 모라 수와 정합
  const t = '물 좀 주세요, 감사합니다';
  const spans = convert(t).sentences.flatMap((s) => s.wordSpans);
  check('스팬: 총 모라 수 정합', String(spans[spans.length - 1].end), String(morasOf(t)));
}

console.log('── 사전 3권 공용 로직 (src/books.js — audition·웹 UI 공유) ──');
{
  // routeOf: 마커 맥락 라우팅 (실제 파일 로드 없이 스텁 state로 검증)
  const state = { main: { id: 'main' }, en: { id: 'en' }, jp: { id: 'jp' } };
  const r = (token) => {
    const { book, key } = routeOf(token, state);
    return `${book.id}:${key}`;
  };
  check('라우팅: 한글 → dict.json', r('블랙'), 'main:블랙');
  check('라우팅: 라틴 → dict_en (소문자 정규화)', r('Meeting'), 'en:meeting');
  check('라우팅: 한글* → dict_jp', r('커피*'), 'jp:커피');
  check('라우팅: 라틴* → dict_jp (소문자 정규화)', r('Meeting*'), 'jp:meeting');
  // valueError: 값 검증 (audition f와 웹 교정 공용)
  const ok = (book, v) => String(valueError(book, v) === null);
  check('값: 가나+<초>+핵 허용', ok({ id: 'main' }, "ブル<0.02>レッ'"), 'true');
  check('값: 한글+구분리 허용', ok({ id: 'main' }, '하나/둘'), 'true');
  check('값: 장음 ー 거부', ok({ id: 'main' }, 'コーヒー'), 'false');
  check('값: 허용 외 문자 거부', ok({ id: 'main' }, 'abc'), 'false');
  check('값: jp책에 한글 거부', ok({ id: 'jp' }, '커피'), 'false');
  check('값: jp책 가타카나 허용', ok({ id: 'jp' }, 'コオヒイ'), 'true');
  check('값: 빈 값 거부', ok({ id: 'main' }, ''), 'false');
  // KEY_SHAPE: 사전 키 형태
  check('키: 한글 어절', String(KEY_SHAPE.test('블랙')), 'true');
  check('키: 라틴+마커', String(KEY_SHAPE.test('meeting*')), 'true');
  check('키: 공백 포함 거부', String(KEY_SHAPE.test('두 단어')), 'false');
}

console.log('── 어절 분해 buildWords (Phase 3 — 병기 테이블·교정 팝오버) ──');
{
  // 파일 로드 없이 스텁 사전으로 검증
  const state = {
    main: { id: 'main', file: 'dict.json', dict: { '블랙': "ブル<0.02>レッ'", '하나둘': '하나/둘' } },
    en: { id: 'en', file: 'dict_en.json', dict: {} },
    jp: { id: 'jp', file: 'dict_jp.json', dict: { '커피': 'コオヒイ' } },
  };
  const brief = (t, o) => buildWords(t, state, o)
    .map((w) => `${w.token}=${w.kana}#${w.spanCount}`).join(' ');
  check('분해: 기본 두 어절', brief('안녕하세요 커피'), '안녕하세요=アンニョンハセヨ#1 커피=コピ#1');
  check('분해: 마커 어절은 dict_jp 경유', brief('커피* 한잔'), '커피*=コオヒイ#1 한잔=ハンジャン#1');
  check('분해: 사전 / 값은 스팬 2개', brief('하나둘'), '하나둘=ハナ/ドゥル#2');
  check('분해: 직접 입력 가나(<초> 내포)', brief('ブル<0.02>レッ 좋다'), 'ブル<0.02>レッ=ブルレッ#1 좋다=チョタ#1');
  const words = buildWords('블랙', state, {});
  check('분해: 현재 사전값', words[0].current, "ブル<0.02>レッ'");
  check('분해: 원본 변환(사전 제외)', words[0].ruleKana, 'プルレッ');
  check('분해: 저장처', `${words[0].book}:${words[0].key}`, 'dict.json:블랙');
  const kanaTok = buildWords('カナ', state, {})[0];
  check('분해: 가나 토큰은 교정 불가', String(kanaTok.correctable), 'false');
}

console.log('── 사전 파일 손상 보호 (loadBook loadError · saveBook 거부/원자적 쓰기) ──');
{
  const fs = require('fs');
  const os = require('os');
  const pathMod = require('path');
  const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'k2v-test-'));
  const brokenPath = pathMod.join(tmpDir, 'broken.json');
  fs.writeFileSync(brokenPath, '{ "키": "값"', 'utf8'); // 닫는 괄호 없는 JSON
  const broken = loadBook({ id: 'main', file: 'broken.json', path: brokenPath, comment: '테스트' });
  check('깨진 JSON → loadError 표시', String(!!broken.loadError), 'true');
  check('깨진 JSON → 빈 사전으로 동작', Object.keys(broken.dict).length, 0);
  let saveErr = '';
  try { saveBook(broken); } catch (e) { saveErr = 'throw'; }
  check('깨진 사전에 저장 시도 → 거부(기존 항목 보호)', saveErr, 'throw');
  check('거부 후 파일 원본 유지', fs.readFileSync(brokenPath, 'utf8'), '{ "키": "값"');

  const missingPath = pathMod.join(tmpDir, 'missing.json');
  const fresh = loadBook({ id: 'main', file: 'missing.json', path: missingPath, comment: '테스트' });
  check('없는 파일 → loadError 없음 (새 사전)', String(fresh.loadError), 'null');
  fresh.raw['안녕'] = 'アンニョン';
  saveBook(fresh);
  check('정상 저장 → 파일에 반영', JSON.parse(fs.readFileSync(missingPath, 'utf8'))['안녕'], 'アンニョン');
  check('정상 저장 → 임시 파일 잔존 없음', String(fs.existsSync(missingPath + '.tmp')), 'false');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('── 어절 타이밍 moraTimes (server.js — pause_mora는 시간만, 인덱스 없음) ──');
{
  const phrases = [
    { moras: [{ consonant_length: 0.05, vowel_length: 0.1 }, { consonant_length: null, vowel_length: 0.2 }], pause_mora: { vowel_length: 0.3 } },
    { moras: [{ consonant_length: 0.1, vowel_length: 0.1 }], pause_mora: null },
  ];
  const t = moraTimes(phrases, 0.1);
  const fmt = (arr) => arr.map((x) => x.toFixed(2)).join(' ');
  check('시작 시각 (pause 건너뜀 반영)', fmt(t.starts), '0.10 0.25 0.75');
  check('끝 시각', fmt(t.ends), '0.25 0.45 0.95');
  check('총 길이 (pause 포함)', t.total.toFixed(2), '0.85');
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);

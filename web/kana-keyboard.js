'use strict';
// 가상 가나 키보드 (기획서 4장 필수급) — 버튼마다 한글 발음 라벨.
// 탭: 청음 / 탁음·반탁음 / 작은 가나·기호. 마지막 포커스된 입력 필드의 커서 위치에 삽입.

(() => {
  // [가나, 한글 라벨] — null은 줄바꿈
  const SEION = [
    ['ア', '아'], ['イ', '이'], ['ウ', '우'], ['エ', '에'], ['オ', '오'], null,
    ['カ', '카'], ['キ', '키'], ['ク', '쿠'], ['ケ', '케'], ['コ', '코'], null,
    ['サ', '사'], ['シ', '시'], ['ス', '스'], ['セ', '세'], ['ソ', '소'], null,
    ['タ', '타'], ['チ', '치'], ['ツ', '츠'], ['テ', '테'], ['ト', '토'], ['ティ', '티'], ['トゥ', '투'], null,
    ['ナ', '나'], ['ニ', '니'], ['ヌ', '누'], ['ネ', '네'], ['ノ', '노'], null,
    ['ハ', '하'], ['ヒ', '히'], ['フ', '후'], ['ヘ', '헤'], ['ホ', '호'], null,
    ['マ', '마'], ['ミ', '미'], ['ム', '무'], ['メ', '메'], ['モ', '모'], null,
    ['ヤ', '야'], ['ユ', '유'], ['ヨ', '요'], null,
    ['ラ', '라'], ['リ', '리'], ['ル', '루'], ['レ', '레'], ['ロ', '로'], null,
    ['ワ', '와'], ['ヲ', '오'], ['ン', 'ㄴ/ㅇ받침'],
  ];
  const DAKUON = [
    ['ガ', '가'], ['ギ', '기'], ['グ', '구'], ['ゲ', '게'], ['ゴ', '고'], null,
    ['ザ', '자*'], ['ジ', '지'], ['ズ', '즈'], ['ゼ', '제'], ['ゾ', '조'], null,
    ['ダ', '다'], ['ヂ', '지'], ['ヅ', '즈'], ['デ', '데'], ['ド', '도'], ['ディ', '디'], ['ドゥ', '두'], null,
    ['バ', '바'], ['ビ', '비'], ['ブ', '부'], ['ベ', '베'], ['ボ', '보'], null,
    ['パ', '파'], ['ピ', '피'], ['プ', '푸'], ['ペ', '페'], ['ポ', '포'],
  ];
  const SMALL = [
    ['ッ', '받침(ㄱㄷㅂ)'], ['ャ', 'ㅑ'], ['ュ', 'ㅠ'], ['ョ', 'ㅛ'], null,
    ['ァ', 'ㅏ'], ['ィ', 'ㅣ'], ['ゥ', 'ㅜ'], ['ェ', 'ㅔ'], ['ォ', 'ㅗ'], ['ヮ', 'ㅘ'], null,
    ["'", '악센트 핵'], ['/', '구 분리'], ['、', '쉼'], ['*', '일본어식'],
  ];
  const TABS = [
    { name: '청음', keys: SEION },
    { name: '탁음·반탁음', keys: DAKUON },
    { name: '작은 가나·기호', keys: SMALL },
  ];

  let target = null; // 마지막 포커스된 삽입 대상

  function insert(text) {
    const el = target ?? document.getElementById('markup-input');
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const pos = start + text.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function render(container) {
    const tabsEl = document.createElement('div');
    tabsEl.className = 'kb-tabs';
    const gridEl = document.createElement('div');
    gridEl.className = 'kb-grid';

    function show(idx) {
      [...tabsEl.children].forEach((b, i) => b.classList.toggle('active', i === idx));
      gridEl.textContent = '';
      for (const key of TABS[idx].keys) {
        if (key === null) {
          const gap = document.createElement('span');
          gap.className = 'kb-gap';
          gridEl.appendChild(gap);
          continue;
        }
        const [kana, label] = key;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kb-key';
        btn.innerHTML = `<span class="k">${kana}</span><span class="l">${label}</span>`;
        // mousedown에서 처리해 대상 입력의 포커스·커서를 잃지 않게 한다
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); insert(kana); });
        gridEl.appendChild(btn);
      }
    }

    TABS.forEach((tab, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tab.name;
      b.addEventListener('click', () => show(i));
      tabsEl.appendChild(b);
    });
    container.appendChild(tabsEl);
    container.appendChild(gridEl);
    show(0);
  }

  // 삽입 대상 추적: 마크업 편집 필드와 교정 팝오버 입력만
  document.addEventListener('focusin', (e) => {
    if (e.target.id === 'markup-input' || e.target.id === 'pop-input') target = e.target;
  });

  window.KanaKeyboard = { render };
})();

'use strict';
// k2v 웹 UI (Phase 3) — 버튼식 변환: [변환]/Ctrl+Enter로만 변환, 자동 변환 없음.
// 서버(server.js)가 규칙엔진·사전 쓰기·엔진 호출을 담당하고, 여기는 표시·재생·편집만.

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    config: { styleId: 3, jp: false, autoPlay: true },
    lastText: null,   // 마지막 변환 성공 입력
    lastJp: false,    // 그때의 JP 토글
    conv: null,       // /api/convert 응답
    spanToWord: null, // 타이밍 span 인덱스 → 병기 테이블 행 (정합 실패 시 null)
    audio: { key: null, url: null, timings: null, el: null, highlight: false },
    raf: 0,
    popWord: null,    // 팝오버가 열린 어절
  };

  // ── 공통 ──────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error ?? `HTTP ${res.status}`);
      err.data = data;
      throw err;
    }
    return data;
  }

  function toast(msg, isError = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), isError ? 6000 : 2500);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── 엔진 상태 · 화자 선택 (커스텀 드롭다운 — 스타일은 화자 아래 서브메뉴) ──
  let speakers = [];      // [{name, speaker_uuid, styles:[{id, name}]}]
  let speakerIcons = {};  // styleId → dataURL (엔진 /speaker_info, 서버 캐시)

  async function initSpeakers() {
    const dot = $('engine-dot');
    const label = $('engine-label');
    try {
      speakers = await api('GET', '/api/speakers');
      buildSpeakerMenu();
      updateSpeakerButton();
      $('speaker-btn').disabled = false;
      dot.className = 'dot ok';
      label.textContent = '엔진 연결됨';
      $('engine-retry').classList.add('hidden');
      loadSpeakerIcons(); // 아이콘은 비동기로 — 도착하는 대로 채움
    } catch (e) {
      $('speaker-btn').disabled = true;
      $('speaker-btn-label').textContent = '엔진 연결 안 됨';
      dot.className = 'dot down';
      label.textContent = '엔진 연결 안 됨 (변환은 가능, 재생 불가)';
      $('engine-retry').classList.remove('hidden');
    }
  }

  async function loadSpeakerIcons() {
    try {
      const res = await api('GET', '/api/speaker_icons');
      speakerIcons = res.icons;
      applyIcons();
      updateSpeakerButton();
    } catch { /* 아이콘 없이 이름만 표시 */ }
  }

  function findStyle(styleId) {
    for (const sp of speakers) {
      for (const st of sp.styles) if (st.id === styleId) return { sp, st };
    }
    return null;
  }

  function updateSpeakerButton() {
    const found = findStyle(state.config.styleId)
      ?? (speakers[0] && { sp: speakers[0], st: speakers[0].styles[0] });
    if (!found) return;
    $('speaker-btn-label').textContent = `${found.sp.name}（${found.st.name}）`;
    const img = $('speaker-btn-icon');
    const icon = speakerIcons[found.st.id];
    if (icon) { img.src = icon; img.classList.remove('hidden'); }
    else img.classList.add('hidden');
  }

  function makeSpeakerRow(iconStyleId, name, hasArrow) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sp-row';
    const img = document.createElement('img');
    img.className = 'sp-icon';
    img.alt = '';
    img.dataset.style = iconStyleId;
    const nm = document.createElement('span');
    nm.className = 'sp-name';
    nm.textContent = name;
    row.appendChild(img);
    row.appendChild(nm);
    if (hasArrow) {
      const ar = document.createElement('span');
      ar.className = 'sp-arrow';
      ar.textContent = '›';
      row.appendChild(ar);
    }
    return row;
  }

  function buildSpeakerMenu() {
    const menu = $('speaker-menu');
    menu.textContent = '';
    for (const sp of speakers) {
      const row = makeSpeakerRow(sp.styles[0].id, sp.name, sp.styles.length > 1);
      if (sp.styles.length === 1) {
        row.addEventListener('click', () => selectStyle(sp, sp.styles[0]));
        row.addEventListener('mouseenter', () => closeSubmenu());
      } else {
        const open = () => openSubmenu(sp, row);
        row.addEventListener('click', open);
        row.addEventListener('mouseenter', open);
      }
      menu.appendChild(row);
    }
    applyIcons();
  }

  function openSubmenu(sp, row) {
    closeSubmenu();
    row.classList.add('open');
    const sub = $('speaker-submenu');
    sub.textContent = '';
    for (const st of sp.styles) {
      const item = makeSpeakerRow(st.id, `${sp.name}（${st.name}）`, false);
      if (st.id === state.config.styleId) item.classList.add('selected');
      item.addEventListener('click', () => selectStyle(sp, st));
      sub.appendChild(item);
    }
    sub.classList.remove('hidden');
    const rect = row.getBoundingClientRect();
    sub.style.left = `${rect.right + 2}px`;
    sub.style.top = `${Math.min(rect.top, window.innerHeight - Math.min(sub.offsetHeight, window.innerHeight * 0.62) - 12)}px`;
    applyIcons();
  }

  function closeSubmenu() {
    $('speaker-submenu').classList.add('hidden');
    document.querySelectorAll('.sp-row.open').forEach((r) => r.classList.remove('open'));
  }

  function closeSpeakerMenu() {
    $('speaker-menu').classList.add('hidden');
    closeSubmenu();
  }

  function applyIcons() {
    document.querySelectorAll('img.sp-icon[data-style]').forEach((img) => {
      const icon = speakerIcons[img.dataset.style];
      if (icon && img.src !== icon) img.src = icon;
    });
  }

  function selectStyle(sp, st) {
    saveConfig({ styleId: st.id });
    updateSpeakerButton();
    closeSpeakerMenu();
    toast(`화자 변경: ${sp.name}（${st.name}）`);
  }

  async function initConfig() {
    try {
      state.config = await api('GET', '/api/config');
    } catch { /* 기본값 유지 */ }
    $('auto-play').checked = state.config.autoPlay;
    $('jp-toggle').checked = state.config.jp;
  }

  function saveConfig(patch) {
    Object.assign(state.config, patch);
    api('PUT', '/api/config', patch).catch((e) => toast(`설정 저장 실패: ${e.message}`, true));
  }

  // ── 변환 ──────────────────────────────────────────────────────────
  async function convertNow(autoplay = true) {
    const text = $('text-input').value.trim();
    if (!text) { toast('변환할 텍스트를 입력하세요', true); return; }
    const t0 = performance.now();
    let conv;
    try {
      conv = await api('POST', '/api/convert', { text, jp: state.config.jp });
    } catch (e) {
      toast(`변환 실패: ${e.message}`, true);
      return;
    }
    if (!conv.sentences.length) {
      toast('발음할 내용이 없습니다' + (conv.warnings.length ? ` — ${conv.warnings[0]}` : ''), true);
      return;
    }
    state.conv = conv;
    state.lastText = text;
    state.lastJp = state.config.jp;
    state.spanToWord = buildSpanMap(conv);
    renderResult(conv);
    $('markup-input').value = conv.sentences.map((s) => s.markup).join('\n');
    setMarkupDirty(false);
    $('btn-play').disabled = false;
    $('btn-save').disabled = false;
    $('btn-play-markup').disabled = false;
    $('btn-hold').disabled = false;
    $('convert-time').textContent = `변환 완료 ✔ ${((performance.now() - t0) / 1000).toFixed(2)}초`;
    updateStale();
    if (autoplay && state.config.autoPlay) play();
  }

  // 타이밍 span 인덱스 → 병기 테이블 행 매핑 (buildWords의 spanCount 누적)
  function buildSpanMap(conv) {
    const totalSpans = conv.sentences.reduce((n, s) => n + s.wordSpans.length, 0);
    const map = [];
    conv.words.forEach((w, wi) => {
      for (let k = 0; k < w.spanCount; k++) map.push(wi);
    });
    return map.length === totalSpans ? map : null; // 정합 실패 시 하이라이트 생략
  }

  function renderResult(conv) {
    // 배지
    const badges = $('badges');
    badges.textContent = '';
    const addBadge = (text, cls = '') => {
      const b = document.createElement('span');
      b.className = 'badge' + (cls ? ` ${cls}` : '');
      b.textContent = text;
      badges.appendChild(b);
    };
    if (conv.dictHits.length) addBadge(`사전 ${conv.dictHits.length}`);
    if (conv.enHits.length) addBadge(`영어 ${conv.enHits.length}`);
    if (state.config.jp) addBadge('외래어 일본어식', 'jp');

    // 경고
    const warnEl = $('warnings');
    warnEl.textContent = '';
    for (const w of conv.warnings) {
      const div = document.createElement('div');
      div.className = 'warning-item';
      div.textContent = `⚠ ${w}`;
      warnEl.appendChild(div);
    }

    // 어절별 병기 테이블
    const table = $('words-table');
    table.textContent = '';
    conv.words.forEach((w, wi) => {
      const row = document.createElement('div');
      row.className = 'word-row' + (w.correctable ? ' clickable' : '');
      row.dataset.wi = wi;
      const tok = document.createElement('span');
      tok.className = 'word-token';
      tok.textContent = w.token;
      if (w.current !== null && w.current !== undefined) {
        const mark = document.createElement('span');
        mark.className = 'in-dict';
        mark.textContent = w.book;
        mark.title = `사전 등록됨: ${w.current}`;
        tok.appendChild(mark);
      }
      const kana = document.createElement('span');
      kana.className = 'word-kana';
      kana.textContent = w.kana;
      row.appendChild(tok);
      row.appendChild(kana);
      if (w.correctable) {
        row.title = '클릭 → 발음 교정';
        row.addEventListener('click', () => openPopover(w, row));
      }
      table.appendChild(row);
    });

    // 마크업 미리보기 (핵 ' 강조)
    const preview = $('markup-preview');
    const markup = conv.sentences.map((s) => s.markup).join(' ');
    preview.innerHTML = escapeHtml(markup).replace(/'/g, "<span class=\"kernel\">'</span>");
    preview.classList.remove('hidden');
  }

  // ── stale (입력 변경됨) ────────────────────────────────────────────
  function updateStale() {
    const stale = state.lastText !== null
      && ($('text-input').value.trim() !== state.lastText || state.config.jp !== state.lastJp);
    $('stale-banner').classList.toggle('hidden', !stale);
    $('result-body').classList.toggle('stale', stale);
  }

  // ── 합성·재생 ─────────────────────────────────────────────────────
  async function ensureAudio(text, highlight) {
    const key = JSON.stringify([text, state.config.styleId, state.config.jp]);
    if (state.audio.key === key) {
      state.audio.highlight = highlight;
      return state.audio;
    }
    const res = await api('POST', '/api/synth',
      { text, speaker: state.config.styleId, jp: state.config.jp });
    const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
    if (state.audio.url) URL.revokeObjectURL(state.audio.url);
    if (state.audio.el) state.audio.el.pause();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const el = new Audio(url);
    el.addEventListener('ended', stopHighlight);
    el.addEventListener('pause', stopHighlight);
    state.audio = { key, url, timings: res.timings, el, highlight };
    return state.audio;
  }

  async function playText(text, highlight) {
    let audio;
    try {
      audio = await ensureAudio(text, highlight);
    } catch (e) {
      const detail = e.data?.markup ? ` (마크업: ${e.data.markup})` : '';
      toast(`합성 실패: ${e.message}${detail}`, true);
      return false;
    }
    audio.el.currentTime = 0;
    try {
      await audio.el.play(); // 브라우저 autoplay 차단 등으로 거부될 수 있음
    } catch (e) {
      toast(`재생 실패: ${e.message}`, true);
      return false;
    }
    if (audio.highlight && state.spanToWord) startHighlight(audio);
    return true;
  }

  function play() { return playText(state.lastText, true); }

  // 편집한 가나로 재생 — 줄바꿈은 문장 경계('.')로. 어절 매핑이 어긋날 수 있어 하이라이트 없음
  async function playMarkup() {
    const text = $('markup-input').value.split(/\n+/).map((s) => s.trim()).filter(Boolean).join('.');
    if (!text) { toast('재생할 가나가 없습니다', true); return; }
    if (await playText(text, false)) setMarkupDirty(false);
  }

  // ── 재생 중 어절 하이라이트 ───────────────────────────────────────
  function startHighlight(audio) {
    cancelAnimationFrame(state.raf);
    const step = () => {
      const t = audio.el.currentTime;
      let active = -1;
      for (let i = 0; i < audio.timings.length; i++) {
        const tm = audio.timings[i];
        if (tm.start !== null && t >= tm.start && t < tm.end) { active = i; break; }
      }
      const wi = active >= 0 ? state.spanToWord[active] : -1;
      document.querySelectorAll('.word-row').forEach((row) => {
        row.classList.toggle('playing', Number(row.dataset.wi) === wi && wi >= 0);
      });
      if (!audio.el.paused && !audio.el.ended) state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }

  function stopHighlight() {
    cancelAnimationFrame(state.raf);
    document.querySelectorAll('.word-row.playing').forEach((r) => r.classList.remove('playing'));
  }

  // ── wav 저장 ──────────────────────────────────────────────────────
  async function saveWav() {
    try {
      const audio = await ensureAudio(state.lastText, true);
      const a = document.createElement('a');
      a.href = audio.url;
      a.download = 'k2v.wav';
      a.click();
      toast('✔ k2v.wav 다운로드');
    } catch (e) {
      toast(`합성 실패: ${e.message}`, true);
    }
  }

  // ── 가나 편집 dirty 배지 ──────────────────────────────────────────
  function setMarkupDirty(dirty) {
    $('markup-dirty').classList.toggle('hidden', !dirty);
  }

  // ── 교정 팝오버 ───────────────────────────────────────────────────
  function openPopover(word, rowEl) {
    state.popWord = word;
    $('pop-title').innerHTML =
      `${escapeHtml(word.token)} <span class="book">→ ${escapeHtml(word.book)}</span>`;
    $('pop-rule').textContent = word.ruleKana;
    const hasCurrent = word.current !== null && word.current !== undefined;
    $('pop-current-label').style.display = hasCurrent ? '' : 'none';
    $('pop-current').style.display = hasCurrent ? '' : 'none';
    $('pop-current').textContent = hasCurrent ? word.current : '';
    $('pop-delete').classList.toggle('hidden', !hasCurrent);
    $('pop-input').value = hasCurrent ? word.current : '';
    $('pop-error').classList.add('hidden');

    const pop = $('popover');
    pop.classList.remove('hidden');
    const rect = rowEl.getBoundingClientRect();
    pop.style.top = `${rect.bottom + window.scrollY + 4}px`;
    pop.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 16)}px`;
    $('pop-input').focus();
  }

  function closePopover() {
    $('popover').classList.add('hidden');
    state.popWord = null;
  }

  async function popSave() {
    const word = state.popWord;
    if (!word) return;
    const value = $('pop-input').value.trim();
    try {
      const r = await api('PUT', '/api/dict', { book: word.bookId, key: word.key, value });
      toast(`✔ ${r.book} 저장됨: ${r.key} → ${r.value}`);
      closePopover();
      await convertNow(false); // 재변환 후
      play();                  // 저장 및 재생
      refreshDictsIfOpen();
    } catch (e) {
      $('pop-error').textContent = e.message;
      $('pop-error').classList.remove('hidden');
    }
  }

  async function popDelete() {
    const word = state.popWord;
    if (!word) return;
    try {
      const r = await api('DELETE', '/api/dict', { book: word.bookId, key: word.key });
      toast(`✔ ${r.book} 삭제됨: ${r.key}`);
      closePopover();
      await convertNow(false);
      refreshDictsIfOpen();
    } catch (e) {
      $('pop-error').textContent = e.message;
      $('pop-error').classList.remove('hidden');
    }
  }

  // ── 사전 브라우저 ─────────────────────────────────────────────────
  let dicts = null;
  let dictTab = 'main';

  async function refreshDicts() {
    try {
      dicts = await api('GET', '/api/dicts');
      renderDictList();
    } catch (e) {
      toast(`사전 로드 실패: ${e.message}`, true);
    }
  }

  function refreshDictsIfOpen() {
    if ($('dict-panel').open) refreshDicts();
  }

  function renderDictList() {
    const list = $('dict-list');
    list.textContent = '';
    if (!dicts) return;
    const q = $('dict-search').value.trim().toLowerCase();
    const entries = Object.entries(dicts[dictTab].entries)
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q));
    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'dict-empty';
      p.textContent = q ? '검색 결과 없음' : '항목 없음';
      list.appendChild(p);
      return;
    }
    for (const [key, value] of entries) {
      const row = document.createElement('div');
      row.className = 'dict-row';
      const k = document.createElement('span'); k.className = 'k'; k.textContent = key;
      const v = document.createElement('span'); v.className = 'v'; v.textContent = value;
      const ops = document.createElement('span'); ops.className = 'ops';
      const edit = document.createElement('button');
      edit.textContent = '✏';
      edit.title = '수정 (아래 입력칸으로)';
      edit.addEventListener('click', () => {
        $('dict-add-key').value = key;
        $('dict-add-value').value = value;
        $('dict-add-value').focus();
      });
      const del = document.createElement('button');
      del.textContent = '🗑';
      del.title = '삭제';
      del.addEventListener('click', async () => {
        try {
          const r = await api('DELETE', '/api/dict', { book: dictTab, key });
          toast(`✔ ${r.book} 삭제됨: ${key}`);
          await refreshDicts();
          if (state.lastText) convertNow(false); // 결과에 반영
        } catch (e) {
          toast(`삭제 실패: ${e.message}`, true);
        }
      });
      ops.appendChild(edit);
      ops.appendChild(del);
      row.appendChild(k); row.appendChild(v); row.appendChild(ops);
      list.appendChild(row);
    }
  }

  async function dictAddSubmit(e) {
    e.preventDefault();
    const key = $('dict-add-key').value.trim();
    const value = $('dict-add-value').value.trim();
    try {
      const r = await api('PUT', '/api/dict', { book: dictTab, key, value });
      toast(`✔ ${r.book} 저장됨: ${r.key} → ${r.value}`);
      $('dict-add-key').value = '';
      $('dict-add-value').value = '';
      await refreshDicts();
      if (state.lastText) convertNow(false);
    } catch (err) {
      toast(`저장 실패: ${err.message}`, true);
    }
  }

  // ── 보류 메모 ─────────────────────────────────────────────────────
  async function holdSave() {
    const note = $('hold-note').value.trim();
    if (!note) return;
    const kana = state.conv ? state.conv.sentences.map((s) => s.markup).join(' ') : '';
    try {
      await api('POST', '/api/hold', { text: state.lastText ?? '', kana, note });
      toast('✔ 보류목록.md에 기록됨');
      $('hold-note').value = '';
      $('hold-form').classList.add('hidden');
    } catch (e) {
      toast(`기록 실패: ${e.message}`, true);
    }
  }

  // ── 이벤트 연결 ───────────────────────────────────────────────────
  $('btn-convert').addEventListener('click', () => convertNow());
  $('btn-reconvert').addEventListener('click', () => convertNow());
  $('btn-play').addEventListener('click', () => play());
  $('btn-save').addEventListener('click', saveWav);
  $('btn-play-markup').addEventListener('click', playMarkup);
  $('text-input').addEventListener('input', updateStale);
  $('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); convertNow(); }
  });
  $('markup-input').addEventListener('input', () => {
    if (state.conv) {
      const orig = state.conv.sentences.map((s) => s.markup).join('\n');
      setMarkupDirty($('markup-input').value !== orig);
    }
  });
  $('speaker-btn').addEventListener('click', () => {
    const menu = $('speaker-menu');
    if (menu.classList.contains('hidden')) menu.classList.remove('hidden');
    else closeSpeakerMenu();
  });
  $('jp-toggle').addEventListener('change', (e) => {
    saveConfig({ jp: e.target.checked });
    updateStale();
  });
  $('auto-play').addEventListener('change', (e) => saveConfig({ autoPlay: e.target.checked }));
  $('engine-retry').addEventListener('click', initSpeakers);
  $('btn-hold').addEventListener('click', () => $('hold-form').classList.toggle('hidden'));
  $('hold-save').addEventListener('click', holdSave);
  $('hold-note').addEventListener('keydown', (e) => { if (e.key === 'Enter') holdSave(); });

  $('btn-keyboard').addEventListener('click', () => {
    const kb = $('kana-keyboard');
    if (!kb.dataset.rendered) {
      window.KanaKeyboard.render(kb);
      kb.dataset.rendered = '1';
    }
    kb.classList.toggle('hidden');
  });

  $('pop-save').addEventListener('click', popSave);
  $('pop-delete').addEventListener('click', popDelete);
  $('pop-cancel').addEventListener('click', closePopover);
  $('pop-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') popSave();
    if (e.key === 'Escape') closePopover();
  });
  document.addEventListener('click', (e) => {
    // 팝오버 밖 클릭으로 닫기 (팝오버·어절 행 내부 클릭은 유지)
    if (!$('popover').classList.contains('hidden')
      && !e.target.closest('#popover') && !e.target.closest('.word-row')) closePopover();
    // 화자 메뉴 밖 클릭으로 닫기
    if (!$('speaker-menu').classList.contains('hidden')
      && !e.target.closest('.speaker-picker')) closeSpeakerMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSpeakerMenu();
  });

  $('dict-panel').addEventListener('toggle', () => { if ($('dict-panel').open) refreshDicts(); });
  $('dict-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-book]');
    if (!btn) return;
    dictTab = btn.dataset.book;
    document.querySelectorAll('#dict-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    renderDictList();
  });
  $('dict-search').addEventListener('input', renderDictList);
  $('dict-add').addEventListener('submit', dictAddSubmit);

  // ── 시작 ──────────────────────────────────────────────────────────
  (async () => {
    await initConfig();
    initSpeakers();
  })();
})();

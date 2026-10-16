// UI controller for the "Bài hát" tab: song library, editor and practice
// (right hand plays the melody one note at a time, left hand plays the chord's bass/root note).
import { parseSong, splitSongs, buildEvents, keyScaleNotes } from './song.js';
import { renderScore } from './scoreView.js';
import { DEMO_SONGS } from './demoSongs.js';
import { load, save } from './storage.js';
import { mod12, prettyName, solfegeName } from './theory.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);
const HANDS_LABEL = { R: 'tay phải', L: 'tay trái', both: 'hai tay' };

const TEMPLATE = `title: Bài hát mới
composer:
key: C
time: 4/4
tempo: 80
// Mỗi nốt: tên nốt + quãng tám + trường độ. Ví dụ: C4q (Đô đen), F#4e. (Fa thăng móc đơn chấm dôi)
// Trường độ: w = tròn, h = trắng, q = đen, e = móc đơn, s = móc kép; thêm "." = chấm dôi, "3" = liên ba, "~" = dấu nối.
// Dấu lặng: r + trường độ (rq, re). Hợp âm đặt trong [ ] trước nốt bắt đầu hợp âm. Dấu | ngăn ô nhịp.
@Phiên khúc
[C] C4q D4q E4q F4q | [G] G4h [C] E4h |
`;

/**
 * @param {{synth, pretty:(s:string)=>string, toast:(s:string)=>void, refresh:()=>void, onRangeChange:()=>void}} ctx
 */
export function createSongView(ctx) {
  const { synth, toast } = ctx;
  const pretty = prettyName;

  let songs = load('songs', null);
  if (!Array.isArray(songs) || !songs.length) {
    songs = DEMO_SONGS.map((text) => ({ id: uid(), text }));
    save('songs', songs);
  }
  const settings = {
    current: songs[0].id, mode: 'wait', hands: 'R', bpm: 60, accomp: true, loop: false, metro: true,
    ...load('songSettings', {}),
  };

  const v = {
    song: null,
    events: [],
    score: null,
    range: [0, 0], // event indexes (inclusive)
    index: 0,
    running: false,
    run: null,
    timers: [],
    raf: 0,
  };

  const persist = () => {
    save('songs', songs);
    save('songSettings', settings);
  };

  // ------------------------------------------------------------ library
  function renderLibrary() {
    $('#songList').innerHTML = songs
      .map((s) => {
        const p = parseSong(s.text);
        return `<li class="${s.id === settings.current ? 'current' : ''}" data-id="${s.id}">
          <button class="song-pick" data-act="pick"><b>${escapeHtml(p.meta.title)}</b>
          <small>${escapeHtml(p.meta.composer || '')}${p.meta.composer ? ' · ' : ''}${escapeHtml(p.meta.key)} · ${p.meta.time}${p.errors.length || p.warnings.length ? ' · ⚠️' : ''}</small></button>
        </li>`;
      })
      .join('');
  }

  $('#songList').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    selectSong(li.dataset.id);
  });

  function selectSong(id) {
    stopAll();
    settings.current = id;
    persist();
    renderLibrary();
    loadSong();
  }

  $('#songNew').addEventListener('click', () => openEditor(null));
  $('#songEdit').addEventListener('click', () => openEditor(settings.current));
  $('#songImport').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    importText(text);
  });
  $('#songExport').addEventListener('click', () => {
    const blob = new Blob([songs.map((s) => s.text.trim()).join('\n\n===\n\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bai-hat.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function importText(text) {
    let parts;
    try {
      const json = JSON.parse(text);
      parts = (Array.isArray(json) ? json : [json]).map((x) => (typeof x === 'string' ? x : x.text)).filter(Boolean);
    } catch {
      parts = splitSongs(text);
    }
    let added = 0;
    let updated = 0;
    const failed = [];
    let lastId = null;
    for (const t of parts) {
      const p = parseSong(t);
      if (p.errors.length) {
        failed.push(p.meta.title);
        continue;
      }
      const existing = songs.find((s) => parseSong(s.text).meta.title === p.meta.title);
      if (existing) {
        existing.text = t;
        lastId = existing.id;
        updated++;
      } else {
        const id = uid();
        songs.push({ id, text: t });
        lastId = id;
        added++;
      }
    }
    persist();
    if (lastId) selectSong(lastId);
    else renderLibrary();
    toast(
      `Đã nhập ${added} bài${updated ? `, cập nhật ${updated} bài` : ''}.${failed.length ? ` Không nhập được: ${failed.join(', ')} (có lỗi).` : ''}`,
      4500,
    );
  }

  // ------------------------------------------------------------ editor
  let editingId = null;
  function openEditor(id) {
    stopAll();
    editingId = id;
    const s = songs.find((x) => x.id === id);
    $('#songEditorTitle').textContent = s ? 'Sửa bài hát' : 'Thêm bài hát mới';
    $('#songText').value = s ? s.text : TEMPLATE;
    $('#songDelete').hidden = !s;
    $('#songEditor').hidden = false;
    checkEditor();
    $('#songEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function checkEditor() {
    const p = parseSong($('#songText').value);
    const box = $('#songErrors');
    if (!p.errors.length && !p.warnings.length) {
      box.innerHTML = `<p class="feedback ok">✓ Hợp lệ: ${p.measures.length} ô nhịp, ${p.notes.length} nốt, ${p.chords.length} hợp âm.</p>`;
    } else {
      box.innerHTML = [...p.errors.map((x) => `<li class="err">${escapeHtml(x)}</li>`), ...p.warnings.map((x) => `<li class="warn">${escapeHtml(x)}</li>`)].join('');
      box.innerHTML = `<ul>${box.innerHTML}</ul>`;
    }
    return p;
  }
  $('#songCheck').addEventListener('click', checkEditor);
  $('#songText').addEventListener('input', debounce(checkEditor, 400));
  $('#songCancel').addEventListener('click', () => ($('#songEditor').hidden = true));
  $('#songSave').addEventListener('click', () => {
    const p = checkEditor();
    if (p.errors.length) return toast('Bài hát còn lỗi — xem danh sách bên dưới ô soạn thảo.');
    const text = $('#songText').value;
    if (editingId) songs.find((s) => s.id === editingId).text = text;
    else {
      editingId = uid();
      songs.push({ id: editingId, text });
    }
    persist();
    $('#songEditor').hidden = true;
    selectSong(editingId);
    toast(p.warnings.length ? 'Đã lưu (còn cảnh báo về trường độ).' : 'Đã lưu bài hát.');
  });
  $('#songDelete').addEventListener('click', () => {
    const s = songs.find((x) => x.id === editingId);
    if (!s || !confirm(`Xóa bài “${parseSong(s.text).meta.title}”?`)) return;
    songs = songs.filter((x) => x.id !== editingId);
    if (!songs.length) songs = DEMO_SONGS.map((text) => ({ id: uid(), text }));
    $('#songEditor').hidden = true;
    selectSong(songs[0].id);
  });

  // ------------------------------------------------------------ settings
  function bindSeg(sel, key, attr) {
    $$(`${sel} button`).forEach((b) =>
      b.addEventListener('click', () => {
        stopAll();
        settings[key] = b.dataset[attr];
        persist();
        renderControls();
        renderStatus();
        ctx.refresh();
      }),
    );
  }
  bindSeg('#songModes', 'mode', 'mode');
  bindSeg('#songHands', 'hands', 'hands');
  $('#songBpm').addEventListener('input', (e) => {
    settings.bpm = Number(e.target.value);
    $('#songBpmVal').textContent = settings.bpm;
    persist();
  });
  for (const [sel, key] of [['#songAccomp', 'accomp'], ['#songLoop', 'loop'], ['#songMetro', 'metro']]) {
    $(sel).addEventListener('change', (e) => {
      settings[key] = e.target.checked;
      persist();
    });
  }
  for (const sel of ['#songFrom', '#songTo']) {
    $(sel).addEventListener('change', () => {
      stopAll();
      applyRange();
      v.index = v.range[0];
      v.score.clearMarks();
      showCurrent();
    });
  }

  function renderControls() {
    $$('#songModes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
    $$('#songHands button').forEach((b) => b.classList.toggle('active', b.dataset.hands === settings.hands));
    $('#songBpm').value = settings.bpm;
    $('#songBpmVal').textContent = settings.bpm;
    $('#songAccomp').checked = settings.accomp;
    $('#songLoop').checked = settings.loop;
    $('#songMetro').checked = settings.metro;
    $('#songAccompWrap').hidden = settings.hands === 'both' || settings.mode === 'listen';
    $('#songMetroWrap').hidden = settings.mode !== 'tempo';
    $('#songStart').textContent = { wait: '▶ Bắt đầu tập', tempo: '▶ Bắt đầu (đếm vào 1 ô nhịp)', listen: '▶ Nghe mẫu' }[settings.mode];
    $('#songStart').hidden = v.running;
    $('#songStop').hidden = !v.running;
  }

  // ------------------------------------------------------------ loading a song
  function loadSong() {
    const entry = songs.find((s) => s.id === settings.current) ?? songs[0];
    settings.current = entry.id;
    const song = parseSong(entry.text);
    v.song = song;
    v.events = song.errors.length ? [] : buildEvents(song);
    $('#songTitle').textContent = song.meta.title;
    $('#songMeta').textContent = [song.meta.composer, `Giọng ${pretty(song.meta.key)}`, `Nhịp ${song.meta.time}`, song.meta.tempo ? `♩ = ${song.meta.tempo}` : '']
      .filter(Boolean)
      .join(' · ');
    if (song.errors.length) {
      $('#songScore').innerHTML = `<p class="feedback bad">Bài hát có lỗi: ${escapeHtml(song.errors[0])} Bấm “Sửa” để chỉnh.</p>`;
      v.score = null;
      return;
    }
    v.score = renderScore($('#songScore'), song, v.events, {
      onClickEvent: (i) => {
        if (v.running) return;
        v.index = i;
        showCurrent();
        playEvent(v.events[i], { both: true });
      },
    });
    const first = song.measures[0].number;
    const last = song.measures[song.measures.length - 1].number;
    for (const sel of ['#songFrom', '#songTo']) {
      $(sel).min = first;
      $(sel).max = last;
    }
    $('#songFrom').value = first;
    $('#songTo').value = last;
    applyRange();
    v.index = v.range[0];
    $('#songSummary').hidden = true;
    showCurrent();
    ctx.onRangeChange();
  }

  function applyRange() {
    const nums = v.song.measures.map((m) => m.number);
    let a = clamp(Number($('#songFrom').value), nums[0], nums[nums.length - 1]);
    let b = clamp(Number($('#songTo').value), nums[0], nums[nums.length - 1]);
    if (b < a) [a, b] = [b, a];
    $('#songFrom').value = a;
    $('#songTo').value = b;
    const inRange = v.events.filter((e) => {
      const n = v.song.measures[e.measure].number;
      return n >= a && n <= b;
    });
    v.range = inRange.length ? [inRange[0].index, inRange[inRange.length - 1].index] : [0, Math.max(0, v.events.length - 1)];
    v.rangeMeasures = [a, b];
  }

  // ------------------------------------------------------------ what to play
  /** Notes the learner must play for an event, depending on the chosen hand(s). */
  function required(ev, hands = settings.hands) {
    return {
      rh: hands !== 'L' && ev?.rh ? ev.rh : null,
      lh: hands !== 'R' && ev?.lh ? ev.lh : null,
    };
  }
  const hasReq = (ev) => {
    const r = required(ev);
    return !!(r.rh || r.lh);
  };

  /** Sounding length (beats) of a melody note including tied continuations. */
  function soundBeats(note) {
    let d = note.dur;
    let i = v.song.notes.indexOf(note);
    while (v.song.notes[i]?.tieNext && v.song.notes[i + 1]) {
      d += v.song.notes[i + 1].dur;
      i++;
    }
    return d;
  }

  const beatSec = () => 60 / settings.bpm;

  function playEvent(ev, { both = false, skip = {} } = {}) {
    if (!ev) return;
    const sec = beatSec();
    if (ev.rh && (both || !skip.rh)) synth.noteOn(ev.rh.midi, 80, 0, Math.max(0.15, soundBeats(ev.rh) * sec * 0.95));
    if (ev.lh && (both || !skip.lh)) synth.noteOn(ev.lh.midi, 65, 0, Math.max(0.2, ev.lh.dur * sec * 0.95));
  }

  /** Accompaniment: play the parts of `ev` the learner is not practising. */
  function accompany(ev) {
    if (!settings.accomp || settings.hands === 'both') return;
    playEvent(ev, { skip: { rh: settings.hands !== 'L', lh: settings.hands !== 'R' } });
  }

  // ------------------------------------------------------------ status / keyboard
  function showCurrent() {
    if (!v.score) return;
    v.score.setCurrent(v.index);
    renderStatus();
    ctx.refresh();
  }

  function renderStatus() {
    const ev = v.events[v.index];
    const r = required(ev, settings.mode === 'listen' ? 'both' : settings.hands);
    const noteText = (n) => `ngón ${n.finger} · ${pretty(n.name)}${n.octave} (${solfegeName(n.name)})`;
    $('#songRH').textContent = r.rh ? noteText(r.rh) : ev?.rh && settings.hands === 'L' ? 'máy chơi' : '—';
    $('#songLH').textContent = r.lh ? `${noteText(r.lh)} — hợp âm ${pretty(r.lh.chord.symbol)}` : ev?.lh && settings.hands === 'R' ? `máy chơi (${pretty(ev.lh.chord.symbol)})` : ev?.chord && !ev.chord.none ? `giữ (${pretty(ev.chord.symbol)})` : '—';
    const [a, b] = v.range;
    const done = Math.max(0, Math.min(v.index, b + 1) - a);
    $('#songProgress').textContent = v.events.length ? `${done}/${b - a + 1} · ô nhịp ${v.song.measures[ev?.measure ?? 0].number}` : '—';
  }

  function pianoState(pressed) {
    const st = { pressed, target: [], correct: [], wrong: [], next: [], fingers: new Map() };
    const ev = v.events[v.index];
    if (!ev) return st;
    const r = required(ev, settings.mode === 'listen' ? 'both' : settings.hands);
    for (const [n, hand] of [[r.rh, 'R'], [r.lh, 'L']]) {
      if (!n) continue;
      st.target.push(n.midi);
      st.fingers.set(n.midi, { finger: n.finger, hand });
    }
    if (settings.mode !== 'listen') {
      const nextEv = v.events.slice(v.index + 1, v.range[1] + 1).find(hasReq);
      if (nextEv) {
        const nr = required(nextEv);
        st.next = [nr.rh?.midi, nr.lh?.midi].filter((m) => m != null);
      }
    }
    for (const m of pressed) if (st.target.includes(m)) st.correct.push(m);
    return st;
  }

  function noteRange() {
    if (!v.events.length) return null;
    const all = v.events.flatMap((e) => [e.rh?.midi, e.lh?.midi]).filter((m) => m != null);
    return { lo: Math.min(...all), hi: Math.max(...all), focus: pianoFocus() };
  }
  function pianoFocus() {
    const ev = v.events[v.index];
    return ev ? [ev.rh?.midi, ev.lh?.midi].filter((m) => m != null) : [];
  }

  /** Key-signature spelling so played notes are named like the sheet (Bb rather than A#). */
  function spellContext() {
    if (!v.song) return null;
    return { notes: keyScaleNotes(v.song.keySig).map((n) => ({ ...n, midi: n.pc })), pcs: [] };
  }

  // ------------------------------------------------------------ note input
  function onNoteOn(m) {
    if (!v.score || !v.events.length) return;
    if (!v.running) {
      // Not practising: pressing the shown key still moves along, so the score doubles as a guide.
      if (settings.mode === 'wait') startWait(true);
      else return;
    }
    if (settings.mode === 'wait') waitNote(m);
    else if (settings.mode === 'tempo') tempoNote(m);
  }

  const isBassOf = (m, ev) => ev?.chord && !ev.chord.none && m < 60 && mod12(m) === ev.chord.bassPc;

  // ---- wait mode: the score waits until the right key(s) are pressed
  function startWait(silent = false) {
    stopAll();
    v.running = true;
    v.run = { mode: 'wait', mistakes: 0, perMeasure: new Map(), clean: 0, total: 0, startedAt: performance.now(), hit: { rh: false, lh: false }, evMistakes: 0 };
    v.score.clearMarks();
    if (v.index < v.range[0] || v.index > v.range[1]) v.index = v.range[0];
    skipToRequired();
    renderControls();
    if (!silent) feedback(`Chơi các phím màu xanh (${HANDS_LABEL[settings.hands]}). Số trên phím là ngón tay.`, 'info');
    showCurrent();
  }

  /** In wait mode, events with nothing to play for the chosen hand are played by the app. */
  function skipToRequired() {
    while (v.index <= v.range[1] && !hasReq(v.events[v.index])) {
      accompany(v.events[v.index]);
      v.index++;
    }
    if (v.index > v.range[1]) finishOrLoop();
  }

  function waitNote(m) {
    const ev = v.events[v.index];
    if (!ev) return;
    const r = required(ev);
    const run = v.run;
    if (r.rh && m === r.rh.midi) run.hit.rh = true;
    else if (r.lh && m < (r.rh ? r.rh.midi : 60) && mod12(m) === mod12(r.lh.midi)) run.hit.lh = true;
    else if (isBassOf(m, ev) || (r.lh && run.hit.lh && mod12(m) === mod12(r.lh.midi))) return; // harmless bass note
    else {
      run.mistakes++;
      run.evMistakes++;
      const num = v.song.measures[ev.measure].number;
      run.perMeasure.set(num, (run.perMeasure.get(num) ?? 0) + 1);
      const want = [r.rh && `${pretty(r.rh.name)}${r.rh.octave} (ngón ${r.rh.finger})`, r.lh && `${pretty(r.lh.name)}${r.lh.octave} tay trái`].filter(Boolean).join(' + ');
      feedback(`✗ Chưa đúng phím — cần ${want}.`, 'bad');
      v.score.mark(ev.index, 'bad');
      return;
    }
    if ((r.rh && !run.hit.rh) || (r.lh && !run.hit.lh)) return;
    // Event complete.
    run.total++;
    if (!run.evMistakes) run.clean++;
    v.score.mark(ev.index, run.evMistakes ? 'late' : 'ok');
    feedback(run.evMistakes ? '✓ Đúng rồi, tiếp tục!' : '', run.evMistakes ? 'ok' : 'info');
    run.evMistakes = 0;
    run.hit = { rh: false, lh: false };
    accompany(ev);
    // Let the app play following events that need nothing from the learner, in time.
    const start = ev.time;
    v.index++;
    while (v.index <= v.range[1] && !hasReq(v.events[v.index])) {
      const e2 = v.events[v.index];
      v.timers.push(setTimeout(() => accompany(e2), (e2.time - start) * beatSec() * 1000));
      v.index++;
    }
    if (v.index > v.range[1]) return finishOrLoop();
    showCurrent();
  }

  // ---- tempo & listen modes: a moving cursor
  function startClock() {
    stopAll();
    synth.ensure();
    const mode = settings.mode;
    const [a, b] = v.range;
    const startT = v.song.measures.find((m) => m.number === v.rangeMeasures[0]).start;
    const lastM = v.song.measures.find((m) => m.number === v.rangeMeasures[1]);
    const endT = lastM.start + lastM.length;
    const bpm = v.song.beatsPerMeasure;
    const countIn = mode === 'tempo' ? Math.round(bpm) : 0;
    v.running = true;
    v.score.clearMarks();
    v.run = {
      mode,
      t0: performance.now() + countIn * beatSec() * 1000,
      startT,
      endT,
      next: a, // next event to play/judge
      judged: a,
      hits: new Map(), // event index -> {rh, lh}
      mistakes: 0,
      ok: 0,
      missed: 0,
      perMeasure: new Map(),
      lastBeat: -countIn - 1,
    };
    v.index = a;
    renderControls();
    feedback(mode === 'tempo' ? `Đếm vào ${countIn} phách… rồi chơi theo vạch xanh (${HANDS_LABEL[settings.hands]}).` : 'Đang phát mẫu — nhìn phím đàn và số ngón tay.', 'info');
    showCurrent();
    const tol = Math.min(0.45, Math.max(0.15, 0.28 / beatSec())); // beats
    v.run.tol = tol;
    const tick = () => {
      if (!v.running) return;
      const run = v.run;
      const now = performance.now();
      const songT = run.startT + (now - run.t0) / (beatSec() * 1000);
      // Metronome & count-in.
      const beat = Math.floor((now - run.t0) / (beatSec() * 1000));
      if (beat !== run.lastBeat) {
        run.lastBeat = beat;
        if (beat < 0) {
          synth.click(beat === -countIn);
          feedback(`Đếm vào: ${-beat}`, 'info');
        } else if (mode === 'tempo' && settings.metro) {
          const tb = run.startT + beat;
          const onBar = v.song.measures.some((m) => Math.abs(m.start - tb) < 1e-6);
          synth.click(onBar);
        }
      }
      if (songT >= run.startT) {
        v.score.setCursorX(v.score.xOfTime(Math.min(songT, run.endT)));
        // Play events as they arrive (all of them when listening, the other hand when practising).
        while (run.next <= b && v.events[run.next].time <= songT) {
          const ev = v.events[run.next];
          if (mode === 'listen') playEvent(ev, { both: true });
          else accompany(ev);
          v.index = run.next;
          v.score.setCurrent(run.next);
          renderStatus();
          ctx.refresh();
          run.next++;
        }
        if (mode === 'tempo') {
          // Events whose window closed without a complete answer are missed.
          while (run.judged <= b && v.events[run.judged].time + tol < songT) {
            const ev = v.events[run.judged];
            if (hasReq(ev) && !isComplete(ev)) {
              run.missed++;
              const num = v.song.measures[ev.measure].number;
              run.perMeasure.set(num, (run.perMeasure.get(num) ?? 0) + 1);
              v.score.mark(ev.index, 'bad');
            }
            run.judged++;
          }
        }
      }
      if (songT > run.endT + (mode === 'tempo' ? tol : 0)) {
        if (settings.loop) return startClock();
        return finish();
      }
      v.raf = requestAnimationFrame(tick);
    };
    v.raf = requestAnimationFrame(tick);
  }

  function isComplete(ev) {
    const r = required(ev);
    const h = v.run.hits.get(ev.index) ?? {};
    return (!r.rh || h.rh) && (!r.lh || h.lh);
  }

  function tempoNote(m) {
    const run = v.run;
    if (!run || run.mode !== 'tempo') return;
    const songT = run.startT + (performance.now() - run.t0) / (beatSec() * 1000);
    let best = null;
    let bestD = Infinity;
    for (let i = Math.max(v.range[0], run.judged - 2); i <= v.range[1]; i++) {
      const ev = v.events[i];
      const d = Math.abs(ev.time - songT);
      if (ev.time - songT > run.tol) break;
      if (d > run.tol) continue;
      const r = required(ev);
      const h = run.hits.get(i) ?? {};
      const part = r.rh && !h.rh && m === r.rh.midi ? 'rh' : r.lh && !h.lh && m < 60 && mod12(m) === mod12(r.lh.midi) ? 'lh' : null;
      if (part && d < bestD) {
        best = { i, part };
        bestD = d;
      }
    }
    if (best) {
      const h = run.hits.get(best.i) ?? {};
      h[best.part] = true;
      run.hits.set(best.i, h);
      const ev = v.events[best.i];
      if (isComplete(ev)) {
        run.ok++;
        v.score.mark(ev.index, 'ok');
      }
      return;
    }
    const ev = v.events[v.index];
    if (isBassOf(m, ev)) return;
    run.mistakes++;
    feedback('✗ Sai phím hoặc lệch nhịp', 'bad');
  }

  // ------------------------------------------------------------ run control
  function start() {
    if (!v.events.length) return;
    $('#songSummary').hidden = true;
    if (settings.mode === 'wait') {
      v.index = v.range[0];
      startWait();
    } else startClock();
  }

  function stopAll() {
    v.timers.forEach(clearTimeout);
    v.timers = [];
    cancelAnimationFrame(v.raf);
    const was = v.running;
    v.running = false;
    if (was) {
      renderControls();
      renderStatus();
    }
  }

  function finishOrLoop() {
    if (settings.loop && v.run?.mode === 'wait') {
      const run = v.run;
      v.index = v.range[0];
      v.score.clearMarks();
      run.hit = { rh: false, lh: false };
      feedback('↻ Lặp lại đoạn nhạc', 'info');
      skipToRequired();
      showCurrent();
      return;
    }
    finish();
  }

  function finish() {
    const run = v.run;
    stopAll();
    if (!run) return;
    const box = $('#songSummary');
    const worst = [...run.perMeasure.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    let html = '<h3>Kết quả</h3>';
    if (run.mode === 'wait') {
      const secs = Math.round((performance.now() - run.startedAt) / 1000);
      const pct = run.total ? Math.round((run.clean / run.total) * 100) : 0;
      html += `<div class="summary">${tile(`${run.clean}/${run.total}`, 'Nốt đúng ngay lần đầu')}${tile(`${pct}%`, 'Tỉ lệ')}${tile(run.mistakes, 'Lần bấm sai')}${tile(`${secs}s`, 'Thời gian')}</div>`;
      html += pct >= 90 && run.total ? '<p class="feedback ok">Rất tốt! Thử chế độ “Theo nhịp” ở tốc độ chậm.</p>' : '';
    } else if (run.mode === 'tempo') {
      const total = v.events.slice(v.range[0], v.range[1] + 1).filter(hasReq).length;
      const pct = total ? Math.round((run.ok / total) * 100) : 0;
      html += `<div class="summary">${tile(`${run.ok}/${total}`, 'Nốt đúng nhịp')}${tile(`${pct}%`, 'Tỉ lệ')}${tile(run.missed, 'Nốt bị lỡ')}${tile(run.mistakes, 'Phím sai')}</div>`;
      html += pct >= 90
        ? `<p class="feedback ok">Tuyệt! Tăng tốc độ lên ${Math.min(160, settings.bpm + 5)} BPM nhé.</p>`
        : `<p class="muted">Giảm tốc độ hoặc tập “Chờ chơi đúng” thêm vài lần trước.</p>`;
    } else {
      feedback('Đã phát xong.', 'info');
      showCurrent();
      return;
    }
    if (worst.length) {
      html += `<p>Ô nhịp cần tập thêm (bấm để tập riêng):</p><div class="chip-list">${worst
        .map(([num, n]) => `<button class="chip" data-measure="${num}">Ô ${num} · ${n} lỗi</button>`)
        .join('')}</div>`;
    }
    html += '<div class="btn-row"><button class="btn btn-primary" id="songAgain">Tập lại</button></div>';
    box.innerHTML = html;
    box.hidden = false;
    box.querySelectorAll('[data-measure]').forEach((b) =>
      b.addEventListener('click', () => {
        const num = Number(b.dataset.measure);
        $('#songFrom').value = Math.max(Number($('#songFrom').min), num - 1);
        $('#songTo').value = Math.min(Number($('#songTo').max), num);
        applyRange();
        settings.mode = 'wait';
        persist();
        renderControls();
        box.hidden = true;
        start();
      }),
    );
    $('#songAgain').addEventListener('click', start);
    feedback('Đã xong đoạn nhạc!', 'ok');
    v.index = v.range[0];
    showCurrent();
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function feedback(text, kind) {
    const fb = $('#songFeedback');
    fb.className = `feedback ${kind}`;
    fb.textContent = text;
  }

  $('#songStart').addEventListener('click', start);
  $('#songStop').addEventListener('click', () => (v.run?.mode === 'listen' ? stopAll() : finish()));
  $('#songRestart').addEventListener('click', () => {
    stopAll();
    v.index = v.range[0];
    v.score?.clearMarks();
    feedback('', 'info');
    showCurrent();
  });

  // ------------------------------------------------------------ init
  renderLibrary();
  renderControls();
  loadSong();

  return {
    onNoteOn,
    pianoState,
    noteRange,
    spellContext,
    stop: stopAll,
    render() {
      renderControls();
      if (v.score) showCurrent();
    },
  };
}

function tile(v, k) {
  return `<div class="stat-tile"><div class="v">${v}</div><div class="k">${k}</div></div>`;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : a));
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

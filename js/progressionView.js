// UI controller for the "Vòng hợp âm" (chord progression) tab.
import { CHORD_TYPES, TYPE_BY_ID, INVERSION_NAMES, maxInversion, rootNameFor, solfegeName, mod12 } from './theory.js';
import {
  PRESETS, MAJOR_KEYS, MINOR_KEYS, presetItems, itemLabel, voiceProgression, matchStep, transitionTips,
} from './progression.js';
import { renderStaff } from './staff.js';
import { load, save } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const ROOT_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
const COL_GAP = 110;
const STAFF_SCALE = 1.15;

/**
 * @param {{synth, pretty:(s:string)=>string, toast:(s:string)=>void, activeNotes:()=>number[],
 *   refresh:()=>void, onRangeChange:()=>void, isActive:()=>boolean}} ctx
 */
export function createProgressionView(ctx) {
  const { synth, pretty, toast } = ctx;
  const data = { items: presetItems('pop', 0), bass: 'root', ...load('prog', {}) };
  const settings = { loops: 2, bpm: 70, beats: 4, strict: true, showNext: true, ...load('progSettings', {}) };
  let saved = load('progSaved', []);

  const v = {
    steps: [],
    index: 0,
    mode: 'step', // step | wait | tempo
    running: false,
    run: null,
    timers: [],
    raf: 0,
  };

  const cur = () => v.steps[v.index] ?? null;
  const nextIndex = () => (v.steps.length ? (v.index + 1) % v.steps.length : 0);
  const prevIndex = () => (v.index > 0 ? v.index - 1 : v.steps.length > 1 ? v.steps.length - 1 : null);
  const keyOf = (notes) => notes.join(',');

  function persist() {
    save('prog', data);
    save('progSettings', settings);
  }

  // ------------------------------------------------------------ builder
  function fillKeySelect() {
    const preset = PRESETS.find((p) => p.id === $('#progPreset').value) ?? PRESETS[0];
    const names = preset.minor ? MINOR_KEYS : MAJOR_KEYS;
    const keep = $('#progKey').value || '0';
    $('#progKey').replaceChildren(...names.map((n, pc) => new Option(`${pretty(n)} ${preset.minor ? 'thứ' : 'trưởng'}`, pc)));
    $('#progKey').value = keep;
  }

  $('#progPreset').replaceChildren(...PRESETS.map((p) => new Option(p.name, p.id)));
  $('#progPreset').addEventListener('change', fillKeySelect);
  fillKeySelect();
  $('#progRoot').replaceChildren(...ROOT_LABELS.map((n, pc) => new Option(pretty(n), pc)));
  $('#progType').replaceChildren(...CHORD_TYPES.map((t) => new Option(`${t.name} (${t.symbol || 'M'})`, t.id)));

  $('#progUsePreset').addEventListener('click', () => {
    stopAll();
    data.items = presetItems($('#progPreset').value, Number($('#progKey').value));
    v.index = 0;
    recompute();
    toast(`Đã tạo vòng: ${data.items.map((i) => pretty(itemLabel(i))).join(' → ')}`);
  });
  $('#progAdd').addEventListener('click', () => {
    stopAll();
    const pc = Number($('#progRoot').value);
    const typeId = $('#progType').value;
    data.items.push({ pc, typeId, rootName: rootNameFor(pc, typeId), inversion: 'auto' });
    v.index = data.items.length - 1;
    recompute();
    synth.playChord(cur().midis, { duration: 1 });
  });
  $('#progClear').addEventListener('click', () => {
    if (data.items.length && !confirm('Xóa toàn bộ hợp âm trong vòng?')) return;
    stopAll();
    data.items = [];
    v.index = 0;
    recompute();
  });
  $('#progBass').value = data.bass;
  $('#progBass').addEventListener('change', (e) => {
    data.bass = e.target.value;
    recompute();
  });

  $('#progList').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const i = Number(btn.closest('li').dataset.index);
    const act = btn.dataset.act;
    if (act === 'select') return select(i, true);
    stopAll();
    if (act === 'up' && i > 0) [data.items[i - 1], data.items[i]] = [data.items[i], data.items[i - 1]];
    if (act === 'down' && i < data.items.length - 1) [data.items[i + 1], data.items[i]] = [data.items[i], data.items[i + 1]];
    if (act === 'del') data.items.splice(i, 1);
    if (act === 'up' || act === 'down') v.index = act === 'up' ? Math.max(0, i - 1) : Math.min(data.items.length - 1, i + 1);
    recompute();
  });
  $('#progList').addEventListener('change', (e) => {
    const sel = e.target.closest('select');
    if (!sel) return;
    const i = Number(sel.closest('li').dataset.index);
    data.items[i].inversion = sel.value === 'auto' ? 'auto' : Number(sel.value);
    v.index = i;
    recompute();
    synth.playChord(cur().midis, { duration: 1 });
  });

  function renderSaved() {
    $('#progSaved').replaceChildren(
      ...(saved.length ? saved.map((s, i) => new Option(`${s.name} (${s.items.length} hợp âm)`, i)) : [new Option('Chưa có vòng nào được lưu', '')]),
    );
  }
  $('#progSave').addEventListener('click', () => {
    const name = $('#progName').value.trim();
    if (!name) return toast('Hãy nhập tên cho vòng hợp âm.');
    if (!data.items.length) return toast('Vòng hợp âm đang trống.');
    saved = saved.filter((s) => s.name !== name);
    saved.push({ name, items: structuredClone(data.items), bass: data.bass });
    save('progSaved', saved);
    renderSaved();
    toast(`Đã lưu “${name}”.`);
  });
  $('#progOpen').addEventListener('click', () => {
    const s = saved[Number($('#progSaved').value)];
    if (!s) return;
    stopAll();
    data.items = structuredClone(s.items);
    data.bass = s.bass;
    $('#progBass').value = s.bass;
    $('#progName').value = s.name;
    v.index = 0;
    recompute();
  });
  $('#progDelete').addEventListener('click', () => {
    const i = Number($('#progSaved').value);
    if (!saved[i] || !confirm(`Xóa vòng “${saved[i].name}”?`)) return;
    saved.splice(i, 1);
    save('progSaved', saved);
    renderSaved();
  });

  // ------------------------------------------------------------ settings
  const bindSetting = (sel, key, cast, prop = 'value') => {
    const elx = $(sel);
    elx[prop] = prop === 'checked' ? settings[key] : String(settings[key]);
    elx.addEventListener(prop === 'value' && elx.type === 'range' ? 'input' : 'change', () => {
      settings[key] = cast(elx[prop]);
      persist();
      $('#progBpmVal').textContent = settings.bpm;
      if (key === 'showNext') ctx.refresh();
    });
  };
  bindSetting('#progLoops', 'loops', Number);
  bindSetting('#progBpm', 'bpm', Number);
  bindSetting('#progBeats', 'beats', Number);
  bindSetting('#progStrict', 'strict', Boolean, 'checked');
  bindSetting('#progShowNext', 'showNext', Boolean, 'checked');
  $('#progBpmVal').textContent = settings.bpm;

  $$('#progModes button').forEach((b) =>
    b.addEventListener('click', () => {
      stopAll();
      setMode(b.dataset.mode);
    }),
  );
  function setMode(mode) {
    v.mode = mode;
    $$('#progModes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#progStart').textContent = mode === 'tempo' ? 'Bắt đầu (theo nhịp)' : 'Bắt đầu luyện';
    renderCurrent();
  }

  $('#progPrev').addEventListener('click', () => v.steps.length && select((v.index - 1 + v.steps.length) % v.steps.length, true));
  $('#progNext').addEventListener('click', () => v.steps.length && select(nextIndex(), true));
  $('#progListen').addEventListener('click', listen);
  $('#progStart').addEventListener('click', start);
  $('#progStop').addEventListener('click', () => (v.running ? finish() : stopAll()));

  // ------------------------------------------------------------ rendering
  function recompute() {
    v.steps = data.items.length ? voiceProgression(data.items, { bass: data.bass }) : [];
    v.index = Math.min(v.index, Math.max(0, v.steps.length - 1));
    persist();
    renderList();
    renderSheet();
    renderCurrent();
    ctx.onRangeChange();
    ctx.refresh();
  }

  function renderList() {
    const list = $('#progList');
    if (!data.items.length) {
      list.innerHTML = '<li class="empty">Vòng đang trống — chọn mẫu hoặc thêm hợp âm.</li>';
      return;
    }
    list.innerHTML = data.items
      .map((item, i) => {
        const step = v.steps[i];
        const max = maxInversion(item.typeId);
        const opts = [`<option value="auto"${item.inversion === 'auto' ? ' selected' : ''}>Tự động · ${INVERSION_NAMES[step.inversion]}</option>`];
        for (let k = 0; k <= max; k++) opts.push(`<option value="${k}"${item.inversion === k ? ' selected' : ''}>${INVERSION_NAMES[k]}</option>`);
        return `<li data-index="${i}" class="${i === v.index ? 'current' : ''}">
          <button class="prog-chord" data-act="select" title="Chọn hợp âm này">${pretty(step.label)}</button>
          <select aria-label="Thế bấm">${opts.join('')}</select>
          <button class="mini" data-act="up" title="Lên" aria-label="Chuyển lên">↑</button>
          <button class="mini" data-act="down" title="Xuống" aria-label="Chuyển xuống">↓</button>
          <button class="mini" data-act="del" title="Xóa" aria-label="Xóa">✕</button>
        </li>`;
      })
      .join('');
  }

  function renderSheet() {
    const box = $('#progStaff');
    if (!v.steps.length) {
      box.replaceChildren();
      return;
    }
    const results = v.run?.marks;
    const cols = v.steps.map((s, i) => ({
      // Right hand always on the treble staff, left hand on the bass staff.
      notes: [...s.lh.map((n) => ({ ...n, clef: 'bass' })), ...s.rh.map((n) => ({ ...n, clef: 'treble' }))],
      label: pretty(s.label),
      highlight: i === v.index,
      color: results?.[i] === true ? 'var(--ok)' : results?.[i] === false ? 'var(--bad)' : undefined,
    }));
    // Note heads stay ink-coloured; only labels pick up the result colour.
    for (const c of cols) if (c.color) c.notes = c.notes.map((n) => ({ ...n, color: 'var(--staff-ink)' }));
    renderStaff(box, cols, {
      colGap: COL_GAP,
      barlines: true,
      scale: STAFF_SCALE,
      ariaLabel: 'Vòng hợp âm trên khuông nhạc kèm số ngón tay',
      onColumnClick: v.running ? null : (i) => select(i, true),
    });
    const x = (122 + v.index * COL_GAP) * STAFF_SCALE;
    if (x < box.scrollLeft + 60 || x > box.scrollLeft + box.clientWidth - 60) box.scrollLeft = x - box.clientWidth / 2;
  }

  const noteList = (notes) => notes.map((n) => `${pretty(n.name)} (${n.finger})`).join(' – ');

  function placementTips(step) {
    const tips = [`Tay phải: ${step.rh.map((n) => `ngón ${n.finger} vào ${n.name}`).join(', ')}.`];
    if (step.lh.length) tips.push(`Tay trái: ${step.lh.map((n) => `ngón ${n.finger} vào ${n.name}`).join(', ')}.`);
    if (step.rh.length < step.chord.notes.length) tips.push('Tay phải bỏ nốt gốc (tay trái đã chơi), giúp hợp âm 5 nốt vừa một bàn tay.');
    return tips;
  }

  function renderCurrent() {
    const step = cur();
    $$('#progList li').forEach((li) => li.classList.toggle('current', Number(li.dataset.index) === v.index));
    const disabled = !step;
    ['#progStart', '#progListen', '#progPrev', '#progNext'].forEach((s) => ($(s).disabled = disabled || (v.running && s !== '#progStart')));
    $('#progStart').hidden = v.running;
    $('#progStop').hidden = !v.running && !v.playing;
    if (!step) {
      $('#progSymbol').textContent = '—';
      $('#progTitle').textContent = '';
      $('#progCounter').textContent = '';
      $('#progRH').textContent = '—';
      $('#progLH').textContent = '—';
      $('#progNextLabel').textContent = '—';
      $('#progTips').innerHTML = '';
      return;
    }
    const n = v.steps.length;
    let counter = `Hợp âm ${v.index + 1}/${n}`;
    if (v.running) counter += ` · Vòng ${v.run.loop}${v.run.loopsTotal ? `/${v.run.loopsTotal}` : ''}`;
    $('#progCounter').textContent = counter;
    $('#progSymbol').textContent = pretty(step.label);
    $('#progSymbol').classList.remove('ok');
    const rootless = step.rh.length < step.chord.notes.length;
    $('#progTitle').textContent = `${solfegeName(step.chord.root)} ${TYPE_BY_ID[step.chord.typeId].name.toLowerCase()} · ${
      INVERSION_NAMES[step.inversion]
    }${rootless ? ' (tay phải bỏ nốt gốc)' : ''}`;
    $('#progRH').textContent = noteList(step.rh);
    $('#progLHBox').hidden = !step.lh.length;
    $('#progLH').textContent = noteList(step.lh);
    $('#progNextLabel').textContent = n > 1 ? pretty(v.steps[nextIndex()].label) : '—';

    const p = prevIndex();
    const firstOfFirstLoop = v.index === 0 && !(v.running && v.run.loop > 1);
    let title;
    let tips;
    if (p == null || firstOfFirstLoop) {
      title = `Cách đặt tay cho ${pretty(step.label)}`;
      tips = placementTips(step);
      if (p != null && !v.running) {
        tips.push(`Khi quay lại từ ${v.steps[p].label}: ${transitionTips(v.steps[p], step).join(' ')}`);
      }
    } else {
      title = `Chuyển từ ${pretty(v.steps[p].label)} sang ${pretty(step.label)}`;
      tips = transitionTips(v.steps[p], step);
    }
    $('#progTipsTitle').textContent = title;
    $('#progTips').innerHTML = tips.map((t) => `<li>${escapeHtml(pretty(t))}</li>`).join('');
    renderBeats();
  }

  function renderBeats(beatInChord = -1, countIn = null) {
    const box = $('#progBeatsView');
    box.hidden = !(v.running && v.mode === 'tempo');
    if (box.hidden) return;
    if (countIn != null) {
      box.innerHTML = `<span class="count">Chuẩn bị… ${countIn}</span>`;
      return;
    }
    box.innerHTML = Array.from({ length: settings.beats }, (_, i) => `<i class="${i <= beatInChord ? 'on' : ''}${i === 0 ? ' first' : ''}"></i>`).join('');
  }

  function select(i, play = false) {
    if (v.running) return;
    v.index = i;
    renderList();
    renderSheet();
    renderCurrent();
    feedback('', 'info');
    ctx.refresh();
    if (play) synth.playChord(cur().midis, { duration: 1.2 });
  }

  function feedback(text, kind = 'info') {
    const fb = $('#progFeedback');
    fb.className = `feedback ${kind}`;
    fb.textContent = text;
  }

  function reasonText(step, m) {
    if (m.reason === 'lh') return `Tay trái cần chơi nốt gốc ${pretty(step.lh.map((n) => n.name).join(' – '))} (thấp hơn tay phải).`;
    if (m.reason === 'position') return `Đúng nốt nhưng sai thế bấm: nốt thấp nhất của tay phải phải là ${pretty(step.rh[0].name)} (ngón 1).`;
    if (m.extra.length) return 'Có nốt không thuộc hợp âm (phím đỏ).';
    return 'Còn thiếu nốt — xem các phím có số ngón tay.';
  }

  // ------------------------------------------------------------ keyboard view for the app
  function pianoState(pressed) {
    const step = cur();
    const state = { pressed, target: [], correct: [], wrong: [], next: [], fingers: new Map() };
    if (!step) return state;
    state.target = step.midis;
    for (const n of [...step.lh, ...step.rh]) state.fingers.set(n.midi, { finger: n.finger, hand: n.hand });
    if (settings.showNext && v.steps.length > 1) state.next = v.steps[nextIndex()].midis;
    for (const m of pressed) (step.pcs.includes(mod12(m)) ? state.correct : state.wrong).push(m);
    return state;
  }

  function noteRange() {
    const all = v.steps.flatMap((s) => s.midis);
    if (!all.length) return null;
    return { lo: Math.min(...all), hi: Math.max(...all) };
  }

  // ------------------------------------------------------------ note input
  function onNotes(notes) {
    const step = cur();
    if (!step || v.playing) return;
    const m = matchStep(step, notes, { strict: settings.strict });
    if (!v.running) {
      if (!notes.length) return;
      if (m.ok) {
        $('#progSymbol').classList.add('ok');
        feedback(`✓ Chính xác! ${v.steps.length > 1 ? `Giờ chuyển sang ${pretty(v.steps[nextIndex()].label)} (bấm ›).` : ''}`, 'ok');
      } else if (m.complete) {
        $('#progSymbol').classList.remove('ok');
        feedback(`✗ ${reasonText(step, m)}`, 'bad');
      }
      return;
    }
    if (v.mode === 'wait') onNotesWait(step, notes, m);
    else onNotesTempo(step, notes, m);
  }

  function onNotesWait(step, notes, m) {
    const r = v.run;
    const key = keyOf(notes);
    clearTimeout(r.evalTimer);
    if (!notes.length) {
      r.needChange = null;
      r.lock = null;
      return;
    }
    if (m.ok && key !== r.needChange) {
      const now = performance.now();
      const isTransition = !(v.index === 0 && r.loop === 1);
      if (isTransition) r.trans[v.index].times.push(now - r.lastOkAt);
      r.lastOkAt = now;
      r.marks[v.index] = r.trans[v.index].pending === 0;
      r.trans[v.index].pending = 0;
      r.needChange = key;
      r.lock = null;
      advanceWait();
      return;
    }
    if (!m.complete || key === r.needChange || key === r.lock) return;
    r.evalTimer = setTimeout(() => {
      const now = activeKey();
      if (now !== key || cur() !== step || !v.running) return;
      r.lock = key;
      r.trans[v.index].mistakes++;
      r.trans[v.index].pending++;
      synth.feedback(false);
      feedback(`✗ ${reasonText(step, m)}`, 'bad');
    }, 350);
  }

  const activeKey = () => keyOf(ctx.activeNotes());

  function advanceWait() {
    const r = v.run;
    let next = v.index + 1;
    if (next >= v.steps.length) {
      next = 0;
      r.loop++;
      if (r.loopsTotal && r.loop > r.loopsTotal) return finish();
    }
    v.index = next;
    feedback('✓', 'ok');
    renderSheet();
    renderCurrent();
    ctx.refresh();
  }

  function onNotesTempo(step, notes, m) {
    const r = v.run;
    if (!r.started) return;
    if (m.ok && !r.hit) {
      r.hit = true;
      $('#progSymbol').classList.add('ok');
      feedback('✓ Đúng nhịp!', 'ok');
    }
    // Accept the next chord slightly early (last half beat of the current chord).
    if (r.windowEnd - performance.now() < r.beatMs / 2 && v.steps.length > 1) {
      const nxt = v.steps[nextIndex()];
      if (matchStep(nxt, notes, { strict: settings.strict }).ok) r.preHit = true;
    }
    if (!m.ok && m.complete && !r.hit && notes.length) feedback(`✗ ${reasonText(step, m)}`, 'bad');
  }

  // ------------------------------------------------------------ run control
  function start() {
    if (!v.steps.length) return;
    stopAll();
    if (v.mode === 'step') setMode('wait');
    synth.ensure();
    v.running = true;
    v.index = 0;
    const n = v.steps.length;
    v.run = {
      loop: 1,
      loopsTotal: settings.loops,
      marks: new Array(n).fill(undefined),
      trans: v.steps.map(() => ({ times: [], mistakes: 0, pending: 0 })),
      hits: v.steps.map(() => ({ hit: 0, total: 0 })),
      lastOkAt: performance.now(),
      needChange: keyOf(ctx.activeNotes()) || null,
    };
    $('#progSummary').hidden = true;
    feedback(v.mode === 'wait' ? 'Chơi hợp âm đầu tiên để bắt đầu. Hợp âm chỉ chuyển khi bạn chơi đúng.' : 'Đếm vào 1 ô nhịp, rồi chơi mỗi hợp âm đúng phách đầu.', 'info');
    renderSheet();
    renderCurrent();
    ctx.refresh();
    if (v.mode === 'tempo') startTempo();
  }

  function startTempo() {
    const r = v.run;
    r.beatMs = 60000 / settings.bpm;
    r.beats = settings.beats;
    r.start = performance.now() + r.beatMs * r.beats; // one bar count-in
    r.lastBeat = -r.beats - 1;
    r.window = -1;
    const tick = () => {
      if (!v.running) return;
      const now = performance.now();
      const beat = Math.floor((now - r.start) / r.beatMs);
      if (beat !== r.lastBeat) {
        r.lastBeat = beat;
        if (beat < 0) {
          synth.click(beat === -r.beats);
          renderBeats(-1, -beat);
        } else {
          const w = Math.floor(beat / r.beats);
          if (w !== r.window) {
            if (!enterWindow(w)) return;
          }
          synth.click(beat % r.beats === 0);
          renderBeats(beat % r.beats);
        }
      }
      v.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Close the previous chord window and open window `w`. Returns false when the run ends. */
  function enterWindow(w) {
    const r = v.run;
    const n = v.steps.length;
    if (r.window >= 0) {
      const i = r.window % n;
      r.hits[i].total++;
      if (r.hit) r.hits[i].hit++;
      r.marks[i] = r.hit;
      if (!r.hit) feedback(`✗ Lỡ nhịp ${pretty(v.steps[i].label)}`, 'bad');
    }
    if (r.loopsTotal && w >= r.loopsTotal * n) {
      finish();
      return false;
    }
    r.window = w;
    r.started = true;
    r.hit = r.preHit ?? false;
    r.preHit = false;
    r.windowEnd = r.start + (w + 1) * r.beats * r.beatMs;
    r.loop = Math.floor(w / n) + 1;
    v.index = w % n;
    renderSheet();
    renderCurrent();
    if (r.hit) $('#progSymbol').classList.add('ok');
    ctx.refresh();
    return true;
  }

  function listen() {
    if (!v.steps.length) return;
    stopAll();
    synth.ensure();
    v.playing = true;
    const ms = (60000 / settings.bpm) * settings.beats;
    v.steps.forEach((s, i) => {
      v.timers.push(
        setTimeout(() => {
          v.index = i;
          renderSheet();
          renderCurrent();
          ctx.refresh();
          synth.playChord(s.midis, { duration: (ms / 1000) * 0.95 });
        }, i * ms),
      );
    });
    v.timers.push(setTimeout(() => stopAll(), v.steps.length * ms));
    renderCurrent();
  }

  function stopAll() {
    v.timers.forEach(clearTimeout);
    v.timers = [];
    cancelAnimationFrame(v.raf);
    if (v.run) clearTimeout(v.run.evalTimer);
    const was = v.running || v.playing;
    v.running = false;
    v.playing = false;
    if (was) {
      renderBeats();
      renderSheet();
      renderCurrent();
      ctx.refresh();
    }
  }

  function finish() {
    const r = v.run;
    const mode = v.mode;
    stopAll();
    showSummary(mode, r);
    feedback('Đã xong! Xem kết quả bên dưới.', 'ok');
  }

  function showSummary(mode, r) {
    const box = $('#progSummary');
    const n = v.steps.length;
    let html = '<h2>Kết quả luyện vòng hợp âm</h2>';
    if (mode === 'wait') {
      const rows = v.steps.map((s, i) => {
        const t = r.trans[i];
        const from = v.steps[(i - 1 + n) % n];
        const avg = t.times.length ? t.times.reduce((a, b) => a + b, 0) / t.times.length / 1000 : null;
        return { i, label: `${pretty(from.label)} → ${pretty(s.label)}`, avg, mistakes: t.mistakes, count: t.times.length };
      }).filter((x) => x.count || x.mistakes);
      const avgs = rows.filter((x) => x.avg != null).map((x) => x.avg);
      const overall = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0;
      const slow = rows.filter((x) => x.avg != null && (x.avg > overall * 1.3 || x.avg > 2) || x.mistakes > 0);
      html += `<p>Thời gian chuyển hợp âm trung bình: <b>${overall ? overall.toFixed(2) + ' giây' : '—'}</b>. Tổng lỗi: <b>${rows.reduce((a, x) => a + x.mistakes, 0)}</b>.</p>`;
      html += `<table><thead><tr><th>Chuyển hợp âm</th><th>Thời gian TB</th><th>Số lần</th><th>Lỗi</th></tr></thead><tbody>${rows
        .map((x) => `<tr class="${slow.includes(x) ? 'slow' : ''}"><td>${x.label}</td><td>${x.avg != null ? x.avg.toFixed(2) + 's' : '—'}</td><td>${x.count}</td><td>${x.mistakes}</td></tr>`)
        .join('')}</tbody></table>`;
      if (slow.length) {
        html += `<p class="muted">Gợi ý: tập riêng các bước chuyển tô đỏ ở chế độ “Xem từng bước” — đọc mục “Chuyển từ … sang …” và tập đặt ngón nhiều lần, rồi luyện lại.</p>`;
      } else if (overall && overall < 1) {
        html += '<p class="feedback ok">Rất tốt! Bạn đã chuyển hợp âm nhanh — hãy thử chế độ “Luyện theo nhịp”.</p>';
      }
    } else {
      const hit = r.hits.reduce((a, h) => a + h.hit, 0);
      const total = r.hits.reduce((a, h) => a + h.total, 0);
      const pct = total ? Math.round((hit / total) * 100) : 0;
      html += `<p>Đúng nhịp: <b>${hit}/${total}</b> (${pct}%) ở tốc độ ${settings.bpm} BPM.</p>`;
      html += `<table><thead><tr><th>Hợp âm</th><th>Đúng nhịp</th></tr></thead><tbody>${v.steps
        .map((s, i) => `<tr class="${r.hits[i].total && r.hits[i].hit < r.hits[i].total ? 'slow' : ''}"><td>${pretty(s.label)}</td><td>${r.hits[i].hit}/${r.hits[i].total}</td></tr>`)
        .join('')}</tbody></table>`;
      if (total) {
        html += pct >= 90
          ? `<p class="feedback ok">Tuyệt vời! Thử tăng tốc độ lên ${Math.min(160, settings.bpm + 10)} BPM.</p>`
          : pct < 60
            ? `<p class="muted">Hãy giảm tốc độ xuống ${Math.max(30, settings.bpm - 10)} BPM hoặc luyện ở chế độ “chờ chơi đúng” trước.</p>`
            : '<p class="muted">Khá tốt! Luyện thêm vài lần ở tốc độ này trước khi tăng tốc.</p>';
      }
    }
    html += '<div class="btn-row"><button class="btn btn-primary" id="progAgain">Luyện lại</button></div>';
    box.innerHTML = html;
    box.hidden = false;
    $('#progAgain').addEventListener('click', start);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ------------------------------------------------------------ init
  renderSaved();
  setMode('step');
  recompute();

  return {
    onNotes,
    pianoState,
    noteRange,
    stop: stopAll,
    current: () => cur(),
    render: () => {
      renderSheet();
      renderCurrent();
    },
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

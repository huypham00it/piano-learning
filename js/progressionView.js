// UI controller for the "Vòng hợp âm" (chord progression) tab.
import { CHORD_TYPES, TYPE_BY_ID, INVERSION_NAMES, maxInversion, rootNameFor, solfegeName, mod12 } from './theory.js';
import {
  PRESETS, MAJOR_KEYS, MINOR_KEYS, presetItems, itemLabel, voiceProgression, matchStep, transitionTips, keyPalette, moveItem,
} from './progression.js';
import { renderStaff } from './staff.js';
import { load, save } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const ROOT_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
const TYPE_GROUPS = [...new Set(CHORD_TYPES.map((t) => t.group))];
const COL_GAP = 110;
const STAFF_SCALE = 1.15;

/**
 * @param {{synth, pretty:(s:string)=>string, toast:(s:string)=>void, activeNotes:()=>number[],
 *   refresh:()=>void, onRangeChange:()=>void, selectedIds:()=>string[]}} ctx
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

  $('#progUsePreset').addEventListener('click', () => {
    stopAll();
    data.items = presetItems($('#progPreset').value, Number($('#progKey').value));
    v.index = 0;
    recompute();
    toast(`Đã tạo vòng: ${data.items.map((i) => pretty(itemLabel(i))).join(' → ')}`);
  });
  /** Insert a chord into the progression (at the end by default) and select it. */
  function insertItem(item, at = data.items.length) {
    stopAll();
    data.items.splice(at, 0, { ...item, inversion: 'auto' });
    v.index = at;
    recompute();
    synth.playChord(cur().midis, { duration: 1 });
  }

  function reorder(from, to) {
    if (from === to) return;
    stopAll();
    const selected = data.items[v.index];
    moveItem(data.items, from, to);
    v.index = data.items.indexOf(selected);
    if (v.index < 0) v.index = to;
    recompute();
  }
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

  // ------------------------------------------------------------ sequence list (drag & drop)
  $('#progList').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const i = Number(btn.closest('li').dataset.index);
    if (btn.dataset.act === 'del') {
      stopAll();
      data.items.splice(i, 1);
      if (v.index > i || v.index >= data.items.length) v.index = Math.max(0, v.index - 1);
      recompute();
    }
    // Mouse/touch selection is handled by the drag controller; this covers keyboard activation.
    if (btn.dataset.act === 'select' && e.detail === 0) select(i, true);
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
  $('#progList').addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li.seq-item');
    if (!li || e.target.closest('select, [data-act=del]')) return;
    // On touch screens only the handle drags, so the page can still scroll.
    if (e.pointerType === 'touch' && !e.target.closest('.handle')) return;
    const i = Number(li.dataset.index);
    const onChord = e.target.closest('[data-act=select]');
    beginDrag(e, li, { from: i, onClick: () => onChord && select(i, true) });
  });
  $('#progList').addEventListener('keydown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    const i = Number(handle.closest('li').dataset.index);
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const to = i + delta;
    if (to < 0 || to >= data.items.length) return;
    reorder(i, to);
    $(`#progList li[data-index="${to}"] .handle`)?.focus();
  });

  /**
   * Pointer-based drag (works for mouse, pen and touch). A press without movement counts as a click.
   * payload: {from?: index in list, item?: chord to insert, onClick?: fn}
   */
  function beginDrag(e, el, payload) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (v.running) return payload.onClick?.();
    const sx = e.clientX;
    const sy = e.clientY;
    const rect = el.getBoundingClientRect();
    const offX = sx - rect.left;
    const offY = sy - rect.top;
    let dragging = false;
    let ghost = null;
    let insertAt = null;
    const list = $('#progList');

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragging = true;
        ghost = el.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = `${rect.width}px`;
        document.body.appendChild(ghost);
        if (payload.from != null) el.classList.add('dragging');
        document.body.classList.add('is-dragging');
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px)`;
      insertAt = dropIndex(list, ev.clientX, ev.clientY, payload.from);
      showMarker(list, insertAt, payload.from);
      autoScroll(ev.clientY);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cleanup);
      ghost?.remove();
      el.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      list.querySelector('.seq-marker')?.remove();
      list.classList.remove('drop-target');
    };
    const onUp = () => {
      cleanup();
      if (!dragging) return payload.onClick?.();
      if (insertAt == null) return;
      if (payload.from != null) reorder(payload.from, insertAt);
      else insertItem(payload.item, insertAt);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
  }

  /** Where a drop at (x, y) lands in the list, or null when outside it. Items flow left-to-right, then wrap. */
  function dropIndex(list, x, y, from) {
    const box = list.getBoundingClientRect();
    const pad = 24;
    if (x < box.left - pad || x > box.right + pad || y < box.top - pad || y > box.bottom + pad) return null;
    const others = [...list.querySelectorAll('li.seq-item')].filter((li) => Number(li.dataset.index) !== from);
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (y < r.top || (y < r.bottom && x < r.left + r.width / 2)) return i;
    }
    return others.length;
  }

  function showMarker(list, at, from) {
    list.classList.toggle('drop-target', at != null);
    let marker = list.querySelector('.seq-marker');
    if (at == null) return marker?.remove();
    if (!marker) {
      marker = document.createElement('li');
      marker.className = 'seq-marker';
      marker.setAttribute('aria-hidden', 'true');
    }
    const others = [...list.querySelectorAll('li.seq-item')].filter((li) => Number(li.dataset.index) !== from);
    const before = others[at] ?? null;
    if (before) list.insertBefore(marker, before);
    else list.appendChild(marker);
  }

  function autoScroll(y) {
    const dockTop = document.querySelector('.dock')?.getBoundingClientRect().top ?? window.innerHeight;
    if (y < 70) window.scrollBy(0, -12);
    else if (y > dockTop - 40) window.scrollBy(0, 12);
  }

  // ------------------------------------------------------------ chord palette
  const pal = { tab: 'key', key: 'major:0', root: 0, ...load('progPalette', {}) };
  let palItems = [];

  $$('#palTabs button').forEach((b) =>
    b.addEventListener('click', () => {
      pal.tab = b.dataset.pal;
      save('progPalette', pal);
      renderPalette();
    }),
  );

  function renderPalette() {
    $$('#palTabs button').forEach((b) => b.classList.toggle('active', b.dataset.pal === pal.tab));
    const filter = $('#palFilter');
    let groups = [];
    if (pal.tab === 'key') {
      const opts = ['major', 'minor'].flatMap((mode) =>
        (mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS).map(
          (n, pc) => `<option value="${mode}:${pc}"${pal.key === `${mode}:${pc}` ? ' selected' : ''}>${pretty(n)} ${mode === 'minor' ? 'thứ' : 'trưởng'}</option>`,
        ),
      );
      filter.innerHTML = `<label class="inline">Giọng <select id="palKey">${opts.join('')}</select></label>`;
      $('#palKey').addEventListener('change', (e) => {
        pal.key = e.target.value;
        save('progPalette', pal);
        renderPalette();
      });
      const [mode, pc] = pal.key.split(':');
      groups = keyPalette(mode, Number(pc)).map((g) => ({ title: g.title, chords: g.chords.map((c) => ({ item: c.item, sub: c.roman })) }));
    } else if (pal.tab === 'selected') {
      const ids = ctx.selectedIds();
      filter.innerHTML = `<span class="muted small">${ids.length ? `${ids.length} hợp âm bạn đã chọn ở tab ① Chọn hợp âm.` : 'Bạn chưa chọn hợp âm nào ở tab ① Chọn hợp âm.'}</span>`;
      groups = TYPE_GROUPS.map((title) => ({
        title,
        chords: ids
          .map((id) => {
            const [pc, typeId] = id.split(':');
            return { pc: Number(pc), typeId };
          })
          .filter((c) => TYPE_BY_ID[c.typeId].group === title)
          .map((c) => ({ item: { ...c, rootName: rootNameFor(c.pc, c.typeId) }, sub: TYPE_BY_ID[c.typeId].name })),
      }));
    } else {
      filter.innerHTML = `<div class="root-pick" role="group" aria-label="Nốt gốc">${ROOT_LABELS.map(
        (n, pc) => `<button data-root="${pc}" class="${pal.root === pc ? 'active' : ''}">${pretty(n)}</button>`,
      ).join('')}</div>`;
      filter.querySelectorAll('[data-root]').forEach((b) =>
        b.addEventListener('click', () => {
          pal.root = Number(b.dataset.root);
          save('progPalette', pal);
          renderPalette();
        }),
      );
      groups = TYPE_GROUPS.map((title) => ({
        title,
        chords: CHORD_TYPES.filter((t) => t.group === title).map((t) => ({
          item: { pc: pal.root, typeId: t.id, rootName: rootNameFor(pal.root, t.id) },
          sub: t.name,
        })),
      }));
    }
    palItems = [];
    $('#palette').innerHTML = groups
      .filter((g) => g.chords.length)
      .map(
        (g) => `<div class="pal-group"><div class="pal-title">${g.title}</div><div class="pal-chips">${g.chords
          .map((c) => {
            const i = palItems.push(c.item) - 1;
            const label = pretty(itemLabel(c.item));
            return `<button class="pal-chip" data-pi="${i}" title="Bấm để thêm ${label} vào cuối vòng, hoặc kéo vào vị trí mong muốn"><b>${label}</b><small>${pretty(c.sub)}</small></button>`;
          })
          .join('')}</div></div>`,
      )
      .join('') || '<p class="muted small">Không có hợp âm nào.</p>';
  }

  $('#palette').addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.pal-chip');
    if (!chip) return;
    const item = palItems[Number(chip.dataset.pi)];
    const add = () => insertItem(item);
    // Touch: tap to add (dragging from the palette would block page scrolling).
    if (e.pointerType === 'touch') {
      chip.addEventListener('pointerup', add, { once: true });
      chip.addEventListener('pointercancel', () => chip.removeEventListener('pointerup', add), { once: true });
      return;
    }
    beginDrag(e, chip, { item, onClick: add });
  });
  $('#palette').addEventListener('click', (e) => {
    const chip = e.target.closest('.pal-chip');
    if (chip && e.detail === 0) insertItem(palItems[Number(chip.dataset.pi)]); // keyboard
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
    $('#progSeqCount').textContent = data.items.length ? `(${data.items.length} hợp âm)` : '';
    if (!data.items.length) {
      list.innerHTML = '<li class="seq-empty">Vòng đang trống — bấm hoặc kéo hợp âm từ <b>Bảng hợp âm</b> vào đây, hoặc chọn một vòng mẫu.</li>';
      return;
    }
    list.innerHTML = data.items
      .map((item, i) => {
        const step = v.steps[i];
        const max = maxInversion(item.typeId);
        const opts = [`<option value="auto"${item.inversion === 'auto' ? ' selected' : ''}>Tự động (${INVERSION_NAMES[step.inversion].toLowerCase()})</option>`];
        for (let k = 0; k <= max; k++) opts.push(`<option value="${k}"${item.inversion === k ? ' selected' : ''}>${INVERSION_NAMES[k]}</option>`);
        const label = pretty(step.label);
        return `<li data-index="${i}" class="seq-item${i === v.index ? ' current' : ''}">
          <span class="handle" tabindex="0" role="button" aria-label="Kéo để đổi vị trí ${label}; hoặc dùng phím mũi tên" title="Kéo để sắp xếp">⠿</span>
          <span class="seq-num">${i + 1}</span>
          <button class="seq-chord" data-act="select" title="Chọn hợp âm này">${label}</button>
          <select class="seq-inv" aria-label="Thế bấm của ${label}">${opts.join('')}</select>
          <button class="mini" data-act="del" title="Xóa" aria-label="Xóa ${label}">✕</button>
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
    $$('#progList li.seq-item').forEach((li) => li.classList.toggle('current', Number(li.dataset.index) === v.index));
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
  renderPalette();
  setMode('step');
  recompute();

  return {
    onNotes,
    pianoState,
    noteRange,
    stop: stopAll,
    current: () => cur(),
    render: () => {
      renderPalette();
      renderSheet();
      renderCurrent();
    },
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

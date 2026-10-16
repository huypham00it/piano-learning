import {
  CHORD_TYPES, TYPE_BY_ID, INVERSION_NAMES, buildChord, chordId, parseChordId, rootNameFor, maxInversion,
  matchChord, detectChord, diatonicChords, formulaText, prettyName, respell, spellMidi, solfegeName, mod12,
} from './theory.js';
import { renderStaff } from './staff.js';
import { PianoKeyboard } from './keyboard.js';
import { MidiInput } from './midi.js';
import { Synth } from './audio.js';
import { load, save } from './storage.js';
import { MODES, MAX_BOX, nextQuestion, recordResult, emptyStat } from './practice.js';
import { createProgressionView } from './progressionView.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------- state
const state = {
  tab: 'select',
  selected: new Set(load('selected', ['0:maj', '5:maj', '7:maj', '9:min', '2:min', '4:min'])),
  stats: load('stats', {}),
  settings: {
    mode: 'name-play', count: 20, inversions: 'root', time: 0, hint: 2, strictBass: true,
    ...load('settings', {}),
  },
  prefs: { sound: true, midiEcho: false, labels: false, midiDevice: 'all', midiAuto: false, ...load('prefs', {}) },
  held: new Set(), // MIDI + computer keyboard
  latched: new Set(), // mouse / touch on screen keys
  kbOctave: 4,
};

const synth = new Synth();
const midi = new MidiInput();
let progView = null; // created once the rest of the UI is ready

const activeNotes = () => [...new Set([...state.held, ...state.latched])].sort((a, b) => a - b);

function persist() {
  save('selected', [...state.selected]);
  save('stats', state.stats);
  save('settings', state.settings);
  save('prefs', state.prefs);
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

const pretty = (s) => prettyName(s);
function chordTitle(chord) {
  return `${solfegeName(chord.root)} ${chord.type.name.toLowerCase()}`;
}

function sortedSelection(ids = state.selected) {
  const order = (id) => {
    const { pc, typeId } = parseChordId(id);
    return CHORD_TYPES.findIndex((t) => t.id === typeId) * 12 + pc;
  };
  return [...ids].sort((a, b) => order(a) - order(b));
}

// ---------------------------------------------------------------- piano
const piano = new PianoKeyboard($('#piano'), { start: 48, end: 84, onPress: onScreenPress });

function fitPianoRange() {
  const w = window.innerWidth;
  let [lo, hi] = w >= 1100 ? [36, 96] : w >= 700 ? [48, 84] : [55, 84];
  // Progressions may use a left-hand bass below the default range: widen (the piano scrolls if needed).
  const r = state.tab === 'prog' ? progView?.noteRange() : null;
  if (r) {
    lo = Math.min(lo, r.lo - mod12(r.lo));
    hi = Math.max(hi, r.hi + 11 - mod12(r.hi));
  }
  piano.setRange(lo, hi);
}
window.addEventListener('resize', fitPianoRange);
fitPianoRange();

function onScreenPress(m) {
  if (state.latched.has(m)) {
    state.latched.delete(m);
    synth.noteOff(m);
  } else {
    state.latched.add(m);
    if (state.prefs.sound) synth.noteOn(m, 90, 0, 1.5);
  }
  notesChanged('latch');
}

function noteOn(m, velocity = 90, source = 'kb') {
  state.held.add(m);
  const echo = source === 'midi' ? state.prefs.midiEcho : state.prefs.sound;
  if (echo) synth.noteOn(m, velocity);
  notesChanged(source);
}

function noteOff(m) {
  state.held.delete(m);
  synth.noteOff(m);
  notesChanged('off');
}

function clearLatched() {
  for (const m of state.latched) synth.noteOff(m);
  state.latched.clear();
  notesChanged('clear');
}

/** Context chord used to spell played notes nicely. */
function contextChord() {
  if (state.tab === 'practice' && practice.q) return practice.q.chord;
  if (state.tab === 'learn') return learn.chord;
  if (state.tab === 'prog') return progView?.current()?.chord ?? null;
  return null;
}

function spellPlayed(m, chord) {
  const n = chord?.notes.find((x) => mod12(x.midi) === mod12(m));
  if (n) return respell(m, n.letter, n.acc);
  const flats = chord ? chord.notes.some((x) => x.acc < 0) : false;
  return spellMidi(m, flats);
}

function notesChanged(source) {
  const notes = activeNotes();
  const chord = contextChord();
  $('#playingNotes').textContent = notes.length ? notes.map((m) => pretty(spellPlayed(m, chord).name)).join(' ') : '—';
  const detected = detectChord(notes);
  $('#playingChord').textContent = detected ? pretty(detected) : '—';
  renderMiniStaff(notes, chord);

  if (state.tab === 'learn') learn.check(notes);
  if (state.tab === 'practice') practice.onNotes(notes, source);
  if (state.tab === 'prog') progView?.onNotes(notes);
  renderPiano();
}

function renderMiniStaff(notes, chord) {
  const colored = notes.map((m) => {
    const n = spellPlayed(m, chord);
    let color = 'var(--staff-ink)';
    if (chord && highlightPlayed()) color = chord.pcs.includes(mod12(m)) ? '#16a34a' : '#dc2626';
    return { ...n, color };
  });
  renderStaff($('#playStaff'), [{ notes: colored }], { width: 175, ariaLabel: 'Các nốt đang bấm' });
}

function highlightPlayed() {
  if (state.tab === 'learn' || state.tab === 'prog') return true;
  if (state.tab === 'practice' && practice.q) return practice.q.revealed || practice.q.done || practice.q.hint;
  return false;
}

function renderPiano() {
  const pressed = activeNotes();
  const chord = contextChord();
  piano.showLabels = state.prefs.labels;
  piano.labelFor = (m) => pretty(spellPlayed(m, chord).name);
  if (state.tab === 'prog' && progView) return piano.render(progView.pianoState(pressed));
  const view = { pressed, target: [], correct: [], wrong: [] };
  let showTarget = false;
  let judge = false;
  if (state.tab === 'learn' && chord) {
    showTarget = true;
    judge = true;
  } else if (state.tab === 'practice' && practice.q) {
    const q = practice.q;
    showTarget = q.revealed || q.done || q.hint || q.mode === 'keys-identify';
    judge = q.mode.endsWith('play') && (q.revealed || q.done || q.hint || q.lastWrong);
  }
  if (showTarget && chord) view.target = chord.notes.map((n) => n.midi);
  if (judge && chord) {
    for (const m of pressed) (chord.pcs.includes(mod12(m)) ? view.correct : view.wrong).push(m);
  }
  piano.render(view);
}

// ---------------------------------------------------------------- computer keyboard input
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };
const kbDown = new Map();

function isTyping(e) {
  const tag = e.target?.tagName;
  const textInput = tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(e.target.type);
  return textInput || tag === 'SELECT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
  const key = e.key.toLowerCase();
  if (/^[1-4]$/.test(key) && state.tab === 'practice' && practice.q?.options) {
    practice.answerOption(Number(key) - 1);
    return;
  }
  if (key === 'z' || key === 'x') {
    state.kbOctave = Math.max(1, Math.min(6, state.kbOctave + (key === 'z' ? -1 : 1)));
    $('#kbOctave').textContent = `C${state.kbOctave}`;
    return;
  }
  if (key in KEYMAP) {
    e.preventDefault();
    if (e.repeat || kbDown.has(key)) return;
    const m = 12 * (state.kbOctave + 1) + KEYMAP[key];
    kbDown.set(key, m);
    noteOn(m, 90, 'kb');
  }
});
window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  const m = kbDown.get(key);
  if (m != null) {
    kbDown.delete(key);
    noteOff(m);
  }
});
window.addEventListener('blur', () => {
  for (const m of kbDown.values()) noteOff(m);
  kbDown.clear();
});

// ---------------------------------------------------------------- MIDI
midi.addEventListener('noteon', (e) => noteOn(e.detail.note, e.detail.velocity, 'midi'));
midi.addEventListener('noteoff', (e) => noteOff(e.detail.note));
midi.addEventListener('devices', renderMidiStatus);

function renderMidiStatus() {
  const pill = $('#midiStatus');
  const sel = $('#midiDevice');
  const inputs = midi.inputs;
  if (!midi.access) return;
  $('#midiConnect').hidden = true;
  $('#midiEchoWrap').hidden = false;
  if (!inputs.length) {
    pill.className = 'pill pill-err';
    pill.textContent = 'Chưa thấy thiết bị MIDI — hãy cắm cáp';
    sel.hidden = true;
    return;
  }
  pill.className = 'pill pill-on';
  const current = midi.selectedId === 'all' ? null : inputs.find((i) => i.id === midi.selectedId);
  pill.textContent = current ? current.name : inputs.length === 1 ? inputs[0].name : `${inputs.length} thiết bị MIDI`;
  sel.hidden = inputs.length < 2;
  sel.replaceChildren(
    new Option('Tất cả thiết bị', 'all'),
    ...inputs.map((i) => new Option(i.name || i.id, i.id)),
  );
  sel.value = midi.selectedId;
}

async function connectMidi(silent = false) {
  if (!midi.supported) {
    $('#midiStatus').className = 'pill pill-err';
    $('#midiStatus').textContent = 'Trình duyệt không hỗ trợ Web MIDI';
    if (!silent) toast('Trình duyệt này không hỗ trợ Web MIDI. Hãy dùng Chrome, Edge hoặc Opera (máy tính hoặc Android).', 5000);
    return;
  }
  try {
    midi.selectedId = state.prefs.midiDevice;
    await midi.connect();
    state.prefs.midiAuto = true;
    persist();
    if (!silent) toast('Đã bật MIDI. Hãy bấm thử vài phím trên đàn!');
  } catch (err) {
    $('#midiStatus').className = 'pill pill-err';
    $('#midiStatus').textContent = 'Không truy cập được MIDI';
    if (!silent) toast('Không truy cập được MIDI: ' + (err?.message || err), 5000);
  }
}

$('#midiConnect').addEventListener('click', () => connectMidi());
$('#midiDevice').addEventListener('change', (e) => {
  state.prefs.midiDevice = e.target.value;
  persist();
  midi.select(e.target.value);
});

// ---------------------------------------------------------------- top toggles
function bindToggle(id, key, after) {
  const elx = $(id);
  elx.checked = state.prefs[key];
  elx.addEventListener('change', () => {
    state.prefs[key] = elx.checked;
    persist();
    after?.();
  });
}
// Extra toggle shown only once MIDI is active.
$('.top-tools').insertAdjacentHTML(
  'afterbegin',
  `<label class="toggle" id="midiEchoWrap" hidden title="Phát tiếng từ trình duyệt khi chơi trên đàn MIDI (bật nếu đàn không có loa)">
     <input type="checkbox" id="midiEchoToggle" /> <span>Tiếng cho đàn MIDI</span>
   </label>`,
);
bindToggle('#soundToggle', 'sound');
bindToggle('#midiEchoToggle', 'midiEcho');
bindToggle('#labelToggle', 'labels', renderPiano);

// ---------------------------------------------------------------- tabs
function setTab(tab) {
  if (state.tab === 'practice' && tab !== 'practice') practice.pauseTimer();
  if (state.tab === 'prog' && tab !== 'prog') progView.stop();
  state.tab = tab;
  fitPianoRange();
  if (tab === 'prog') progView.render();
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'learn') learn.render();
  if (tab === 'practice') practice.renderSetupInfo();
  if (tab === 'stats') renderStats();
  if (tab === 'select') renderGrid();
  notesChanged('tab');
}
$$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.goto)));

// ---------------------------------------------------------------- chord selection grid
const ROOT_HEADERS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];

function renderGrid() {
  const table = $('#chordGrid');
  const rows = [];
  rows.push(`<thead><tr><th class="row-head" data-all="1" title="Chọn/bỏ tất cả">Loại \\ Gốc</th>${ROOT_HEADERS.map(
    (h, pc) => `<th data-col="${pc}" title="Chọn/bỏ cả cột">${pretty(h)}</th>`,
  ).join('')}</tr></thead><tbody>`);
  let group = null;
  for (const t of CHORD_TYPES) {
    if (t.group !== group) {
      group = t.group;
      rows.push(`<tr class="group-row"><th colspan="13">${group}</th></tr>`);
    }
    const cells = [];
    for (let pc = 0; pc < 12; pc++) {
      const id = chordId(pc, t.id);
      const on = state.selected.has(id);
      const label = pretty(rootNameFor(pc, t.id) + t.symbol);
      cells.push(`<td><button class="cell${on ? ' on' : ''}" data-id="${id}" aria-pressed="${on}">${label}</button></td>`);
    }
    rows.push(`<tr><th class="row-head" data-row="${t.id}" title="Chọn/bỏ cả hàng">${t.name}<small>${formulaText(t.id)}</small></th>${cells.join('')}</tr>`);
  }
  rows.push('</tbody>');
  table.innerHTML = rows.join('');
  $('#selCount').textContent = state.selected.size;
}

function toggleMany(ids) {
  const allOn = ids.every((id) => state.selected.has(id));
  for (const id of ids) allOn ? state.selected.delete(id) : state.selected.add(id);
  selectionChanged();
}

function selectionChanged() {
  persist();
  renderGrid();
  learn.ensureIndex();
}

$('#chordGrid').addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) {
    const id = cell.dataset.id;
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    selectionChanged();
    const { pc, typeId } = parseChordId(id);
    if (state.selected.has(id) && state.prefs.sound) synth.playChord(buildChord(pc, typeId).notes.map((n) => n.midi), { duration: 0.8 });
    return;
  }
  const th = e.target.closest('th');
  if (!th) return;
  if (th.dataset.row) toggleMany([...Array(12).keys()].map((pc) => chordId(pc, th.dataset.row)));
  else if (th.dataset.col) toggleMany(CHORD_TYPES.map((t) => chordId(Number(th.dataset.col), t.id)));
  else if (th.dataset.all) toggleMany(CHORD_TYPES.flatMap((t) => [...Array(12).keys()].map((pc) => chordId(pc, t.id))));
});

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
$('#keySelect').replaceChildren(...KEY_NAMES.map((k, pc) => new Option(`${pretty(k)} trưởng`, pc)));

$$('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    const p = b.dataset.preset;
    const all12 = [...Array(12).keys()];
    const keyPc = Number($('#keySelect').value);
    const presets = {
      basic: ['0:maj', '5:maj', '7:maj', '9:min', '2:min', '4:min'],
      majors: all12.map((pc) => chordId(pc, 'maj')),
      minors: all12.map((pc) => chordId(pc, 'min')),
      triads: all12.flatMap((pc) => ['maj', 'min'].map((t) => chordId(pc, t))),
      sevenths: all12.flatMap((pc) => ['7', 'maj7', 'm7'].map((t) => chordId(pc, t))),
      key: diatonicChords(keyPc),
      key7: diatonicChords(keyPc, true),
    };
    if (p === 'none') state.selected.clear();
    else state.selected = new Set(presets[p]);
    selectionChanged();
    toast(p === 'none' ? 'Đã bỏ chọn tất cả.' : `Đã chọn ${state.selected.size} hợp âm.`);
  }),
);

// ---------------------------------------------------------------- learn
const learn = {
  index: 0,
  inversion: 0,
  chord: null,
  list() {
    return sortedSelection();
  },
  ensureIndex() {
    const n = this.list().length;
    if (this.index >= n) this.index = Math.max(0, n - 1);
  },
  go(delta) {
    const n = this.list().length;
    if (!n) return;
    this.index = (this.index + delta + n) % n;
    this.inversion = 0;
    this.render();
    this.play();
  },
  play(arpeggio = false) {
    if (this.chord) synth.playChord(this.chord.notes.map((n) => n.midi), { arpeggio });
  },
  render() {
    const list = this.list();
    const listEl = $('#learnList');
    if (!list.length) {
      this.chord = null;
      listEl.innerHTML = '<p class="muted">Chưa chọn hợp âm nào. Hãy sang tab “Chọn hợp âm”.</p>';
      $('#learnSymbol').textContent = '—';
      $('#learnName').textContent = '';
      $('#learnStaff').replaceChildren();
      $('#learnInv').replaceChildren();
      ['#learnNotes', '#learnFormula', '#learnBass'].forEach((s) => ($(s).textContent = '—'));
      renderPiano();
      return;
    }
    this.ensureIndex();
    const id = list[this.index];
    const { pc, typeId } = parseChordId(id);
    this.inversion = Math.min(this.inversion, maxInversion(typeId));
    const chord = (this.chord = buildChord(pc, typeId, this.inversion));

    listEl.replaceChildren(
      ...list.map((cid, i) => {
        const { pc: p, typeId: t } = parseChordId(cid);
        const b = document.createElement('button');
        b.className = 'chip' + (i === this.index ? ' active' : '');
        const box = state.stats[cid]?.box;
        b.innerHTML = `${pretty(rootNameFor(p, t) + TYPE_BY_ID[t].symbol)}${box ? `<span class="lvl">${'•'.repeat(box)}</span>` : ''}`;
        b.title = box ? `Mức nhớ ${box}/${MAX_BOX}` : 'Chưa luyện';
        b.addEventListener('click', () => {
          this.index = i;
          this.inversion = 0;
          this.render();
          this.play();
        });
        return b;
      }),
    );

    $('#learnSymbol').textContent = pretty(chord.label);
    $('#learnName').textContent = chordTitle(chord) + (chord.inversion ? ` · ${INVERSION_NAMES[chord.inversion].toLowerCase()}` : '');
    const inv = $('#learnInv');
    inv.replaceChildren(
      ...Array.from({ length: maxInversion(typeId) + 1 }, (_, i) => {
        const b = document.createElement('button');
        b.textContent = INVERSION_NAMES[i];
        b.className = i === this.inversion ? 'active' : '';
        b.addEventListener('click', () => {
          this.inversion = i;
          this.render();
          this.play();
        });
        return b;
      }),
    );
    renderStaff($('#learnStaff'), [{ notes: chord.notes }], { ariaLabel: `Hợp âm ${chord.label} trên khuông nhạc` });
    $('#learnNotes').textContent = chord.notes.map((n) => pretty(n.name)).join(' – ');
    $('#learnFormula').textContent = formulaText(typeId);
    $('#learnBass').textContent = pretty(chord.notes[0].name);
    $('#learnFeedback').className = 'feedback info';
    $('#learnFeedback').textContent = 'Hãy thử chơi hợp âm này trên đàn — các phím cần bấm được tô màu xanh bên dưới.';
    notesChanged('render');
  },
  check(notes) {
    if (!this.chord || !notes.length) return;
    const fb = $('#learnFeedback');
    const m = matchChord(this.chord, notes, { requireInversion: true });
    const loose = matchChord(this.chord, notes);
    if (m.ok) {
      fb.className = 'feedback ok';
      fb.textContent = `✓ Chính xác! Bạn đã chơi ${pretty(this.chord.label)}.`;
    } else if (loose.ok) {
      fb.className = 'feedback ok';
      fb.textContent = `✓ Đúng các nốt của ${pretty(this.chord.symbol)} (nốt trầm khác với ${INVERSION_NAMES[this.chord.inversion].toLowerCase()}).`;
    } else if (loose.complete) {
      fb.className = 'feedback bad';
      fb.textContent = loose.extra.length ? 'Có nốt không thuộc hợp âm (tô đỏ).' : 'Chưa đúng, thử lại nhé.';
    }
  },
};
$('#learnPrev').addEventListener('click', () => learn.go(-1));
$('#learnNext').addEventListener('click', () => learn.go(1));
$('#learnPlay').addEventListener('click', () => learn.play(false));
$('#learnArp').addEventListener('click', () => learn.play(true));

// ---------------------------------------------------------------- practice
$('#setMode').replaceChildren(...Object.entries(MODES).map(([k, v]) => new Option(v, k)));
const settingInputs = {
  mode: ['#setMode', String],
  count: ['#setCount', Number],
  inversions: ['#setInv', String],
  time: ['#setTime', Number],
  hint: ['#setHint', Number],
};
for (const [key, [sel, cast]] of Object.entries(settingInputs)) {
  $(sel).value = String(state.settings[key]);
  $(sel).addEventListener('change', () => {
    state.settings[key] = cast($(sel).value);
    persist();
  });
}
$('#setStrictBass').checked = state.settings.strictBass;
$('#setStrictBass').addEventListener('change', (e) => {
  state.settings.strictBass = e.target.checked;
  persist();
});

const practice = {
  q: null,
  pool: [],
  index: 0,
  results: [],
  streak: 0,
  timers: [],

  renderSetupInfo() {
    const n = state.selected.size;
    $('#poolInfo').innerHTML = n
      ? `Sẽ luyện với <b>${n}</b> hợp âm đã chọn: ${sortedSelection().slice(0, 14).map((id) => {
          const { pc, typeId } = parseChordId(id);
          return pretty(rootNameFor(pc, typeId) + TYPE_BY_ID[typeId].symbol);
        }).join(', ')}${n > 14 ? ', …' : ''}`
      : '⚠️ Chưa chọn hợp âm nào — hãy sang tab “Chọn hợp âm”.';
    $('#startBtn').disabled = !n;
  },

  show(which) {
    $('#practiceSetup').hidden = which !== 'setup';
    $('#practiceRun').hidden = which !== 'run';
    $('#practiceDone').hidden = which !== 'done';
  },

  start(pool = sortedSelection()) {
    if (!pool.length) {
      toast('Hãy chọn ít nhất một hợp âm.');
      setTab('select');
      return;
    }
    synth.ensure();
    this.pool = pool;
    this.index = 0;
    this.results = [];
    this.streak = 0;
    this.lastKey = null;
    this.show('run');
    this.next();
  },

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    cancelAnimationFrame(this.raf);
    clearTimeout(this.evalTimer);
  },

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  },

  total() {
    return state.settings.count || Infinity;
  },

  next() {
    this.clearTimers();
    if (this.index >= this.total()) return this.finish();
    const q = nextQuestion(this.pool, state.settings, state.stats, this.lastKey);
    this.lastKey = q.key;
    q.waitRelease = activeNotes().length > 0;
    this.q = q;
    if (state.latched.size) clearLatched();
    this.renderQuestion();
    this.startTimer();
    notesChanged('question');
  },

  renderQuestion() {
    const q = this.q;
    const total = this.total();
    $('#runCounter').textContent = total === Infinity ? `Câu ${this.index + 1}` : `Câu ${this.index + 1}/${total}`;
    $('#progressBar').style.width = total === Infinity ? '100%' : `${(this.index / total) * 100}%`;
    const correct = this.results.filter((r) => r.correct).length;
    $('#runCorrect').textContent = correct;
    $('#runWrong').textContent = this.results.length - correct;
    $('#runStreak').textContent = this.streak;

    const sym = $('#qSymbol');
    sym.className = 'big-symbol q-symbol';
    const staffEl = $('#qStaff');
    const opts = $('#qOptions');
    opts.replaceChildren();
    const invText = q.chord.inversion ? ` (${INVERSION_NAMES[q.chord.inversion].toLowerCase()})` : '';
    const strict = state.settings.strictBass && q.chord.inversion > 0;

    if (q.mode === 'name-play') {
      $('#qPrompt').textContent = `Hãy chơi hợp âm${invText}${strict ? ' — đúng nốt trầm' : ''}:`;
      sym.textContent = pretty(q.chord.label);
      sym.hidden = false;
      staffEl.hidden = true;
    } else if (q.mode === 'staff-play') {
      $('#qPrompt').textContent = 'Hãy chơi hợp âm được viết trên khuông nhạc:';
      sym.hidden = true;
      staffEl.hidden = false;
      renderStaff(staffEl, [{ notes: q.chord.notes }]);
    } else {
      $('#qPrompt').innerHTML = q.mode === 'identify'
        ? 'Đây là hợp âm gì? <span class="muted small">(phím 1–4)</span>'
        : 'Các phím xanh trên bàn phím là hợp âm gì? <span class="muted small">(phím 1–4)</span>';
      sym.hidden = true;
      staffEl.hidden = q.mode !== 'identify';
      if (q.mode === 'identify') renderStaff(staffEl, [{ notes: q.chord.notes }]);
      q.options.forEach((o, i) => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.innerHTML = `<span class="num">${i + 1}</span>${pretty(o.label)}`;
        b.addEventListener('click', () => this.answerOption(i));
        opts.appendChild(b);
      });
    }
    this.feedback('', 'info');
    $('#qClear').hidden = !q.mode.endsWith('play');
    $('#qReveal').hidden = !q.mode.endsWith('play');
  },

  feedback(text, kind = 'info') {
    const fb = $('#qFeedback');
    fb.className = `feedback ${kind}`;
    fb.textContent = text;
  },

  startTimer() {
    const limit = state.settings.time;
    $('#qTimerWrap').hidden = !limit;
    if (!limit) return;
    const bar = $('#qTimer');
    const q = this.q;
    q.deadline = performance.now() + limit * 1000;
    const tick = () => {
      if (this.q !== q || q.done) return;
      const left = q.deadline - performance.now();
      bar.style.width = `${Math.max(0, (left / (limit * 1000)) * 100)}%`;
      if (left <= 0) return this.timeout();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  },

  pauseTimer() {
    cancelAnimationFrame(this.raf);
  },

  timeout() {
    const q = this.q;
    q.mistakes++;
    this.feedback(`⏰ Hết giờ! Đáp án: ${pretty(q.chord.label)} = ${q.chord.notes.map((n) => pretty(n.name)).join(' ')}`, 'bad');
    synth.feedback(false);
    this.complete(false, 2200);
  },

  onNotes(notes, source) {
    const q = this.q;
    if (!q || q.done || !q.mode.endsWith('play')) return;
    if (q.waitRelease) {
      if (!notes.length) q.waitRelease = false;
      return;
    }
    clearTimeout(this.evalTimer);
    if (!notes.length) {
      q.attemptLocked = false;
      return;
    }
    const opts = { requireInversion: state.settings.strictBass };
    const m = matchChord(q.chord, notes, opts);
    if (m.ok) return this.playedCorrect();
    if (!m.complete || q.attemptLocked) return;
    // Wait briefly: fingers rarely land at exactly the same time.
    const delay = source === 'latch' ? 0 : 220;
    this.evalTimer = setTimeout(() => {
      const now = activeNotes();
      const m2 = matchChord(q.chord, now, opts);
      if (this.q !== q || q.done || m2.ok || !m2.complete) return;
      q.attemptLocked = true;
      q.mistakes++;
      q.lastWrong = true;
      this.streak = 0;
      $('#runStreak').textContent = 0;
      synth.feedback(false);
      const sym = $('#qSymbol');
      sym.classList.remove('flash-bad');
      void sym.offsetWidth;
      sym.classList.add('flash-bad');
      let msg = '✗ Chưa đúng.';
      const loose = matchChord(q.chord, now);
      if (loose.ok && !m2.bassOk) msg = '✗ Đúng các nốt nhưng sai nốt trầm (thế đảo).';
      else if (m2.extra.length) msg = `✗ Có ${m2.extra.length} nốt không thuộc hợp âm.`;
      if (q.mistakes >= state.settings.hint && !q.hint) {
        q.hint = true;
        msg += ` Gợi ý: ${q.chord.notes.map((n) => pretty(n.name)).join(' – ')} (phím xanh).`;
      } else {
        msg += ' Thử lại!';
      }
      this.feedback(msg, 'bad');
      // Show what was played next to the target on the staff.
      if (q.mode === 'staff-play') this.renderComparison(now);
      if (state.latched.size) this.later(() => clearLatched(), 700);
      renderPiano();
    }, delay);
  },

  renderComparison(notes) {
    const q = this.q;
    const played = notes.map((m) => ({ ...spellPlayed(m, q.chord), color: q.chord.pcs.includes(mod12(m)) ? '#16a34a' : '#dc2626' }));
    $('#qStaff').hidden = false;
    renderStaff($('#qStaff'), [
      { notes: q.chord.notes, label: 'Đáp án' },
      { notes: played, label: 'Bạn chơi' },
    ]);
  },

  playedCorrect() {
    const q = this.q;
    const first = q.mistakes === 0 && !q.revealed;
    synth.feedback(true);
    $('#qSymbol').hidden = false;
    $('#qSymbol').textContent = pretty(q.chord.label);
    $('#qSymbol').classList.remove('flash-bad');
    $('#qSymbol').classList.add('flash-ok');
    if (q.mode === 'name-play' || q.mode === 'staff-play') {
      $('#qStaff').hidden = false;
      renderStaff($('#qStaff'), [{ notes: q.chord.notes }]);
    }
    const secs = ((Date.now() - q.startedAt) / 1000).toFixed(1);
    this.feedback(first ? `✓ Chính xác! (${secs}s)` : '✓ Đúng rồi — lần sau cố gắng ngay lần đầu nhé!', 'ok');
    this.complete(first, first ? 800 : 1300);
  },

  answerOption(i) {
    const q = this.q;
    if (!q || q.done || !q.options) return;
    const o = q.options[i];
    if (!o) return;
    const buttons = $$('#qOptions .opt');
    buttons.forEach((b, j) => {
      if (q.options[j].correct) b.classList.add('right');
    });
    synth.playChord(q.chord.notes.map((n) => n.midi), { duration: 1 });
    if (o.correct) {
      synth.feedback(true);
      this.feedback(`✓ Chính xác! ${pretty(q.chord.label)} = ${q.chord.notes.map((n) => pretty(n.name)).join(' ')}`, 'ok');
      this.complete(true, 1000);
    } else {
      buttons[i].classList.add('wrong');
      q.mistakes++;
      synth.feedback(false);
      this.feedback(`✗ Sai. Đáp án là ${pretty(q.chord.label)} = ${q.chord.notes.map((n) => pretty(n.name)).join(' ')}`, 'bad');
      this.complete(false, 2200);
    }
  },

  /** Mark question finished, record stats, move on after `delay` ms. */
  complete(correct, delay) {
    const q = this.q;
    if (q.done) return;
    q.done = true;
    clearTimeout(this.evalTimer);
    cancelAnimationFrame(this.raf);
    const ms = Date.now() - q.startedAt;
    recordResult(state.stats, q.chord.id, { correct, ms });
    persist();
    this.results.push({ id: q.chord.id, label: q.chord.label, correct, ms, mistakes: q.mistakes });
    this.streak = correct ? this.streak + 1 : 0;
    this.index++;
    q.waitRelease = true;
    renderPiano();
    renderMiniStaff(activeNotes(), q.chord);
    this.later(() => this.next(), delay);
  },

  reveal() {
    const q = this.q;
    if (!q || q.done) return;
    q.revealed = true;
    q.hint = true;
    $('#qSymbol').hidden = false;
    $('#qSymbol').textContent = pretty(q.chord.label);
    $('#qStaff').hidden = false;
    renderStaff($('#qStaff'), [{ notes: q.chord.notes }]);
    this.feedback(`Đáp án: ${q.chord.notes.map((n) => pretty(n.name)).join(' – ')}. Hãy chơi lại để tiếp tục (hoặc bấm Bỏ qua).`, 'info');
    synth.playChord(q.chord.notes.map((n) => n.midi));
    renderPiano();
  },

  skip() {
    const q = this.q;
    if (!q) return;
    if (!q.done) {
      q.mistakes++;
      this.complete(false, 0);
    }
  },

  finish() {
    this.clearTimers();
    this.q = null;
    this.show('done');
    const r = this.results;
    const correct = r.filter((x) => x.correct).length;
    const okTimes = r.filter((x) => x.correct).map((x) => x.ms);
    const avg = okTimes.length ? okTimes.reduce((a, b) => a + b, 0) / okTimes.length / 1000 : 0;
    const pct = r.length ? Math.round((correct / r.length) * 100) : 0;
    $('#summary').innerHTML = [
      ['Đúng ngay lần đầu', `${correct}/${r.length}`],
      ['Tỉ lệ', `${pct}%`],
      ['Thời gian TB (câu đúng)', okTimes.length ? `${avg.toFixed(1)}s` : '—'],
      ['Chuỗi dài nhất', String(longestStreak(r))],
    ].map(([k, v]) => `<div class="stat-tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
    const wrong = {};
    for (const x of r) if (!x.correct) wrong[x.label] = (wrong[x.label] || 0) + 1;
    const wrongList = Object.entries(wrong).sort((a, b) => b[1] - a[1]);
    $('#summaryList').innerHTML = wrongList.length
      ? `<h3>Cần ôn thêm</h3><div class="chip-list">${wrongList.map(([l, n]) => `<span class="chip">${pretty(l)} ×${n}</span>`).join('')}</div>`
      : r.length ? '<p class="feedback ok">🎉 Tuyệt vời! Không sai câu nào.</p>' : '';
    $('#retryWrongBtn').hidden = !wrongList.length;
    $('#progressBar').style.width = '100%';
    notesChanged('finish');
  },
};

function longestStreak(r) {
  let best = 0;
  let cur = 0;
  for (const x of r) {
    cur = x.correct ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

$('#startBtn').addEventListener('click', () => practice.start());
$('#qListen').addEventListener('click', () => {
  if (practice.q) synth.playChord(practice.q.chord.notes.map((n) => n.midi));
});
$('#qClear').addEventListener('click', () => clearLatched());
$('#qReveal').addEventListener('click', () => practice.reveal());
$('#qSkip').addEventListener('click', () => practice.skip());
$('#qStop').addEventListener('click', () => practice.finish());
$('#againBtn').addEventListener('click', () => practice.start());
$('#setupBtn').addEventListener('click', () => {
  practice.show('setup');
  practice.renderSetupInfo();
});
$('#retryWrongBtn').addEventListener('click', () => {
  const ids = [...new Set(practice.results.filter((x) => !x.correct).map((x) => x.id))];
  practice.start(ids);
});

// ---------------------------------------------------------------- stats
function renderStats() {
  const table = $('#statsTable');
  const ids = Object.keys(state.stats).filter((id) => state.stats[id].seen > 0);
  if (!ids.length) {
    table.innerHTML = '<tr><td class="empty">Chưa có dữ liệu. Hãy làm vài bài luyện tập!</td></tr>';
    return;
  }
  ids.sort((a, b) => {
    const sa = state.stats[a];
    const sb = state.stats[b];
    return sa.box - sb.box || sa.correct / sa.seen - sb.correct / sb.seen;
  });
  const rows = ids.map((id) => {
    const s = { ...emptyStat(), ...state.stats[id] };
    const { pc, typeId } = parseChordId(id);
    const sym = pretty(rootNameFor(pc, typeId) + TYPE_BY_ID[typeId].symbol);
    const acc = Math.round((s.correct / s.seen) * 100);
    const avg = s.correct ? (s.totalMs / s.correct / 1000).toFixed(1) + 's' : '—';
    const last = s.last ? new Date(s.last).toLocaleDateString('vi-VN') : '—';
    return `<tr>
      <td class="sym">${sym}</td>
      <td>${TYPE_BY_ID[typeId].name}</td>
      <td><span class="lvl-dots" title="Mức ${s.box}/${MAX_BOX}">${'●'.repeat(s.box)}${'○'.repeat(MAX_BOX - s.box)}</span></td>
      <td><span class="bar"><i style="width:${acc}%;background:${acc >= 80 ? 'var(--ok)' : acc >= 50 ? 'var(--warn)' : 'var(--bad)'}"></i></span>${acc}%</td>
      <td>${s.correct}/${s.seen}</td>
      <td>${avg}</td>
      <td>${last}</td>
    </tr>`;
  });
  table.innerHTML = `<thead><tr><th>Hợp âm</th><th>Loại</th><th>Mức nhớ</th><th>Chính xác</th><th>Đúng/Lượt</th><th>TG trung bình</th><th>Lần cuối</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

$('#resetStats').addEventListener('click', () => {
  if (!confirm('Xóa toàn bộ thống kê luyện tập?')) return;
  state.stats = {};
  persist();
  renderStats();
  toast('Đã xóa thống kê.');
});
$('#practiceWeak').addEventListener('click', () => {
  const weak = Object.entries(state.stats).filter(([, s]) => s.seen > 0 && s.box <= 2).map(([id]) => id);
  if (!weak.length) return toast('Chưa có hợp âm yếu — bạn đang làm rất tốt!');
  state.selected = new Set(weak);
  persist();
  renderGrid();
  toast(`Đã chọn ${weak.length} hợp âm yếu để luyện.`);
  setTab('practice');
});

// ---------------------------------------------------------------- progressions
progView = createProgressionView({
  synth,
  pretty,
  toast,
  activeNotes,
  refresh: () => progView && state.tab === 'prog' && notesChanged('prog'),
  onRangeChange: () => progView && fitPianoRange(),
  selectedIds: () => sortedSelection(),
});

// ---------------------------------------------------------------- init
renderGrid();
$('#kbOctave').textContent = `C${state.kbOctave}`;
setTab('select');
if (!midi.supported) {
  $('#midiStatus').className = 'pill pill-err';
  $('#midiStatus').textContent = 'Không hỗ trợ Web MIDI (dùng Chrome/Edge)';
  $('#midiConnect').hidden = true;
} else if (state.prefs.midiAuto) {
  connectMidi(true);
}
// Unlock audio on first interaction (browser autoplay policy).
window.addEventListener('pointerdown', () => synth.ensure(), { once: true });

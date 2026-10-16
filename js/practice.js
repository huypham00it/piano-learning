// Exercise engine: weighted chord scheduling (Leitner boxes), question generation, stats.
import { buildChord, maxInversion, parseChordId, CHORD_TYPES, chordId } from './theory.js';

export const MODES = {
  'name-play': 'Nhìn tên → chơi hợp âm',
  'staff-play': 'Đọc khuông nhạc → chơi hợp âm',
  identify: 'Nhìn khuông nhạc → chọn tên',
  'keys-identify': 'Nhìn phím đàn → chọn tên',
  mixed: 'Trộn tất cả',
};

export const MAX_BOX = 5;
const BOX_WEIGHT = [0, 10, 6, 3, 1.6, 1]; // index by box (1..5)

export function emptyStat() {
  return { seen: 0, correct: 0, wrong: 0, totalMs: 0, box: 1, last: 0 };
}

/** Record result for a chord. `firstTry` true when answered correctly without mistakes. */
export function recordResult(stats, id, { correct, ms }) {
  const s = (stats[id] ??= emptyStat());
  s.seen++;
  s.last = Date.now();
  if (correct) {
    s.correct++;
    s.totalMs += ms;
    s.box = Math.min(MAX_BOX, s.box + 1);
  } else {
    s.wrong++;
    s.box = 1;
  }
  return s;
}

export function chordWeight(stat) {
  if (!stat || stat.seen === 0) return BOX_WEIGHT[1];
  const avg = stat.correct ? stat.totalMs / stat.correct : 8000;
  const slow = avg > 5000 ? 1.5 : avg > 3000 ? 1.2 : 1;
  return BOX_WEIGHT[stat.box] * slow;
}

export function pickWeighted(items, weightFn, rng = Math.random) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Build 4 answer options (1 correct + 3 distractors) for an identify question. */
export function buildOptions(chord, pool, rng = Math.random) {
  const inv = chord.inversion;
  const candidates = new Map();
  const add = (pc, typeId) => {
    const id = chordId(pc, typeId);
    if (id === chord.id || candidates.has(id)) return;
    const c = buildChord(pc, typeId, Math.min(inv, maxInversion(typeId)));
    if (sameSet(c.pcs, chord.pcs) || c.label === chord.label) return;
    candidates.set(id, c);
  };
  // Similar chords first: same root different quality, same quality nearby roots, pool members.
  const near = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', '7', 'maj7', 'm7', 'm7b5', 'dim7', '6', 'm6'];
  const sameSize = CHORD_TYPES.filter((t) => t.intervals.length === chord.notes.length).map((t) => t.id);
  for (const t of near) if (sameSize.includes(t)) add(chord.pc, t);
  for (const d of [1, -1, 2, -2, 5, 7]) add(chord.pc + d, chord.typeId);
  for (const id of pool) {
    const { pc, typeId } = parseChordId(id);
    add(pc, typeId);
  }
  const picks = shuffle([...candidates.values()], rng).slice(0, 3);
  return shuffle([chord, ...picks], rng).map((c) => ({ label: c.label, correct: c.id === chord.id, chord: c }));
}

/**
 * Create the next question.
 * @param {string[]} pool chord ids
 * @param {object} settings {mode, inversions:'root'|'all'}
 * @param {object} stats
 * @param {string|null} lastKey avoid repeating the same question
 */
export function nextQuestion(pool, settings, stats, lastKey = null, rng = Math.random) {
  let id;
  let inversion = 0;
  let key;
  for (let tries = 0; tries < 8; tries++) {
    id = pickWeighted(pool, (cid) => chordWeight(stats[cid]), rng);
    const { typeId } = parseChordId(id);
    inversion = settings.inversions === 'all' ? Math.floor(rng() * (maxInversion(typeId) + 1)) : 0;
    key = `${id}/${inversion}`;
    if (key !== lastKey || pool.length === 1) break;
  }
  const { pc, typeId } = parseChordId(id);
  const chord = buildChord(pc, typeId, inversion);
  let mode = settings.mode;
  if (mode === 'mixed') {
    const modes = ['name-play', 'staff-play', 'identify', 'keys-identify'];
    mode = modes[Math.floor(rng() * modes.length)];
  }
  const q = { key, chord, mode, startedAt: Date.now(), mistakes: 0 };
  if (mode === 'identify' || mode === 'keys-identify') q.options = buildOptions(chord, pool, rng);
  return q;
}

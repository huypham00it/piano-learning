// Chord progressions: presets, smooth voice leading, fingering and transition tips.
// Pure module (no DOM) so it can be unit-tested with `node --test`.
import {
  LETTER_PC, buildChord, makeNote, parseNoteName, maxInversion, mod12, respell, noteName, TYPE_BY_ID,
} from './theory.js';

export const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MINOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

// Steps are [scale degree index 0..6, semitones above tonic, chord type].
export const PRESETS = [
  { id: 'pop', name: 'I – V – vi – IV (Pop)', steps: [[0, 0, 'maj'], [4, 7, 'maj'], [5, 9, 'min'], [3, 5, 'maj']] },
  { id: '50s', name: 'I – vi – IV – V (thập niên 50)', steps: [[0, 0, 'maj'], [5, 9, 'min'], [3, 5, 'maj'], [4, 7, 'maj']] },
  { id: 'sad', name: 'vi – IV – I – V', steps: [[5, 9, 'min'], [3, 5, 'maj'], [0, 0, 'maj'], [4, 7, 'maj']] },
  { id: 'basic', name: 'I – IV – V – I (cơ bản)', steps: [[0, 0, 'maj'], [3, 5, 'maj'], [4, 7, 'maj'], [0, 0, 'maj']] },
  { id: 'circle', name: 'vi – ii – V – I (vòng quãng 5)', steps: [[5, 9, 'min'], [1, 2, 'min'], [4, 7, 'maj'], [0, 0, 'maj']] },
  { id: 'canon', name: 'Canon: I – V – vi – iii – IV – I – IV – V', steps: [[0, 0, 'maj'], [4, 7, 'maj'], [5, 9, 'min'], [2, 4, 'min'], [3, 5, 'maj'], [0, 0, 'maj'], [3, 5, 'maj'], [4, 7, 'maj']] },
  { id: '251', name: 'ii7 – V7 – Imaj7 (Jazz)', steps: [[1, 2, 'm7'], [4, 7, '7'], [0, 0, 'maj7']] },
  { id: '1625', name: 'Imaj7 – vi7 – ii7 – V7 (Jazz)', steps: [[0, 0, 'maj7'], [5, 9, 'm7'], [1, 2, 'm7'], [4, 7, '7']] },
  { id: 'blues', name: 'Blues 12 ô nhịp (I7 – IV7 – V7)', steps: [[0, 0, '7'], [0, 0, '7'], [0, 0, '7'], [0, 0, '7'], [3, 5, '7'], [3, 5, '7'], [0, 0, '7'], [0, 0, '7'], [4, 7, '7'], [3, 5, '7'], [0, 0, '7'], [4, 7, '7']] },
  { id: 'minor', name: 'i – VI – III – VII (giọng thứ)', minor: true, steps: [[0, 0, 'min'], [5, 8, 'maj'], [2, 3, 'maj'], [6, 10, 'maj']] },
  { id: 'andalusian', name: 'i – VII – VI – V (Andalusian, giọng thứ)', minor: true, steps: [[0, 0, 'min'], [6, 10, 'maj'], [5, 8, 'maj'], [4, 7, 'maj']] },
  { id: 'minor145', name: 'i – iv – V – i (giọng thứ)', minor: true, steps: [[0, 0, 'min'], [3, 5, 'min'], [4, 7, 'maj'], [0, 0, 'min']] },
];

/** Spell a scale degree of a key, e.g. (B major, degree 2, 4 semitones) -> "D#". */
export function spellDegree(tonicName, degree, semis) {
  const tonic = parseNoteName(tonicName);
  const letter = (tonic.letter + degree) % 7;
  let acc = mod12(tonic.pc + semis - LETTER_PC[letter]);
  if (acc > 6) acc -= 12;
  return noteName(letter, acc);
}

/** Build progression items from a preset in a key (keyPc = tonic pitch class). */
export function presetItems(presetId, keyPc) {
  const preset = PRESETS.find((p) => p.id === presetId);
  const tonic = (preset.minor ? MINOR_KEYS : MAJOR_KEYS)[mod12(keyPc)];
  return preset.steps.map(([deg, semis, typeId]) => {
    const rootName = spellDegree(tonic, deg, semis);
    return { pc: parseNoteName(rootName).pc, typeId, rootName, inversion: 'auto' };
  });
}

export function itemLabel(item) {
  return (item.rootName ?? buildChord(item.pc, item.typeId).root) + TYPE_BY_ID[item.typeId].symbol;
}

// ---------------------------------------------------------------- fingering

/** Right-hand fingers for an ascending list of MIDI notes (1 = thumb ... 5 = little finger). */
export function fingerRH(midis) {
  const n = midis.length;
  if (n === 1) return [1];
  if (n === 2) return midis[1] - midis[0] >= 7 ? [1, 5] : [1, 3];
  const gaps = midis.slice(1).map((m, i) => m - midis[i]);
  if (n === 3) {
    // Root & 2nd inversion: 1-3-5. 1st inversion (4th on top) or a 2nd at the bottom: 1-2-5.
    const middle = gaps[0] <= 2 || gaps[1] >= 5 ? 2 : 3;
    return [1, middle, 5];
  }
  if (n === 4) return gaps[2] <= 2 ? [1, 2, 4, 5] : [1, 2, 3, 5];
  return [1, 2, 3, 4, 5].slice(0, n);
}

/** Left-hand fingers for an ascending list of MIDI notes. */
export function fingerLH(midis) {
  const n = midis.length;
  if (n === 1) return [5];
  if (n === 2) return midis[1] - midis[0] >= 7 ? [5, 1] : [3, 1];
  const gaps = midis.slice(1).map((m, i) => m - midis[i]);
  if (n === 3) return [5, gaps[0] >= 5 ? 2 : 3, 1];
  return [5, 3, 2, 1].slice(-n);
}

export const FINGER_NAMES = { 1: 'ngón cái', 2: 'ngón trỏ', 3: 'ngón giữa', 4: 'ngón áp út', 5: 'ngón út' };

// ---------------------------------------------------------------- voice leading

const RH_MIN = 53; // F3
const RH_MAX = 84; // C6
const CENTER = 66;

function shiftNotes(notes, octaves) {
  return notes.map((n) => ({ ...makeNote(n.letter, n.acc, n.octave + octaves), degree: n.degree }));
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** How far the hand has to move between two voicings (symmetric nearest-note distance). */
export function movementCost(prev, next) {
  const d = (a, bs) => Math.min(...bs.map((b) => Math.abs(a - b)));
  return next.reduce((s, m) => s + d(m, prev), 0) + prev.reduce((s, m) => s + d(m, next), 0);
}

/** Right-hand note candidates for an item (all allowed inversions and octave positions). */
function candidates(item) {
  const max = maxInversion(item.typeId);
  const invs = item.inversion === 'auto' || item.inversion == null ? [...Array(max + 1).keys()] : [Math.min(item.inversion, max)];
  const out = [];
  for (const inv of invs) {
    const chord = buildChord(item.pc, item.typeId, inv, item.rootName);
    // Five-note chords: right hand plays the upper notes, the root goes to the left hand.
    let notes = chord.notes;
    if (notes.length > 4) notes = notes.filter((n) => n.degree !== 1);
    for (const k of [-1, 0, 1]) {
      const rh = shiftNotes(notes, k);
      if (rh[0].midi < RH_MIN || rh[rh.length - 1].midi > RH_MAX) continue;
      out.push({ chord, inv, rh });
    }
  }
  return out;
}

/** Left-hand notes for the bass option ('none' | 'root' | 'octave'). */
function leftHand(chord, rhLowest, mode) {
  if (mode === 'none') return [];
  const rootNote = chord.notes.find((n) => n.degree === 1);
  let hi = Math.min(rhLowest - 1, 59);
  while (mod12(hi) !== chord.pc) hi--;
  const mk = (m) => respell(m, rootNote.letter, rootNote.acc);
  return mode === 'octave' ? [mk(hi - 12), mk(hi)] : [mk(hi)];
}

/**
 * Voice a whole progression.
 * @param {Array<{pc:number,typeId:string,rootName?:string,inversion:'auto'|number}>} items
 * @param {{bass?:'none'|'root'|'octave'}} opts
 * @returns {Array<{index, item, chord, label, inversion, rh, lh, midis, pcs}>}
 */
export function voiceProgression(items, { bass = 'root' } = {}) {
  const out = [];
  let prev = null;
  items.forEach((item, index) => {
    const cands = candidates(item);
    let best = null;
    let bestCost = Infinity;
    for (const c of cands) {
      const ms = c.rh.map((n) => n.midi);
      let cost = Math.abs(mean(ms) - CENTER) * 0.3;
      if (prev) cost += movementCost(prev, ms);
      else if (item.inversion === 'auto' || item.inversion == null) cost += c.inv * 2; // start in root position
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    const rhMidis = best.rh.map((n) => n.midi);
    // A rootless right hand (9th chords) always needs the root in the left hand.
    const lhMode = bass === 'none' && best.rh.length < best.chord.notes.length ? 'root' : bass;
    const lhNotes = leftHand(best.chord, rhMidis[0], lhMode);
    const rhF = fingerRH(rhMidis);
    const lhF = fingerLH(lhNotes.map((n) => n.midi));
    const rh = best.rh.map((n, i) => ({ ...n, finger: rhF[i], hand: 'R' }));
    const lh = lhNotes.map((n, i) => ({ ...n, finger: lhF[i], hand: 'L' }));
    const bassNote = best.rh[0];
    const symbol = best.chord.symbol;
    const label = lh.length || bassNote.degree === 1 ? symbol : `${symbol}/${bassNote.name}`;
    out.push({
      index,
      item,
      chord: best.chord,
      symbol,
      label,
      inversion: best.inv,
      rh,
      lh,
      midis: [...lh, ...rh].map((n) => n.midi),
      pcs: [...new Set([...lh, ...rh].map((n) => mod12(n.midi)))].sort((a, b) => a - b),
    });
    prev = rhMidis;
  });
  return out;
}

// ---------------------------------------------------------------- checking

/**
 * Check played notes against a voiced step.
 * strict: right hand must use the shown position (lowest right-hand note) and the left hand must play the root.
 */
export function matchStep(step, played, { strict = false } = {}) {
  const notes = [...new Set(played)].sort((a, b) => a - b);
  const playedPcs = [...new Set(notes.map(mod12))];
  const missing = step.pcs.filter((pc) => !playedPcs.includes(pc));
  const extra = playedPcs.filter((pc) => !step.pcs.includes(pc));
  const complete = playedPcs.length >= step.pcs.length;
  const base = { complete, missing, extra };
  if (missing.length || extra.length) return { ...base, ok: false, reason: 'notes' };
  if (!strict) return { ...base, ok: true };
  const lhCount = step.lh.length;
  if (lhCount) {
    if (notes.length < lhCount + step.rh.length) return { ...base, ok: false, reason: 'lh' };
    const lh = notes.slice(0, lhCount);
    if (!lh.every((m) => mod12(m) === step.chord.pc)) return { ...base, ok: false, reason: 'lh' };
    const rh = notes.slice(lhCount);
    if (mod12(rh[0]) !== mod12(step.rh[0].midi)) return { ...base, ok: false, reason: 'position' };
    return { ...base, ok: true };
  }
  if (mod12(notes[0]) !== mod12(step.rh[0].midi)) return { ...base, ok: false, reason: 'position' };
  return { ...base, ok: true };
}

// ---------------------------------------------------------------- guidance

function stepText(semis) {
  const a = Math.abs(semis);
  const dir = semis > 0 ? 'lên' : 'xuống';
  const size = a === 1 ? 'nửa cung' : a === 2 ? '1 cung' : a % 2 === 0 ? `${a / 2} cung` : `${(a - 1) / 2} cung rưỡi`;
  return `${dir} ${size}`;
}

/**
 * Human-readable tips (Vietnamese) to move the hands from `prev` to `next`.
 * Notes names are plain ASCII (e.g. "Bb"); the UI prettifies them.
 */
export function transitionTips(prev, next) {
  const tips = [];
  const prevByMidi = new Map(prev.rh.map((n) => [n.midi, n]));
  const prevByFinger = new Map(prev.rh.map((n) => [n.finger, n]));
  const kept = next.rh.filter((n) => prevByMidi.has(n.midi));
  for (const n of kept) {
    const p = prevByMidi.get(n.midi);
    tips.push(
      p.finger === n.finger
        ? `Giữ nguyên phím ${n.name} bằng ngón ${n.finger}.`
        : `Phím ${n.name} dùng lại nhưng đổi từ ngón ${p.finger} sang ngón ${n.finger}.`,
    );
  }
  const shift = mean(next.rh.map((n) => n.midi)) - mean(prev.rh.map((n) => n.midi));
  if (Math.abs(shift) >= 5) {
    tips.push(`Nhấc cả bàn tay phải ${shift > 0 ? 'lên' : 'xuống'} rồi đặt ngón 1 vào ${next.rh[0].name}.`);
  }
  for (const n of next.rh) {
    if (prevByMidi.has(n.midi)) continue;
    const p = prevByFinger.get(n.finger);
    if (p && Math.abs(n.midi - p.midi) <= 4 && Math.abs(shift) < 5) {
      tips.push(`Ngón ${n.finger}: ${p.name} → ${n.name} (${stepText(n.midi - p.midi)}).`);
    } else if (Math.abs(shift) < 5 || n.finger !== 1) {
      tips.push(`Ngón ${n.finger} đặt vào ${n.name}.`);
    }
  }
  if (next.lh.length) {
    const pl = prev.lh[0];
    const nl = next.lh[0];
    if (pl && pl.midi === nl.midi) tips.push(`Tay trái giữ nguyên ${nl.name}.`);
    else if (pl) tips.push(`Tay trái: ${pl.name} → ${nl.name} (${stepText(nl.midi - pl.midi)}), ngón ${next.lh.map((n) => n.finger).join('–')}.`);
    else tips.push(`Tay trái đặt ngón ${next.lh.map((n) => n.finger).join('–')} vào ${next.lh.map((n) => n.name).join(' – ')}.`);
  }
  return tips;
}

/** Short description of a step's hand position. */
export function positionText(step) {
  const rh = step.rh.map((n) => `${n.name}(${n.finger})`).join(' – ');
  const lh = step.lh.map((n) => `${n.name}(${n.finger})`).join(' – ');
  return { rh, lh };
}


// ---------------------------------------------------------------- chord palette by key

// [degree index, semitones above tonic, chord type, roman numeral]
const KEY_PALETTE = {
  major: [
    { title: 'Hợp âm 3 nốt', steps: [[0, 0, 'maj', 'I'], [1, 2, 'min', 'ii'], [2, 4, 'min', 'iii'], [3, 5, 'maj', 'IV'], [4, 7, 'maj', 'V'], [5, 9, 'min', 'vi'], [6, 11, 'dim', 'vii°']] },
    { title: 'Hợp âm 7', steps: [[0, 0, 'maj7', 'Imaj7'], [1, 2, 'm7', 'ii7'], [2, 4, 'm7', 'iii7'], [3, 5, 'maj7', 'IVmaj7'], [4, 7, '7', 'V7'], [5, 9, 'm7', 'vi7'], [6, 11, 'm7b5', 'viiø7']] },
    { title: 'Thường gặp khác', steps: [[4, 7, 'sus4', 'Vsus4'], [0, 0, 'sus2', 'Isus2'], [1, 2, '7', 'II7'], [2, 4, '7', 'III7'], [5, 9, '7', 'VI7'], [3, 5, 'min', 'iv'], [6, 10, 'maj', '♭VII'], [5, 8, 'maj', '♭VI'], [0, 0, '7', 'I7']] },
  ],
  minor: [
    { title: 'Hợp âm 3 nốt', steps: [[0, 0, 'min', 'i'], [1, 2, 'dim', 'ii°'], [2, 3, 'maj', 'III'], [3, 5, 'min', 'iv'], [4, 7, 'min', 'v'], [5, 8, 'maj', 'VI'], [6, 10, 'maj', 'VII']] },
    { title: 'Hợp âm 7', steps: [[0, 0, 'm7', 'i7'], [1, 2, 'm7b5', 'iiø7'], [2, 3, 'maj7', 'IIImaj7'], [3, 5, 'm7', 'iv7'], [4, 7, 'm7', 'v7'], [5, 8, 'maj7', 'VImaj7'], [6, 10, '7', 'VII7']] },
    { title: 'Thường gặp khác', steps: [[4, 7, 'maj', 'V'], [4, 7, '7', 'V7'], [6, 11, 'dim7', 'vii°7'], [3, 5, 'maj', 'IV'], [0, 0, 'mMaj7', 'i(maj7)'], [1, 1, 'maj', '♭II']] },
  ],
};

/**
 * Chords that belong to (or are common in) a key, grouped, with roman numerals.
 * @param {'major'|'minor'} mode
 * @returns {Array<{title:string, chords:Array<{roman:string, item:object}>}>}
 */
export function keyPalette(mode, keyPc) {
  const tonic = (mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS)[mod12(keyPc)];
  return KEY_PALETTE[mode].map((g) => ({
    title: g.title,
    chords: g.steps.map(([deg, semis, typeId, roman]) => {
      const rootName = spellDegree(tonic, deg, semis);
      return { roman, item: { pc: parseNoteName(rootName).pc, typeId, rootName, inversion: 'auto' } };
    }),
  }));
}

/** Move an element of `arr` from index `from` to index `to` (in place); returns the array. */
export function moveItem(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(Math.max(0, Math.min(to, arr.length)), 0, x);
  return arr;
}

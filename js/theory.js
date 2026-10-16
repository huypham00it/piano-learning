// Music theory helpers: note spelling, chord construction, inversions, detection.
// Pure module (no DOM) so it can be unit-tested with `node --test`.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

// Preferred root spellings for each pitch class, depending on chord quality.
const ROOT_SPELLINGS = {
  major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
  dim: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
};

// Chord types. Intervals are [scale degree, semitones above root].
export const CHORD_TYPES = [
  { id: 'maj', symbol: '', name: 'Trưởng', group: 'Hợp âm 3 nốt', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7]] },
  { id: 'min', symbol: 'm', name: 'Thứ', group: 'Hợp âm 3 nốt', spell: 'minor', intervals: [[1, 0], [3, 3], [5, 7]] },
  { id: 'dim', symbol: 'dim', name: 'Giảm', group: 'Hợp âm 3 nốt', spell: 'dim', intervals: [[1, 0], [3, 3], [5, 6]] },
  { id: 'aug', symbol: 'aug', name: 'Tăng', group: 'Hợp âm 3 nốt', spell: 'major', intervals: [[1, 0], [3, 4], [5, 8]] },
  { id: 'sus2', symbol: 'sus2', name: 'Treo 2', group: 'Hợp âm 3 nốt', spell: 'major', intervals: [[1, 0], [2, 2], [5, 7]] },
  { id: 'sus4', symbol: 'sus4', name: 'Treo 4', group: 'Hợp âm 3 nốt', spell: 'major', intervals: [[1, 0], [4, 5], [5, 7]] },
  { id: '7', symbol: '7', name: 'Bảy át', group: 'Hợp âm 7', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7], [7, 10]] },
  { id: 'maj7', symbol: 'maj7', name: 'Bảy trưởng', group: 'Hợp âm 7', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7], [7, 11]] },
  { id: 'm7', symbol: 'm7', name: 'Thứ bảy', group: 'Hợp âm 7', spell: 'minor', intervals: [[1, 0], [3, 3], [5, 7], [7, 10]] },
  { id: 'mMaj7', symbol: 'm(maj7)', name: 'Thứ bảy trưởng', group: 'Hợp âm 7', spell: 'minor', intervals: [[1, 0], [3, 3], [5, 7], [7, 11]] },
  { id: 'm7b5', symbol: 'm7b5', name: 'Nửa giảm', group: 'Hợp âm 7', spell: 'dim', intervals: [[1, 0], [3, 3], [5, 6], [7, 10]] },
  { id: 'dim7', symbol: 'dim7', name: 'Bảy giảm', group: 'Hợp âm 7', spell: 'dim', intervals: [[1, 0], [3, 3], [5, 6], [7, 9]] },
  { id: '7sus4', symbol: '7sus4', name: 'Bảy treo 4', group: 'Hợp âm 7', spell: 'major', intervals: [[1, 0], [4, 5], [5, 7], [7, 10]] },
  { id: '6', symbol: '6', name: 'Sáu', group: 'Mở rộng', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7], [6, 9]] },
  { id: 'm6', symbol: 'm6', name: 'Thứ sáu', group: 'Mở rộng', spell: 'minor', intervals: [[1, 0], [3, 3], [5, 7], [6, 9]] },
  { id: 'add9', symbol: 'add9', name: 'Thêm 9', group: 'Mở rộng', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7], [9, 14]] },
  { id: 'madd9', symbol: 'm(add9)', name: 'Thứ thêm 9', group: 'Mở rộng', spell: 'minor', intervals: [[1, 0], [3, 3], [5, 7], [9, 14]] },
  { id: '9', symbol: '9', name: 'Chín', group: 'Mở rộng', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7], [7, 10], [9, 14]] },
  { id: 'maj9', symbol: 'maj9', name: 'Chín trưởng', group: 'Mở rộng', spell: 'major', intervals: [[1, 0], [3, 4], [5, 7], [7, 11], [9, 14]] },
  { id: 'm9', symbol: 'm9', name: 'Thứ chín', group: 'Mở rộng', spell: 'minor', intervals: [[1, 0], [3, 3], [5, 7], [7, 10], [9, 14]] },
];

export const TYPE_BY_ID = Object.fromEntries(CHORD_TYPES.map((t) => [t.id, t]));

export const INVERSION_NAMES = ['Thế gốc', 'Đảo 1', 'Đảo 2', 'Đảo 3'];

export const mod12 = (n) => ((n % 12) + 12) % 12;

/** Parse a note name like "Eb", "F#", "Bbb" into {letter, acc, pc}. */
export function parseNoteName(name) {
  const letter = LETTERS.indexOf(name[0].toUpperCase());
  if (letter < 0) throw new Error(`Bad note name: ${name}`);
  let acc = 0;
  for (const ch of name.slice(1)) {
    if (ch === '#') acc += 1;
    else if (ch === 'b') acc -= 1;
    else throw new Error(`Bad note name: ${name}`);
  }
  return { letter, acc, pc: mod12(LETTER_PC[letter] + acc) };
}

export function accidentalText(acc) {
  return ['bb', 'b', '', '#', '##'][acc + 2] ?? '';
}

/** Display accidental using music symbols. */
export function accidentalSymbol(acc) {
  return ['𝄫', '♭', '', '♯', '𝄪'][acc + 2] ?? '';
}

export function noteName(letter, acc) {
  return LETTERS[letter] + accidentalText(acc);
}

export function prettyName(name) {
  return name.replace(/##/g, '𝄪').replace(/#/g, '♯').replace(/(?<=[A-G])bb/g, '𝄫').replace(/(?<=[A-G𝄫])b/g, '♭');
}

/** Note object from letter/accidental/octave (scientific pitch: C4 = MIDI 60). */
export function makeNote(letter, acc, octave) {
  return {
    letter,
    acc,
    octave,
    midi: 12 * (octave + 1) + LETTER_PC[letter] + acc,
    name: noteName(letter, acc),
    // Diatonic step index (C0 = 0) used for staff placement.
    step: octave * 7 + letter,
  };
}

/** Spell a MIDI note using a given letter/accidental (octave derived from the MIDI number). */
export function respell(midi, letter, acc) {
  const octave = Math.floor((midi - LETTER_PC[letter] - acc) / 12) - 1;
  return makeNote(letter, acc, octave);
}

const SOLFEGE = ['Đô', 'Rê', 'Mi', 'Fa', 'Sol', 'La', 'Si'];

/** Vietnamese solfège name, e.g. "Bb" -> "Si giáng", "F#" -> "Fa thăng". */
export function solfegeName(name) {
  const { letter, acc } = parseNoteName(name);
  const accName = { [-2]: ' giáng kép', [-1]: ' giáng', 0: '', 1: ' thăng', 2: ' thăng kép' }[acc];
  return SOLFEGE[letter] + accName;
}

/** Default spelling for a MIDI note when no chord context is available. */
export function spellMidi(midi, preferFlats = false) {
  const pc = mod12(midi);
  const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const { letter, acc } = parseNoteName((preferFlats ? flatNames : sharpNames)[pc]);
  const octave = Math.floor((midi - LETTER_PC[letter] - acc) / 12) - 1;
  return makeNote(letter, acc, octave);
}

export function rootNameFor(pc, typeId) {
  return ROOT_SPELLINGS[TYPE_BY_ID[typeId].spell][mod12(pc)];
}

export function chordId(pc, typeId) {
  return `${mod12(pc)}:${typeId}`;
}

export function parseChordId(id) {
  const [pc, typeId] = id.split(':');
  return { pc: Number(pc), typeId };
}

/** Max inversion allowed for a chord type (extensions above the 7th are not inverted to). */
export function maxInversion(typeId) {
  const n = TYPE_BY_ID[typeId].intervals.filter(([deg]) => deg <= 7).length;
  return Math.min(n, 4) - 1;
}

/**
 * Build a chord.
 * @returns {{id, pc, typeId, type, root, symbol, notes, pcs, bassPc, inversion, label}}
 * `notes` is a voiced list (ascending) with lowest note in octave 4 range (MIDI 60..71).
 */
export function buildChord(pc, typeId, inversion = 0) {
  const type = TYPE_BY_ID[typeId];
  if (!type) throw new Error(`Unknown chord type ${typeId}`);
  const rootName = rootNameFor(pc, typeId);
  const root = parseNoteName(rootName);
  const rootOctave = 4;
  const rootMidi = 12 * (rootOctave + 1) + LETTER_PC[root.letter] + root.acc;

  let notes = type.intervals.map(([deg, semis]) => {
    const letterIdx = root.letter + deg - 1;
    const letter = letterIdx % 7;
    const octave = rootOctave + Math.floor(letterIdx / 7);
    const midi = rootMidi + semis;
    const acc = midi - (12 * (octave + 1) + LETTER_PC[letter]);
    return { ...makeNote(letter, acc, octave), degree: deg };
  });

  const inv = Math.max(0, Math.min(inversion, maxInversion(typeId)));
  for (let i = 0; i < inv; i++) {
    const n = notes[i];
    notes[i] = { ...makeNote(n.letter, n.acc, n.octave + 1), degree: n.degree };
  }
  notes.sort((a, b) => a.midi - b.midi || a.step - b.step);

  // Keep the lowest note within MIDI 60..71 so the chord sits on the treble staff.
  while (notes[0].midi > 71) {
    notes = notes.map((n) => ({ ...makeNote(n.letter, n.acc, n.octave - 1), degree: n.degree }));
  }
  while (notes[0].midi < 60) {
    notes = notes.map((n) => ({ ...makeNote(n.letter, n.acc, n.octave + 1), degree: n.degree }));
  }

  const symbol = rootName + type.symbol;
  const bass = notes[0];
  const label = inv > 0 ? `${symbol}/${bass.name}` : symbol;
  return {
    id: chordId(pc, typeId),
    pc: mod12(pc),
    typeId,
    type,
    root: rootName,
    symbol,
    label,
    notes,
    pcs: [...new Set(notes.map((n) => mod12(n.midi)))].sort((a, b) => a - b),
    bassPc: mod12(bass.midi),
    inversion: inv,
  };
}

/** All chord ids (12 roots x every type). */
export function allChordIds() {
  const ids = [];
  for (const t of CHORD_TYPES) for (let pc = 0; pc < 12; pc++) ids.push(chordId(pc, t.id));
  return ids;
}

/** Diatonic triads (or sevenths) of a major key, as chord ids. */
export function diatonicChords(keyPc, sevenths = false) {
  const scale = [0, 2, 4, 5, 7, 9, 11];
  const triads = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  const sev = ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'];
  return scale.map((s, i) => chordId(keyPc + s, (sevenths ? sev : triads)[i]));
}

/** Compare a set of played MIDI notes against a chord. */
export function matchChord(chord, midiNotes, { requireInversion = false } = {}) {
  if (!midiNotes.length) return { ok: false, complete: false };
  const played = [...new Set(midiNotes.map(mod12))];
  const target = new Set(chord.pcs);
  const missing = chord.pcs.filter((pc) => !played.includes(pc));
  const extra = played.filter((pc) => !target.has(pc));
  const lowest = Math.min(...midiNotes);
  const bassOk = !requireInversion || mod12(lowest) === chord.bassPc;
  return {
    ok: missing.length === 0 && extra.length === 0 && bassOk,
    complete: played.length >= chord.pcs.length,
    missing,
    extra,
    bassOk,
  };
}

/** Try to name a set of MIDI notes. Returns best chord label or null. */
export function detectChord(midiNotes) {
  if (midiNotes.length < 2) return null;
  const played = [...new Set(midiNotes.map(mod12))].sort((a, b) => a - b);
  const bassPc = mod12(Math.min(...midiNotes));
  const matches = [];
  for (const t of CHORD_TYPES) {
    for (let pc = 0; pc < 12; pc++) {
      const pcs = t.intervals.map(([, s]) => mod12(pc + s));
      if (pcs.length !== played.length) continue;
      if (!pcs.every((p) => played.includes(p))) continue;
      const rootName = rootNameFor(pc, t.id);
      let label = rootName + t.symbol;
      if (bassPc !== pc) {
        const c = buildChord(pc, t.id);
        const bassNote = c.notes.find((n) => mod12(n.midi) === bassPc);
        label += '/' + bassNote.name;
      }
      // Prefer root-position interpretations and simpler chord types.
      matches.push({ label, score: (bassPc === pc ? 0 : 10) + CHORD_TYPES.indexOf(t) });
    }
  }
  matches.sort((a, b) => a.score - b.score);
  return matches[0]?.label ?? null;
}

/** Formula text such as "1 - 3 - 5". */
export function formulaText(typeId) {
  const t = TYPE_BY_ID[typeId];
  return t.intervals
    .map(([deg, semis]) => {
      const major = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14 }[deg];
      const diff = semis - major;
      return (diff < 0 ? 'b'.repeat(-diff) : '#'.repeat(diff)) + deg;
    })
    .join(' - ');
}

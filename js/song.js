// Songs: a small text notation for melody + chord symbols, parsed into measures and practice events.
// Pure module (no DOM) so it can be unit-tested with `node --test`.
//
// Notation (one song):
//   title: Tên bài            composer: Tác giả
//   key: Dm                   time: 2/4            tempo: 75
//   @Điệp khúc                (section label for the next measure)
//   [Dm] F4q G4e E4e | [Am/C] E4e E4s G4s C4e C4e | ...
// Notes: letter + optional #/b/##/bb + octave + duration (w h q e s), optional "." (dotted),
// optional "3" (triplet), optional "~" (tie to the next note). Rests: r + duration (re, rq.).
// [Chord] applies from the next note or rest. "|" separates measures. Lines starting with // are comments.
import { LETTER_PC, TYPE_BY_ID, CHORD_TYPES, makeNote, parseNoteName, respell, mod12, noteName } from './theory.js';

const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
const EPS = 1e-6;

const MAJOR_SIG = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indexes)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

/** Key signature from a key name like "F", "Dm", "Am", "Bb". Returns sharps (+) / flats (-). */
export function keySignature(key = 'C') {
  const m = /^([A-G](?:#|b)?)(m?)$/.exec(String(key).trim());
  if (!m) return 0;
  if (!m[2]) return MAJOR_SIG[m[1]] ?? 0;
  // Minor: relative major is a minor third above.
  const relPc = mod12(parseNoteName(m[1]).pc + 3);
  const entry = Object.entries(MAJOR_SIG).find(([n, s]) => parseNoteName(n).pc === relPc && Math.abs(s) <= 6);
  return entry ? entry[1] : 0;
}

/** Accidental (-1, 0, +1) the key signature gives each letter index (0 = C ... 6 = B). */
export function keyAccidentals(sig) {
  const acc = [0, 0, 0, 0, 0, 0, 0];
  if (sig > 0) SHARP_ORDER.slice(0, sig).forEach((l) => (acc[l] = 1));
  if (sig < 0) FLAT_ORDER.slice(0, -sig).forEach((l) => (acc[l] = -1));
  return acc;
}

// Chord symbols: longest suffix first so "m7b5" wins over "m".
const SUFFIXES = CHORD_TYPES.map((t) => [t.symbol, t.id])
  .concat([['M', 'maj'], ['maj', 'maj'], ['min', 'min'], ['-', 'min'], ['°', 'dim'], ['o', 'dim'], ['+', 'aug'], ['ø', 'm7b5'], ['ø7', 'm7b5'], ['M7', 'maj7'], ['Δ', 'maj7'], ['sus', 'sus4'], ['°7', 'dim7'], ['o7', 'dim7'], ['mmaj7', 'mMaj7'], ['m(maj7)', 'mMaj7']])
  .sort((a, b) => b[0].length - a[0].length);

/** Parse a chord symbol such as "Am", "Bbmaj7", "Am/C", "Esus4", "Edim". */
export function parseChordSymbol(sym) {
  const s = sym.trim();
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(s);
  if (!m) return null;
  const rootName = m[1];
  const suffix = m[2];
  let typeId = null;
  if (suffix === '') typeId = 'maj';
  else {
    const hit = SUFFIXES.find(([sfx]) => sfx === suffix);
    typeId = hit ? hit[1] : null;
  }
  const bassName = m[3] ?? rootName;
  return {
    symbol: s,
    rootName,
    rootPc: parseNoteName(rootName).pc,
    typeId, // null when the quality is unknown (still playable: the left hand only needs the bass)
    typeName: typeId ? TYPE_BY_ID[typeId].name : '',
    bassName,
    bassPc: parseNoteName(bassName).pc,
  };
}

function parseNoteToken(tok) {
  const m = /^([A-G])(##|bb|#|b)?(-?\d)([whqes])(\.?)(3?)(~?)$/.exec(tok);
  if (!m) return null;
  const acc = { '##': 2, '#': 1, b: -1, bb: -2 }[m[2]] ?? 0;
  const letter = 'CDEFGAB'.indexOf(m[1]);
  let dur = DUR[m[4]] * (m[5] ? 1.5 : 1);
  if (m[6]) dur = (dur * 2) / 3;
  return { ...makeNote(letter, acc, Number(m[3])), dur, base: m[4], dotted: !!m[5], triplet: !!m[6], tieNext: !!m[7] };
}

function parseRestToken(tok) {
  const m = /^r([whqes])(\.?)(3?)$/.exec(tok);
  if (!m) return null;
  let dur = DUR[m[1]] * (m[2] ? 1.5 : 1);
  if (m[3]) dur = (dur * 2) / 3;
  return { rest: true, dur, base: m[1], dotted: !!m[2], triplet: !!m[3] };
}

/** Split a file holding several songs separated by lines of "===". */
export function splitSongs(text) {
  return text
    .split(/^\s*={3,}\s*$/m)
    .map((t) => t.trim())
    .filter((t) => t && /\|/.test(t));
}

/**
 * Parse one song.
 * @returns {{meta, measures, notes, chords, errors:string[], warnings:string[], keySig:number, beatsPerMeasure:number}}
 */
export function parseSong(text) {
  const meta = { title: 'Bài không tên', composer: '', key: 'C', time: '4/4', tempo: 80 };
  const errors = [];
  const warnings = [];
  const measures = [];
  const notes = [];
  const chords = [];
  let pendingSection = null;
  let pendingChord = null;
  let current = null;
  let t = 0;

  const openMeasure = () => {
    current = { index: measures.length, start: t, items: [], section: pendingSection, chordAt: [] };
    pendingSection = null;
  };
  const closeMeasure = () => {
    if (current && (current.items.length || current.chordAt.length)) {
      current.length = t - current.start;
      measures.push(current);
    }
    current = null;
  };

  text.split(/\r?\n/).forEach((raw, li) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;
    const head = /^(title|composer|key|time|tempo)\s*:\s*(.*)$/i.exec(line);
    if (head) {
      const k = head[1].toLowerCase();
      meta[k] = k === 'tempo' ? Number(head[2]) || meta.tempo : head[2].trim();
      return;
    }
    if (line.startsWith('@')) {
      pendingSection = line.slice(1).trim();
      return;
    }
    const tokens = line.match(/\[[^\]]*\]|\||[^\s|[]+/g) ?? [];
    for (const tok of tokens) {
      if (tok === '|') {
        closeMeasure();
        continue;
      }
      if (!current) openMeasure();
      if (tok.startsWith('[')) {
        const sym = tok.slice(1, -1).trim();
        if (sym === '-' || sym === '') {
          pendingChord = { none: true, symbol: '' };
          continue;
        }
        const c = parseChordSymbol(sym);
        if (!c) errors.push(`Dòng ${li + 1}: không hiểu hợp âm “${sym}”.`);
        else pendingChord = c;
        continue;
      }
      const item = parseNoteToken(tok) ?? parseRestToken(tok);
      if (!item) {
        errors.push(`Dòng ${li + 1}: không hiểu “${tok}”. Ví dụ đúng: C4q, F#4e., Bb3h, A4e3, re.`);
        continue;
      }
      item.start = t;
      item.measure = measures.length;
      if (pendingChord) {
        const chord = { ...pendingChord, start: t, measure: measures.length };
        chords.push(chord);
        current.chordAt.push(chord);
        pendingChord = null;
      }
      current.items.push(item);
      if (!item.rest) notes.push(item);
      t += item.dur;
    }
  });
  closeMeasure();

  const [num, den] = String(meta.time).split('/').map(Number);
  const beatsPerMeasure = num && den ? (num * 4) / den : 4;
  meta.time = `${num || 4}/${den || 4}`;

  // Measure numbering: a short first measure is a pickup (measure 0).
  const pickup = measures.length > 1 && measures[0].length < beatsPerMeasure - EPS;
  measures.forEach((m, i) => {
    m.number = pickup ? i : i + 1;
    const full = Math.abs(m.length - beatsPerMeasure) < EPS;
    const isEdge = i === 0 || i === measures.length - 1;
    if (!full && !(isEdge && m.length < beatsPerMeasure)) {
      warnings.push(`Ô nhịp ${m.number}: tổng trường độ ${round(m.length)} phách, cần ${round(beatsPerMeasure)} phách.`);
    }
  });

  // Ties must join equal pitches.
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (!n.tieNext) continue;
    const next = notes[i + 1];
    if (!next || next.midi !== n.midi) {
      warnings.push(`Ô nhịp ${measures[n.measure]?.number ?? '?'}: dấu nối (~) phải nối hai nốt cùng cao độ.`);
      n.tieNext = false;
    } else next.tiedFrom = true;
  }

  if (!notes.length && !errors.length) errors.push('Bài hát chưa có nốt nào.');
  const keySig = keySignature(meta.key);
  return { meta, measures, notes, chords, errors, warnings, keySig, beatsPerMeasure, totalBeats: t, pickup };
}

const round = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- fingering

const isBlackPc = (pc) => [1, 3, 6, 8, 10].includes(pc);

/** Cost of moving from (m1 with finger f1) to (m2 with finger f2) in the right hand. */
function moveCost(m1, f1, m2, f2, relaxed) {
  const d = m2 - m1;
  let cost;
  if (f1 === f2) {
    if (d === 0) cost = 0;
    // Same finger on a new key = moving the whole hand: cheap only when there is time (long note / rest).
    else cost = relaxed ? 1 + 0.3 * Math.abs(d) : 5 + Math.abs(d);
  } else if (d === 0) return 4; // changing finger on a repeated note confuses beginners
  else {
    const fd = f2 - f1;
    if (d > 0 === fd > 0) {
      const span = Math.abs(d);
      const fs = Math.abs(fd);
      const thumb = f1 === 1 || f2 === 1;
      const max = fs * 2 + (thumb ? 3 : 1);
      // Inside the comfortable range, prefer spacings close to ~2 semitones per finger.
      cost = span < fs ? (fs - span) * 2 : span > max ? (span - max) * 2 : 0.2 * Math.abs(span - fs * 1.8);
    } else if ((d > 0 && f2 === 1 && f1 <= 4 && d <= 5) || (d < 0 && f1 === 1 && f2 <= 4 && -d <= 5)) {
      cost = relaxed ? 2 : 3.5; // thumb under / finger over the thumb: possible but harder for beginners
    } else cost = relaxed ? 3 + 0.3 * Math.abs(d) : 10 + Math.abs(d);
  }
  const pc = mod12(m2);
  if (isBlackPc(pc) && f2 === 1) cost += 2;
  if (isBlackPc(pc) && f2 === 5) cost += 0.6;
  if (f2 === 4) cost += 0.15; // the ring finger is the weakest
  return cost;
}

/**
 * Choose fingers for a sequence of single notes (dynamic programming).
 * @param {Array<{midi:number, relaxed?:boolean}>} seq relaxed = time to reposition before this note
 * @param {'R'|'L'} hand
 */
export function fingerSequence(seq, hand = 'R') {
  if (!seq.length) return [];
  const sign = hand === 'R' ? 1 : -1; // left hand: mirror the keyboard
  const F = [1, 2, 3, 4, 5];
  const startBias = (f, m) => (isBlackPc(mod12(m)) && f === 1 ? 2 : 0) + Math.abs(f - 3) * 0.05;
  let cost = F.map((f) => startBias(f, seq[0].midi));
  const back = [];
  for (let i = 1; i < seq.length; i++) {
    const prev = cost;
    const ptr = [];
    cost = F.map((f2) => {
      let best = Infinity;
      let arg = 0;
      F.forEach((f1, j) => {
        const c = prev[j] + moveCost(sign * seq[i - 1].midi, f1, sign * seq[i].midi, f2, seq[i].relaxed);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      ptr.push(arg);
      return best;
    });
    back.push(ptr);
  }
  let j = cost.indexOf(Math.min(...cost));
  const out = [F[j]];
  for (let i = back.length - 1; i >= 0; i--) {
    j = back[i][j];
    out.unshift(F[j]);
  }
  return out;
}

// ---------------------------------------------------------------- practice events

const LH_LOW = 41; // F2: left-hand roots sit in F2..E3, below the melody

/** Left-hand bass note (MIDI) for a chord, spelled with the chord's bass name. */
export function bassNote(chord) {
  const midi = LH_LOW + mod12(chord.bassPc - LH_LOW);
  const { letter, acc } = parseNoteName(chord.bassName);
  return respell(midi, letter, acc);
}

/**
 * Build the strike events used for practice: each event is a moment where the right hand plays a new
 * melody note and/or the left hand plays the root (bass) of a new chord.
 */
export function buildEvents(song) {
  const attacks = song.notes.filter((n) => !n.tiedFrom);
  const lhChords = song.chords.filter((c) => !c.none);
  const times = [...new Set([...attacks.map((n) => n.start), ...lhChords.map((c) => c.start)].map((x) => round6(x)))].sort((a, b) => a - b);

  const rhFingers = fingerSequence(
    attacks.map((n, i) => ({ midi: n.midi, relaxed: i > 0 && n.start - (attacks[i - 1].start + attacks[i - 1].dur) > 0.2 || (i > 0 && attacks[i - 1].dur >= 1.5) })),
    'R',
  );
  attacks.forEach((n, i) => (n.finger = rhFingers[i]));
  // Tied continuations keep the same finger.
  song.notes.forEach((n, i) => {
    if (n.tiedFrom) n.finger = song.notes[i - 1].finger;
  });

  const lhNotes = lhChords.map((c, i) => {
    const next = lhChords[i + 1];
    const end = next ? next.start : song.totalBeats;
    return { ...bassNote(c), start: c.start, dur: end - c.start, chord: c, measure: c.measure };
  });
  const lhFingers = fingerSequence(lhNotes.map((n, i) => ({ midi: n.midi, relaxed: i > 0 && lhNotes[i - 1].dur >= 2 })), 'L');
  lhNotes.forEach((n, i) => (n.finger = lhFingers[i]));

  let chordIdx = -1;
  const sortedChords = [...song.chords].sort((a, b) => a.start - b.start);
  return times.map((time, index) => {
    while (chordIdx + 1 < sortedChords.length && sortedChords[chordIdx + 1].start <= time + EPS) chordIdx++;
    const rh = attacks.find((n) => Math.abs(n.start - time) < EPS) ?? null;
    const lh = lhNotes.find((n) => Math.abs(n.start - time) < EPS) ?? null;
    const measure = (rh ?? lh).measure;
    return { index, time, rh, lh, chord: sortedChords[chordIdx] ?? null, measure };
  });
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Spelled scale notes of the key (for naming played notes). */
export function keyScaleNotes(sig) {
  const acc = keyAccidentals(sig);
  return [0, 1, 2, 3, 4, 5, 6].map((l) => ({ letter: l, acc: acc[l], name: noteName(l, acc[l]), pc: mod12(LETTER_PC[l] + acc[l]) }));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSong, splitSongs, parseChordSymbol, keySignature, keyAccidentals, buildEvents, fingerSequence, bassNote,
} from '../js/song.js';
import { DEMO_SONGS } from '../js/demoSongs.js';

test('chord symbols', () => {
  const c = parseChordSymbol('Am/C');
  assert.equal(c.rootName, 'A');
  assert.equal(c.typeId, 'min');
  assert.equal(c.bassName, 'C');
  assert.equal(parseChordSymbol('Bbmaj7').typeId, 'maj7');
  assert.equal(parseChordSymbol('Esus4').typeId, 'sus4');
  assert.equal(parseChordSymbol('Edim').typeId, 'dim');
  assert.equal(parseChordSymbol('F#m7b5').rootName, 'F#');
  assert.equal(parseChordSymbol('Gm7').typeId, 'm7');
  assert.equal(parseChordSymbol('H7'), null);
});

test('key signatures', () => {
  assert.equal(keySignature('C'), 0);
  assert.equal(keySignature('Am'), 0);
  assert.equal(keySignature('Dm'), -1);
  assert.equal(keySignature('F'), -1);
  assert.equal(keySignature('E'), 4);
  assert.equal(keySignature('F#m'), 3);
  assert.deepEqual(keyAccidentals(-1), [0, 0, 0, 0, 0, 0, -1]);
  assert.deepEqual(keyAccidentals(2), [1, 0, 0, 1, 0, 0, 0]);
});

test('parses notes, rests, ties, triplets and measures', () => {
  const s = parseSong(`title: T
key: Dm
time: 2/4
A3e |
[Dm] D4q. A4e | [Am/C] E4e E4s G4s C4e3 C4e3 C4e3 | [Bb] D4h~ | D4e re A4e C5e | [Dm] D4q`);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.warnings, []);
  assert.equal(s.pickup, true);
  assert.equal(s.measures.length, 6);
  assert.equal(s.measures[0].number, 0);
  assert.equal(s.measures[1].number, 1);
  assert.equal(s.keySig, -1);
  const tied = s.notes.find((n) => n.tiedFrom);
  assert.equal(tied.name, 'D');
  assert.equal(s.chords.map((c) => c.symbol).join(' '), 'Dm Am/C Bb Dm');
  const ev = buildEvents(s);
  // The tied D does not need a new key press; the left hand holds Bb meanwhile.
  assert.equal(ev.filter((e) => e.rh?.tiedFrom).length, 0);
  assert.equal(ev.find((e) => e.lh?.chord.symbol === 'Am/C').lh.name, 'C');
});

test('reports measure length problems and bad tokens', () => {
  const s = parseSong(`time: 2/4
C4q | D4q E4q F4q | G4h | A4q`);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /Ô nhịp 1/);
  const bad = parseSong('C4x | [Q] D4q');
  assert.equal(bad.errors.length, 2);
});

test('left-hand bass sits below middle C', () => {
  for (const sym of ['C', 'F', 'G', 'A', 'Bb', 'E', 'Am/C', 'D7']) {
    const n = bassNote(parseChordSymbol(sym));
    assert.ok(n.midi >= 41 && n.midi <= 52, sym);
  }
  assert.equal(bassNote(parseChordSymbol('Bb')).name, 'Bb');
});

test('fingering: a five-finger scale and its return', () => {
  const up = [60, 62, 64, 65, 67, 65, 64, 62, 60].map((midi) => ({ midi }));
  assert.deepEqual(fingerSequence(up, 'R'), [1, 2, 3, 4, 5, 4, 3, 2, 1]);
  assert.deepEqual(fingerSequence([48, 50, 52, 53, 55].map((midi) => ({ midi })), 'L'), [5, 4, 3, 2, 1]);
  assert.deepEqual(fingerSequence([64, 64, 64].map((midi) => ({ midi })), 'R').length, 3);
});

test('demo songs parse cleanly', () => {
  for (const text of DEMO_SONGS) {
    const s = parseSong(text);
    assert.deepEqual(s.errors, [], s.meta.title);
    assert.deepEqual(s.warnings, [], s.meta.title);
    const ev = buildEvents(s);
    assert.ok(ev.length > 10);
    assert.ok(ev.every((e) => e.rh || e.lh));
    for (const e of ev) if (e.rh) assert.ok(e.rh.finger >= 1 && e.rh.finger <= 5);
  }
  assert.equal(splitSongs(DEMO_SONGS.join('\n===\n')).length, 2);
});

test('time signature changes inside a song', () => {
  const s = parseSong(`time: 2/4
[Am] A4h |
time: 3/4
[E7] G#4q D5e E5e D5e C5e |
2/4 E4q B4q | [Am] A4h`);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(s.measures.map((m) => m.time), ['2/4', '3/4', '2/4', '2/4']);
  assert.deepEqual(s.measures.map((m) => m.beats), [2, 3, 2, 2]);
  assert.deepEqual(s.measures.map((m) => !!m.timeChange), [false, true, true, false]);
  assert.equal(s.meta.time, '2/4');
  assert.equal(s.meta.timeChanges, true);
  assert.equal(s.pickup, false);
  // A 3-beat measure under 2/4 is reported.
  const bad = parseSong(`time: 2/4
C4h | C4q D4q E4q | C4h`);
  assert.match(bad.warnings[0], /cần 2 phách/);
  // A leading time token is just the song's time signature.
  assert.equal(parseSong('3/4 C4h. | D4h.').meta.time, '3/4');
  assert.equal(parseSong('time: 2/4\nC4h |\ntime: 5/3\nD4h').errors.length, 1);
});

test('right hand can strike several notes together (two-part writing)', async () => {
  const { rhNotes } = await import('../js/song.js');
  const s = parseSong(`time: 2/4
[Am] C5+E5e. A4+C5s B4+D5e E5+C5e | [Dm] A4+D5q. F4+B4e | [E7] E4e E4+B4e E4+B4s C5s D4+B4e | [Am] C4+A4h`);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.warnings, []);
  const first = s.notes[0];
  assert.equal(first.name + first.octave, 'E5'); // the highest pitch is the melody
  assert.deepEqual(first.harmony.map((h) => h.name + h.octave), ['C5']);
  const ev = buildEvents(s);
  const fingers = (e) => rhNotes(e.rh).map((n) => n.finger);
  for (const e of ev) {
    const f = fingers(e);
    // distinct fingers, melody finger highest
    assert.equal(new Set(f).size, f.length);
    assert.ok(f.every((x, i) => i === 0 || x < f[i - 1]));
  }
  assert.deepEqual(fingers(ev[0]), [5, 3]); // C5+E5 with 3 and 5
  assert.deepEqual(fingers(ev.at(-1)), [5, 1]); // C4+A4 spans a sixth: 1 and 5
  // Duplicate pitches collapse to one note.
  assert.equal(parseSong('A4+A4q').notes[0].harmony, undefined);
});

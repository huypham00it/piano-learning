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

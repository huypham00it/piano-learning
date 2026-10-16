import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChord, matchChord, detectChord, diatonicChords, formulaText, allChordIds, parseChordId, maxInversion, CHORD_TYPES,
} from '../js/theory.js';

const names = (c) => c.notes.map((n) => n.name).join(' ');

test('spells basic triads', () => {
  assert.equal(names(buildChord(0, 'maj')), 'C E G');
  assert.equal(names(buildChord(9, 'min')), 'A C E');
  assert.equal(names(buildChord(1, 'min')), 'C# E G#');
  assert.equal(names(buildChord(1, 'maj')), 'Db F Ab');
  assert.equal(names(buildChord(11, 'dim')), 'B D F');
  assert.equal(names(buildChord(8, 'aug')), 'Ab C E');
});

test('spells sevenths with double accidentals when needed', () => {
  assert.equal(names(buildChord(0, 'dim7')), 'C Eb Gb Bbb');
  assert.equal(names(buildChord(7, '7')), 'G B D F');
  assert.equal(names(buildChord(2, 'm7b5')), 'D F Ab C');
});

test('midi numbers and voicing range', () => {
  const c = buildChord(0, 'maj');
  assert.deepEqual(c.notes.map((n) => n.midi), [60, 64, 67]);
  for (const id of allChordIds()) {
    const { pc, typeId } = parseChordId(id);
    for (let inv = 0; inv <= maxInversion(typeId); inv++) {
      const ch = buildChord(pc, typeId, inv);
      assert.ok(ch.notes[0].midi >= 60 && ch.notes[0].midi <= 71, `${ch.label} low`);
      for (const n of ch.notes) assert.ok(Math.abs(n.acc) <= 2, `${ch.label} acc`);
      for (let i = 1; i < ch.notes.length; i++) assert.ok(ch.notes[i].midi > ch.notes[i - 1].midi);
    }
  }
});

test('inversions', () => {
  const c1 = buildChord(0, 'maj', 1);
  assert.equal(names(c1), 'E G C');
  assert.equal(c1.label, 'C/E');
  const c2 = buildChord(7, '7', 3);
  assert.equal(names(c2), 'F G B D');
  assert.equal(c2.label, 'G7/F');
  assert.equal(maxInversion('maj'), 2);
  assert.equal(maxInversion('9'), 3);
});

test('matchChord', () => {
  const c = buildChord(0, 'maj');
  assert.ok(matchChord(c, [48, 64, 67, 72]).ok);
  assert.ok(!matchChord(c, [60, 63, 67]).ok);
  const inv = buildChord(0, 'maj', 1);
  assert.ok(!matchChord(inv, [60, 64, 67], { requireInversion: true }).ok);
  assert.ok(matchChord(inv, [52, 60, 67], { requireInversion: true }).ok);
});

test('detectChord', () => {
  assert.equal(detectChord([60, 64, 67]), 'C');
  assert.equal(detectChord([57, 60, 64]), 'Am');
  assert.equal(detectChord([64, 67, 72]), 'C/E');
  assert.equal(detectChord([55, 59, 62, 65]), 'G7');
  assert.equal(detectChord([60, 61]), null);
});

test('diatonic and formula', () => {
  assert.deepEqual(diatonicChords(0), ['0:maj', '2:min', '4:min', '5:maj', '7:maj', '9:min', '11:dim']);
  assert.equal(formulaText('m7b5'), '1 - b3 - b5 - b7');
  assert.equal(formulaText('dim7'), '1 - b3 - b5 - bb7');
  assert.equal(CHORD_TYPES.length, 20);
});

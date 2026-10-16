import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spellDegree, presetItems, PRESETS, fingerRH, fingerLH, voiceProgression, matchStep, transitionTips, movementCost, itemLabel,
} from '../js/progression.js';

const names = (ns) => ns.map((n) => n.name).join(' ');

test('spells chord roots in key context', () => {
  assert.equal(spellDegree('B', 2, 4), 'D#');
  assert.equal(spellDegree('Eb', 4, 7), 'Bb');
  assert.equal(spellDegree('F#', 3, 5), 'B');
  assert.equal(spellDegree('C#', 6, 10), 'B');
  assert.deepEqual(presetItems('pop', 11).map(itemLabel), ['B', 'F#', 'G#m', 'E']);
  assert.deepEqual(presetItems('canon', 11).map(itemLabel)[3], 'D#m');
  assert.deepEqual(presetItems('andalusian', 9).map(itemLabel), ['Am', 'G', 'F', 'E']);
});

test('standard triad fingerings', () => {
  assert.deepEqual(fingerRH([60, 64, 67]), [1, 3, 5]); // C
  assert.deepEqual(fingerRH([64, 67, 72]), [1, 2, 5]); // C/E
  assert.deepEqual(fingerRH([67, 72, 76]), [1, 3, 5]); // C/G
  assert.deepEqual(fingerRH([60, 62, 67]), [1, 2, 5]); // Csus2
  assert.deepEqual(fingerRH([60, 64, 67, 70]), [1, 2, 3, 5]); // C7
  assert.deepEqual(fingerRH([64, 67, 71, 72]), [1, 2, 4, 5]); // Cmaj7/E
  assert.deepEqual(fingerLH([48]), [5]);
  assert.deepEqual(fingerLH([36, 48]), [5, 1]);
});

test('voice leading keeps the hand close (C G Am F)', () => {
  const steps = voiceProgression(presetItems('pop', 0), { bass: 'root' });
  assert.equal(names(steps[0].rh), 'C E G');
  assert.equal(names(steps[1].rh), "B D G"); // common tone G kept, thumb moves C -> B
  assert.equal(names(steps[2].rh), 'C E A');
  assert.equal(names(steps[3].rh), 'C F A');
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1].rh.map((n) => n.midi);
    const b = steps[i].rh.map((n) => n.midi);
    assert.ok(movementCost(a, b) <= 10, `smooth ${i}`);
  }
  assert.deepEqual(steps.map((s) => s.lh[0].name), ['C', 'G', 'A', 'F']);
  assert.ok(steps.every((s) => s.lh[0].midi < s.rh[0].midi));
  assert.deepEqual(steps[1].rh.map((n) => n.finger), [1, 2, 5]);
});

test('fixed inversions and bass modes', () => {
  const items = presetItems('basic', 0).map((it) => ({ ...it, inversion: 0 }));
  const steps = voiceProgression(items, { bass: 'none' });
  assert.ok(steps.every((s) => s.rh[0].degree === 1 && s.lh.length === 0));
  const oct = voiceProgression(items, { bass: 'octave' });
  assert.ok(oct.every((s) => s.lh.length === 2 && s.lh[1].midi - s.lh[0].midi === 12));
  assert.deepEqual(oct[0].lh.map((n) => n.finger), [5, 1]);
});

test('ninth chords go rootless in the right hand with root in the left', () => {
  const [s] = voiceProgression([{ pc: 0, typeId: '9', inversion: 'auto' }], { bass: 'none' });
  assert.equal(s.rh.length, 4);
  assert.equal(s.lh.length, 1);
  assert.equal(s.lh[0].name, 'C');
});

test('all presets in all keys voice within range', () => {
  for (const p of PRESETS) {
    for (let k = 0; k < 12; k++) {
      for (const bass of ['none', 'root', 'octave']) {
        const steps = voiceProgression(presetItems(p.id, k), { bass });
        for (const s of steps) {
          assert.ok(s.rh[0].midi >= 53 && s.rh.at(-1).midi <= 84, `${p.id} ${k}`);
          for (const n of s.lh) assert.ok(n.midi >= 28 && n.midi < s.rh[0].midi);
          assert.equal(new Set(s.rh.map((n) => n.finger)).size, s.rh.length);
        }
      }
    }
  }
});

test('matchStep', () => {
  const [c, g] = voiceProgression(presetItems('pop', 0), { bass: 'root' });
  assert.ok(matchStep(c, [48, 60, 64, 67], { strict: true }).ok);
  assert.ok(matchStep(c, [64, 67, 72]).ok);
  assert.equal(matchStep(c, [48, 64, 67, 72], { strict: true }).reason, 'position');
  assert.equal(matchStep(c, [60, 64, 67], { strict: true }).reason, 'lh');
  assert.equal(matchStep(c, [60, 63, 67]).reason, 'notes');
  assert.ok(matchStep(g, [43, 59, 62, 67], { strict: true }).ok);
});

test('transition tips mention common tones and finger moves', () => {
  const [c, g] = voiceProgression(presetItems('pop', 0), { bass: 'root' });
  const tips = transitionTips(c, g).join('\n');
  assert.match(tips, /phím G/);
  assert.match(tips, /Ngón 1: C → B \(xuống nửa cung\)/);
  assert.match(tips, /Tay trái: C → G/);
});

test('key palette spells chords in the key', async () => {
  const { keyPalette, moveItem } = await import('../js/progression.js');
  const major = keyPalette('major', 11); // B major
  assert.deepEqual(major[0].chords.map((c) => itemLabel(c.item)), ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim']);
  assert.equal(major[0].chords[6].roman, 'vii°');
  assert.deepEqual(major[1].chords.map((c) => itemLabel(c.item))[4], 'F#7');
  const minor = keyPalette('minor', 9); // A minor
  assert.deepEqual(minor[0].chords.map((c) => itemLabel(c.item)), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.ok(minor[2].chords.some((c) => itemLabel(c.item) === 'E7'));
  assert.ok(minor[2].chords.some((c) => itemLabel(c.item) === 'G#dim7'));
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
});

// Renders a parsed song (song.js) as a single scrolling grand staff: melody on the treble staff,
// left-hand bass notes on the bass staff, chord symbols, finger numbers, cursor and per-event colouring.
import { el, glyph, ACC } from './staff.js';
import { keyAccidentals } from './song.js';
import { prettyName } from './theory.js';

const SP = 10;
const HALF = SP / 2;
const SECTION_Y = 13;
const CHORD_Y = 30;
const RH_FINGER_Y = 47;
const MEASURE_NUM_Y = 63;
const TREBLE_BOTTOM_Y = 114; // E4
const BASS_BOTTOM_Y = 204; // G2
const LH_FINGER_Y = 238;
const HEIGHT = 250;
const PPB = 64; // pixels per quarter-note beat
const MIN_GAP = 24;

const stepY = (step, clef) => (clef === 'treble' ? TREBLE_BOTTOM_Y - (step - 30) * HALF : BASS_BOTTOM_Y - (step - 18) * HALF);

// Largest standard duration not longer than `beats` (for left-hand notes).
const STANDARD = [
  [4, 'w', false], [3, 'h', true], [2, 'h', false], [1.5, 'q', true], [1, 'q', false], [0.75, 'e', true], [0.5, 'e', false], [0.25, 's', false],
];
const fitDuration = (beats) => STANDARD.find(([b]) => b <= beats + 1e-6) ?? STANDARD[STANDARD.length - 1];

/**
 * @param {HTMLElement} container
 * @param {object} song parsed song
 * @param {Array} events from buildEvents()
 * @returns {{setCurrent(i:number):void, mark(i:number, cls:string):void, clearMarks():void, xOfTime(t:number):number, eventAt(x:number):number, svg:SVGElement}}
 */
export function renderScore(container, song, events, { onClickEvent } = {}) {
  const sig = song.keySig;
  const keyAcc = keyAccidentals(sig);
  const ink = 'var(--staff-ink)';

  // ---- left-hand segments (split at bar lines so each measure is self-contained)
  const lhNotes = [...new Set(events.filter((e) => e.lh).map((e) => e.lh))];
  const lhSegs = [];
  for (const n of lhNotes) {
    let t = n.start;
    const end = n.start + n.dur;
    let first = true;
    for (const m of song.measures) {
      const mEnd = m.start + m.length;
      if (mEnd <= t + 1e-6 || m.start >= end - 1e-6) continue;
      const segEnd = Math.min(end, mEnd);
      lhSegs.push({ note: n, start: t, len: segEnd - t, measure: m.index, first, tieNext: segEnd < end - 1e-6 });
      first = false;
      t = segEnd;
    }
  }

  // ---- horizontal layout: every onset gets a column; bar lines add space
  const header = 44 + Math.abs(sig) * 8 + 38;
  const onsets = new Map(); // time -> {acc:boolean}
  const addOnset = (t, acc = false) => {
    const k = Math.round(t * 1e6) / 1e6;
    const o = onsets.get(k) ?? { acc: false };
    o.acc ||= acc;
    onsets.set(k, o);
  };
  const accState = new Map();
  const displayAcc = (n, clefKey) => {
    const key = `${clefKey}${n.letter}${n.octave}`;
    const cur = accState.has(key) ? accState.get(key) : keyAcc[n.letter];
    if (cur === n.acc) return null;
    accState.set(key, n.acc);
    return n.acc;
  };
  // Pre-compute displayed accidentals per measure (state resets at each bar line).
  for (const m of song.measures) {
    accState.clear();
    for (const it of m.items) {
      if (it.rest) addOnset(it.start);
      else {
        it.shownAcc = it.tiedFrom ? null : displayAcc(it, 'T');
        addOnset(it.start, it.shownAcc != null);
      }
    }
    for (const s of lhSegs.filter((x) => x.measure === m.index)) {
      s.shownAcc = displayAcc(s.note, 'B');
      addOnset(s.start, s.shownAcc != null);
    }
    addOnset(m.start);
  }
  const times = [...onsets.keys()].sort((a, b) => a - b);
  const measureStarts = new Set(song.measures.map((m) => Math.round(m.start * 1e6) / 1e6));
  const xOf = new Map();
  const barX = [];
  let x = header;
  let prevT = null;
  for (const t of times) {
    const o = onsets.get(t);
    if (prevT != null) {
      const gap = Math.max(MIN_GAP, (t - prevT) * PPB);
      if (measureStarts.has(t)) {
        const bx = x + Math.max(16, gap - 10);
        barX.push({ t, x: bx });
        x = bx + 18;
      } else x += gap;
    }
    if (o.acc) x += 9;
    xOf.set(t, x);
    prevT = t;
  }
  const lastM = song.measures[song.measures.length - 1];
  const endT = lastM.start + lastM.length;
  const endX = x + Math.max(30, (endT - prevT) * PPB);
  const width = endX + 12;
  const xAt = (t) => xOf.get(Math.round(t * 1e6) / 1e6);

  const svg = el('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, class: 'score-svg', role: 'img', 'aria-label': `Bản nhạc ${song.meta.title}` });
  svg.style.width = `${width}px`;
  const cursor = el('rect', { class: 'score-cursor', x: -100, y: 20, width: 26, height: HEIGHT - 26, rx: 6 }, svg);

  // ---- staff lines, bar lines, clefs, key & time signatures
  for (let i = 0; i < 5; i++) {
    el('line', { x1: 4, x2: endX, y1: TREBLE_BOTTOM_Y - i * SP, y2: TREBLE_BOTTOM_Y - i * SP, stroke: ink, 'stroke-width': 1 }, svg);
    el('line', { x1: 4, x2: endX, y1: BASS_BOTTOM_Y - i * SP, y2: BASS_BOTTOM_Y - i * SP, stroke: ink, 'stroke-width': 1 }, svg);
  }
  const bar = (bx, w = 1) => el('line', { x1: bx, x2: bx, y1: TREBLE_BOTTOM_Y - 4 * SP, y2: BASS_BOTTOM_Y, stroke: ink, 'stroke-width': w }, svg);
  bar(4, 1.5);
  bar(endX, 3);
  barX.forEach((b) => bar(b.x));
  glyph(svg, 'treble', 8, stepY(32, 'treble') + 160 * 0.058, 0.058, ink);
  glyph(svg, 'bass', 10, stepY(24, 'bass') + 565 * 0.058, 0.058, ink);
  const sharpsT = [38, 35, 39, 36, 33, 37, 34];
  const flatsT = [34, 37, 33, 36, 32, 35, 31];
  for (let i = 0; i < Math.abs(sig); i++) {
    const spec = ACC[sig > 0 ? 1 : -1];
    const st = (sig > 0 ? sharpsT : flatsT)[i];
    for (const [clef, step] of [['treble', st], ['bass', st - 14]]) {
      glyph(svg, spec.name, 44 + i * 8 - 56 * spec.scale, stepY(step, clef) + spec.anchor * spec.scale, spec.scale, ink);
    }
  }
  const [tn, td] = song.meta.time.split('/');
  const tsx = 44 + Math.abs(sig) * 8 + 8;
  for (const [y0, y1] of [[TREBLE_BOTTOM_Y - 20, TREBLE_BOTTOM_Y], [BASS_BOTTOM_Y - 20, BASS_BOTTOM_Y]]) {
    el('text', { x: tsx, y: y0 - 2, class: 'score-time' }, svg).textContent = tn;
    el('text', { x: tsx, y: y1 - 2, class: 'score-time' }, svg).textContent = td;
  }

  // ---- measure numbers & section labels
  for (const m of song.measures) {
    const mx = m.index === 0 ? header - 6 : barX.find((b) => Math.abs(b.t - m.start) < 1e-6)?.x ?? header;
    if (m.number > 0 && (m.number === 1 || m.number % 2 === 1 || m.section)) {
      el('text', { x: mx + 3, y: MEASURE_NUM_Y, class: 'score-mnum' }, svg).textContent = m.number;
    }
    if (m.section) el('text', { x: mx + 3, y: SECTION_Y, class: 'score-section' }, svg).textContent = m.section;
  }

  // ---- chord symbols
  for (const c of song.chords) {
    if (c.none) continue;
    el('text', { x: xAt(c.start) - 6, y: CHORD_Y, class: 'score-chord' }, svg).textContent = prettyName(c.symbol);
  }

  // ---- notes
  const evGroups = events.map(() => []);
  const evByRh = new Map(events.filter((e) => e.rh).map((e) => [e.rh, e.index]));
  const evByLh = new Map(events.filter((e) => e.lh).map((e) => [e.lh, e.index]));
  const triplets = [];

  for (const m of song.measures) {
    for (const it of m.items) {
      const nx = xAt(it.start);
      if (it.rest) {
        drawRest(svg, nx, it);
        if (it.triplet) triplets.push({ x: nx, y: 70, it });
        continue;
      }
      const g = el('g', { class: 'sn' }, svg);
      const y = stepY(it.step, 'treble');
      drawNote(g, nx, y, it.step, 'treble', it, it.shownAcc);
      const evIndex = it.tiedFrom ? null : evByRh.get(it);
      if (evIndex != null) {
        evGroups[evIndex].push(g);
        if (it.finger) el('text', { x: nx, y: RH_FINGER_Y, class: 'score-finger rh', 'text-anchor': 'middle' }, svg).textContent = it.finger;
      }
      if (it.tieNext) it.tieFromX = nx;
      if (it.tiedFrom) {
        const prev = song.notes[song.notes.indexOf(it) - 1];
        drawTie(svg, prev.tieFromX, nx, y, it.step >= 34 ? -1 : 1);
      }
      if (it.triplet) triplets.push({ x: nx, y: it.step >= 34 ? y + 40 : y - 40, it });
    }
  }
  for (const s of lhSegs) {
    const nx = xAt(s.start);
    const [, base, dotted] = fitDuration(s.len);
    const g = el('g', { class: 'sn' }, svg);
    const y = stepY(s.note.step, 'bass');
    drawNote(g, nx, y, s.note.step, 'bass', { base, dotted }, s.shownAcc);
    if (s.first) {
      const evIndex = evByLh.get(s.note);
      if (evIndex != null) evGroups[evIndex].push(g);
      if (s.note.finger) el('text', { x: nx, y: LH_FINGER_Y, class: 'score-finger lh', 'text-anchor': 'middle' }, svg).textContent = s.note.finger;
    } else {
      const prevSeg = lhSegs[lhSegs.indexOf(s) - 1];
      drawTie(svg, xAt(prevSeg.start), nx, y, s.note.step >= 22 ? -1 : 1);
    }
  }
  // Triplet numbers: one "3" per group of three.
  for (let i = 0; i + 2 < triplets.length; i += 3) {
    const grp = triplets.slice(i, i + 3);
    const cx = (grp[0].x + grp[2].x) / 2;
    const cy = Math.max(MEASURE_NUM_Y + 6, Math.min(...grp.map((g) => g.y)) - 4);
    el('text', { x: cx, y: cy, class: 'score-triplet', 'text-anchor': 'middle' }, svg).textContent = '3';
  }

  container.replaceChildren(svg);
  if (onClickEvent) {
    svg.addEventListener('click', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * width;
      onClickEvent(eventAt(px));
    });
  }

  const eventX = events.map((e) => xAt(e.time));
  function eventAt(px) {
    let best = 0;
    eventX.forEach((ex, i) => {
      if (Math.abs(ex - px) < Math.abs(eventX[best] - px)) best = i;
    });
    return best;
  }
  function xOfTime(t) {
    // Piecewise-linear interpolation between onsets (used by the moving cursor in tempo mode).
    if (t <= times[0]) return xOf.get(times[0]);
    for (let i = 1; i < times.length; i++) {
      if (t <= times[i]) {
        const a = times[i - 1];
        const b = times[i];
        return xOf.get(a) + ((t - a) / (b - a)) * (xOf.get(b) - xOf.get(a));
      }
    }
    return endX;
  }

  return {
    svg,
    width,
    eventX,
    xOfTime,
    eventAt,
    setCursorX(cx) {
      cursor.setAttribute('x', cx - 13);
      follow(container, cx);
    },
    setCurrent(i) {
      for (const gs of evGroups) for (const g of gs) g.classList.remove('cur');
      if (i == null || i < 0) {
        cursor.setAttribute('x', -100);
        return;
      }
      for (const g of evGroups[i] ?? []) g.classList.add('cur');
      cursor.setAttribute('x', eventX[i] - 13);
      follow(container, eventX[i]);
    },
    mark(i, cls) {
      for (const g of evGroups[i] ?? []) {
        g.classList.remove('ok', 'bad', 'late');
        if (cls) g.classList.add(cls);
      }
    },
    clearMarks() {
      for (const gs of evGroups) for (const g of gs) g.classList.remove('ok', 'bad', 'late', 'cur');
    },
  };
}

/** Keep x visible (about a third from the left) inside the scroll container. */
function follow(container, x) {
  const w = container.clientWidth;
  if (!w) return;
  const left = container.scrollLeft;
  if (x < left + 40 || x > left + w * 0.7) container.scrollTo({ left: Math.max(0, x - w * 0.33), behavior: 'smooth' });
}

function drawLedgers(g, x, step, clef) {
  const bottom = clef === 'treble' ? 30 : 18;
  const top = bottom + 8;
  for (let s = bottom - 2; s >= step; s -= 2) el('line', { x1: x - 9, x2: x + 9, y1: stepY(s, clef), y2: stepY(s, clef), stroke: 'var(--staff-ink)', 'stroke-width': 1.2 }, g);
  for (let s = top + 2; s <= step; s += 2) el('line', { x1: x - 9, x2: x + 9, y1: stepY(s, clef), y2: stepY(s, clef), stroke: 'var(--staff-ink)', 'stroke-width': 1.2 }, g);
}

function drawNote(g, x, y, step, clef, it, shownAcc) {
  drawLedgers(g, x, step, clef);
  if (shownAcc != null) {
    const spec = ACC[shownAcc] ?? ACC[0];
    glyph(g, spec.name, x - 9 - spec.width - 2 - 56 * spec.scale, y + spec.anchor * spec.scale, spec.scale, 'currentColor');
  }
  const hollow = it.base === 'h' || it.base === 'w';
  el('ellipse', { cx: x, cy: y, rx: 6.2, ry: 4.4, fill: 'currentColor', transform: `rotate(-20 ${x} ${y})` }, g);
  if (hollow) el('ellipse', { cx: x, cy: y, rx: 3.6, ry: 2.2, fill: 'var(--staff-paper)', transform: `rotate(-35 ${x} ${y})` }, g);
  if (it.dotted) {
    const onLine = (step - (clef === 'treble' ? 30 : 18)) % 2 === 0;
    el('circle', { cx: x + 10, cy: onLine ? y - 3 : y, r: 1.7, fill: 'currentColor' }, g);
  }
  if (it.base === 'w') return;
  const middle = clef === 'treble' ? 34 : 22;
  const up = step < middle;
  const sx = up ? x + 5.6 : x - 5.6;
  const sy = up ? y - 32 : y + 32;
  el('line', { x1: sx, x2: sx, y1: y, y2: sy, stroke: 'currentColor', 'stroke-width': 1.3 }, g);
  const flags = { e: 1, s: 2 }[it.base] ?? 0;
  for (let i = 0; i < flags; i++) {
    const fy = up ? sy + i * 7 : sy - i * 7;
    const d = up ? `M ${sx} ${fy} q 2 7 8 10 q 3 3 1 10` : `M ${sx} ${fy} q 2 -7 8 -10 q 3 -3 1 -10`;
    el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, g);
  }
}

function drawTie(svg, x1, x2, y, dir) {
  if (x1 == null) return;
  const yy = y + dir * 7;
  el('path', { d: `M ${x1 + 5} ${yy} Q ${(x1 + x2) / 2} ${yy + dir * 9} ${x2 - 5} ${yy}`, fill: 'none', stroke: 'var(--staff-ink)', 'stroke-width': 1.2 }, svg);
}

function drawRest(svg, x, it) {
  const ink = 'var(--staff-ink)';
  const y = stepY(34, 'treble'); // middle line
  const g = el('g', { class: 'rest' }, svg);
  if (it.base === 'w') el('rect', { x: x - 6, y: y - SP, width: 12, height: 5, fill: ink }, g);
  else if (it.base === 'h') el('rect', { x: x - 6, y: y - 5, width: 12, height: 5, fill: ink }, g);
  else if (it.base === 'q') {
    el('path', { d: `M ${x - 3} ${y - 14} l 6 7 l -5 6 l 6 7 c -6 -3 -9 1 -4 6`, fill: 'none', stroke: ink, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, g);
  } else {
    const n = it.base === 's' ? 2 : 1;
    el('line', { x1: x + 3, y1: y - 6, x2: x - 1, y2: y + 8 + (n - 1) * 6, stroke: ink, 'stroke-width': 1.4 }, g);
    for (let i = 0; i < n; i++) {
      el('circle', { cx: x - 3, cy: y - 5 + i * 6, r: 2.3, fill: ink }, g);
      el('path', { d: `M ${x - 3} ${y - 3 + i * 6} q 3 1 6 -3`, fill: 'none', stroke: ink, 'stroke-width': 1.2 }, g);
    }
  }
  if (it.dotted) el('circle', { cx: x + 9, cy: y - 3, r: 1.7, fill: ink }, g);
}

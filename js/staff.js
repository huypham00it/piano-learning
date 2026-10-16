// Grand staff renderer (SVG). Draws one or more chord "columns" as whole notes.
import { GLYPHS } from './glyphs.js';

const NS = 'http://www.w3.org/2000/svg';
const SP = 10; // staff space in px (viewBox units)
const HALF = SP / 2;

// Treble: bottom line E4 (step 30). Bass: bottom line G2 (step 18).
const TREBLE_BOTTOM_Y = 110;
const BASS_BOTTOM_Y = 210;
const TREBLE_BOTTOM_STEP = 30;
const BASS_BOTTOM_STEP = 18;

const HEIGHT = 262;
const CLEF_X = 8;
const FIRST_COL_X = 92;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

const stepY = (step, clef) =>
  clef === 'treble'
    ? TREBLE_BOTTOM_Y - (step - TREBLE_BOTTOM_STEP) * HALF
    : BASS_BOTTOM_Y - (step - BASS_BOTTOM_STEP) * HALF;

function glyph(parent, name, x, y, scale, fill) {
  return el('path', { d: GLYPHS[name], transform: `translate(${x} ${y}) scale(${scale} ${-scale})`, fill }, parent);
}

// Vertical offset (font units) of each accidental's visual anchor from its origin.
const ACC = {
  2: { name: 'dsharp', scale: 0.026, anchor: 180, width: 10 },
  1: { name: 'sharp', scale: 0.029, anchor: 198, width: 9.5 },
  0: { name: 'natural', scale: 0.029, anchor: 192, width: 8 },
  [-1]: { name: 'flat', scale: 0.029, anchor: 235, width: 9 },
  [-2]: { name: 'dflat', scale: 0.029, anchor: 235, width: 15 },
};

/**
 * Render a grand staff.
 * @param {HTMLElement} container
 * @param {Array<{notes: Array<{step:number, acc:number, midi:number, color?:string}>, label?:string, color?:string}>} columns
 * @param {{width?:number, showNaturals?:boolean}} opts
 */
export function renderStaff(container, columns = [], opts = {}) {
  const colGap = 90;
  const width = opts.width ?? Math.max(340, FIRST_COL_X + Math.max(1, columns.length) * colGap + 20);
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    class: 'staff-svg',
    role: 'img',
    'aria-label': opts.ariaLabel ?? 'Khuông nhạc',
  });

  const ink = 'var(--staff-ink)';
  // Staff lines
  for (let i = 0; i < 5; i++) {
    el('line', { x1: 4, x2: width - 4, y1: TREBLE_BOTTOM_Y - i * SP, y2: TREBLE_BOTTOM_Y - i * SP, stroke: ink, 'stroke-width': 1 }, svg);
    el('line', { x1: 4, x2: width - 4, y1: BASS_BOTTOM_Y - i * SP, y2: BASS_BOTTOM_Y - i * SP, stroke: ink, 'stroke-width': 1 }, svg);
  }
  // Barlines / brace line
  el('line', { x1: 4, x2: 4, y1: TREBLE_BOTTOM_Y - 4 * SP, y2: BASS_BOTTOM_Y, stroke: ink, 'stroke-width': 1.5 }, svg);
  el('line', { x1: width - 4, x2: width - 4, y1: TREBLE_BOTTOM_Y - 4 * SP, y2: BASS_BOTTOM_Y, stroke: ink, 'stroke-width': 1.5 }, svg);

  // Clefs: treble anchored at G4 line (step 32), bass at F3 line (step 24).
  glyph(svg, 'treble', CLEF_X, stepY(32, 'treble') + 160 * 0.058, 0.058, ink);
  glyph(svg, 'bass', CLEF_X + 2, stepY(24, 'bass') + 565 * 0.058, 0.058, ink);

  columns.forEach((col, i) => {
    const x = columns.length === 1 ? FIRST_COL_X + (width - FIRST_COL_X - 20) / 2 : FIRST_COL_X + i * colGap + 10;
    drawColumn(svg, col, x);
  });

  container.replaceChildren(svg);
  return svg;
}

function drawColumn(svg, col, x) {
  const g = el('g', { class: 'staff-col' }, svg);
  const byClef = { treble: [], bass: [] };
  for (const n of col.notes) {
    const clef = n.clef ?? (n.midi >= 60 ? 'treble' : 'bass');
    byClef[clef].push(n);
  }

  for (const clef of ['treble', 'bass']) {
    const notes = [...byClef[clef]].sort((a, b) => a.step - b.step);
    if (!notes.length) continue;

    // Head displacement for seconds: alternate right side within adjacent-step clusters.
    const headW = 13;
    // Each head takes the left-most column with no neighbour within one step (seconds/unisons).
    const placed = [];
    const offsets = notes.map((n) => {
      let c = 0;
      while ((placed[c] ??= []).some((s) => Math.abs(s - n.step) <= 1)) c++;
      placed[c].push(n.step);
      return c * (headW - 1);
    });

    // Ledger lines
    const bottomStep = clef === 'treble' ? TREBLE_BOTTOM_STEP : BASS_BOTTOM_STEP;
    const topStep = bottomStep + 8;
    const minStep = notes[0].step;
    const maxStep = notes[notes.length - 1].step;
    const ledgerX1 = x - 9;
    const ledgerX2 = x + 9 + Math.max(...offsets);
    for (let s = bottomStep - 2; s >= minStep; s -= 2) {
      const y = stepY(s, clef);
      el('line', { x1: ledgerX1, x2: ledgerX2, y1: y, y2: y, stroke: 'var(--staff-ink)', 'stroke-width': 1.2 }, g);
    }
    for (let s = topStep + 2; s <= maxStep; s += 2) {
      const y = stepY(s, clef);
      el('line', { x1: ledgerX1, x2: ledgerX2, y1: y, y2: y, stroke: 'var(--staff-ink)', 'stroke-width': 1.2 }, g);
    }

    // Accidentals: assign columns from top to bottom, avoiding vertical collisions.
    const accCols = []; // array of arrays of steps
    const accPlacements = [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (!n.acc && !n.showNatural) continue;
      let c = 0;
      while (accCols[c] && accCols[c].some((s) => Math.abs(s - n.step) < 6)) c++;
      (accCols[c] ??= []).push(n.step);
      accPlacements.push({ n, c });
    }
    const accW = 11;
    for (const { n, c } of accPlacements) {
      const spec = ACC[n.acc] ?? ACC[0];
      const ax = x - 9 - spec.width - 2 - c * accW;
      const ay = stepY(n.step, clef) + spec.anchor * spec.scale;
      glyph(g, spec.name, ax - 56 * spec.scale, ay, spec.scale, n.color ?? col.color ?? 'var(--staff-ink)');
    }

    // Note heads (whole notes)
    notes.forEach((n, i) => {
      const cx = x + offsets[i];
      const cy = stepY(n.step, clef);
      const color = n.color ?? col.color ?? 'var(--staff-ink)';
      const head = el('g', { transform: `translate(${cx} ${cy})`, class: 'note-head' }, g);
      el('ellipse', { rx: 6.6, ry: 4.6, fill: color }, head);
      el('ellipse', { rx: 3.5, ry: 2.3, fill: 'var(--staff-paper)', transform: 'rotate(-55)' }, head);
    });
  }

  if (col.label) {
    el('text', {
      x: x + 3,
      y: HEIGHT - 6,
      'text-anchor': 'middle',
      class: 'staff-label',
      fill: col.color ?? 'var(--staff-ink)',
    }, g).textContent = col.label;
  }
}

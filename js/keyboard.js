// On-screen piano keyboard (DOM based, responsive).
import { mod12, spellMidi } from './theory.js';

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
export const isBlack = (midi) => BLACK_PCS.has(mod12(midi));

export class PianoKeyboard {
  /**
   * @param {HTMLElement} root
   * @param {{start:number, end:number, onPress?:(midi:number)=>void}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.onPress = opts.onPress ?? (() => {});
    this.keys = new Map();
    this.showLabels = false;
    this.labelFor = (midi) => spellMidi(midi).name;
    this.setRange(opts.start, opts.end);
  }

  setRange(start, end) {
    // Ranges must start and end on white keys.
    while (isBlack(start)) start--;
    while (isBlack(end)) end++;
    if (start === this.start && end === this.end) return;
    this.start = start;
    this.end = end;
    this.build();
  }

  build() {
    this.root.replaceChildren();
    this.keys.clear();
    const whites = [];
    for (let m = this.start; m <= this.end; m++) if (!isBlack(m)) whites.push(m);
    const ww = 100 / whites.length;
    this.root.classList.add('piano');
    this.root.style.setProperty('--white-count', whites.length);

    let wi = 0;
    for (let m = this.start; m <= this.end; m++) {
      const key = document.createElement('div');
      key.dataset.midi = m;
      const black = isBlack(m);
      key.className = `key ${black ? 'black' : 'white'}`;
      if (black) {
        key.style.left = `calc(${wi * ww}% - var(--black-w) / 2)`;
      } else {
        key.style.left = `${wi * ww}%`;
        key.style.width = `${ww}%`;
        wi++;
      }
      const label = document.createElement('span');
      label.className = 'key-label';
      key.appendChild(label);
      const finger = document.createElement('span');
      finger.className = 'finger';
      key.appendChild(finger);
      if (mod12(m) === 0) {
        const oct = document.createElement('span');
        oct.className = 'key-octave';
        oct.textContent = `C${Math.floor(m / 12) - 1}`;
        key.appendChild(oct);
      }
      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.onPress(m);
      });
      this.root.appendChild(key);
      this.keys.set(m, key);
    }
    this.render(this.lastState ?? {});
  }

  /**
   * @param {{pressed?:Iterable<number>, target?:Iterable<number>, wrong?:Iterable<number>, correct?:Iterable<number>,
   *   next?:Iterable<number>, fingers?:Map<number,{finger:number, hand:'L'|'R'}>, labels?:Map<number,string>}} state
   */
  render(state) {
    this.lastState = state;
    const pressed = new Set(state.pressed ?? []);
    const target = new Set(state.target ?? []);
    const wrong = new Set(state.wrong ?? []);
    const correct = new Set(state.correct ?? []);
    const next = new Set(state.next ?? []);
    for (const [m, key] of this.keys) {
      key.classList.toggle('pressed', pressed.has(m));
      key.classList.toggle('target', target.has(m));
      key.classList.toggle('wrong', wrong.has(m));
      key.classList.toggle('correct', correct.has(m));
      key.classList.toggle('next', next.has(m) && !target.has(m));
      const f = state.fingers?.get(m);
      const badge = key.querySelector('.finger');
      badge.textContent = f ? f.finger : '';
      badge.className = f ? `finger hand-${f.hand}` : 'finger';
      const label = key.firstChild;
      const custom = state.labels?.get(m);
      label.textContent = custom ?? (this.showLabels || pressed.has(m) ? this.labelFor(m) : '');
    }
  }
}

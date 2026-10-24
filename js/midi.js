// Web MIDI input wrapper.
// Uses the most widely implemented form of the API (onmidimessage / onstatechange / forEach) so it also
// works in iPad/iPhone apps that add Web MIDI to a web view with a JavaScript shim
// (e.g. "Web MIDI Browser"), as well as in Chrome, Edge and Opera.

export class MidiInput extends EventTarget {
  constructor() {
    super();
    this.access = null;
    this.selectedId = 'all';
    this.handler = (e) => this.handleMessage(e);
    this.knownIds = '';
    this.poll = null;
  }

  /** Checked lazily: shims may add requestMIDIAccess after this module loads. */
  get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async connect() {
    if (!this.supported) throw new Error('unsupported');
    const res = navigator.requestMIDIAccess({ sysex: false });
    this.access = typeof res?.then === 'function' ? await res : res;
    this.access.onstatechange = () => this.refresh();
    // Some shims never fire statechange: also look for plugged/unplugged devices every 2 s.
    clearInterval(this.poll);
    this.poll = setInterval(() => {
      const ids = this.inputs.map((i) => i.id).join('|');
      if (ids !== this.knownIds) this.refresh();
    }, 2000);
    this.refresh();
  }

  refresh() {
    this.knownIds = this.inputs.map((i) => i.id).join('|');
    this.bind();
    this.emit('devices');
  }

  get inputs() {
    const ins = this.access?.inputs;
    if (!ins) return [];
    const list = [];
    if (typeof ins === 'function') list.push(...ins.call(this.access)); // very old API: inputs()
    else if (typeof ins.forEach === 'function') ins.forEach((input) => list.push(input));
    else if (typeof ins.values === 'function') for (const input of ins.values()) list.push(input);
    return list;
  }

  select(id) {
    this.selectedId = id;
    this.bind();
    this.emit('devices');
  }

  bind() {
    for (const input of this.inputs) {
      const on = this.selectedId === 'all' || input.id === this.selectedId;
      input.onmidimessage = on ? this.handler : null;
    }
  }

  handleMessage(e) {
    const data = e.data ?? e.detail?.data;
    if (!data || data.length < 2) return;
    const [status, d1, d2 = 0] = data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && d2 > 0) this.emit('noteon', { note: d1, velocity: d2 });
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.emit('noteoff', { note: d1 });
    else if (cmd === 0xb0 && d1 === 64) this.emit('sustain', { on: d2 >= 64 });
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// Web MIDI input wrapper.

export class MidiInput extends EventTarget {
  constructor() {
    super();
    this.access = null;
    this.selectedId = 'all';
    this.supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    this.handler = (e) => this.handleMessage(e);
  }

  async connect() {
    if (!this.supported) throw new Error('unsupported');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.addEventListener('statechange', () => {
      this.bind();
      this.emit('devices');
    });
    this.bind();
    this.emit('devices');
  }

  get inputs() {
    return this.access ? [...this.access.inputs.values()] : [];
  }

  select(id) {
    this.selectedId = id;
    this.bind();
    this.emit('devices');
  }

  bind() {
    for (const input of this.inputs) {
      input.removeEventListener('midimessage', this.handler);
      if (this.selectedId === 'all' || input.id === this.selectedId) {
        input.addEventListener('midimessage', this.handler);
      }
    }
  }

  handleMessage(e) {
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && d2 > 0) this.emit('noteon', { note: d1, velocity: d2 });
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.emit('noteoff', { note: d1 });
    else if (cmd === 0xb0 && d1 === 64) this.emit('sustain', { on: d2 >= 64 });
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

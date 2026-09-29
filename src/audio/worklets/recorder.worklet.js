/*
 * Captures the master output as 16-bit stereo PCM. Interleaved blocks of BLOCK frames are posted
 * to the main thread; the recorder stops itself after `maxFrames` to bound memory.
 */
const BLOCK = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = (options && options.processorOptions) || {};
    this.maxFrames = processorOptions.maxFrames || Infinity;
    this.frames = 0;
    this.filled = 0;
    this.block = new Int16Array(BLOCK * 2);
    this.active = true;
    this.seed = 0x2f6e2b1;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') this.finish();
    };
  }

  random() {
    // xorshift32 in [0, 1)
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }

  quantise(sample) {
    // TPDF dither of one least-significant bit before rounding to 16 bits.
    const dithered = sample * 32767 + (this.random() - this.random());
    return dithered > 32767 ? 32767 : dithered < -32768 ? -32768 : Math.round(dithered);
  }

  flush() {
    if (this.filled === 0) return;
    const pcm = this.block.slice(0, this.filled);
    this.port.postMessage({ type: 'data', pcm }, [pcm.buffer]);
    this.filled = 0;
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.flush();
    this.port.postMessage({ type: 'done', frames: this.frames });
  }

  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0] || [];
    const left = input[0];
    const right = input[1] || left;
    const length = left ? left.length : 128;
    for (let i = 0; i < length; i++) {
      this.block[this.filled++] = this.quantise(left ? left[i] : 0);
      this.block[this.filled++] = this.quantise(right ? right[i] : 0);
      if (this.filled === this.block.length) this.flush();
    }
    this.frames += length;
    if (this.frames >= this.maxFrames) {
      this.port.postMessage({ type: 'limit' });
      this.finish();
      return false;
    }
    return true;
  }
}

registerProcessor('ec-recorder', RecorderProcessor);

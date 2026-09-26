// AudioWorkletProcessor that streams emulator audio from a small ring
// buffer fed by the main thread (see GbAudioPlayer.push()).
//
// This exists instead of scheduling a series of AudioBufferSourceNodes
// because each independently-scheduled buffer gets its own resampling pass
// (from the emulator's rate to the device's native rate) with no filter
// continuity from the previous chunk, which produces an audible artifact at
// every chunk boundary. Streaming through one continuous node avoids that
// entirely, and GbAudioPlayer additionally tells the core to generate audio
// at this context's exact native rate so no resampling happens at all.
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
  }

  write(left, right) {
    const count = left.length;
    for (let i = 0; i < count; i++) {
      this.left[this.writeIndex] = left[i];
      this.right[this.writeIndex] = right[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      if (this.available < this.capacity) {
        this.available++;
      } else {
        // Full: drop the oldest sample instead of growing latency without
        // bound (e.g. during fast-forward, which produces audio faster
        // than real time).
        this.readIndex = (this.readIndex + 1) % this.capacity;
      }
    }
  }

  read(outLeft, outRight) {
    const count = outLeft.length;
    let i = 0;
    for (; i < count && this.available > 0; i++) {
      outLeft[i] = this.left[this.readIndex];
      outRight[i] = this.right[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.capacity;
      this.available--;
    }
    for (; i < count; i++) {
      outLeft[i] = 0;
      outRight[i] = 0;
    }
  }
}

class GbAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~0.5s of backlog - generous enough to absorb scheduling jitter
    // without adding noticeable latency.
    this.ring = new RingBuffer(Math.ceil(sampleRate * 0.5));
    // The main thread pushes a chunk once per animation frame (~60Hz),
    // while process() is called far more often (every ~128-sample render
    // quantum). With no cushion, the ring sits near-empty between pushes,
    // so ordinary jitter (a slow rAF, a GC pause) starves it; the resulting
    // brief, repeated silence gaps land at ~60Hz and are heard as a low
    // hum/buzz rather than a single glitch. Building up (and, if the ring
    // ever runs dry, rebuilding) this much of a cushion before reading
    // keeps normal jitter from ever touching an empty buffer.
    this.primeThreshold = Math.ceil(sampleRate * 0.06); // 60ms
    this.priming = true;
    // Priming ends with a hard cut from 0-filled silence to real (possibly
    // non-zero-crossing) samples, which is an audible click/pop. Ramp gain
    // linearly over the first few ms after priming ends - both at startup
    // and after any underrun-triggered re-prime - to smooth that transition.
    this.underrunRampLength = Math.ceil(sampleRate * 0.005); // ~5ms
    // A freshly (re)started game is different: with no boot ROM, its first
    // sound-register writes make the output jump from silence to a channel's
    // level within a frame or two, and a 5ms ramp is far too short to hide
    // that. After a reset() fade in over a much longer window, using a
    // quadratic curve so the start stays very quiet while the game inits.
    this.resetRampLength = Math.ceil(sampleRate * 0.15); // ~150ms
    this.rampLength = this.underrunRampLength;
    this.rampRemaining = 0;
    this.rampQuadratic = false;
    this.nextRampIsReset = true; // the very first start counts as a reset
    // Tail of the audio that was playing when reset() arrived, faded out over
    // a few ms so cutting to the new game doesn't itself click.
    this.tailLength = Math.ceil(sampleRate * 0.005);
    this.tailLeft = new Float32Array(this.tailLength);
    this.tailRight = new Float32Array(this.tailLength);
    this.tailPos = 0;
    this.tailCount = 0;
    this.port.onmessage = (event) => {
      if (event.data.type === "reset") {
        this.reset();
        return;
      }
      this.ring.write(event.data.left, event.data.right);
    };
  }

  // Discard queued audio from the previous game (ROM swap / state load).
  reset() {
    const ring = this.ring;
    const count = Math.min(ring.available, this.tailLength);
    // Only capture a tail if audio was actually playing, not while priming.
    if (!this.priming && count > 0) {
      for (let i = 0; i < count; i++) {
        const gain = 1 - (i + 1) / count;
        const index = (ring.readIndex + i) % ring.capacity;
        this.tailLeft[i] = ring.left[index] * gain;
        this.tailRight[i] = ring.right[index] * gain;
      }
      this.tailPos = 0;
      this.tailCount = count;
    }
    ring.available = 0;
    ring.readIndex = ring.writeIndex;
    this.priming = true;
    this.rampRemaining = 0;
    this.nextRampIsReset = true;
  }

  process(_inputs, outputs) {
    const output = outputs[0];

    if (this.priming) {
      if (this.ring.available < this.primeThreshold) {
        output[0].fill(0);
        output[1].fill(0);
        this.drainTail(output);
        return true;
      }
      this.priming = false;
      this.rampLength = this.nextRampIsReset ? this.resetRampLength : this.underrunRampLength;
      this.rampQuadratic = this.nextRampIsReset;
      this.nextRampIsReset = false;
      this.rampRemaining = this.rampLength;
    }

    this.ring.read(output[0], output[1]);

    if (this.rampRemaining > 0) {
      const left = output[0];
      const right = output[1];
      const count = Math.min(this.rampRemaining, left.length);
      for (let i = 0; i < count; i++) {
        let gain = (this.rampLength - this.rampRemaining + i + 1) / this.rampLength;
        if (this.rampQuadratic) gain *= gain;
        left[i] *= gain;
        right[i] *= gain;
      }
      this.rampRemaining -= count;
    }
    this.drainTail(output);

    if (this.ring.available === 0) {
      this.priming = true; // ran dry - rebuild the cushion before resuming
    }
    return true;
  }

  drainTail(output) {
    if (this.tailPos >= this.tailCount) return;
    const count = Math.min(this.tailCount - this.tailPos, output[0].length);
    for (let i = 0; i < count; i++) {
      output[0][i] += this.tailLeft[this.tailPos + i];
      output[1][i] += this.tailRight[this.tailPos + i];
    }
    this.tailPos += count;
  }
}

registerProcessor("gb-audio-processor", GbAudioProcessor);

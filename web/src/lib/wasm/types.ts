export interface EmulatorButtonValue {
  value: number;
}

export interface EmulatorButtonEnum {
  Right: EmulatorButtonValue;
  Left: EmulatorButtonValue;
  Up: EmulatorButtonValue;
  Down: EmulatorButtonValue;
  A: EmulatorButtonValue;
  B: EmulatorButtonValue;
  Select: EmulatorButtonValue;
  Start: EmulatorButtonValue;
}

export interface EmulatorInstance {
  reset(): void;
  loadRom(data: Uint8Array): void;
  runFrame(): void;
  getFramebuffer(): Uint8Array;
  // Interleaved stereo float32 (L, R, L, R, ...) generated since the last
  // call, in [-1, 1] at the rate passed to setAudioSampleRate(). The
  // returned view aliases wasm memory - copy it before calling into the
  // emulator again.
  getAudioSamples(): Float32Array;
  // Sets the rate audio is generated at; pass the playback device's actual
  // native rate (e.g. an AudioContext's sampleRate) so it never needs
  // resampling downstream. Call before the first runFrame() that should
  // produce audio.
  setAudioSampleRate(sampleRate: number): void;
  // Zero-length for carts with no cartridge RAM.
  getCartRam(): Uint8Array;
  loadCartRam(data: Uint8Array): void;
  // Full machine snapshot (CPU/PPU/MMU/timer/joypad/cartridge). The
  // returned view aliases wasm memory - copy it before calling into the
  // emulator again.
  getSaveState(): Uint8Array;
  // Returns false if `data` is malformed/truncated or from an incompatible
  // save-state version.
  loadSaveState(data: Uint8Array): boolean;
  setButtonPressed(button: EmulatorButtonValue, pressed: boolean): void;
  // Super Game Boy colorization. Games that support it send palette and
  // per-tile color attributes to the core; sgbHasColors() turns true once
  // they've set any palette. The two views alias wasm memory - re-fetch them
  // after every runFrame().
  sgbHasColors(): boolean;
  // What the SGB is doing with the picture: 0 = showing it, 1 = frozen on
  // the last frame, 2 = black, 3 = solid backdrop color (palette 0, color 0).
  getSgbMask(): number;
  // 4 palettes x 4 colors x (R, G, B) bytes, shade 0 (lightest) first.
  getSgbColors(): Uint8Array;
  // One palette number (0-3) per 8x8 cell of the 20x18 screen, row-major.
  getSgbAttributes(): Uint8Array;
}

export interface EmulatorModule {
  Emulator: new () => EmulatorInstance;
  Button: EmulatorButtonEnum;
}

export type EmulatorModuleFactory = (
  options?: Record<string, unknown>
) => Promise<EmulatorModule>;

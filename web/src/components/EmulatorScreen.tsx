"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadEmulatorModule } from "@/lib/wasm/loadEmulator";
import { GbAudioPlayer } from "@/lib/audio/GbAudioPlayer";
import { PalettePicker } from "@/components/PalettePicker";
import { TouchControls } from "@/components/TouchControls";
import { useCustomPalettes } from "@/lib/customPalettes";
import { findGameBoyColorPalette } from "@/lib/gameBoyColorPalettes";
import {
  AUTO_PALETTE,
  AUTO_PALETTE_SGB,
  DEFAULT_PALETTE,
  paletteColor,
  resolvePalette,
  type Palette,
} from "@/lib/palettes";
import { findSuperGameBoyPalette } from "@/lib/superGameBoyPalettes";
import { useIntegerScaling } from "@/lib/settings";
import type { EmulatorInstance, EmulatorModule } from "@/lib/wasm/types";

type LoadStatus = "loading" | "ready" | "error";

const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;

//runs at the gameboy frame rate independent of refresh rate
const GB_FRAME_MS = (70224 / 4194304) * 1000;
const MAX_FRAMES_PER_RAF = 4;

const SPEED_OPTIONS = [1, 2, 4] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

const SAVE_KEY_PREFIX = "gb-save-";
const AUTOSAVE_INTERVAL_MS = 5000;

const SAVE_STATE_KEY_PREFIX = "gb-savestate-";
const SAVE_STATE_SLOT_COUNT = 10;

function saveStateKey(cartridgeId: string, slot: number): string {
  return `${SAVE_STATE_KEY_PREFIX}${cartridgeId}-${slot}`;
}


function readCartridgeId(bytes: Uint8Array): string {
  let title = "";
  for (let i = 0x134; i <= 0x143 && i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x20 || byte > 0x7e) break; // stop at the null/padding byte
    title += String.fromCharCode(byte);
  }
  title = title.trim() || "untitled";

  const checksum =
    bytes.length > 0x14f ? (bytes[0x14e] << 8) | bytes[0x14f] : 0;

  return `${title}-${checksum.toString(16).padStart(4, "0")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Bundled ROMs served from web/public/roms, selectable without a file picker.
const TEST_ROM_GROUPS: { label: string; roms: Record<string, string> }[] = [
  {
    label: "Homebrew Games",
    roms: {
      "Snake.gb": "/roms/Snake.gb",
      "PandorasBlocks.gbc": "/roms/PandorasBlocks.gbc",
    },
  },
  {
    label: "Hardware Tests",
    roms: {
      "cpu_instrs.gb": "/roms/cpu_instrs.gb",
      "dmg-acid2.gb": "/roms/dmg-acid2.gb",
    },
  },
];

const KEY_TO_BUTTON: Record<string, keyof EmulatorModule["Button"]> = {
  ArrowRight: "Right",
  ArrowLeft: "Left",
  ArrowUp: "Up",
  ArrowDown: "Down",
  z: "B",
  x: "A",
  Shift: "Select",
  Enter: "Start",
};

export function EmulatorScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moduleRef = useRef<EmulatorModule | null>(null);
  const emulatorRef = useRef<EmulatorInstance | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const audioPlayerRef = useRef<GbAudioPlayer | null>(null);
  const saveKeyRef = useRef<string | null>(null);
  const cartridgeIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [romLoaded, setRomLoaded] = useState(false);
  const [romName, setRomName] = useState<string | null>(null);
  const [paletteKey, setPaletteKey] = useState<string>(DEFAULT_PALETTE);
  const [autoPalette, setAutoPalette] = useState<Palette | null>(null);
  const [autoPaletteSgb, setAutoPaletteSgb] = useState<Palette | null>(null);
  const customPalettes = useCustomPalettes();
  // Colors from the palette editor's draft, shown live while it's open.
  const [previewPalette, setPreviewPalette] = useState<Palette | null>(null);
  const [selectedTestRom, setSelectedTestRom] = useState("");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [muted, setMuted] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [filledSlots, setFilledSlots] = useState<boolean[]>(() =>
    Array(SAVE_STATE_SLOT_COUNT).fill(false)
  );
  const [saveFlash, setSaveFlash] = useState(false);
  const [loadFlash, setLoadFlash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // While the palette picker is open on a phone in landscape, the menu's
  // other controls and its dimming get out of the way so the game is fully
  // visible; closing the picker brings them back.
  const [palettePickerOpen, setPalettePickerOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  });
  const integerScaling = useIntegerScaling();
  const saveFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveFlashTimeoutRef.current) clearTimeout(saveFlashTimeoutRef.current);
      if (loadFlashTimeoutRef.current) clearTimeout(loadFlashTimeoutRef.current);
    };
  }, []);

  // CSS's `aspect-ratio` can only grow the auto side of a box to match a
  // definite one - it won't shrink a definite side back down when the
  // *other* constraint (a max-width or max-height) turns out to be the
  // tighter one. That means a pure-CSS box can fit a container that's too
  // wide, or one that's too tall, but not both, so on an oddly-shaped
  // screen it distorts. Measuring the wrapper and computing an exact
  // display size here keeps the canvas at the true 160:144 ratio no
  // matter which dimension is actually the limiting one.
  useEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;

    const targetRatio = SCREEN_WIDTH / SCREEN_HEIGHT;
    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      if (integerScaling) {
        // Scale by a whole number of *device* pixels per Game Boy pixel so
        // every pixel is the same size on high-DPI screens too. The canvas
        // is border-box, so leave room for its 1px border on each side.
        const dpr = window.devicePixelRatio || 1;
        const border = 2;
        const scale = Math.floor(
          Math.min(
            ((width - border) * dpr) / SCREEN_WIDTH,
            ((height - border) * dpr) / SCREEN_HEIGHT
          )
        );
        // Too small for even 1x: fall through to the regular fit.
        if (scale >= 1) {
          setCanvasSize({
            width: (SCREEN_WIDTH * scale) / dpr + border,
            height: (SCREEN_HEIGHT * scale) / dpr + border,
          });
          return;
        }
      }
      const fitted =
        width / height > targetRatio
          ? { width: height * targetRatio, height }
          : { width, height: width / targetRatio };
      setCanvasSize({
        width: Math.floor(fitted.width),
        height: Math.floor(fitted.height),
      });
    };

    const rect = wrapper.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [integerScaling]);

  useEffect(() => {
    let cancelled = false;
    const audioPlayer = new GbAudioPlayer();
    audioPlayerRef.current = audioPlayer;

    Promise.all([loadEmulatorModule(), audioPlayer.waitUntilReady()])
      .then(([module]) => {
        if (cancelled) return;
        moduleRef.current = module;
        const emulator = new module.Emulator();
        // Set before any runFrame() so the core generates audio at the
        // device's exact native rate - no resampling needed downstream.
        emulator.setAudioSampleRate(audioPlayer.sampleRate);
        emulatorRef.current = emulator;
        audioPlayer.setMuted(muted);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
      audioPlayerRef.current?.close();
      audioPlayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    audioPlayerRef.current?.setMuted(muted);
  }, [muted]);

  // The palette on screen: the editor's draft while one is being edited,
  // otherwise the selection. drawFrame reads it through a ref so a palette
  // change repaints without giving drawFrame a new identity - the frame loop
  // below depends on it and would restart on every change (each color drag).
  const palette =
    previewPalette ?? resolvePalette(paletteKey, autoPalette, autoPaletteSgb, customPalettes);
  const paletteRef = useRef<Palette>(palette);

  const drawFrame = useCallback(() => {
    const emulator = emulatorRef.current;
    const canvas = canvasRef.current;
    if (!emulator || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!imageDataRef.current) {
      imageDataRef.current = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    }
    const imageData = imageDataRef.current;
    const framebuffer = emulator.getFramebuffer();
    const colors = paletteRef.current;

    for (let i = 0; i < framebuffer.length; i++) {
      const pixel = framebuffer[i];
      const layer = (pixel >> 2) & 0x03;
      const [r, g, b] = paletteColor(
        colors,
        layer > 2 ? 0 : layer, // layer 3 is unused
        pixel & 0x03
      );
      const offset = i * 4;
      imageData.data[offset] = r;
      imageData.data[offset + 1] = g;
      imageData.data[offset + 2] = b;
      imageData.data[offset + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }, []);

  useEffect(() => {
    // Paused: cancel the loop outright (rather than running it in place)
    // so the frozen frame stays on screen and no CPU/battery is spent.
    if (!romLoaded || paused) return;

    let running = true;
    let frameId: number;
    let lastTimestamp: number | null = null;
    let accumulatedMs = 0;
    const maxFramesPerRaf = MAX_FRAMES_PER_RAF * speed;

    const loop = (timestamp: number) => {
      if (!running) return;

      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      let deltaMs = timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      // If the tab was backgrounded or a huge stall happened, don't try to
      // burn through minutes of emulated frames catching up.
      if (deltaMs > 1000) {
        deltaMs = GB_FRAME_MS;
      }
      // Fast-forward by feeding the loop sped-up wall-clock time, rather
      // than running extra frames per emulated frame's worth of time.
      accumulatedMs += deltaMs * speed;

      let framesRun = 0;
      while (
        accumulatedMs >= GB_FRAME_MS &&
        framesRun < maxFramesPerRaf
      ) {
        emulatorRef.current?.runFrame();
        accumulatedMs -= GB_FRAME_MS;
        framesRun++;
      }
      // Dropped time from an oversaturated frame budget shouldn't linger and
      // cause a burst of catch-up frames later.
      if (framesRun === maxFramesPerRaf) {
        accumulatedMs = 0;
      }

      if (framesRun > 0) {
        drawFrame();
        // Drain every tick regardless of speed/mute so the core's sample
        // buffer doesn't grow unbounded; GbAudioPlayer drops chunks itself
        // if they'd push playback too far ahead of real time (e.g. during
        // fast-forward, which generates audio faster than it plays).
        const samples = emulatorRef.current?.getAudioSamples();
        if (samples) audioPlayerRef.current?.push(samples);
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(frameId);
    };
  }, [romLoaded, paused, speed, drawFrame]);

  // Repaint the current frame immediately when the palette changes, even if
  // the emulator isn't running (e.g. before a ROM is loaded).
  useEffect(() => {
    paletteRef.current = palette;
    drawFrame();
  }, [palette, drawFrame]);

  const setButton = useCallback(
    (buttonName: keyof EmulatorModule["Button"], pressed: boolean) => {
      const emulatorModule = moduleRef.current;
      const emulator = emulatorRef.current;
      if (!emulatorModule || !emulator) return;
      emulator.setButtonPressed(emulatorModule.Button[buttonName], pressed);
    },
    []
  );

  useEffect(() => {
    const handleKey = (pressed: boolean) => (event: KeyboardEvent) => {
      // Typing (e.g. naming a custom palette) isn't playing: leave z/x,
      // arrows, Shift and Enter alone in text fields.
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.type === "text")
      ) {
        return;
      }

      const buttonName = KEY_TO_BUTTON[event.key];
      if (!buttonName) return;

      event.preventDefault();
      setButton(buttonName, pressed);
    };

    const onKeyDown = handleKey(true);
    const onKeyUp = handleKey(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [setButton]);

  const saveCartRam = useCallback(() => {
    const emulator = emulatorRef.current;
    const key = saveKeyRef.current;
    if (!emulator || !key) return;
    const ram = emulator.getCartRam();
    if (ram.length === 0) return; // nothing battery-backed to persist
    try {
      localStorage.setItem(key, bytesToBase64(ram));
    } catch {
      // Storage full/unavailable (e.g. private browsing) - not fatal.
    }
  }, []);

  useEffect(() => {
    if (!romLoaded) return;
    const interval = setInterval(saveCartRam, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [romLoaded, saveCartRam]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveCartRam();
    };
    window.addEventListener("beforeunload", saveCartRam);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", saveCartRam);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [saveCartRam]);

  const refreshFilledSlots = useCallback((cartridgeId: string | null) => {
    if (!cartridgeId) {
      setFilledSlots(Array(SAVE_STATE_SLOT_COUNT).fill(false));
      return;
    }
    const next: boolean[] = [];
    for (let slot = 0; slot < SAVE_STATE_SLOT_COUNT; slot++) {
      next.push(localStorage.getItem(saveStateKey(cartridgeId, slot)) !== null);
    }
    setFilledSlots(next);
  }, []);

  const loadRomBytes = (bytes: Uint8Array, name: string) => {
    const emulator = emulatorRef.current;
    if (!emulator) return;

    saveCartRam(); // flush whatever ROM was previously running
    audioPlayerRef.current?.resume(); // called from a user gesture - satisfies autoplay policy

    audioPlayerRef.current?.reset();
    emulator.reset();
    emulator.loadRom(bytes);

    setAutoPalette(findGameBoyColorPalette(bytes));
    setAutoPaletteSgb(findSuperGameBoyPalette(bytes));

    const cartridgeId = readCartridgeId(bytes);
    cartridgeIdRef.current = cartridgeId;
    saveKeyRef.current = SAVE_KEY_PREFIX + cartridgeId;
    const saved = localStorage.getItem(saveKeyRef.current);
    if (saved) {
      try {
        emulator.loadCartRam(base64ToBytes(saved));
      } catch {
        // Corrupted/incompatible save data - start fresh instead of crashing.
      }
    }
    refreshFilledSlots(cartridgeId);

    setRomName(name);
    setPaused(false);
    setRomLoaded(true);
  };

  const handleSaveState = useCallback(() => {
    const emulator = emulatorRef.current;
    const cartridgeId = cartridgeIdRef.current;
    if (!emulator || !cartridgeId) return;
    try {
      localStorage.setItem(
        saveStateKey(cartridgeId, selectedSlot),
        bytesToBase64(emulator.getSaveState())
      );
      refreshFilledSlots(cartridgeId);

      setSaveFlash(true);
      if (saveFlashTimeoutRef.current) clearTimeout(saveFlashTimeoutRef.current);
      saveFlashTimeoutRef.current = setTimeout(() => setSaveFlash(false), 1500);
    } catch {
      // Storage full/unavailable (e.g. private browsing) - not fatal.
    }
  }, [selectedSlot, refreshFilledSlots]);

  const handleLoadState = useCallback(() => {
    const emulator = emulatorRef.current;
    const cartridgeId = cartridgeIdRef.current;
    if (!emulator || !cartridgeId) return;
    const saved = localStorage.getItem(saveStateKey(cartridgeId, selectedSlot));
    if (!saved) return;
    try {
      emulator.loadSaveState(base64ToBytes(saved));
      audioPlayerRef.current?.reset();
      drawFrame(); // repaint immediately, even while paused

      setLoadFlash(true);
      if (loadFlashTimeoutRef.current) clearTimeout(loadFlashTimeoutRef.current);
      loadFlashTimeoutRef.current = setTimeout(() => setLoadFlash(false), 1500);
    } catch {
      // Corrupted save data - ignore rather than crash.
    }
  }, [selectedSlot, drawFrame]);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadRomBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  const handleLoadTestRom = async () => {
    if (!selectedTestRom) return;
    const romName =
      TEST_ROM_GROUPS.flatMap((group) => Object.entries(group.roms)).find(
        ([, url]) => url === selectedTestRom
      )?.[0] ?? selectedTestRom;
    const response = await fetch(selectedTestRom);
    loadRomBytes(new Uint8Array(await response.arrayBuffer()), romName);
    // Clear any locally-picked file so the input doesn't keep showing its
    // name once a test ROM has taken over.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Soft-reset, like the console's reset button: reboots CPU/PPU/APU state
  // but leaves the cartridge (ROM + cart RAM) alone, so the current game
  // and any unsaved battery RAM survive the reset.
  const handleReset = useCallback(() => {
    const emulator = emulatorRef.current;
    if (!emulator || !romLoaded) return;
    emulator.reset();
    drawFrame(); // repaint immediately, even while paused
  }, [romLoaded, drawFrame]);

  return (
    <div className="relative flex w-full min-h-0 max-w-[480px] flex-1 flex-col items-center gap-3 touch:max-w-none phone-landscape:flex-row phone-landscape:items-stretch phone-landscape:gap-0">
      <div
        ref={canvasWrapperRef}
        className="flex w-full min-h-0 flex-1 items-center justify-center phone-landscape:h-full phone-landscape:w-auto"
      >
        <canvas
          ref={canvasRef}
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          className="border border-outline bg-black"
          style={{
            imageRendering: "pixelated",
            width: canvasSize.width,
            height: canvasSize.height,
          }}
        />
      </div>

      {/* Menu toggle: the secondary controls below are docked inline in
          portrait, but tucked behind this button in landscape on touch
          devices - there's no vertical room there to show them alongside
          a full-height canvas and the d-pad/button overlay. */}
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        className={`absolute right-2 top-2 z-30 hidden h-8 w-8 items-center justify-center rounded-full border border-outline bg-surface-translucent text-foreground-secondary ${
          palettePickerOpen ? "" : "phone-landscape:flex"
        }`}
      >
        {menuOpen ? "×" : "☰"}
      </button>

      {/* Width-capped independently of the canvas above: the outer
          `relative` wrapper goes full-width on touch devices so the canvas
          can use all the available space on a wide tablet, but these rows
          still need to stay a readable column width rather than stretching
          edge to edge. `phone-landscape:contents` drops this wrapper's own
          box on phones so it doesn't claim a slot in the outer flex-row
          alongside the canvas - its child below positions itself via the
          phone drawer's own `absolute` instead. */}
      <div className="w-full shrink-0 touch:max-w-[480px] phone-landscape:contents">
      <div
        onClick={() => setMenuOpen(false)}
        className={`flex w-full min-w-0 shrink-0 flex-col items-center gap-3 phone-landscape:absolute phone-landscape:inset-0 phone-landscape:z-20 phone-landscape:justify-center phone-landscape:p-3 ${
          palettePickerOpen
            ? "phone-landscape:pointer-events-none"
            : "phone-landscape:bg-black/60"
        } ${menuOpen ? "" : "phone-landscape:hidden"}`}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          className={`flex w-full min-w-0 shrink-0 flex-col items-center gap-3 phone-landscape:w-full phone-landscape:max-w-lg phone-landscape:rounded phone-landscape:border phone-landscape:border-outline phone-landscape:bg-background phone-landscape:p-3 ${
            palettePickerOpen ? "phone-landscape:invisible" : ""
          }`}
        >
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-3">
          <select
            value={selectedTestRom}
            disabled={status !== "ready"}
            onChange={(event) => setSelectedTestRom(event.target.value)}
            autoComplete="off"
            className="min-w-0 flex-1 truncate rounded-sm border border-outline bg-surface px-2 py-1 text-sm text-foreground-secondary"
          >
            <option value="" disabled>
              Select test ROM...
            </option>
            {TEST_ROM_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {Object.entries(group.roms).map(([label, url]) => (
                  <option key={url} value={url}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={handleLoadTestRom}
            disabled={status !== "ready" || !selectedTestRom}
            title="Load test ROM"
            className="shrink-0 rounded-sm border border-outline bg-surface px-3 py-1 text-sm text-foreground-secondary disabled:opacity-50"
          >
            Load
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={!romLoaded}
            title="Reset"
            className="shrink-0 rounded-sm border border-outline bg-surface px-3 py-1 text-sm text-foreground-secondary disabled:opacity-50"
          >
            Reset
          </button>
        </div>
        <div className="@container flex w-full min-w-0 shrink-0 flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gb,.gbc"
            disabled={status !== "ready"}
            onChange={handleFileChange}
            autoComplete="off"
            // The filename/"No file chosen" label is browser-rendered text we
            // can't remove outright, so once the row is too narrow to show it
            // without clipping mid-word, make it transparent instead - the
            // Browse button (styled via file:*, with its own explicit color)
            // stays visible either way.
            className="min-w-0 flex-1 overflow-hidden text-sm text-foreground-secondary @max-[400px]:text-transparent file:mr-3 file:rounded-sm file:border file:border-outline file:bg-surface file:px-3 file:py-1 file:text-sm file:text-foreground-secondary"
          />
          <PalettePicker
            value={paletteKey}
            onChange={setPaletteKey}
            autoColors={resolvePalette(AUTO_PALETTE, autoPalette, autoPaletteSgb, customPalettes)}
            autoColorsSgb={resolvePalette(AUTO_PALETTE_SGB, autoPalette, autoPaletteSgb, customPalettes)}
            onPreview={setPreviewPalette}
            onOpenChange={setPalettePickerOpen}
          />
        </div>
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center justify-center gap-2">
          <div className="flex w-full flex-wrap items-center justify-center gap-2 md:w-auto md:justify-start md:mr-auto">
            <button
              type="button"
              onClick={() => {
                audioPlayerRef.current?.resume();
                setPaused((prev) => !prev);
              }}
              disabled={!romLoaded}
              aria-pressed={paused}
              title="Pause game"
              className={`w-18 shrink-0 whitespace-nowrap rounded border px-2 py-1 text-center text-sm disabled:opacity-50 ${
                paused
                  ? "border-outline-strong bg-surface-strong text-foreground"
                  : "border-outline bg-surface text-foreground-secondary"
              }`}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => setMuted((prev) => !prev)}
              disabled={!romLoaded}
              aria-pressed={muted}
              title={muted ? "Unmute" : "Mute"}
              className={`w-18 shrink-0 whitespace-nowrap rounded border px-2 py-1 text-center text-sm disabled:opacity-50 ${
                muted
                  ? "border-outline-strong bg-surface-strong text-foreground"
                  : "border-outline bg-surface text-foreground-secondary"
              }`}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <div className="flex shrink-0 gap-1" role="group" aria-label="Emulation speed">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSpeed(option)}
                  disabled={!romLoaded}
                  aria-pressed={speed === option}
                  className={`rounded border px-2 py-1 text-sm disabled:opacity-50 ${
                    speed === option
                      ? "border-outline-strong bg-surface-strong text-foreground"
                      : "border-outline bg-surface text-foreground-secondary"
                  }`}
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-2">
            <select
              value={selectedSlot}
              onChange={(event) => setSelectedSlot(Number(event.target.value))}
              disabled={!romLoaded}
              aria-label="Save state slot"
              className="min-w-0 shrink-0 rounded-sm border border-outline bg-surface px-2 py-1 text-sm text-foreground-secondary disabled:opacity-50"
            >
              {Array.from({ length: SAVE_STATE_SLOT_COUNT }, (_, slot) => (
                <option key={slot} value={slot}>
                  Slot {slot + 1}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSaveState}
              disabled={!romLoaded}
              title="Save state"
              className={`relative shrink-0 whitespace-nowrap rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
                saveFlash
                  ? "border-success bg-success-surface text-success-foreground"
                  : "border-outline bg-surface text-foreground-secondary"
              }`}
            >
              <span className="invisible">Save</span>
              <span className="absolute inset-0 flex items-center justify-center">
                {saveFlash ? "Saved!" : "Save"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleLoadState}
              disabled={!romLoaded || !filledSlots[selectedSlot]}
              title="Load state"
              className={`relative shrink-0 whitespace-nowrap rounded border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
                loadFlash
                  ? "border-success bg-success-surface text-success-foreground"
                  : "border-outline bg-surface text-foreground-secondary"
              }`}
            >
              <span className="invisible">Load</span>
              <span className="absolute inset-0 flex items-center justify-center">
                {loadFlash ? "Loaded!" : "Load"}
              </span>
            </button>
          </div>
        </div>
        <p className="shrink-0 text-sm text-foreground-muted">
          Status: {romLoaded
            ? paused
              ? "paused"
              : `running${speed !== 1 ? ` (${speed}x)` : ""}`
            : status}
          {romName ? ` · ${romName}` : ""}
        </p>
        </div>
      </div>
      </div>
      <TouchControls disabled={!romLoaded} onButtonChange={setButton} />
    </div>
  );
}

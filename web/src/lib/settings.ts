"use client";

import { useSyncExternalStore } from "react";

// Settings shared between SettingsMenu and EmulatorScreen, which live in
// separate trees on the page. Backed by localStorage so they persist, with a
// listener set so every subscriber re-renders when one of them changes it.

const INTEGER_SCALING_KEY = "integerScaling";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cached in memory so the toggle still works for the session when storage
// is unavailable; `null` means not read from storage yet.
let integerScaling: boolean | null = null;

function getIntegerScaling(): boolean {
  if (integerScaling === null) {
    try {
      integerScaling = localStorage.getItem(INTEGER_SCALING_KEY) === "true";
    } catch {
      integerScaling = false;
    }
  }
  return integerScaling;
}

export function setIntegerScaling(enabled: boolean) {
  integerScaling = enabled;
  try {
    localStorage.setItem(INTEGER_SCALING_KEY, String(enabled));
  } catch {
    // Storage full/unavailable (e.g. private browsing) - just won't persist.
  }
  listeners.forEach((listener) => listener());
}

export function useIntegerScaling(): boolean {
  return useSyncExternalStore(subscribe, getIntegerScaling, () => false);
}

export const GB_BUTTONS = [
  "Up",
  "Down",
  "Left",
  "Right",
  "A",
  "B",
  "Select",
  "Start",
] as const;
export type GbButton = (typeof GB_BUTTONS)[number];
export type KeyBindings = Record<GbButton, string>;

// Keyed by KeyboardEvent.code (the physical key), so bindings don't depend on
// keyboard layout or Caps Lock.
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  A: "KeyX",
  B: "KeyZ",
  Select: "Space",
  Start: "Enter",
};

const KEY_BINDINGS_KEY = "keyBindings";

// Replaced (never mutated) on change so it works as a stable snapshot.
let keyBindings: KeyBindings | null = null;

function readKeyBindings(): KeyBindings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY_BINDINGS_KEY) ?? "null");
    if (stored && typeof stored === "object") {
      const result = { ...DEFAULT_KEY_BINDINGS };
      for (const button of GB_BUTTONS) {
        if (typeof stored[button] === "string") result[button] = stored[button];
      }
      return result;
    }
  } catch {
    // Missing, corrupt or unavailable storage - use the defaults.
  }
  return DEFAULT_KEY_BINDINGS;
}

function getKeyBindings(): KeyBindings {
  if (keyBindings === null) keyBindings = readKeyBindings();
  return keyBindings;
}

function saveKeyBindings(next: KeyBindings) {
  keyBindings = next;
  try {
    localStorage.setItem(KEY_BINDINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage full/unavailable (e.g. private browsing) - just won't persist.
  }
  listeners.forEach((listener) => listener());
}

// If another button already uses the key, the two swap keys.
export function setKeyBinding(button: GbButton, code: string) {
  const current = getKeyBindings();
  const next = { ...current };
  const other = GB_BUTTONS.find((b) => b !== button && current[b] === code);
  if (other) next[other] = current[button];
  next[button] = code;
  saveKeyBindings(next);
}

export function resetKeyBindings() {
  saveKeyBindings(DEFAULT_KEY_BINDINGS);
}

export function useKeyBindings(): KeyBindings {
  return useSyncExternalStore(
    subscribe,
    getKeyBindings,
    () => DEFAULT_KEY_BINDINGS
  );
}

export function keyLabel(code: string): string {
  const arrows: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  if (arrows[code]) return arrows[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code.replace(/(Left|Right)$/, " $1").replace(/([a-z])([A-Z])/g, "$1 $2");
}

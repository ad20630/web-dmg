"use client";

import { useEffect, useState } from "react";

import {
  keyLabel,
  setIntegerScaling,
  setKeyBinding,
  useIntegerScaling,
  useKeyBindings,
  type GbButton,
} from "@/lib/settings";

type Theme = "dark" | "light" | "dmg" | "gba";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "dmg", label: "Brick" },
  { value: "gba", label: "Advanced" },
];

function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage full/unavailable (e.g. private browsing) - just won't persist.
  }
}

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dmg" || attr === "gba"
    ? attr
    : "dark";
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  // Matches whatever the inline theme-init script in layout.tsx already
  // applied before this component mounted, rather than assuming dark. That
  // script runs pre-hydration and isn't React state, so there's no way to
  // know its result during SSR/initial render - syncing from it here is a
  // legitimate effect (reading an external, non-React-owned source), not a
  // value derivable from props/state.
  const [theme, setTheme] = useState<Theme>("dark");
  const integerScaling = useIntegerScaling();
  const [showScalingHelp, setShowScalingHelp] = useState(false);
  const keyBindings = useKeyBindings();
  const [rebinding, setRebinding] = useState<GbButton | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readTheme());
  }, []);

  useEffect(() => {
    if (!open || !rebinding) return;
    // Capture phase, and stopped there, so the key is only used for binding:
    // it doesn't press a game button, close the menu (Escape) or activate a
    // focused control (Enter/Space).
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.code !== "Escape") setKeyBinding(rebinding, event.code);
      setRebinding(null);
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [open, rebinding]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const selectTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRebinding(null);
          setOpen(true);
        }}
        aria-label="Show settings"
        title="Settings"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline bg-surface text-xs text-foreground-secondary"
      >
        ⚙
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-sm border border-outline bg-surface p-4 text-sm text-foreground-secondary phone-landscape:max-h-full phone-landscape:overflow-y-auto"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Theme</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-outline text-foreground-secondary"
              >
                ×
              </button>
            </div>
            <div className="flex gap-2" role="group" aria-label="Theme">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectTheme(option.value)}
                  aria-pressed={theme === option.value}
                  className={`flex-1 rounded border px-3 py-1 text-sm ${
                    theme === option.value
                      ? "border-outline-strong bg-surface-strong text-foreground"
                      : "border-outline bg-surface text-foreground-secondary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mb-3 mt-4 flex items-center gap-2">
              <h2 className="font-semibold text-foreground">Integer Scaling</h2>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowScalingHelp((v) => !v)}
                  aria-label="What is integer scaling?"
                  aria-expanded={showScalingHelp}
                  aria-controls="integer-scaling-help"
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-outline text-xs text-foreground-secondary"
                >
                  ?
                </button>
                {showScalingHelp && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowScalingHelp(false)}
                    />
                    <p
                      id="integer-scaling-help"
                      role="tooltip"
                      className="absolute left-0 top-full z-20 mt-2 w-56 rounded border border-outline-strong bg-surface-strong p-2 text-xs font-normal text-foreground shadow-lg"
                    >
                      When on, forces the game&apos;s resolution to be a clean
                      multiple of the original Game Boy&apos;s. Results in a
                      sharper image, but one that fills less of the screen.
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2" role="group" aria-label="Integer scaling">
              {[
                { value: false, label: "Off" },
                { value: true, label: "On" },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setIntegerScaling(option.value)}
                  aria-pressed={integerScaling === option.value}
                  className={`flex-1 rounded border px-3 py-1 text-sm ${
                    integerScaling === option.value
                      ? "border-outline-strong bg-surface-strong text-foreground"
                      : "border-outline bg-surface text-foreground-secondary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="touch:hidden">
            <h2 className="mb-3 mt-4 font-semibold text-foreground">Keyboard Controls</h2>
            {(() => {
              const keyCell = (button: GbButton, className = "") => (
                <div key={button} className={`flex flex-col items-center gap-0.5 ${className}`}>
                  <span className="text-xs">{button}</span>
                  <button
                    type="button"
                    onClick={() => setRebinding(rebinding === button ? null : button)}
                    aria-label={`Rebind ${button}`}
                    className={`w-full min-w-0 truncate rounded border px-1 py-1 text-xs ${
                      rebinding === button
                        ? "border-outline-strong bg-surface-strong text-foreground"
                        : "border-outline bg-surface text-foreground-secondary"
                    }`}
                  >
                    {rebinding === button ? "Press…" : keyLabel(keyBindings[button])}
                  </button>
                </div>
              );
              return (
                <div className="flex items-center justify-between gap-3">
                  <div className="grid w-40 shrink-0 grid-cols-3 gap-1">
                    {keyCell("Up", "col-start-2")}
                    {keyCell("Left", "col-start-1 row-start-2")}
                    {keyCell("Right", "col-start-3 row-start-2")}
                    {keyCell("Down", "col-start-2 row-start-3")}
                  </div>
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="flex justify-center gap-2">
                      {keyCell("Select", "w-14")}
                      {keyCell("Start", "w-14")}
                    </div>
                    <div className="flex justify-center gap-2">
                      {keyCell("B", "w-14")}
                      {keyCell("A", "w-14")}
                    </div>
                  </div>
                </div>
              );
            })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

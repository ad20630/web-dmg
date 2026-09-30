"use client";

import { useEffect, useState } from "react";

import { GB_BUTTONS, keyLabel, useKeyBindings } from "@/lib/settings";

export function ControlsHelp() {
  const [open, setOpen] = useState(false);
  const keyBindings = useKeyBindings();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show controls help"
        title="Controls"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline bg-surface text-xs text-foreground-secondary"
      >
        ?
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Controls"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-sm border border-outline bg-surface p-4 text-sm text-foreground-secondary phone-landscape:max-h-full phone-landscape:overflow-y-auto"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Controls</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-outline text-foreground-secondary"
              >
                ×
              </button>
            </div>

            <p className="mb-3 text-foreground-muted">
              Select a ROM from the file picker or test-ROM dropdown to start playing.
            </p>

            <h3 className="mb-1 font-medium text-foreground-secondary">Keyboard</h3>
            <ul className="mb-3 text-foreground-muted space-y-0.5">
              {GB_BUTTONS.map((button) => (
                <li key={button}>
                  {keyLabel(keyBindings[button])} - {button}
                </li>
              ))}
              <li>Change these in Settings</li>
            </ul>

            <h3 className="mb-1 font-medium text-foreground-secondary">Touch (mobile)</h3>
            <p className="mb-3 text-foreground-muted">
              Use the on-screen D-pad and A/B/Select/Start buttons - below the
              game in portrait, or alongside it in landscape (tap the menu
              icon for ROM/save controls).
            </p>

            <h3 className="mb-1 font-medium text-foreground-secondary">Other</h3>
            <ul className="space-y-0.5 text-foreground-muted">
              <li>Pause / Resume - stop and continue emulation</li>
              <li>Mute - silence audio</li>
              <li>1x / 2x / 4x - change emulation speed</li>
              <li>Save / Load - store or restore a save-state in the selected slot</li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

import { CustomPaletteEditor } from "@/components/CustomPaletteEditor";
import { PaletteSwatch } from "@/components/PaletteSwatch";
import {
  CUSTOM_COLOR_COUNT,
  customKey,
  deleteCustomPalette,
  newCustomId,
  saveCustomPalette,
  useCustomPalettes,
} from "@/lib/customPalettes";
import type { Rgb } from "@/lib/gameBoyColorPalettes";
import {
  AUTO_PALETTE,
  AUTO_PALETTE_ALL,
  AUTO_PALETTE_ALL_LABEL,
  AUTO_PALETTE_GROUP,
  DEFAULT_PALETTE,
  AUTO_PALETTE_LABEL,
  AUTO_PALETTE_SGB,
  AUTO_PALETTE_SGB_LABEL,
  PALETTE_GROUPS,
  PALETTE_GROUP_LABELS,
  PALETTE_LIST,
  PRESET_SUBGROUP_LABELS,
  paletteColor,
  type Palette,
  type PaletteGroup,
  type PresetSubgroup,
} from "@/lib/palettes";

interface Choice {
  key: string;
  label: string;
  colors: Palette;
  hint?: string;
  rainbow?: boolean; // swatch is a rainbow: the colors come from the game
  customId?: string; // set for the user's own palettes, which can be edited
  subgroup?: PresetSubgroup; // the header a preset is listed under
}

// A palette being made or changed in the editor; id is null for a new one.
interface Draft {
  id: string | null;
  name: string;
  colors: Rgb[];
}

const ARROW_BUTTON_CLASS =
  "flex h-7 w-6 shrink-0 items-center justify-center rounded-sm border border-outline bg-surface text-foreground-secondary";

interface PalettePickerProps {
  value: string;
  onChange: (key: string) => void;
  // What each Auto option is showing right now (the game's palette, or the
  // fallback), so its swatch previews the real colors.
  autoColorsAll: Palette;
  autoColors: Palette;
  autoColorsSgb: Palette;
  // The loaded game supports the Super Game Boy, so Auto (SGB) colors it
  // itself rather than with one palette.
  autoSgbFromGame: boolean;
  // Live preview of the palette being edited (null when not editing), drawn
  // on the game screen in place of the selected palette.
  onPreview: (colors: Palette | null) => void;
  // Reports the picker opening and closing, so the surrounding menu can get
  // out of the way of the game while palettes are being tried.
  onOpenChange?: (open: boolean) => void;
}

export function PalettePicker({
  value,
  onChange,
  autoColorsAll,
  autoColors,
  autoColorsSgb,
  autoSgbFromGame,
  onPreview,
  onOpenChange,
}: PalettePickerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [tab, setTab] = useState<PaletteGroup>(AUTO_PALETTE_GROUP);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [helpChoice, setHelpChoice] = useState<Choice | null>(null);
  const customPalettes = useCustomPalettes();

  const sections = useMemo(() => {
    const result = {} as Record<PaletteGroup, Choice[]>;
    for (const group of PALETTE_GROUPS) {
      result[group] =
        group === "custom"
          ? customPalettes.map((palette) => ({
              key: customKey(palette.id),
              label: palette.name,
              colors: palette.colors,
              customId: palette.id,
            }))
          : PALETTE_LIST.filter((entry) => entry.group === group).map((entry) => ({
              key: entry.key,
              label: entry.label,
              colors: entry.colors,
              subgroup: entry.subgroup,
            }));
    }
    result[AUTO_PALETTE_GROUP].unshift(
      {
        key: AUTO_PALETTE_ALL,
        label: AUTO_PALETTE_ALL_LABEL,
        colors: autoColorsAll,
        rainbow: autoSgbFromGame,
        hint: "Applies SGB enhancements for supported games, else the game's GBC palette when it has one, grayscale otherwise",
      },
      {
        key: AUTO_PALETTE,
        label: AUTO_PALETTE_LABEL,
        colors: autoColors,
        hint: "Uses the game's own GBC palette when it has one, grayscale otherwise",
      },
      {
        key: AUTO_PALETTE_SGB,
        label: AUTO_PALETTE_SGB_LABEL,
        colors: autoColorsSgb,
        rainbow: autoSgbFromGame,
        hint: "Applies SGB enhancements for supported games, else its cooresponding preset, 1-A otherwise",
      }
    );
    return result;
  }, [autoColorsAll, autoColors, autoColorsSgb, autoSgbFromGame, customPalettes]);

  const currentGroup =
    PALETTE_GROUPS.find((group) => sections[group].some((c) => c.key === value)) ??
    AUTO_PALETTE_GROUP;
  const current =
    sections[currentGroup].find((c) => c.key === value) ?? sections[AUTO_PALETTE_GROUP][0];

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape in the color popup only dismisses the popup. Coloris closes
      // itself in a document listener that runs after this one, so its open
      // state can still be read here.
      if (document.getElementById("clr-picker")?.classList.contains("clr-open")) return;
      // Escape backs out of the editor first, and only then closes the picker.
      if (editing) setEditing(null);
      else setOpen(false);
    };
    // Capture phase, to run ahead of Coloris's own Escape handling.
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [open, editing]);

  // Steps through every palette in section order (Hardware, GBC Boot, SGB,
  // Preset, then Custom), wrapping from the last back to the first.
  const cycle = (step: 1 | -1) => {
    const choices = PALETTE_GROUPS.flatMap((group) => sections[group]);
    const index = choices.findIndex((c) => c.key === current.key);
    onChange(choices[(index + step + choices.length) % choices.length].key);
  };

  const openPicker = () => {
    setTab(currentGroup);
    setEditing(null);
    setHelpChoice(null);
    setOpen(true);
  };

  const closePicker = () => {
    setEditing(null);
    setOpen(false);
  };

  const uniqueName = () => {
    const names = new Set(customPalettes.map((palette) => palette.name));
    let name = "My Palette";
    for (let n = 2; names.has(name); n++) name = `My Palette ${n}`;
    return name;
  };

  // New palettes start as a copy of whatever is being used now, so it's a
  // tweak of something that already looks right rather than a blank slate.
  const startNew = () => {
    setEditing({
      id: null,
      name: uniqueName(),
      colors: Array.from({ length: CUSTOM_COLOR_COUNT }, (_, i) =>
        paletteColor(current.colors, Math.floor(i / 4), i % 4)
      ),
    });
  };

  const startEdit = (choice: Choice) => {
    if (!choice.customId) return;
    setEditing({
      id: choice.customId,
      name: choice.label,
      colors: Array.from({ length: CUSTOM_COLOR_COUNT }, (_, i) =>
        paletteColor(choice.colors, Math.floor(i / 4), i % 4)
      ),
    });
  };

  const saveDraft = (name: string, colors: Rgb[]) => {
    if (!editing) return;
    const id = editing.id ?? newCustomId();
    saveCustomPalette({ id, name, colors });
    onChange(customKey(id));
    closePicker();
  };

  const deleteDraft = () => {
    if (!editing?.id) return;
    deleteCustomPalette(editing.id);
    // Don't leave the screen drawing with a palette that no longer exists.
    if (value === customKey(editing.id)) onChange(DEFAULT_PALETTE);
    setEditing(null);
    setTab("custom");
  };

  const renderChoice = (choice: Choice) => {
    const selected = choice.key === current.key;
    return (
      <button
        key={choice.key}
        type="button"
        onClick={() => onChange(choice.key)}
        aria-pressed={selected}
        className={`flex min-w-0 flex-col gap-1.5 rounded border p-2 text-left text-sm ${
          selected
            ? "border-outline-strong bg-surface-strong text-foreground"
            : "border-outline bg-surface text-foreground-secondary"
        }`}
      >
        <PaletteSwatch colors={choice.colors} rainbow={choice.rainbow} className="h-8 w-full" />
        <span className="truncate">{choice.label}</span>
      </button>
    );
  };

  return (
    <>
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => cycle(-1)}
          aria-label="Previous palette"
          title="Previous palette"
          className={ARROW_BUTTON_CLASS}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={openPicker}
          aria-haspopup="dialog"
          title="Choose palette"
          className="flex w-40 shrink-0 items-center gap-2 rounded-sm border border-outline bg-surface px-2 py-1 text-sm text-foreground-secondary"
        >
          <PaletteSwatch
            colors={current.colors}
            rainbow={current.rainbow}
            className="h-[18px] w-10 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
        </button>
        <button
          type="button"
          onClick={() => cycle(1)}
          aria-label="Next palette"
          title="Next palette"
          className={ARROW_BUTTON_CLASS}
        >
          ›
        </button>
      </div>

      {open && (
        // No backdrop, so the game stays visible (and shows a palette being
        // edited live) with the page still clickable around the dialog. The
        // dialog sits out of the game's way: docked to the right where the
        // centered game leaves room for it (the game column is 480px wide, so
        // a 448px dialog clears it from 1408px up), to the right edge on
        // phones in landscape, and as a bottom sheet on narrower screens,
        // where the side has no free room. Close it with the × or Escape.
        // `phone-landscape:visible` keeps the dialog showing while the menu
        // panel it lives in is made invisible around it.
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end phone-landscape:visible justify-center p-4 min-[1408px]:items-center min-[1408px]:justify-end phone-landscape:items-center phone-landscape:justify-end">
          <div
            role="dialog"
            aria-modal="false"
            aria-label="Palette"
            className="pointer-events-auto relative flex max-h-[45svh] w-full max-w-lg flex-col rounded-sm border border-outline bg-surface p-4 text-sm text-foreground-secondary shadow-2xl min-[1408px]:max-h-full min-[1408px]:max-w-md phone-landscape:max-h-full phone-landscape:max-w-sm"
          >
            <div className="mb-3 flex shrink-0 items-center justify-between">
              {editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  aria-label="Back to palettes"
                  className="flex h-6 items-center gap-1 rounded-sm border border-outline bg-surface px-2 text-xs text-foreground-secondary"
                >
                  ‹ Back
                </button>
              ) : (
                <h2 className="font-semibold text-foreground">Palette</h2>
              )}
              <button
                type="button"
                onClick={closePicker}
                aria-label="Close"
                className="flex h-6 w-6 items-center justify-center rounded-full border border-outline text-foreground-secondary"
              >
                ×
              </button>
            </div>

            {editing ? (
              <CustomPaletteEditor
                key={editing.id ?? "new"}
                isNew={editing.id === null}
                initialName={editing.name}
                initialColors={editing.colors}
                onSave={saveDraft}
                onCancel={() => setEditing(null)}
                onDelete={editing.id ? deleteDraft : undefined}
                onDraftChange={onPreview}
              />
            ) : (
              <>
                <div className="mb-3 flex shrink-0 gap-1" role="tablist" aria-label="Palette sections">
                  {PALETTE_GROUPS.map((group) => (
                    <button
                      key={group}
                      type="button"
                      role="tab"
                      aria-selected={tab === group}
                      onClick={() => setTab(group)}
                      className={`min-w-0 flex-1 truncate rounded border px-1 py-1 text-xs sm:text-sm ${
                        tab === group
                          ? "border-outline-strong bg-surface-strong text-foreground"
                          : "border-outline bg-surface text-foreground-secondary"
                      }`}
                    >
                      {PALETTE_GROUP_LABELS[group]}
                    </button>
                  ))}
                </div>

                <div
                  role="group"
                  aria-label={PALETTE_GROUP_LABELS[tab]}
                  className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto"
                >
                  {tab === "custom" && (
                    <button
                      type="button"
                      onClick={startNew}
                      className="flex min-h-[4.75rem] items-center justify-center rounded border border-dashed border-outline-strong bg-surface text-sm text-foreground-secondary"
                    >
                      + New palette
                    </button>
                  )}
                  {sections[tab].flatMap((choice, i, list) => {
                    const item = choice.customId ? (
                      <div key={choice.key} className="relative flex min-w-0 flex-col">
                        {renderChoice(choice)}
                        <button
                          type="button"
                          onClick={() => startEdit(choice)}
                          aria-label={`Edit ${choice.label}`}
                          title="Edit"
                          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-outline bg-surface-translucent text-xs text-foreground-secondary"
                        >
                          ✎
                        </button>
                      </div>
                    ) : choice.hint ? (
                      <div key={choice.key} className="relative flex min-w-0 flex-col">
                        {renderChoice(choice)}
                        <button
                          type="button"
                          onClick={() => setHelpChoice(choice)}
                          aria-label={`About ${choice.label}`}
                          className="absolute bottom-1.5 right-3 flex h-6 w-6 items-center justify-center rounded-full border border-outline bg-surface-translucent text-xs text-foreground-secondary"
                        >
                          ?
                        </button>
                      </div>
                    ) : (
                      renderChoice(choice)
                    );
                    // Presets are listed under a header wherever the subgroup
                    // changes (the list is ordered so each subgroup is together).
                    if (choice.subgroup && choice.subgroup !== list[i - 1]?.subgroup) {
                      return [
                        <h3
                          key={`header-${choice.subgroup}`}
                          className="col-span-2 mt-1 text-xs font-semibold text-foreground-muted first:mt-0"
                        >
                          {PRESET_SUBGROUP_LABELS[choice.subgroup]}
                        </h3>,
                        item,
                      ];
                    }
                    return [item];
                  })}
                </div>

                {tab === "custom" && (
                  <p className="mt-3 shrink-0 text-xs text-foreground-muted">
                    Your palettes are saved in this browser. A new one starts as a
                    copy of the palette you&apos;re using now.
                  </p>
                )}
              </>
            )}

            {helpChoice?.hint && (
              <>
                <div
                  className="absolute inset-0 z-10"
                  onClick={() => setHelpChoice(null)}
                />
                <p
                  role="tooltip"
                  className="absolute inset-x-4 top-1/2 z-20 -translate-y-1/2 rounded border border-outline-strong bg-surface-strong p-3 text-xs text-foreground shadow-lg"
                >
                  <span className="mb-1 block font-semibold">{helpChoice.label}</span>
                  {helpChoice.hint}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

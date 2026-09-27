"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "@melloware/coloris/dist/coloris.css";

import { PaletteSwatch } from "@/components/PaletteSwatch";
import {
  CUSTOM_COLOR_COUNT,
  CUSTOM_NAME_MAX_LENGTH,
  formatHexCodes,
  hexToRgb,
  parseHexCodes,
  rgbToHex,
} from "@/lib/customPalettes";
import type { Rgb } from "@/lib/gameBoyColorPalettes";
import type { Palette } from "@/lib/palettes";

const LAYERS = ["BG", "OBJ0", "OBJ1"] as const;
const SHADES_PER_LAYER = 4;

// 4-color mode edits one set of four shades that every layer shares. The
// palette is still 12 colors underneath, with those four repeated for BG,
// OBJ0 and OBJ1, so saving and drawing don't care which mode made it.
const COLOR_MODES = [SHADES_PER_LAYER, CUSTOM_COLOR_COUNT] as const;
type ColorMode = (typeof COLOR_MODES)[number];

// Four shades repeated for all three layers.
const spread = (four: readonly string[]): string[] =>
  Array.from({ length: CUSTOM_COLOR_COUNT }, (_, i) => four[i % SHADES_PER_LAYER]);

// Every layer already uses the same four shades.
const isUniform = (colors: readonly string[]): boolean =>
  colors.every((color, i) => color === colors[i % SHADES_PER_LAYER]);

// Coloris attaches to the color swatches by this class.
const SWATCH_SELECTOR = ".gb-color-swatch";

// Themes that get Coloris's light popup; the rest (dark, gba) get the dark one.
const LIGHT_THEMES = ["light", "dmg"];

// Coloris has no concept of per-channel fields, only a single value field
// whose format (hex/rgb/hsl) can be toggled. Instead these build three R/G/B
// number fields alongside that field, wired directly to Coloris's DOM below.
const RGB_CHANNELS = [
  { id: "gb-rgb-r", label: "R", name: "Red" },
  { id: "gb-rgb-g", label: "G", name: "Green" },
  { id: "gb-rgb-b", label: "B", name: "Blue" },
] as const;

const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n) || 0));

// Reads the three fields and writes the resulting hex into Coloris's own
// value field, then dispatches `change` so Coloris's own listener re-parses
// it: this drives the gradient/hue markers and, through Coloris's normal
// pick flow, sets the open swatch's value and fires `input` on it.
function pushRgbFields() {
  const colorValueInput = document.getElementById("clr-color-value") as HTMLInputElement | null;
  if (!colorValueInput) return;
  const rgb = RGB_CHANNELS.map(({ id }) =>
    clamp255(Number((document.getElementById(id) as HTMLInputElement | null)?.value))
  ) as Rgb;
  colorValueInput.value = rgbToHex(rgb);
  colorValueInput.dispatchEvent(new Event("change"));
}

// Mirrors a hex color into the three fields, skipping whichever one is
// focused so a round trip through Coloris doesn't fight the user's typing.
function setRgbFields(hex: string) {
  const rgb = hexToRgb(hex);
  RGB_CHANNELS.forEach(({ id }, i) => {
    const field = document.getElementById(id) as HTMLInputElement | null;
    if (field && document.activeElement !== field) field.value = String(rgb[i]);
  });
}

// Builds the three fields once inside Coloris's popup (a global singleton
// Coloris itself never tears down, so later mounts of this editor find them
// already there).
function ensureRgbFields() {
  if (document.getElementById(RGB_CHANNELS[0].id)) return;
  const colorValueInput = document.getElementById("clr-color-value");
  if (!colorValueInput) return;

  const container = document.createElement("div");
  container.className = "gb-rgb-fields";
  RGB_CHANNELS.forEach(({ id, label, name }) => {
    const wrapper = document.createElement("label");
    wrapper.className = "gb-rgb-label";
    wrapper.append(label);
    const field = document.createElement("input");
    // type="number" ignores maxLength, so plain digits are filtered by hand.
    field.type = "text";
    field.id = id;
    field.inputMode = "numeric";
    field.maxLength = 3;
    field.autocomplete = "off";
    field.className = "gb-rgb-field";
    field.setAttribute("aria-label", name);
    field.oninput = () => {
      field.value = field.value.replace(/\D/g, "").slice(0, 3);
      pushRgbFields();
    };
    wrapper.appendChild(field);
    container.appendChild(wrapper);
  });
  colorValueInput.insertAdjacentElement("afterend", container);
}

const BUTTON_CLASS = "rounded border px-3 py-1 text-sm";
const SECONDARY_BUTTON_CLASS = `${BUTTON_CLASS} border-outline bg-surface text-foreground-secondary`;

interface CustomPaletteEditorProps {
  isNew: boolean;
  initialName: string;
  initialColors: Rgb[]; // CUSTOM_COLOR_COUNT long
  onSave: (name: string, colors: Rgb[]) => void;
  onCancel: () => void;
  onDelete?: () => void;
  // Called with the draft's colors on every change so the game behind the
  // dialog can show them live, and with null when the editor goes away.
  onDraftChange: (colors: Palette | null) => void;
}

export function CustomPaletteEditor({
  isNew,
  initialName,
  initialColors,
  onSave,
  onCancel,
  onDelete,
  onDraftChange,
}: CustomPaletteEditorProps) {
  const [name, setName] = useState(initialName);
  // Always CUSTOM_COLOR_COUNT "#rrggbb" colors, edited by the color inputs
  // and by Import.
  const [colors, setColors] = useState(() => initialColors.map(rgbToHex));
  // A palette whose layers all match (a 4-color preset, or one made in
  // 4-color mode) opens in 4-color mode; anything else needs all 12.
  const [mode, setMode] = useState<ColorMode>(() =>
    isUniform(colors) ? SHADES_PER_LAYER : CUSTOM_COLOR_COUNT
  );
  // The 12 colors as they were when switching down to 4-color mode, so an
  // accidental switch doesn't cost the sprite colors.
  const fullColorsRef = useRef<string[] | null>(null);
  // The import/export box is a scratch area, not a live view of the colors:
  // typing in it changes nothing until Import is pressed, and Export fills it
  // with the current colors.
  const [hexText, setHexText] = useState("");
  // Result of the last Import, shown until the box is edited again.
  const [notice, setNotice] = useState<string | null>(null);
  const hexBoxRef = useRef<HTMLTextAreaElement>(null);
  const colorisRef = useRef<typeof import("@melloware/coloris") | null>(null);

  // Coloris touches `document` as soon as it loads, so it can't be imported
  // during server rendering. It binds to the swatches by selector, so the
  // inputs React renders (and re-renders) don't need to be wired up one by one.
  useEffect(() => {
    let cancelled = false;
    import("@melloware/coloris").then(({ default: Coloris }) => {
      if (cancelled) return;
      colorisRef.current = Coloris;
      Coloris.init();
      ensureRgbFields();
      Coloris({
        el: SWATCH_SELECTOR,
        themeMode: LIGHT_THEMES.includes(document.documentElement.dataset.theme ?? "")
          ? "light"
          : "dark",
        format: "hex",
        alpha: false,
        wrap: false,
        // Focusing the popup's hex box would raise the on-screen keyboard over it.
        focusInput: !window.matchMedia("(pointer: coarse)").matches,
      });
    });
    return () => {
      cancelled = true;
      colorisRef.current?.close();
    };
  }, []);

  const parsed = useMemo(() => parseHexCodes(hexText, mode), [hexText, mode]);
  const previewColors = useMemo(() => colors.map((hex) => hexToRgb(hex)), [colors]);

  useEffect(() => {
    onDraftChange(previewColors);
  }, [previewColors, onDraftChange]);
  // Every way out of the editor (Back, Save, Delete, Escape, closing the
  // picker) unmounts it, so this one cleanup restores the real palette.
  useEffect(() => () => onDraftChange(null), [onDraftChange]);

  const changeMode = (next: ColorMode) => {
    if (next === mode) return;
    if (next === SHADES_PER_LAYER) {
      fullColorsRef.current = colors;
      setColors(spread(colors.slice(0, SHADES_PER_LAYER)));
    } else {
      // Back to 12: bring the sprite colors back if the four shades weren't
      // touched in between, otherwise keep what was edited.
      const stash = fullColorsRef.current;
      const collapsed = stash ? spread(stash.slice(0, SHADES_PER_LAYER)) : null;
      if (stash && collapsed && collapsed.every((color, i) => color === colors[i])) {
        setColors(stash);
      }
      fullColorsRef.current = null;
    }
    setMode(next);
    setHexText("");
    setNotice(null);
  };

  // `index` is a shade (0-3) in 4-color mode, which sets it on every layer,
  // and a position in the full 12 otherwise.
  const setColor = (index: number, hex: string) => {
    const value = hex.toLowerCase();
    setColors((current) =>
      current.map((color, i) =>
        (mode === SHADES_PER_LAYER ? i % SHADES_PER_LAYER === index : i === index) ? value : color
      )
    );
  };

  // Flips one row's shades, so lightest-to-darkest becomes darkest-to-lightest.
  // In 4-color mode the single row is every layer's row.
  const reverseRow = (row: number) => {
    setColors(
      colors.map((color, i) => {
        const inRow = mode === SHADES_PER_LAYER || Math.floor(i / SHADES_PER_LAYER) === row;
        if (!inRow) return color;
        const rowStart = i - (i % SHADES_PER_LAYER);
        return colors[rowStart + SHADES_PER_LAYER - 1 - (i % SHADES_PER_LAYER)];
      })
    );
  };

  // Swaps a row of shades (BG, OBJ0 or OBJ1) with the one `direction` away.
  // The row labels stay put, since they name the slot rather than the colors.
  const moveRow = (row: number, direction: -1 | 1) => {
    const other = row + direction;
    if (other < 0 || other >= LAYERS.length) return;
    setColors(
      colors.map((color, i) => {
        const shade = i % SHADES_PER_LAYER;
        const layer = Math.floor(i / SHADES_PER_LAYER);
        if (layer === row) return colors[other * SHADES_PER_LAYER + shade];
        if (layer === other) return colors[row * SHADES_PER_LAYER + shade];
        return color;
      })
    );
  };

  const changeHexText = (text: string) => {
    setHexText(text);
    setNotice(null);
  };

  const importCodes = () => {
    if (!parsed.colors) return;
    setColors(mode === SHADES_PER_LAYER ? spread(parsed.colors) : parsed.colors);
    setNotice(`Imported ${mode} colors`);
  };

  // Fills the box and selects it, ready to copy. Deliberately doesn't write to
  // the clipboard itself: that needs permissions some pages don't have.
  const exportCodes = () => {
    setHexText(
      formatHexCodes(mode === SHADES_PER_LAYER ? colors.slice(0, SHADES_PER_LAYER) : colors)
    );
    setNotice(null);
    // After the render that puts the text in the box.
    setTimeout(() => {
      hexBoxRef.current?.focus();
      hexBoxRef.current?.select();
    }, 0);
  };

  const empty = hexText.trim() === "";
  let problem: string | null = null;
  if (!empty) {
    if (parsed.invalid.length > 0) {
      problem = `"${parsed.invalid[0]}" isn't a valid hex code`;
    } else if (parsed.count !== mode) {
      problem = `Found ${parsed.count} hex codes, need ${mode}`;
    }
  }
  const showProblem = !notice && problem !== null;

  // A valid box says nothing: the Import button being enabled is the signal.
  let status = "";
  if (notice) status = notice;
  else if (empty) status = `Paste ${mode} hex codes and press Import, or press Export.`;
  else if (problem) status = problem;

  const save = () => {
    onSave(name.trim() || "My Palette", colors.map((hex) => hexToRgb(hex)));
  };

  const colorRows = mode === SHADES_PER_LAYER ? (["All"] as const) : LAYERS;
  const shownColors = mode === SHADES_PER_LAYER ? colors.slice(0, SHADES_PER_LAYER) : colors;

  return (
    // The popup doesn't follow its swatch when this scrolls, so close it.
    <div
      className="flex min-h-0 flex-col gap-3 overflow-y-auto"
      onScroll={() => colorisRef.current?.close()}
    >
      <h3 className="font-semibold text-foreground">
        {isNew ? "New palette" : "Edit palette"}
      </h3>

      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={CUSTOM_NAME_MAX_LENGTH}
        autoComplete="off"
        aria-label="Palette name"
        placeholder="Palette name"
        className="w-full rounded-sm border border-outline bg-surface px-2 py-1 text-sm text-foreground"
      />

      <PaletteSwatch colors={previewColors} className="h-10 w-full shrink-0" />

      <div className="flex shrink-0 gap-2" role="group" aria-label="Color mode">
        {COLOR_MODES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeMode(option)}
            aria-pressed={mode === option}
            className={`flex-1 rounded border px-3 py-1 text-sm ${
              mode === option
                ? "border-outline-strong bg-surface-strong text-foreground"
                : "border-outline bg-surface text-foreground-secondary"
            }`}
          >
            {option} colors
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {colorRows.map((row, rowIndex) => (
          <div key={row} className="flex items-center gap-2">
            {mode === CUSTOM_COLOR_COUNT && (
              <div className="flex h-10 shrink-0 flex-col gap-0.5 touch:h-11">
                {([-1, 1] as const).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => moveRow(rowIndex, direction)}
                    disabled={rowIndex + direction < 0 || rowIndex + direction >= LAYERS.length}
                    aria-label={`Move ${row} row ${direction < 0 ? "up" : "down"}`}
                    className="flex w-6 flex-1 items-center justify-center rounded-sm border border-outline bg-surface text-[9px] leading-none text-foreground-secondary disabled:opacity-30"
                  >
                    {direction < 0 ? "▲" : "▼"}
                  </button>
                ))}
              </div>
            )}
            <span className="w-10 shrink-0 text-xs text-foreground-muted">{row}</span>
            <div className="grid flex-1 grid-cols-4 gap-1.5">
              {Array.from({ length: SHADES_PER_LAYER }, (_, shade) => {
                const index = rowIndex * SHADES_PER_LAYER + shade;
                return (
                  // A text input drawn as a swatch: Coloris needs an input to
                  // write to, and the hex text itself is hidden. It listens for
                  // `input` rather than `change` because Coloris sets the value
                  // directly, which React's onChange would ignore.
                  <input
                    key={index}
                    type="text"
                    readOnly
                    value={shownColors[index]}
                    onInput={(event) => {
                      setColor(index, event.currentTarget.value);
                      setRgbFields(event.currentTarget.value);
                    }}
                    // Coloris doesn't reset the R/G/B fields on open (it only
                    // knows about its own value field), so seed them here.
                    onClick={(event) => setRgbFields(event.currentTarget.value)}
                    // Nothing here is meant to be selected. user-select covers most
                    // browsers, but Safari ignores it on inputs, so collapse any
                    // selection that still happens.
                    onSelect={(event) => event.currentTarget.setSelectionRange(0, 0)}
                    // Pointer presses don't focus the input, so no caret or touch
                    // selection handle is placed in it. Coloris opens on click, which
                    // still fires; Enter/Space stand in for that from the keyboard.
                    onMouseDown={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.currentTarget.click();
                      }
                    }}
                    inputMode="none"
                    autoComplete="off"
                    aria-label={`${row} shade ${shade + 1} of ${SHADES_PER_LAYER}`}
                    title={shownColors[index].toUpperCase()}
                    style={{
                      backgroundColor: shownColors[index],
                      color: "transparent",
                      WebkitTextFillColor: "transparent",
                      caretColor: "transparent",
                      userSelect: "none",
                      WebkitUserSelect: "none",
                      WebkitTouchCallout: "none",
                    }}
                    className="gb-color-swatch h-10 w-full cursor-pointer rounded-sm border border-outline p-0 touch:h-11"
                  />
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => reverseRow(rowIndex)}
              aria-label={`Reverse ${row} row`}
              title="Reverse this row"
              className="shrink-0 rounded border border-outline bg-surface px-2 text-sm text-foreground-secondary h-10 touch:h-11"
            >
              ⇄
            </button>
          </div>
        ))}
        <p className="text-xs text-foreground-muted">
          Palettes run lightest to darkest. 4 color mode applies one palette to the whole game. 12 color mode applies a different
          palette to each layer. BG is typically used for the background, level geometry, and UI.
          OBJ0 contains most sprites, with OBJ1 being used for secondary sprites.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-foreground-muted">
        {mode === SHADES_PER_LAYER
          ? "Import or export hex codes (4 colors)"
          : "Import or export hex codes (4 BG, 4 OBJ0, 4 OBJ1)"}
        <textarea
          ref={hexBoxRef}
          value={hexText}
          onChange={(event) => changeHexText(event.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            mode === SHADES_PER_LAYER
              ? "#FFFFFF #AAAAAA #555555 #000000"
              : "#FFFFFF #AAAAAA #555555 #000000\n#FFFFFF #AAAAAA #555555 #000000\n#FFFFFF #AAAAAA #555555 #000000"
          }
          aria-invalid={showProblem}
          className="w-full resize-none rounded-sm border border-outline bg-surface px-2 py-1 font-mono text-xs text-foreground placeholder:text-foreground-muted/60"
        />
      </label>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={importCodes}
          disabled={!parsed.colors}
          className={`${SECONDARY_BUTTON_CLASS} disabled:opacity-50`}
        >
          Import
        </button>
        <button type="button" onClick={exportCodes} className={SECONDARY_BUTTON_CLASS}>
          Export
        </button>
      </div>
      <p
        role="status"
        className={`min-h-4 text-xs ${showProblem ? "text-red-400" : "text-foreground-muted"}`}
      >
        {status}
      </p>

      <div className="flex shrink-0 items-center gap-2">
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete "${name.trim() || initialName}"?`)) onDelete();
            }}
            className={`${SECONDARY_BUTTON_CLASS} mr-auto text-red-400`}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className={`${SECONDARY_BUTTON_CLASS} ${onDelete ? "" : "ml-auto"}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className={`${BUTTON_CLASS} border-outline-strong bg-surface-strong text-foreground`}
        >
          Save
        </button>
      </div>
    </div>
  );
}

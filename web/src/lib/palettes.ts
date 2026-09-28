import { CUSTOM_KEY_PREFIX, type CustomPalette } from "@/lib/customPalettes";
import type { Rgb } from "@/lib/gameBoyColorPalettes";

export type Palette = readonly Rgb[];
// "preset" is the built-in list; "custom" is the user's own saved palettes
// (see customPalettes.ts), which aren't in PALETTE_LIST.
export type PaletteGroup = "hardware" | "sgb" | "boot" | "preset" | "custom";

// Headers within the Preset section.
export type PresetSubgroup = "monochrome" | "duotone" | "twelve";

export interface PaletteEntry {
  key: string;
  label: string;
  group: PaletteGroup;
  subgroup?: PresetSubgroup; // set on every preset, and only on presets
  colors: Palette;
}

// Sections in the order the picker shows them.
export const PALETTE_GROUPS: readonly PaletteGroup[] = ["hardware", "boot", "sgb", "preset", "custom"];

export const PALETTE_GROUP_LABELS: Record<PaletteGroup, string> = {
  hardware: "Hardware",
  sgb: "SGB",
  boot: "GBC",
  preset: "Presets",
  custom: "Custom",
};

export const PRESET_SUBGROUP_LABELS: Record<PresetSubgroup, string> = {
  monochrome: "Monochrome",
  duotone: "Duotone",
  twelve: "12 Color",
};

// Neither "Auto" option is in PALETTE_LIST: each resolves to the running
// game's palette when it has one (see findGameBoyColorPalette and
// findSuperGameBoyPalette), otherwise to the fallback. Both are shown in the
// hardware section.
export const AUTO_PALETTE = "auto";
export const AUTO_PALETTE_LABEL = "Auto (GBC)";
export const AUTO_PALETTE_GROUP: PaletteGroup = "hardware";
export const AUTO_PALETTE_SGB = "auto-sgb";
export const AUTO_PALETTE_SGB_LABEL = "Auto (SGB)";
export const DEFAULT_PALETTE = AUTO_PALETTE;
export const FALLBACK_PALETTE = "grayscale";
// The SGB BIOS's own default when a game isn't in its palette table.
export const FALLBACK_PALETTE_SGB = "sgb-1-a";

const COLORS_PER_LAYER = 4;

// A palette is 4 colors (shade 0-3, 0 = lightest) used for everything, or 12
// colors: 4 for the background/window, then 4 for OBJ0 sprites, then 4 for
// OBJ1 sprites, like the Game Boy Color. Ppu::framebuffer() bits 2-3 say
// which layer a pixel belongs to (kLayerBackground/kLayerObj0/kLayerObj1).
export function paletteColor(palette: Palette, layer: number, shade: number): Rgb {
  const offset = palette.length > COLORS_PER_LAYER ? layer * COLORS_PER_LAYER : 0;
  return palette[offset + shade];
}

// Shade index (0 = lightest) -> RGB, as produced by Ppu::framebuffer().
// Grouped, in the order the picker lists them.
export const PALETTE_LIST: readonly PaletteEntry[] = [
  {
    key: "grayscale",
    label: "Grayscale",
    group: "hardware",
    colors: [
      [255, 255, 255],
      [170, 170, 170],
      [85, 85, 85],
      [0, 0, 0],
    ],
  },
  {
    key: "inverted",
    label: "Inverted",
    group: "hardware",
    colors: [
      [0, 0, 0],
      [85, 85, 85],
      [170, 170, 170],
      [255, 255, 255],
    ],
  },
  {
    key: "dmg",
    label: "DMG",
    group: "hardware",
    colors: [
      [155, 188, 15],
      [139, 172, 15],
      [48, 98, 48],
      [15, 56, 15],
    ],
  },
  {
    key: "light",
    label: "GB Light",
    group: "hardware",
    colors: [
      [29, 222, 206],
      [25, 199, 179],
      [22, 165, 150],
      [11, 122, 109],
    ],
  },
  {
    key: "pocket",
    label: "GB Pocket",
    group: "hardware",
    colors: [
      [196, 207, 161],
      [139, 149, 109],
      [77, 83, 60],
      [31, 31, 31],
    ],
  },
  {
    key: "virtual-boy",
    label: "Virtual Boy",
    group: "hardware",
    colors: [
      [239, 0, 0],
      [164, 0, 0],
      [85, 0, 0],
      [0, 0, 0],
    ],
  },
  {
    key: "sgb-1-a",
    label: "1-A",
    group: "sgb",
    colors: [
      [248, 232, 200],
      [216, 144, 72],
      [168, 40, 32],
      [48, 24, 80],
    ],
  },
  {
    key: "sgb-1-b",
    label: "1-B",
    group: "sgb",
    colors: [
      [216, 216, 192],
      [200, 176, 112],
      [176, 80, 16],
      [0, 0, 0],
    ],
  },
  {
    key: "sgb-1-c",
    label: "1-C",
    group: "sgb",
    colors: [
      [248, 192, 248],
      [232, 152, 80],
      [152, 56, 96],
      [56, 56, 152],
    ],
  },
  {
    key: "sgb-1-d",
    label: "1-D",
    group: "sgb",
    colors: [
      [248, 248, 168],
      [192, 128, 72],
      [248, 0, 0],
      [80, 24, 0],
    ],
  },
  {
    key: "sgb-1-e",
    label: "1-E",
    group: "sgb",
    colors: [
      [248, 216, 176],
      [120, 192, 120],
      [104, 136, 64],
      [88, 56, 32],
    ],
  },
  {
    key: "sgb-1-f",
    label: "1-F",
    group: "sgb",
    colors: [
      [216, 232, 248],
      [224, 136, 80],
      [168, 0, 0],
      [0, 64, 16],
    ],
  },
  {
    key: "sgb-1-g",
    label: "1-G",
    group: "sgb",
    colors: [
      [0, 0, 80],
      [0, 160, 232],
      [120, 120, 0],
      [248, 248, 88],
    ],
  },
  {
    key: "sgb-1-h",
    label: "1-H",
    group: "sgb",
    colors: [
      [248, 232, 224],
      [248, 184, 136],
      [128, 64, 0],
      [48, 24, 0],
    ],
  },
  {
    key: "sgb-2-a",
    label: "2-A",
    group: "sgb",
    colors: [
      [240, 200, 160],
      [192, 136, 72],
      [40, 120, 0],
      [0, 0, 0],
    ],
  },
  {
    key: "sgb-2-b",
    label: "2-B",
    group: "sgb",
    colors: [
      [248, 248, 248],
      [248, 232, 80],
      [248, 48, 0],
      [80, 0, 88],
    ],
  },
  {
    key: "sgb-2-c",
    label: "2-C",
    group: "sgb",
    colors: [
      [248, 192, 248],
      [232, 136, 136],
      [120, 48, 232],
      [40, 40, 152],
    ],
  },
  {
    key: "sgb-2-d",
    label: "2-D",
    group: "sgb",
    colors: [
      [248, 248, 160],
      [0, 248, 0],
      [248, 48, 0],
      [0, 0, 80],
    ],
  },
  {
    key: "sgb-2-e",
    label: "2-E",
    group: "sgb",
    colors: [
      [248, 200, 128],
      [144, 176, 224],
      [40, 16, 96],
      [16, 8, 16],
    ],
  },
  {
    key: "sgb-2-f",
    label: "2-F",
    group: "sgb",
    colors: [
      [208, 248, 248],
      [248, 144, 80],
      [160, 0, 0],
      [24, 0, 0],
    ],
  },
  {
    key: "sgb-2-g",
    label: "2-G",
    group: "sgb",
    colors: [
      [104, 184, 56],
      [224, 80, 64],
      [224, 184, 128],
      [0, 24, 0],
    ],
  },
  {
    key: "sgb-2-h",
    label: "2-H",
    group: "sgb",
    colors: [
      [248, 248, 248],
      [184, 184, 184],
      [112, 112, 112],
      [0, 0, 0],
    ],
  },
  {
    key: "sgb-3-a",
    label: "3-A",
    group: "sgb",
    colors: [
      [248, 248, 248],
      [184, 184, 184],
      [112, 112, 112],
      [0, 0, 0],
    ],
  },
  {
    key: "sgb-3-b",
    label: "3-B",
    group: "sgb",
    colors: [
      [216, 216, 192],
      [224, 128, 32],
      [0, 80, 0],
      [0, 16, 16],
    ],
  },
  {
    key: "sgb-3-c",
    label: "3-C",
    group: "sgb",
    colors: [
      [224, 168, 200],
      [248, 248, 120],
      [0, 184, 248],
      [32, 32, 88],
    ],
  },
  {
    key: "sgb-3-d",
    label: "3-D",
    group: "sgb",
    colors: [
      [240, 248, 184],
      [224, 168, 120],
      [8, 200, 0],
      [0, 0, 0],
    ],
  },
  {
    key: "sgb-3-e",
    label: "3-E",
    group: "sgb",
    colors: [
      [248, 248, 192],
      [224, 176, 104],
      [176, 120, 32],
      [80, 72, 112],
    ],
  },
  {
    key: "sgb-3-f",
    label: "3-F",
    group: "sgb",
    colors: [
      [120, 120, 200],
      [248, 104, 248],
      [248, 208, 0],
      [64, 64, 64],
    ],
  },
  {
    key: "sgb-3-g",
    label: "3-G",
    group: "sgb",
    colors: [
      [248, 248, 248],
      [96, 216, 80],
      [200, 48, 56],
      [56, 0, 0],
    ],
  },
  {
    key: "sgb-3-h",
    label: "3-H",
    group: "sgb",
    colors: [
      [224, 248, 160],
      [120, 200, 56],
      [72, 136, 24],
      [8, 24, 0],
    ],
  },
  {
    key: "sgb-4-a",
    label: "4-A",
    group: "sgb",
    colors: [
      [240, 168, 104],
      [120, 168, 248],
      [208, 0, 208],
      [0, 0, 120],
    ],
  },
  {
    key: "sgb-4-b",
    label: "4-B",
    group: "sgb",
    colors: [
      [240, 232, 240],
      [232, 160, 96],
      [64, 120, 56],
      [24, 8, 8],
    ],
  },
  {
    key: "sgb-4-c",
    label: "4-C",
    group: "sgb",
    colors: [
      [248, 224, 224],
      [216, 160, 208],
      [152, 160, 224],
      [8, 0, 0],
    ],
  },
  {
    key: "sgb-4-d",
    label: "4-D",
    group: "sgb",
    colors: [
      [248, 248, 184],
      [144, 200, 200],
      [72, 104, 120],
      [8, 32, 72],
    ],
  },
  {
    key: "sgb-4-e",
    label: "4-E",
    group: "sgb",
    colors: [
      [248, 216, 168],
      [224, 168, 120],
      [120, 88, 136],
      [0, 32, 48],
    ],
  },
  {
    key: "sgb-4-f",
    label: "4-F",
    group: "sgb",
    colors: [
      [184, 208, 208],
      [216, 128, 216],
      [128, 0, 160],
      [56, 0, 0],
    ],
  },
  {
    key: "sgb-4-g",
    label: "4-G",
    group: "sgb",
    colors: [
      [176, 224, 24],
      [184, 32, 88],
      [40, 16, 0],
      [0, 128, 96],
    ],
  },
  {
    key: "sgb-4-h",
    label: "4-H",
    group: "sgb",
    colors: [
      [248, 248, 200],
      [184, 192, 88],
      [128, 136, 64],
      [64, 80, 40],
    ],
  },
  {
    key: "splash-down",
    label: "Down",
    group: "boot",
    colors: [
      [255, 255, 165], [255, 148, 148], [148, 148, 255], [0, 0, 0], // BG
      [255, 255, 165], [255, 148, 148], [148, 148, 255], [0, 0, 0], // OBJ0
      [255, 255, 165], [255, 148, 148], [148, 148, 255], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-down-a",
    label: "Down + A",
    group: "boot",
    colors: [
      [255, 255, 255], [255, 255, 0], [255, 0, 0], [0, 0, 0], // BG
      [255, 255, 255], [255, 255, 0], [255, 0, 0], [0, 0, 0], // OBJ0
      [255, 255, 255], [255, 255, 0], [255, 0, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-down-b",
    label: "Down + B",
    group: "boot",
    colors: [
      [255, 255, 255], [255, 255, 0], [123, 74, 0], [0, 0, 0], // BG
      [255, 255, 255], [99, 165, 255], [0, 0, 255], [0, 0, 0], // OBJ0
      [255, 255, 255], [123, 255, 49], [0, 132, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-left",
    label: "Left",
    group: "boot",
    colors: [
      [255, 255, 255], [99, 165, 255], [0, 0, 255], [0, 0, 0], // BG
      [255, 255, 255], [255, 132, 132], [148, 58, 58], [0, 0, 0], // OBJ0
      [255, 255, 255], [123, 255, 49], [0, 132, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-left-a",
    label: "Left + A",
    group: "boot",
    colors: [
      [255, 255, 255], [140, 140, 222], [82, 82, 140], [0, 0, 0], // BG
      [255, 255, 255], [255, 132, 132], [148, 58, 58], [0, 0, 0], // OBJ0
      [255, 255, 255], [255, 173, 99], [132, 49, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-left-b",
    label: "Left + B",
    group: "boot",
    colors: [
      [255, 255, 255], [165, 165, 165], [82, 82, 82], [0, 0, 0], // BG
      [255, 255, 255], [165, 165, 165], [82, 82, 82], [0, 0, 0], // OBJ0
      [255, 255, 255], [165, 165, 165], [82, 82, 82], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-right",
    label: "Right",
    group: "boot",
    colors: [
      [255, 255, 255], [82, 255, 0], [255, 66, 0], [0, 0, 0], // BG
      [255, 255, 255], [82, 255, 0], [255, 66, 0], [0, 0, 0], // OBJ0
      [255, 255, 255], [82, 255, 0], [255, 66, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-right-a",
    label: "Right + A",
    group: "boot",
    colors: [
      [255, 255, 255], [123, 255, 49], [0, 99, 197], [0, 0, 0], // BG
      [255, 255, 255], [255, 132, 132], [148, 58, 58], [0, 0, 0], // OBJ0
      [255, 255, 255], [255, 132, 132], [148, 58, 58], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-right-b",
    label: "Right + B",
    group: "boot",
    colors: [
      [0, 0, 0], [0, 132, 132], [255, 222, 0], [255, 255, 255], // BG
      [0, 0, 0], [0, 132, 132], [255, 222, 0], [255, 255, 255], // OBJ0
      [0, 0, 0], [0, 132, 132], [255, 222, 0], [255, 255, 255], // OBJ1
    ],
  },
  {
    key: "splash-up",
    label: "Up",
    group: "boot",
    colors: [
      [255, 255, 255], [255, 173, 99], [132, 49, 0], [0, 0, 0], // BG
      [255, 255, 255], [255, 173, 99], [132, 49, 0], [0, 0, 0], // OBJ0
      [255, 255, 255], [255, 173, 99], [132, 49, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-up-a",
    label: "Up + A",
    group: "boot",
    colors: [
      [255, 255, 255], [255, 132, 132], [148, 58, 58], [0, 0, 0], // BG
      [255, 255, 255], [123, 255, 49], [0, 132, 0], [0, 0, 0], // OBJ0
      [255, 255, 255], [99, 165, 255], [0, 0, 255], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "splash-up-b",
    label: "Up + B",
    group: "boot",
    colors: [
      [255, 230, 197], [206, 156, 132], [132, 107, 41], [90, 49, 8], // BG
      [255, 255, 255], [255, 173, 99], [132, 49, 0], [0, 0, 0], // OBJ0
      [255, 255, 255], [255, 173, 99], [132, 49, 0], [0, 0, 0], // OBJ1
    ],
  },
  {
    key: "neo-dmg",
    label: "Neo DMG",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [218, 251, 221],
      [159, 204, 150],
      [71, 137, 122],
      [13, 64, 73],
    ],
  },
  {
    key: "neo-light",
    label: "Neo Light",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [159, 244, 229],
      [0, 185, 190],
      [0, 95, 140],
      [0, 43, 89],
    ],
  },
  {
    key: "red",
    label: "Red",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [253, 238, 238],
      [232, 180, 180],
      [185, 101, 101],
      [92, 38, 38],
    ],
  },
  {
    key: "blue",
    label: "Blue",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [237, 243, 250],
      [175, 201, 224],
      [95, 132, 172],
      [38, 65, 92],
    ],
  },
  {
    key: "green",
    label: "Green",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [238, 253, 238],
      [180, 232, 180],
      [101, 185, 101],
      [38, 92, 38],
    ],
  },
  {
    key: "orange",
    label: "Orange",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [253, 232, 210],
      [240, 175, 110],
      [200, 120, 60],
      [110, 60, 25],
    ],
  },
  {
    key: "purple",
    label: "Purple",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [247, 238, 253],
      [208, 180, 232],
      [143, 101, 185],
      [62, 38, 92],
    ],
  },
  {
    key: "yellow",
    label: "Yellow",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [253, 251, 230],
      [230, 220, 150],
      [185, 170, 80],
      [92, 85, 35],
    ],
  },
  {
    key: "pink",
    label: "Pink",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [253, 238, 245],
      [235, 170, 195],
      [185, 90, 130],
      [92, 35, 60],
    ],
  },
  {
    key: "brown",
    label: "Brown",
    group: "preset",
    subgroup: "monochrome",
    colors: [
      [245, 230, 210],
      [210, 175, 140],
      [150, 110, 75],
      [75, 50, 30],
    ],
  },
  {
    key: "tundra",
    label: "Tundra",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [205, 245, 240],
      [120, 180, 175],
      [150, 100, 60],
      [70, 35, 15],
    ],
  },
  {
    key: "coral-reef",
    label: "Coral Reef",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [255, 235, 205],
      [250, 140, 110],
      [40, 120, 130],
      [10, 40, 55],
    ],
  },
  {
    key: "neon",
    label: "Neon",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [255, 214, 240],
      [255, 110, 190],
      [40, 130, 180],
      [10, 20, 60],
    ],
  },
  {
    key: "lightning",
    label: "Lightning",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [253, 255, 148],
      [9, 185, 224],
      [14, 85, 171],
      [19, 27, 94],
    ],
  },
  {
    key: "citrus",
    label: "Citrus",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [245, 245, 211],
      [218, 224, 102],
      [245, 159, 54],
      [48, 102, 27],
    ],
  },
  {
    key: "cherry",
    label: "Cherry",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [252, 222, 234],
      [253, 123, 142],
      [53, 120, 48],
      [1, 40, 36],
    ],
  },
  {
    key: "cotton-candy",
    label: "Cotton Candy",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [250, 225, 222],
      [255, 166, 158],
      [115, 132, 213],
      [44, 32, 91],
    ],
  },
  {
    key: "carbon",
    label: "Carbon",
    group: "preset",
    subgroup: "duotone",
    colors: [
      [224, 207, 196],
      [219, 150, 60],
      [158, 97, 40],
      [71, 71, 71],
    ],
  },
  {
    key: "sunset-arcade",
    label: "Sunset Arcade",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [255, 236, 214], [247, 160, 114], [125, 60, 110], [38, 18, 58], // BG
      [235, 255, 255], [110, 225, 235], [30, 120, 170], [10, 25, 60], // OBJ0
      [255, 255, 220], [255, 225, 90], [210, 110, 30], [60, 20, 20], // OBJ1
    ],
  },
  {
    key: "moonlit-forest",
    label: "Moonlit Forest",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [214, 235, 210], [120, 175, 140], [40, 95, 95], [10, 30, 45], // BG
      [255, 245, 214], [255, 200, 90], [200, 95, 40], [50, 20, 20], // OBJ0
      [240, 235, 255], [185, 170, 235], [105, 90, 170], [30, 25, 60], // OBJ1
    ],
  },
  {
    key: "ember-and-ice",
    label: "Ember & Ice",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [235, 225, 215], [170, 140, 125], [90, 60, 60], [25, 15, 20], // BG
      [255, 240, 180], [255, 170, 40], [215, 60, 20], [70, 10, 10], // OBJ0
      [225, 245, 255], [130, 200, 245], [50, 110, 200], [15, 30, 80], // OBJ1
    ],
  },
  {
    key: "stardust-speedway",
    label: "Stardust Speedway",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [255, 215, 255], [190, 120, 230], [80, 50, 140], [15, 10, 45], // BG
      [255, 250, 200], [240, 215, 90], [170, 130, 40], [50, 35, 15], // OBJ0
      [220, 255, 255], [80, 240, 230], [20, 140, 170], [5, 30, 60], // OBJ1
    ],
  },
  {
    key: "ocean-depths",
    label: "Ocean Depths",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [200, 235, 245], [90, 170, 205], [30, 85, 140], [8, 20, 55], // BG
      [255, 240, 225], [255, 150, 120], [200, 60, 70], [60, 15, 35], // OBJ0
      [255, 250, 200], [240, 215, 90], [170, 130, 40], [50, 35, 15], // OBJ1
    ],
  },
  {
    key: "paper-and-ink",
    label: "Paper & Ink",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [244, 236, 214], [201, 184, 140], [120, 98, 70], [42, 32, 26], // BG
      [244, 236, 214], [214, 120, 100], [150, 40, 40], [50, 10, 15], // OBJ0
      [244, 236, 214], [110, 140, 190], [40, 70, 130], [15, 25, 55], // OBJ1
    ],
  },
  {
    key: "golden-hour",
    label: "Golden Hour",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [255, 240, 214], [240, 165, 90], [50, 90, 110], [15, 30, 45], // BG
      [255, 248, 214], [255, 205, 70], [75, 65, 150], [22, 15, 60], // OBJ0
      [255, 232, 225], [255, 125, 105], [110, 45, 110], [45, 12, 50], // OBJ1
    ],
  },
  {
    key: "dragonfruit",
    label: "Dragonfruit",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [255, 232, 240], [240, 140, 180], [25, 85, 60], [8, 32, 24], // BG
      [250, 255, 200], [190, 230, 80], [50, 50, 140], [15, 15, 60], // OBJ0
      [215, 245, 255], [100, 200, 240], [140, 30, 60], [50, 8, 25], // OBJ1
    ],
  },
  {
    key: "lagoon-glow",
    label: "Lagoon Glow",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [222, 245, 228], [120, 200, 160], [35, 80, 110], [10, 25, 50], // BG
      [255, 238, 220], [255, 150, 90], [150, 40, 90], [55, 10, 45], // OBJ0
      [255, 238, 220], [255, 150, 90], [150, 40, 90], [55, 10, 45], // OBJ1
    ],
  },
  {
    key: "blossom",
    label: "Blossom",
    group: "preset",
    subgroup: "twelve",
    colors: [
      [255, 241, 240], [255, 166, 158], [255, 104, 107], [96, 38, 53], // BG
      [242, 255, 232], [139, 243, 168], [31, 138, 91], [18, 71, 45], // OBJ0
      [250, 248, 255], [232, 199, 230], [142, 123, 184], [53, 40, 85], // OBJ1
    ],
  },
];

const PALETTES_BY_KEY = new Map(PALETTE_LIST.map((entry) => [entry.key, entry]));

export function findPalette(key: string): PaletteEntry | undefined {
  return PALETTES_BY_KEY.get(key);
}

// The colors to draw with for a picker selection: each Auto option uses the
// running game's palette when it has one (autoPalette/autoPaletteSgb),
// custom keys look in the user's saved palettes, everything else is a
// built-in, and anything unknown (e.g. a custom palette that was just
// deleted) falls back to grayscale. Auto (SGB) instead falls back to 1-A,
// the SGB BIOS's own default for unrecognized games.
export function resolvePalette(
  key: string,
  autoPalette: Palette | null,
  autoPaletteSgb: Palette | null,
  customPalettes: readonly CustomPalette[]
): Palette {
  const fallback = PALETTES_BY_KEY.get(FALLBACK_PALETTE)?.colors ?? PALETTE_LIST[0].colors;
  if (key === AUTO_PALETTE) return autoPalette ?? fallback;
  if (key === AUTO_PALETTE_SGB) {
    return autoPaletteSgb ?? PALETTES_BY_KEY.get(FALLBACK_PALETTE_SGB)?.colors ?? fallback;
  }
  if (key.startsWith(CUSTOM_KEY_PREFIX)) {
    const id = key.slice(CUSTOM_KEY_PREFIX.length);
    return customPalettes.find((palette) => palette.id === id)?.colors ?? fallback;
  }
  return PALETTES_BY_KEY.get(key)?.colors ?? fallback;
}

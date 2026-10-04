import { findPalette, type Palette } from "@/lib/palettes";

interface SgbPaletteEntry {
  internalName: string; // ROM header title (bytes 0x134-0x143), trimmed
  game: string; // for reference
  key: string;
}

const ENTRIES: SgbPaletteEntry[] = [
  { internalName: "ZELDA", game: "The Legend of Zelda: Link's Awakening", key: "sgb-1-e" },
  { internalName: "SUPER MARIOLAND", game: "Super Mario Land", key: "sgb-1-f" },
  { internalName: "MARIOLAND2", game: "Super Mario Land 2: 6 Golden Coins", key: "sgb-3-d" },
  { internalName: "SUPERMARIOLAND3", game: "Wario Land: Super Mario Land 3", key: "sgb-1-b" },
  { internalName: "KIRBY DREAM LAND", game: "Kirby's Dream Land", key: "sgb-2-c" },
  { internalName: "HOSHINOKA-BI", game: "Hoshi no Kirby", key: "sgb-2-c" },
  { internalName: "KIRBY'S PINBALL", game: "Kirby's Pinball Land", key: "sgb-1-c" },
  { internalName: "YOSSY NO TAMAGO", game: "Yossy no Tamago", key: "sgb-2-d" },
  { internalName: "MARIO & YOSHI", game: "Mario & Yoshi", key: "sgb-2-d" },
  { internalName: "YOSSY NO COOKIE", game: "Yossy no Cookie", key: "sgb-1-d" },
  { internalName: "YOSHI'S COOKIE", game: "Yoshi's Cookie", key: "sgb-1-d" },
  { internalName: "DR.MARIO", game: "Dr. Mario", key: "sgb-3-b" },
  { internalName: "TETRIS", game: "Tetris", key: "sgb-3-a" },
  { internalName: "YAKUMAN", game: "Yakuman", key: "sgb-3-c" },
  { internalName: "METROID2", game: "Metroid II: Return of Samus", key: "sgb-4-g" },
  { internalName: "KAERUNOTAMENI", game: "Kaeru no Tame ni Kane wa Naru", key: "sgb-2-a" },
  { internalName: "GOLF", game: "Golf", key: "sgb-3-h" },
  { internalName: "ALLEY WAY", game: "Alleyway", key: "sgb-3-f" },
  { internalName: "BASEBALL", game: "Baseball", key: "sgb-2-g" },
  { internalName: "TENNIS", game: "Tennis", key: "sgb-3-g" },
  { internalName: "F1RACE", game: "F-1 Race", key: "sgb-4-f" },
  { internalName: "KID ICARUS", game: "Kid Icarus: Of Myths and Monsters", key: "sgb-2-f" },
  { internalName: "BALLOON KID", game: "Balloon Kid", key: "sgb-1-a" },
  { internalName: "QIX", game: "Qix", key: "sgb-4-a" },
  { internalName: "SOLARSTRIKER", game: "SolarStriker", key: "sgb-1-g" },
  { internalName: "X", game: "X", key: "sgb-4-d" },
  { internalName: "GBWARS", game: "Game Boy Wars", key: "sgb-3-e" },
];

// Header says the game can run on a Super Game Boy (byte 0x146 == 0x03 and
// old licensee code 0x14B == 0x33); the same check the core uses to let it
// send colors.
export function supportsSuperGameBoy(rom: Uint8Array): boolean {
  return rom.length > 0x14b && rom[0x146] === 0x03 && rom[0x14b] === 0x33;
}

function readTitle(rom: Uint8Array): string {
  let title = "";
  for (let i = 0x134; i <= 0x143 && i < rom.length; i++) {
    const byte = rom[i];
    if (byte < 0x20 || byte > 0x7e) break; // stop at the null/padding byte
    title += String.fromCharCode(byte);
  }
  return title.trim();
}

// Mirrors the SGB BIOS's palette table: a fixed set of Nintendo-published
// DMG titles get a specific default palette when run through a Super Game
// Boy. Returns null when the ROM isn't one of those titles (the BIOS would
// then leave the console's currently selected palette in place).
export function findSuperGameBoyPalette(rom: Uint8Array): Palette | null {
  if (rom.length < 0x150) return null;
  const title = readTitle(rom);
  const match = ENTRIES.find((entry) => entry.internalName === title);
  return match ? findPalette(match.key)?.colors ?? null : null;
}

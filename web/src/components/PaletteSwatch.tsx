import { paletteColor, type Palette } from "@/lib/palettes";

// The palette's 12 colors as three strips (BG / OBJ0 / OBJ1) of four shades.
// A 4-color palette repeats the same strip, which is accurate: every layer
// uses it.
//
// `rainbow` shows a gradient instead, for a palette that isn't one fixed set
// of colors (a Super Game Boy game picking its own per tile).
export function PaletteSwatch({
  colors,
  className,
  rainbow = false,
}: {
  colors: Palette;
  className: string;
  rainbow?: boolean;
}) {
  if (rainbow) {
    return (
      <span
        aria-hidden
        className={`rounded-[2px] border border-outline ${className}`}
        style={{
          backgroundImage:
            "linear-gradient(to right, #e5484d, #f5a524, #f2d94e, #3fb950, #2f81f7, #8957e5)",
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex flex-col overflow-hidden rounded-[2px] border border-outline ${className}`}
    >
      {[0, 1, 2].map((layer) => (
        <span key={layer} className="flex flex-1">
          {[0, 1, 2, 3].map((shade) => {
            const [r, g, b] = paletteColor(colors, layer, shade);
            return (
              <span
                key={shade}
                className="flex-1"
                style={{ backgroundColor: `rgb(${r} ${g} ${b})` }}
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}

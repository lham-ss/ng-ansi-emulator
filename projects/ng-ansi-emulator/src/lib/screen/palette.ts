/**
 * VGA 16-color palette as packed 0xRRGGBB integers.
 *
 * Index layout follows the IBM CGA/EGA/VGA standard, which is also what ANSI
 * SGR codes 30-37 (foreground) and 40-47 (background) map onto, with the
 * "bold" attribute (SGR 1) selecting the high-intensity row 8-15 for
 * foregrounds.
 *
 * iCE-color mode reinterprets the blink bit as a high-intensity background
 * selector, giving access to the full 16x16 color matrix at the cost of
 * losing blinking text. This is how nearly all BBS ANSI art was authored.
 */
export const VGA_PALETTE: readonly number[] = Object.freeze([
  0x000000, // 0  black
  0x0000aa, // 1  blue
  0x00aa00, // 2  green
  0x00aaaa, // 3  cyan
  0xaa0000, // 4  red
  0xaa00aa, // 5  magenta
  0xaa5500, // 6  brown / dark yellow
  0xaaaaaa, // 7  light gray
  0x555555, // 8  dark gray
  0x5555ff, // 9  light blue
  0x55ff55, // 10 light green
  0x55ffff, // 11 light cyan
  0xff5555, // 12 light red
  0xff55ff, // 13 light magenta
  0xffff55, // 14 yellow
  0xffffff, // 15 white
]);

/** Decompose a packed RGB integer into its r/g/b channels. */
export function rgbOf(packed: number): { r: number; g: number; b: number } {
  return {
    r: (packed >>> 16) & 0xff,
    g: (packed >>> 8) & 0xff,
    b: packed & 0xff,
  };
}

/** Format a palette entry as a CSS hex string (used for Canvas2D fillStyle). */
export function cssHex(packed: number): string {
  return '#' + packed.toString(16).padStart(6, '0');
}

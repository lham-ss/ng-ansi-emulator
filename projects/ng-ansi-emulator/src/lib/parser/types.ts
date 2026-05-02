/**
 * Shared types for the ANSI parser.
 *
 * The parser is intentionally byte-oriented: ANSI art uses CP437, which is
 * an 8-bit codepage where bytes 128-255 are box-drawing/block glyphs that
 * are NOT the same as Latin-1. We never decode through a UTF-8 lens.
 */

/** Parser internal states for the CSI state machine. */
export const enum ParserState {
  Ground = 0,
  Escape = 1,
  CsiParam = 2,
  CsiIntermediate = 3,
}

/** Maximum number of CSI parameters per sequence (more than any real seq). */
export const MAX_PARAMS = 16;

/** A control byte we recognize directly in the Ground state. */
export const C0 = {
  NUL: 0x00,
  BEL: 0x07,
  BS: 0x08,
  HT: 0x09,
  LF: 0x0a,
  VT: 0x0b,
  FF: 0x0c,
  CR: 0x0d,
  SUB: 0x1a, // Ctrl-Z, marks end of file in DOS/BBS ANSI
  ESC: 0x1b,
} as const;

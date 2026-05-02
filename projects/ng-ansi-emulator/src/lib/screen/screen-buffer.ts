/**
 * Screen buffer modeling an 80x25 (or SAUCE-defined) text mode display.
 *
 * Each cell stores: a CP437 codepoint (0-255), a foreground palette index
 * (0-15), a background palette index (0-15 in iCE mode, 0-7 + blink bit
 * otherwise), and a bitmask of attributes. The cursor and active SGR state
 * are tracked separately.
 *
 * The buffer is intentionally framework-agnostic — the player/component
 * layers above can render it however they like.
 */

export const ATTR_BOLD = 1 << 0;
/** In legacy mode this is "blink"; in iCE-color mode it selects bg 8-15. */
export const ATTR_BLINK_OR_HIGH_BG = 1 << 1;
export const ATTR_REVERSE = 1 << 2;
export const ATTR_CONCEAL = 1 << 3;

export interface ScreenCell {
  /** CP437 codepoint (0-255). */
  ch: number;
  /** Foreground palette index (0-15 after bold expansion). */
  fg: number;
  /** Background palette index (0-7 legacy, 0-15 iCE). */
  bg: number;
  /** Bitmask of ATTR_* flags. */
  attr: number;
}

export interface CursorState {
  x: number;
  y: number;
  /** Saved (SCP/RCP — ESC [s / ESC [u). */
  savedX: number;
  savedY: number;
  /** Active SGR foreground index (0-7). */
  fg: number;
  /** Active SGR background index (0-7). */
  bg: number;
  /** Active attribute mask. */
  attr: number;
}

/** Default cell: space, light gray on black, no attrs. */
export function blankCell(): ScreenCell {
  return { ch: 0x20, fg: 7, bg: 0, attr: 0 };
}

export class ScreenBuffer {
  readonly cols: number;
  readonly rows: number;
  /** Row-major, length = cols * rows. */
  readonly cells: ScreenCell[];
  readonly cursor: CursorState;
  /** Marks rows that changed since the last frame, for efficient repaint. */
  readonly dirtyRows: Set<number> = new Set();
  /** True if the buffer just scrolled — renderer should repaint everything. */
  fullDirty = false;
  /** iCE-color mode disables blinking and unlocks bg colors 8-15. */
  iceColors = true;

  constructor(cols = 80, rows = 25) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Array(cols * rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = blankCell();
    this.cursor = {
      x: 0,
      y: 0,
      savedX: 0,
      savedY: 0,
      fg: 7,
      bg: 0,
      attr: 0,
    };
    this.fullDirty = true;
  }

  /**
   * Clear and reset everything. Used on play/restart.
   */
  reset(): void {
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i]!;
      c.ch = 0x20;
      c.fg = 7;
      c.bg = 0;
      c.attr = 0;
    }
    this.cursor.x = 0;
    this.cursor.y = 0;
    this.cursor.savedX = 0;
    this.cursor.savedY = 0;
    this.cursor.fg = 7;
    this.cursor.bg = 0;
    this.cursor.attr = 0;
    this.dirtyRows.clear();
    this.fullDirty = true;
  }

  cellAt(x: number, y: number): ScreenCell | undefined {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return undefined;
    return this.cells[y * this.cols + x];
  }

  /**
   * Write a single CP437 codepoint at the cursor and advance.
   * Handles wrap-around and triggers a scroll when needed.
   */
  putChar(ch: number): void {
    if (this.cursor.x >= this.cols) {
      this.cursor.x = 0;
      this.cursor.y += 1;
      if (this.cursor.y >= this.rows) this.scrollUp();
    }
    const cell = this.cells[this.cursor.y * this.cols + this.cursor.x]!;
    cell.ch = ch;
    // Apply current SGR state, expanding the bold attribute into the high
    // intensity foreground row (8-15) which is how DOS rendered it. We only
    // promote when fg is in the low row — Aixterm 90-97 already lands in 8-15
    // and shouldn't double-shift.
    const bold = (this.cursor.attr & ATTR_BOLD) !== 0;
    const reverse = (this.cursor.attr & ATTR_REVERSE) !== 0;
    let fg = this.cursor.fg;
    if (bold && fg < 8) fg += 8;
    let bg = this.cursor.bg;
    if (this.iceColors && (this.cursor.attr & ATTR_BLINK_OR_HIGH_BG) !== 0 && bg < 8) {
      bg += 8;
    }
    if (reverse) {
      const tmp = fg;
      fg = bg;
      bg = tmp;
    }
    cell.fg = fg & 0x0f;
    cell.bg = bg & 0x0f;
    cell.attr = this.cursor.attr;
    this.dirtyRows.add(this.cursor.y);
    this.cursor.x += 1;
  }

  /** Newline: cursor down, possibly scrolling. */
  lineFeed(): void {
    this.cursor.y += 1;
    if (this.cursor.y >= this.rows) this.scrollUp();
  }

  carriageReturn(): void {
    this.cursor.x = 0;
  }

  /** Backspace — non-destructive in classic terminal semantics. */
  backspace(): void {
    if (this.cursor.x > 0) this.cursor.x -= 1;
  }

  /** Tab to next 8-column stop. */
  tab(): void {
    this.cursor.x = Math.min(this.cols - 1, (Math.floor(this.cursor.x / 8) + 1) * 8);
  }

  /** Move cursor to (1-based) row, col, clamping into bounds. */
  moveTo(row: number, col: number): void {
    this.cursor.y = Math.max(0, Math.min(this.rows - 1, row - 1));
    this.cursor.x = Math.max(0, Math.min(this.cols - 1, col - 1));
  }

  moveBy(dx: number, dy: number): void {
    this.cursor.x = Math.max(0, Math.min(this.cols - 1, this.cursor.x + dx));
    this.cursor.y = Math.max(0, Math.min(this.rows - 1, this.cursor.y + dy));
  }

  saveCursor(): void {
    this.cursor.savedX = this.cursor.x;
    this.cursor.savedY = this.cursor.y;
  }

  restoreCursor(): void {
    this.cursor.x = this.cursor.savedX;
    this.cursor.y = this.cursor.savedY;
  }

  /**
   * Erase in display (CSI n J): 0 = cursor→end, 1 = start→cursor, 2 = whole.
   */
  eraseDisplay(mode: 0 | 1 | 2): void {
    let from = 0;
    let to = this.cells.length;
    if (mode === 0) from = this.cursor.y * this.cols + this.cursor.x;
    if (mode === 1) to = this.cursor.y * this.cols + this.cursor.x + 1;
    for (let i = from; i < to; i++) {
      const c = this.cells[i]!;
      c.ch = 0x20;
      c.fg = this.cursor.fg;
      c.bg = this.cursor.bg;
      c.attr = 0;
    }
    this.fullDirty = true;
  }

  /**
   * Erase in line (CSI n K): 0 = cursor→eol, 1 = sol→cursor, 2 = whole line.
   */
  eraseLine(mode: 0 | 1 | 2): void {
    const rowStart = this.cursor.y * this.cols;
    let from = rowStart;
    let to = rowStart + this.cols;
    if (mode === 0) from = rowStart + this.cursor.x;
    if (mode === 1) to = rowStart + this.cursor.x + 1;
    for (let i = from; i < to; i++) {
      const c = this.cells[i]!;
      c.ch = 0x20;
      c.fg = this.cursor.fg;
      c.bg = this.cursor.bg;
      c.attr = 0;
    }
    this.dirtyRows.add(this.cursor.y);
  }

  /** Scroll the buffer up by one row. */
  private scrollUp(): void {
    // Move rows 1..rows-1 → 0..rows-2
    for (let y = 0; y < this.rows - 1; y++) {
      for (let x = 0; x < this.cols; x++) {
        const dst = this.cells[y * this.cols + x]!;
        const src = this.cells[(y + 1) * this.cols + x]!;
        dst.ch = src.ch;
        dst.fg = src.fg;
        dst.bg = src.bg;
        dst.attr = src.attr;
      }
    }
    // Blank the bottom row
    const bottom = (this.rows - 1) * this.cols;
    for (let x = 0; x < this.cols; x++) {
      const c = this.cells[bottom + x]!;
      c.ch = 0x20;
      c.fg = this.cursor.fg;
      c.bg = this.cursor.bg;
      c.attr = 0;
    }
    this.cursor.y = this.rows - 1;
    this.fullDirty = true;
  }
}

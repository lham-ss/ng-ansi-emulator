import { ATTR_BLINK_OR_HIGH_BG, ATTR_BOLD, ATTR_CONCEAL, ATTR_REVERSE, ScreenBuffer } from '../screen/screen-buffer';
import { C0, MAX_PARAMS, ParserState } from './types';

/**
 * ANSI SGR color codes use RGB bit ordering (bit 0 = red, bit 1 = green,
 * bit 2 = blue), while the VGA hardware palette uses BGR ordering (bit 0 =
 * blue, bit 1 = green, bit 2 = red). Translation is a swap of bits 0 and 2:
 *
 *   ANSI 31 (red, 001b)    -> VGA 4 (red, 100b)
 *   ANSI 34 (blue, 100b)   -> VGA 1 (blue, 001b)
 *   ANSI 33 (yellow, 011b) -> VGA 6 (brown/yellow, 110b)
 *
 * Without this remap, "red" text comes out blue -- a classic CGA/VGA gotcha.
 */
const ANSI_TO_VGA: readonly number[] = Object.freeze([0, 4, 2, 6, 1, 5, 3, 7]);

/**
 * Incremental ANSI parser feeding a ScreenBuffer.
 *
 * Designed for streaming use: feed(bytes) can be called repeatedly with any
 * chunk size and partial CSI sequences will survive across calls. This is
 * what enables baud-rate emulation -- the player can drip a fixed number of
 * bytes per millisecond into the parser and the screen evolves naturally.
 */
export class AnsiParser {
  private state: ParserState = ParserState.Ground;
  private params: number[] = [];
  private currentParam: number = -1;
  private intermediates: number[] = [];
  /** Set when the parameter string starts with '?' (private DEC sequence). */
  private privateMarker = false;

  /** When SUB (0x1A) is seen we stop processing further input. */
  eofSeen = false;

  constructor(public readonly buffer: ScreenBuffer) {}

  /**
   * Feed a chunk of bytes into the parser. Safe to call with arbitrary chunk
   * boundaries; partial CSI sequences are preserved across calls.
   */
  feed(bytes: Uint8Array, start = 0, end = bytes.length): void {
    for (let i = start; i < end; i++) {
      if (this.eofSeen) return;
      this.consume(bytes[i]!);
    }
  }

  /** Reset parser state without touching the screen buffer. */
  reset(): void {
    this.state = ParserState.Ground;
    this.params = [];
    this.currentParam = -1;
    this.intermediates = [];
    this.privateMarker = false;
    this.eofSeen = false;
  }

  private consume(byte: number): void {
    switch (this.state) {
      case ParserState.Ground:
        this.consumeGround(byte);
        return;
      case ParserState.Escape:
        this.consumeEscape(byte);
        return;
      case ParserState.CsiParam:
        this.consumeCsiParam(byte);
        return;
      case ParserState.CsiIntermediate:
        this.consumeCsiIntermediate(byte);
        return;
    }
  }

  private consumeGround(byte: number): void {
    switch (byte) {
      case C0.NUL:
        return;
      case C0.BEL:
        return;
      case C0.BS:
        this.buffer.backspace();
        return;
      case C0.HT:
        this.buffer.tab();
        return;
      case C0.LF:
      case C0.VT:
      case C0.FF:
        this.buffer.lineFeed();
        return;
      case C0.CR:
        this.buffer.carriageReturn();
        return;
      case C0.SUB:
        this.eofSeen = true;
        return;
      case C0.ESC:
        this.state = ParserState.Escape;
        return;
      default:
        this.buffer.putChar(byte);
        return;
    }
  }

  private consumeEscape(byte: number): void {
    if (byte === 0x5b /* '[' */) {
      this.state = ParserState.CsiParam;
      this.params = [];
      this.currentParam = -1;
      this.intermediates = [];
      this.privateMarker = false;
      return;
    }
    if (byte === 0x37) { this.buffer.saveCursor(); this.state = ParserState.Ground; return; }
    if (byte === 0x38) { this.buffer.restoreCursor(); this.state = ParserState.Ground; return; }
    this.state = ParserState.Ground;
  }

  private consumeCsiParam(byte: number): void {
    if (byte === 0x3f && this.params.length === 0 && this.currentParam === -1) {
      this.privateMarker = true;
      return;
    }
    if (byte >= 0x30 && byte <= 0x39) {
      if (this.currentParam === -1) this.currentParam = 0;
      this.currentParam = this.currentParam * 10 + (byte - 0x30);
      if (this.currentParam > 0xffff) this.currentParam = 0xffff;
      return;
    }
    if (byte === 0x3b /* ';' */) {
      this.pushParam();
      return;
    }
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates.push(byte);
      this.state = ParserState.CsiIntermediate;
      return;
    }
    if (byte >= 0x40 && byte <= 0x7e) {
      this.pushParam();
      this.dispatchCsi(byte);
      this.state = ParserState.Ground;
      return;
    }
    this.state = ParserState.Ground;
  }

  private consumeCsiIntermediate(byte: number): void {
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates.push(byte);
      return;
    }
    if (byte >= 0x40 && byte <= 0x7e) {
      this.dispatchCsi(byte);
      this.state = ParserState.Ground;
      return;
    }
    this.state = ParserState.Ground;
  }

  private pushParam(): void {
    if (this.params.length >= MAX_PARAMS) return;
    this.params.push(this.currentParam === -1 ? 0 : this.currentParam);
    this.currentParam = -1;
  }

  private param(index: number, defaultValue: number): number {
    const v = this.params[index];
    if (v === undefined || v === 0) return defaultValue;
    return v;
  }

  private dispatchCsi(finalByte: number): void {
    const buf = this.buffer;
    switch (finalByte) {
      case 0x41: buf.moveBy(0, -this.param(0, 1)); return;
      case 0x42: buf.moveBy(0, this.param(0, 1)); return;
      case 0x43: buf.moveBy(this.param(0, 1), 0); return;
      case 0x44: buf.moveBy(-this.param(0, 1), 0); return;
      case 0x45: buf.cursor.x = 0; buf.moveBy(0, this.param(0, 1)); return;
      case 0x46: buf.cursor.x = 0; buf.moveBy(0, -this.param(0, 1)); return;
      case 0x47:
        buf.cursor.x = Math.max(0, Math.min(buf.cols - 1, this.param(0, 1) - 1));
        return;
      case 0x48:
      case 0x66:
        buf.moveTo(this.param(0, 1), this.param(1, 1));
        return;
      case 0x4a: buf.eraseDisplay(this.clampMode(this.params[0] ?? 0)); return;
      case 0x4b: buf.eraseLine(this.clampMode(this.params[0] ?? 0)); return;
      case 0x53: for (let i = 0; i < this.param(0, 1); i++) buf.lineFeed(); return;
      case 0x68:
      case 0x6c:
        return;
      case 0x6d: this.applySgr(); return;
      case 0x73: buf.saveCursor(); return;
      case 0x75: buf.restoreCursor(); return;
      default: return;
    }
  }

  private clampMode(v: number): 0 | 1 | 2 {
    if (v === 1) return 1;
    if (v === 2) return 2;
    return 0;
  }

  private applySgr(): void {
    const cur = this.buffer.cursor;
    const params = this.params.length === 0 ? [0] : this.params;
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      if (p === 0) {
        cur.fg = 7;
        cur.bg = 0;
        cur.attr = 0;
        continue;
      }
      if (p === 1) { cur.attr |= ATTR_BOLD; continue; }
      if (p === 2 || p === 22) { cur.attr &= ~ATTR_BOLD; continue; }
      if (p === 5 || p === 6) { cur.attr |= ATTR_BLINK_OR_HIGH_BG; continue; }
      if (p === 25) { cur.attr &= ~ATTR_BLINK_OR_HIGH_BG; continue; }
      if (p === 7) { cur.attr |= ATTR_REVERSE; continue; }
      if (p === 27) { cur.attr &= ~ATTR_REVERSE; continue; }
      if (p === 8) { cur.attr |= ATTR_CONCEAL; continue; }
      if (p === 28) { cur.attr &= ~ATTR_CONCEAL; continue; }
      if (p >= 30 && p <= 37) { cur.fg = ANSI_TO_VGA[p - 30]!; continue; }
      if (p === 39) { cur.fg = 7; continue; }
      if (p >= 40 && p <= 47) { cur.bg = ANSI_TO_VGA[p - 40]!; continue; }
      if (p === 49) { cur.bg = 0; continue; }
      if (p >= 90 && p <= 97) { cur.fg = ANSI_TO_VGA[p - 90]! + 8; continue; }
      if (p >= 100 && p <= 107) { cur.bg = ANSI_TO_VGA[p - 100]! + 8; continue; }
    }
  }
}

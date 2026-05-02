import { Injectable, signal, computed, Signal, WritableSignal } from '@angular/core';
import { AnsiParser } from '../parser/ansi-parser';
import { parseSauce, recommendedCps, SauceRecord } from '../parser/sauce';
import { ScreenBuffer } from '../screen/screen-buffer';
import { renderDirty, renderFull, RenderOptions } from '../font/glyph-renderer';

/** Baud-to-cps conversion: serial framing is 1 start + 8 data + 1 stop = 10 bits/char. */
export const BAUD_TO_CPS = 10;

/**
 * Default content-buffer row count when SAUCE doesn't tell us the height.
 * Tall enough for almost all real-world ANSI art (most "long" pieces are
 * 50-200 rows; the largest archived pieces top out around ~600).
 */
export const DEFAULT_BUFFER_ROWS = 1000;

export interface PlayerOptions {
  /** Effective baud rate; 0 = render instantly, no timing emulation. */
  baud?: number;
  /** Force iCE-color mode regardless of SAUCE. */
  iceColors?: boolean;
  /** Override grid dimensions (otherwise read from SAUCE.tInfo1/2 or defaults). */
  cols?: number;
  /** Override the *content* buffer height. */
  rows?: number;
  /** Visible viewport rows (default 25). */
  viewportRows?: number;
  /** Auto-scroll the viewport to keep the cursor visible during playback. */
  followCursor?: boolean;
}

export interface PlayerState {
  status: 'idle' | 'playing' | 'paused' | 'finished';
  bytesProcessed: number;
  totalBytes: number;
  baud: number;
  sauce: SauceRecord | null;
  /** First buffer row visible in the viewport (0-based). */
  scrollTop: number;
  /** Highest valid scrollTop = bufferRows - viewportRows. */
  maxScrollTop: number;
  viewportRows: number;
  bufferRows: number;
}

@Injectable({ providedIn: 'root' })
export class AnsiPlayerService {
  // ---------------------------------------------------------------------
  // Public signals
  // ---------------------------------------------------------------------
  readonly state: Signal<PlayerState>;
  readonly progress: Signal<number>;

  private readonly _state: WritableSignal<PlayerState> = signal<PlayerState>({
    status: 'idle',
    bytesProcessed: 0,
    totalBytes: 0,
    baud: 14400,
    sauce: null,
    scrollTop: 0,
    maxScrollTop: 0,
    viewportRows: 25,
    bufferRows: 25,
  });

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------
  buffer = new ScreenBuffer(80, DEFAULT_BUFFER_ROWS);
  parser = new AnsiParser(this.buffer);

  private body: Uint8Array = new Uint8Array(0);
  private byteBudget = 0;
  private lastTick = 0;
  private rafId: number | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private renderOpts: RenderOptions = { scale: 1, drawCursor: true };
  private viewportRows = 25;
  private scrollTop = 0;
  private followCursor = true;

  constructor() {
    this.state = this._state.asReadonly();
    this.progress = computed(() => {
      const s = this._state();
      return s.totalBytes === 0 ? 0 : s.bytesProcessed / s.totalBytes;
    });
  }

  attachCanvas(canvas: HTMLCanvasElement, renderOpts: RenderOptions = {}): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderOpts = { scale: 1, drawCursor: true, ...renderOpts };
  }

  detachCanvas(): void {
    this.stop();
    this.canvas = null;
    this.ctx = null;
  }

  setRenderOptions(opts: RenderOptions): void {
    this.renderOpts = { ...this.renderOpts, ...opts };
    this.repaint();
  }

  setViewportRows(rows: number): void {
    this.viewportRows = Math.max(1, rows | 0);
    this.publishViewportState();
    this.clampScroll();
    this.repaint();
  }

  setFollowCursor(enabled: boolean): void {
    this.followCursor = enabled;
  }

  /** Programmatic scroll. Clamps to [0, maxScrollTop]. */
  scrollTo(bufferRow: number): void {
    const max = Math.max(0, this.buffer.rows - this.viewportRows);
    this.scrollTop = Math.max(0, Math.min(max, bufferRow | 0));
    this.publishViewportState();
    this.repaint();
  }

  /** Scroll by a delta in rows (positive = scroll down). */
  scrollBy(deltaRows: number): void {
    this.scrollTo(this.scrollTop + deltaRows);
  }

  /** Snap so the cursor row is visible (used by followCursor). */
  scrollToCursor(): void {
    const cy = this.buffer.cursor.y;
    if (cy < this.scrollTop) {
      this.scrollTo(cy);
    } else if (cy >= this.scrollTop + this.viewportRows) {
      this.scrollTo(cy - this.viewportRows + 1);
    }
  }

  load(bytes: Uint8Array, opts: PlayerOptions = {}): void {
    this.stop();
    const { sauce, body } = parseSauce(bytes);
    this.body = body;

    const cols = opts.cols ?? (sauce?.tInfo1 || 80);
    // Buffer height: explicit > SAUCE.tInfo2 (clamped to a sane max) > default.
    const sauceHeight = sauce?.tInfo2 ?? 0;
    const bufferRows = opts.rows ?? (sauceHeight > 0 ? Math.min(sauceHeight, 4000) : DEFAULT_BUFFER_ROWS);
    this.viewportRows = Math.max(1, opts.viewportRows ?? 25);
    this.followCursor = opts.followCursor ?? true;
    this.scrollTop = 0;

    this.buffer = new ScreenBuffer(cols, bufferRows);
    this.buffer.iceColors = opts.iceColors ?? sauce?.iceColors ?? true;
    this.parser = new AnsiParser(this.buffer);

    const baud = opts.baud ?? Math.round(recommendedCps(sauce) * BAUD_TO_CPS);

    this._state.set({
      status: 'idle',
      bytesProcessed: 0,
      totalBytes: this.body.length,
      baud,
      sauce,
      scrollTop: 0,
      maxScrollTop: Math.max(0, bufferRows - this.viewportRows),
      viewportRows: this.viewportRows,
      bufferRows,
    });

    this.repaint();
  }

  setBaud(baud: number): void {
    this._state.update(s => ({ ...s, baud }));
  }

  setIceColors(enabled: boolean): void {
    this.buffer.iceColors = enabled;
    this.buffer.fullDirty = true;
    this.repaint();
  }

  play(): void {
    const s = this._state();
    if (s.status === 'playing') return;
    if (s.status === 'finished') {
      this.restart();
      return;
    }
    this._state.update(prev => ({ ...prev, status: 'playing' }));
    this.lastTick = performance.now();
    this.byteBudget = 0;
    this.tick(this.lastTick);
  }

  pause(): void {
    if (this._state().status !== 'playing') return;
    this._state.update(prev => ({ ...prev, status: 'paused' }));
    this.cancelRaf();
  }

  stop(): void {
    this.cancelRaf();
    this._state.update(prev => ({ ...prev, status: 'idle', bytesProcessed: 0 }));
  }

  restart(): void {
    this.cancelRaf();
    this.buffer.reset();
    this.parser.reset();
    this.scrollTop = 0;
    this._state.update(prev => ({ ...prev, status: 'idle', bytesProcessed: 0, scrollTop: 0 }));
    this.repaint();
    this.play();
  }

  renderToEnd(): void {
    this.cancelRaf();
    this.buffer.reset();
    this.parser.reset();
    this.parser.feed(this.body);
    this._state.update(prev => ({ ...prev, status: 'finished', bytesProcessed: this.body.length }));
    if (this.followCursor) this.scrollToCursor();
    this.repaint();
  }

  // ---------------------------------------------------------------------
  // rAF loop
  // ---------------------------------------------------------------------
  private tick = (now: number): void => {
    const s = this._state();
    if (s.status !== 'playing') return;

    const dtMs = Math.min(100, now - this.lastTick);
    this.lastTick = now;

    if (s.baud > 0) {
      const cps = s.baud / BAUD_TO_CPS;
      this.byteBudget += (cps * dtMs) / 1000;
    } else {
      this.byteBudget = this.body.length;
    }

    let toConsume = Math.floor(this.byteBudget);
    if (toConsume > 0) {
      const start = s.bytesProcessed;
      const end = Math.min(this.body.length, start + toConsume);
      this.parser.feed(this.body, start, end);
      const consumed = end - start;
      this.byteBudget -= consumed;

      const finished = end >= this.body.length || this.parser.eofSeen;
      this._state.update(prev => ({
        ...prev,
        bytesProcessed: end,
        status: finished ? 'finished' : prev.status,
      }));

      if (this.followCursor) this.scrollToCursor();
    }

    if (this.ctx) {
      renderDirty(this.buffer, this.ctx, this.fullRenderOpts(now));
    }

    const after = this._state();
    if (after.status === 'playing') {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private cancelRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private fullRenderOpts(now?: number): RenderOptions {
    return {
      ...this.renderOpts,
      viewportRows: this.viewportRows,
      scrollTop: this.scrollTop,
      now,
    };
  }

  private repaint(): void {
    if (this.ctx) renderFull(this.buffer, this.ctx, this.fullRenderOpts());
  }

  private clampScroll(): void {
    const max = Math.max(0, this.buffer.rows - this.viewportRows);
    if (this.scrollTop > max) this.scrollTop = max;
    if (this.scrollTop < 0) this.scrollTop = 0;
  }

  private publishViewportState(): void {
    const max = Math.max(0, this.buffer.rows - this.viewportRows);
    if (this.scrollTop > max) this.scrollTop = max;
    this._state.update(prev => ({
      ...prev,
      scrollTop: this.scrollTop,
      maxScrollTop: max,
      viewportRows: this.viewportRows,
      bufferRows: this.buffer.rows,
    }));
  }
}
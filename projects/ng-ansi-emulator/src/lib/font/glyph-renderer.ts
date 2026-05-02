import { CP437_GLYPH_HEIGHT, CP437_GLYPH_WIDTH, getGlyph } from './cp437-font';
import { rgbOf, VGA_PALETTE } from '../screen/palette';
import { ScreenBuffer, ScreenCell } from '../screen/screen-buffer';

/**
 * Fast bitmap glyph blitter for HTML5 Canvas.
 *
 * The renderer composes ImageData from a viewport over the screen buffer at
 * pixel resolution (cols * 8 by viewportRows * 16) and blits it onto a
 * possibly-scaled canvas. Direct fillRect-per-pixel rendering also works,
 * but is 5-10x slower for full-screen redraws.
 *
 * Viewport model: the buffer can be much taller than the visible area
 * (think 1000-row ANSI files). The viewport is a window of `viewportRows`
 * buffer rows starting at `scrollTop`. Only those rows are rasterised;
 * scrolling is just changing scrollTop and redrawing.
 *
 * Two modes:
 *   - renderFull   - repaint every viewport row.
 *   - renderDirty  - repaint only buffer.dirtyRows that intersect the viewport.
 */

export interface RenderOptions {
  /** Integer scale factor (1=native pixel, 2=double, etc.). Default 1. */
  scale?: number;
  /** Render iCE high-intensity backgrounds vs let blink animate. */
  iceColors?: boolean;
  /** Show a blinking block cursor at the active position. */
  drawCursor?: boolean;
  /** ms timestamp for blink phase. */
  now?: number;
  /** Number of rows visible in the viewport. Default = buffer.rows. */
  viewportRows?: number;
  /** First buffer row visible at the top of the viewport. Default 0. */
  scrollTop?: number;
}

interface ResolvedViewport {
  viewportRows: number;
  scrollTop: number;
  scale: number;
}

function resolve(buffer: ScreenBuffer, opts: RenderOptions): ResolvedViewport {
  const scale = Math.max(1, opts.scale ?? 1) | 0;
  const viewportRows = Math.max(1, opts.viewportRows ?? buffer.rows);
  const maxScroll = Math.max(0, buffer.rows - viewportRows);
  const scrollTop = Math.max(0, Math.min(maxScroll, opts.scrollTop ?? 0));
  return { viewportRows, scrollTop, scale };
}

/** Resize the canvas backing store to native pixel dims for the viewport. */
export function sizePixelCanvas(canvas: HTMLCanvasElement, buffer: ScreenBuffer, scale = 1, viewportRows?: number): void {
  const rows = Math.max(1, viewportRows ?? buffer.rows);
  canvas.width = buffer.cols * CP437_GLYPH_WIDTH * scale;
  canvas.height = rows * CP437_GLYPH_HEIGHT * scale;
}

/** Render every visible row of the viewport onto ctx. */
export function renderFull(buffer: ScreenBuffer, ctx: CanvasRenderingContext2D, opts: RenderOptions = {}): void {
  const { viewportRows, scrollTop, scale } = resolve(buffer, opts);
  const pxW = buffer.cols * CP437_GLYPH_WIDTH;
  const pxH = viewportRows * CP437_GLYPH_HEIGHT;
  const img = ctx.createImageData(pxW, pxH);
  for (let vy = 0; vy < viewportRows; vy++) {
    const bufferRow = scrollTop + vy;
    if (bufferRow >= buffer.rows) {
      // Past the end of the buffer - leave as transparent black.
      continue;
    }
    drawRowIntoImageData(buffer, bufferRow, img, pxW, vy * CP437_GLYPH_HEIGHT);
  }
  blitToCanvas(img, ctx, pxW, pxH, scale);
  if (opts.drawCursor) drawCursor(buffer, ctx, scale, opts.now ?? 0, scrollTop, viewportRows);
  buffer.dirtyRows.clear();
  buffer.fullDirty = false;
}

/** Render only the rows in buffer.dirtyRows that fall inside the viewport. */
export function renderDirty(buffer: ScreenBuffer, ctx: CanvasRenderingContext2D, opts: RenderOptions = {}): void {
  if (buffer.fullDirty) {
    renderFull(buffer, ctx, opts);
    return;
  }
  const { viewportRows, scrollTop, scale } = resolve(buffer, opts);
  if (buffer.dirtyRows.size === 0) {
    if (opts.drawCursor) drawCursor(buffer, ctx, scale, opts.now ?? 0, scrollTop, viewportRows);
    return;
  }
  const pxW = buffer.cols * CP437_GLYPH_WIDTH;
  const rowImg = ctx.createImageData(pxW, CP437_GLYPH_HEIGHT);
  const visibleEnd = scrollTop + viewportRows;
  for (const bufferRow of buffer.dirtyRows) {
    if (bufferRow < scrollTop || bufferRow >= visibleEnd) continue;
    drawRowIntoImageData(buffer, bufferRow, rowImg, pxW, 0);
    const viewportY = bufferRow - scrollTop;
    blitRowToCanvas(rowImg, ctx, pxW, viewportY, scale);
  }
  buffer.dirtyRows.clear();
  if (opts.drawCursor) drawCursor(buffer, ctx, scale, opts.now ?? 0, scrollTop, viewportRows);
}

/** Internal: rasterise one buffer row into an ImageData buffer at localY. */
function drawRowIntoImageData(buffer: ScreenBuffer, bufferRow: number, img: ImageData, pxW: number, localY: number): void {
  const data = img.data;
  for (let col = 0; col < buffer.cols; col++) {
    const cell = buffer.cells[bufferRow * buffer.cols + col]!;
    const fg = rgbOf(VGA_PALETTE[cell.fg & 0x0f]!);
    const bg = rgbOf(VGA_PALETTE[cell.bg & 0x0f]!);
    rasterCell(cell, col * CP437_GLYPH_WIDTH, localY, data, pxW, fg, bg);
  }
}

function rasterCell(
  cell: ScreenCell,
  pxX: number,
  pxY: number,
  data: Uint8ClampedArray,
  pxStride: number,
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
): void {
  const glyph = getGlyph(cell.ch);
  for (let row = 0; row < CP437_GLYPH_HEIGHT; row++) {
    const rowBits = glyph[row]!;
    const dstY = pxY + row;
    let dstIdx = (dstY * pxStride + pxX) * 4;
    for (let col = 0; col < CP437_GLYPH_WIDTH; col++) {
      const lit = (rowBits >> (7 - col)) & 1;
      if (lit) {
        data[dstIdx] = fg.r;
        data[dstIdx + 1] = fg.g;
        data[dstIdx + 2] = fg.b;
      } else {
        data[dstIdx] = bg.r;
        data[dstIdx + 1] = bg.g;
        data[dstIdx + 2] = bg.b;
      }
      data[dstIdx + 3] = 255;
      dstIdx += 4;
    }
  }
}

function blitToCanvas(img: ImageData, ctx: CanvasRenderingContext2D, pxW: number, pxH: number, scale: number): void {
  if (scale === 1) {
    ctx.putImageData(img, 0, 0);
    return;
  }
  const off = makeOffscreen(pxW, pxH);
  off.ctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off.canvas, 0, 0, pxW * scale, pxH * scale);
}

function blitRowToCanvas(img: ImageData, ctx: CanvasRenderingContext2D, pxW: number, viewportRow: number, scale: number): void {
  const dstY = viewportRow * CP437_GLYPH_HEIGHT * scale;
  if (scale === 1) {
    ctx.putImageData(img, 0, dstY);
    return;
  }
  const off = makeOffscreen(pxW, CP437_GLYPH_HEIGHT);
  off.ctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off.canvas, 0, dstY, pxW * scale, CP437_GLYPH_HEIGHT * scale);
}

function drawCursor(
  buffer: ScreenBuffer,
  ctx: CanvasRenderingContext2D,
  scale: number,
  now: number,
  scrollTop: number,
  viewportRows: number,
): void {
  const phase = Math.floor(now / 500) % 2;
  if (phase === 0) return;
  const cursorBufferY = buffer.cursor.y;
  if (cursorBufferY < scrollTop || cursorBufferY >= scrollTop + viewportRows) return;
  const viewportY = cursorBufferY - scrollTop;
  ctx.fillStyle = '#ffffff';
  const x = buffer.cursor.x * CP437_GLYPH_WIDTH * scale;
  const y = (viewportY * CP437_GLYPH_HEIGHT + CP437_GLYPH_HEIGHT - 2) * scale;
  ctx.fillRect(x, y, CP437_GLYPH_WIDTH * scale, 2 * scale);
}

interface OffscreenPair {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

let cachedOffscreen: { w: number; h: number; pair: OffscreenPair } | null = null;
function makeOffscreen(w: number, h: number): OffscreenPair {
  if (cachedOffscreen && cachedOffscreen.w === w && cachedOffscreen.h === h) {
    return cachedOffscreen.pair;
  }
  let pair: OffscreenPair;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    pair = { canvas, ctx };
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    pair = { canvas, ctx };
  }
  cachedOffscreen = { w, h, pair };
  return pair;
}
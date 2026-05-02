import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ViewChild,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { AnsiPlayerService, PlayerOptions, PlayerState } from '../player/ansi-player.service';
import { CP437_GLYPH_HEIGHT, CP437_GLYPH_WIDTH } from '../font/cp437-font';
import { sizePixelCanvas } from '../font/glyph-renderer';

/**
 * <ng-ansi-canvas
 *    [source]="ansiBytes"
 *    [baud]="14400"
 *    [iceColors]="true"
 *    [scale]="2"
 *    [viewportRows]="25"
 *    [followCursor]="true"
 *    [autoPlay]="true"
 *    (state)="onState($event)" />
 *
 * Renders an ANSI/ASCII file onto a pixel-perfect HTML5 canvas using the
 * CP437 8x16 VGA bitmap font. The canvas is sized to the viewport (e.g.
 * 25 rows tall) while the underlying buffer holds the full content height,
 * so files that are taller than the viewport are scrollable rather than
 * lost off the top.
 *
 * Scroll interactions:
 *   - Mouse wheel over the canvas
 *   - Programmatic: player.scrollTo / scrollBy / scrollToCursor
 *   - During playback, `followCursor` snaps the viewport to the cursor row
 */
@Component({
  selector: 'ng-ansi-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AnsiPlayerService],
  template: `
    <canvas
      #canvas
      class="ng-ansi-canvas"
      [style.width.px]="cssWidth()"
      [style.height.px]="cssHeight()"
      [style.image-rendering]="'pixelated'"
      (wheel)="onWheel($event)">
    </canvas>
  `,
  styles: [`
    :host { display: inline-block; line-height: 0; }
    canvas { display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
  `],
})
export class NgAnsiCanvasComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly source = input<Uint8Array | null>(null);
  readonly baud = input<number | null>(null);
  readonly iceColors = input<boolean | null>(null);
  readonly scale = input<number>(1);
  readonly cols = input<number | null>(null);
  /** Override content buffer height. Otherwise from SAUCE or 1000. */
  readonly bufferRows = input<number | null>(null);
  /** Visible row count. Default 25 (classic 80x25). */
  readonly viewportRows = input<number>(25);
  /** Auto-scroll the viewport during playback to keep the cursor visible. */
  readonly followCursor = input<boolean>(true);
  readonly autoPlay = input<boolean>(true);
  readonly showCursor = input<boolean>(false);
  /** How many rows mouse-wheel deltaY=100 should scroll. Default 3. */
  readonly wheelRowsPer100 = input<number>(3);

  readonly stateChange = output<PlayerState>();

  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly player = inject(AnsiPlayerService);

  private viewInitialized = false;

  constructor() {
    effect(() => {
      const s = this.player.state();
      this.stateChange.emit(s);
    });
  }

  cssWidth(): number {
    const c = this.cols() ?? this.player.buffer.cols;
    return c * CP437_GLYPH_WIDTH * Math.max(1, this.scale());
  }

  cssHeight(): number {
    return this.viewportRows() * CP437_GLYPH_HEIGHT * Math.max(1, this.scale());
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.player.attachCanvas(this.canvasRef.nativeElement, {
      scale: Math.max(1, this.scale()),
      drawCursor: this.showCursor(),
    });
    this.player.setViewportRows(this.viewportRows());
    this.player.setFollowCursor(this.followCursor());
    sizePixelCanvas(this.canvasRef.nativeElement, this.player.buffer, Math.max(1, this.scale()), this.viewportRows());
    this.applySource();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewInitialized) return;
    if (changes['source']) this.applySource();
    if (changes['baud'] && this.baud() !== null) this.player.setBaud(this.baud()!);
    if (changes['iceColors'] && this.iceColors() !== null) this.player.setIceColors(this.iceColors()!);
    if (changes['viewportRows']) {
      this.player.setViewportRows(this.viewportRows());
      sizePixelCanvas(this.canvasRef.nativeElement, this.player.buffer, Math.max(1, this.scale()), this.viewportRows());
    }
    if (changes['followCursor']) this.player.setFollowCursor(this.followCursor());
    if (changes['scale'] || changes['showCursor']) {
      this.player.setRenderOptions({
        scale: Math.max(1, this.scale()),
        drawCursor: this.showCursor(),
      });
      sizePixelCanvas(this.canvasRef.nativeElement, this.player.buffer, Math.max(1, this.scale()), this.viewportRows());
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.player.detachCanvas();
  }

  /** Wheel handler — scrolls the viewport and prevents page scroll. */
  onWheel(evt: WheelEvent): void {
    const max = this.player.state().maxScrollTop;
    if (max <= 0) return; // nothing to scroll, let the page scroll
    const rows = (evt.deltaY / 100) * Math.max(1, this.wheelRowsPer100());
    const before = this.player.state().scrollTop;
    this.player.scrollBy(rows);
    const after = this.player.state().scrollTop;
    if (after !== before) {
      // Only swallow the wheel event when we actually consumed it.
      evt.preventDefault();
    }
  }

  /** Public — re-export for templates that want a scrollbar binding. */
  setScrollTop(row: number): void { this.player.scrollTo(row); }
  scrollBy(rows: number): void    { this.player.scrollBy(rows); }

  @HostListener('keydown', ['$event'])
  onKeyDown(evt: KeyboardEvent): void {
    const max = this.player.state().maxScrollTop;
    if (max <= 0) return;
    const page = this.viewportRows();
    switch (evt.key) {
      case 'ArrowDown': this.player.scrollBy(1);    evt.preventDefault(); break;
      case 'ArrowUp':   this.player.scrollBy(-1);   evt.preventDefault(); break;
      case 'PageDown':  this.player.scrollBy(page); evt.preventDefault(); break;
      case 'PageUp':    this.player.scrollBy(-page);evt.preventDefault(); break;
      case 'Home':      this.player.scrollTo(0);    evt.preventDefault(); break;
      case 'End':       this.player.scrollTo(max);  evt.preventDefault(); break;
    }
  }

  private applySource(): void {
    const bytes = this.source();
    if (!bytes) return;
    const opts: PlayerOptions = {
      viewportRows: this.viewportRows(),
      followCursor: this.followCursor(),
    };
    if (this.baud() !== null) opts.baud = this.baud()!;
    if (this.iceColors() !== null) opts.iceColors = this.iceColors()!;
    if (this.cols() !== null) opts.cols = this.cols()!;
    if (this.bufferRows() !== null) opts.rows = this.bufferRows()!;
    this.player.load(bytes, opts);
    sizePixelCanvas(this.canvasRef.nativeElement, this.player.buffer, Math.max(1, this.scale()), this.viewportRows());
    if (this.autoPlay()) this.player.play();
  }
}
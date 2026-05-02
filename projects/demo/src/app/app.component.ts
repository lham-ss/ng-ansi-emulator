import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgAnsiCanvasComponent, PlayerState } from 'ng-ansi-emulator';
import { SAMPLE_ANSI_BYTES } from './sample-ansi';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgAnsiCanvasComponent],
  template: `
    <div class="wrap">
      <h1>ng-ansi-emulator</h1>
      <p class="subtitle">Angular 21 ANSI/ASCII art player &middot; CP437 8x16 VGA bitmap font &middot; baud-rate playback</p>

      <div class="controls">
        <label class="file">
          <span>Load .ANS file</span>
          <input type="file" accept=".ans,.asc,.ice,.txt,.diz,.nfo,application/octet-stream" (change)="onFile($event)" />
        </label>

        <label>
          Baud
          <select [ngModel]="baud()" (ngModelChange)="baud.set($event)">
            <option [ngValue]="0">Unlimited</option>
            <option [ngValue]="300">300</option>
            <option [ngValue]="1200">1200</option>
            <option [ngValue]="2400">2400</option>
            <option [ngValue]="9600">9600</option>
            <option [ngValue]="14400">14400</option>
            <option [ngValue]="28800">28800</option>
            <option [ngValue]="57600">57600</option>
            <option [ngValue]="115200">115200</option>
          </select>
        </label>

        <label class="checkbox">
          <input type="checkbox" [ngModel]="iceColors()" (ngModelChange)="iceColors.set($event)" />
          iCE colors
        </label>

        <label class="checkbox">
          <input type="checkbox" [ngModel]="followCursor()" (ngModelChange)="followCursor.set($event)" />
          Follow cursor
        </label>

        <label>
          Scale
          <select [ngModel]="scale()" (ngModelChange)="scale.set($event)">
            <option [ngValue]="1">1x</option>
            <option [ngValue]="2">2x</option>
            <option [ngValue]="3">3x</option>
          </select>
        </label>

        <label>
          Viewport rows
          <select [ngModel]="viewportRows()" (ngModelChange)="viewportRows.set($event)">
            <option [ngValue]="20">20</option>
            <option [ngValue]="25">25</option>
            <option [ngValue]="40">40</option>
            <option [ngValue]="50">50</option>
          </select>
        </label>

        <button type="button" (click)="loadSample()">Reload sample</button>
      </div>

      <div class="player-row">
        <ng-ansi-canvas
          #canvas
          [source]="source()"
          [baud]="baud()"
          [iceColors]="iceColors()"
          [scale]="scale()"
          [viewportRows]="viewportRows()"
          [followCursor]="followCursor()"
          [showCursor]="false"
          (stateChange)="onStateChange($event)" />

        @if (state() && state()!.maxScrollTop > 0) {
          <input
            class="scrollbar"
            type="range"
            min="0"
            [max]="state()!.maxScrollTop"
            [ngModel]="state()!.scrollTop"
            (ngModelChange)="canvas.setScrollTop($event)" />
        }
      </div>

      @if (state()) {
        <div class="status">
          <span>Status: <strong>{{ state()!.status }}</strong></span>
          <span>{{ state()!.bytesProcessed }} / {{ state()!.totalBytes }} bytes</span>
          <span>Row {{ state()!.scrollTop }} / {{ state()!.bufferRows }}</span>
          @if (state()!.sauce) {
            <span>SAUCE: "{{ state()!.sauce!.title }}" by {{ state()!.sauce!.author }}</span>
          }
        </div>
        <p class="hint">
          Scroll: mouse wheel over the canvas, or use the slider on the right.
          Click into the canvas first for keyboard shortcuts (PgUp / PgDn / Home / End / arrows).
        </p>
      }
    </div>
  `,
  styles: [`
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 4px; font-weight: 600; }
    .subtitle { margin: 0 0 24px; color: #888; font-size: 14px; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      padding: 12px;
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      margin-bottom: 16px;
    }
    .controls label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #aaa; }
    .controls label.checkbox { flex-direction: row; align-items: center; gap: 6px; color: #eaeaea; }
    .controls input[type=file] { color: #eaeaea; }
    .controls select { padding: 4px 6px; background: #111; color: #eaeaea; border: 1px solid #444; border-radius: 4px; }
    .controls button { padding: 6px 12px; background: #2d6cdf; color: white; border: 0; border-radius: 4px; cursor: pointer; }
    .controls button:hover { background: #3d7cef; }
    .player-row { display: flex; align-items: stretch; gap: 8px; }
    .scrollbar { -webkit-appearance: slider-vertical; appearance: slider-vertical; width: 16px; min-height: 200px; }
    .status { display: flex; gap: 24px; padding: 8px 12px; margin-top: 12px; background: #222; border-radius: 6px; font-size: 12px; color: #aaa; flex-wrap: wrap; }
    .hint { color: #888; font-size: 12px; margin: 8px 0; }
    ng-ansi-canvas { background: #000; border: 1px solid #333; }
  `],
})
export class AppComponent {
  readonly source = signal<Uint8Array | null>(null);
  readonly baud = signal<number>(14400);
  readonly iceColors = signal<boolean>(true);
  readonly scale = signal<number>(2);
  readonly viewportRows = signal<number>(25);
  readonly followCursor = signal<boolean>(true);
  readonly state = signal<PlayerState | null>(null);

  constructor() { this.loadSample(); }

  loadSample(): void {
    this.source.set(new Uint8Array(SAMPLE_ANSI_BYTES));
  }

  onFile(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.arrayBuffer().then(buf => this.source.set(new Uint8Array(buf)));
  }

  onStateChange(s: PlayerState): void { this.state.set(s); }
}
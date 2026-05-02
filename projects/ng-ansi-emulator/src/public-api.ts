/*
 * Public API surface of ng-ansi-emulator
 *
 * Angular 21 ANSI emulator: parses BBS-style .ANS files (with optional SAUCE
 * metadata) and renders them onto an HTML5 Canvas using a hand-encoded CP437
 * 8x16 VGA bitmap font with authentic baud-rate playback timing.
 */

// Components
export * from './lib/components/ng-ansi-canvas.component';

// Services
export * from './lib/player/ansi-player.service';

// Parser
export * from './lib/parser/ansi-parser';
export * from './lib/parser/sauce';
export * from './lib/parser/types';

// Screen / palette
export * from './lib/screen/screen-buffer';
export * from './lib/screen/palette';

// Font
export * from './lib/font/cp437-font';
export * from './lib/font/glyph-renderer';

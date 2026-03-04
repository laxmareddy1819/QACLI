/**
 * Lightweight ANSI escape code → HTML converter.
 * Handles color codes, bold, dim, and reset sequences commonly found
 * in Playwright test output and qabot healing logs.
 */

const ANSI_COLORS: Record<number, string> = {
  30: '#4a4a4a', // black (dark gray for visibility on dark bg)
  31: '#ef4444', // red
  32: '#22c55e', // green
  33: '#eab308', // yellow
  34: '#3b82f6', // blue
  35: '#a855f7', // magenta
  36: '#06b6d4', // cyan
  37: '#e5e5e5', // white
  90: '#737373', // bright black (gray)
  91: '#f87171', // bright red
  92: '#4ade80', // bright green
  93: '#facc15', // bright yellow
  94: '#60a5fa', // bright blue
  95: '#c084fc', // bright magenta
  96: '#22d3ee', // bright cyan
  97: '#ffffff', // bright white
};

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[([0-9;]*)([a-zA-Z])/g;
// OSC sequences (e.g., terminal title changes)
// eslint-disable-next-line no-control-regex
const OSC_RE = /\x1b\].*?(?:\x07|\x1b\\)/g;

interface SpanStyle {
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment {
  text: string;
  style: SpanStyle;
}

/**
 * Parse an ANSI-encoded string into segments with style info.
 * Each segment has plain text + associated CSS-like styles.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  // Strip OSC sequences first
  const cleaned = input.replace(OSC_RE, '');

  const segments: AnsiSegment[] = [];
  let currentStyle: SpanStyle = {};
  let lastIndex = 0;

  ANSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_RE.exec(cleaned)) !== null) {
    // Push text before this escape sequence
    if (match.index > lastIndex) {
      const text = cleaned.slice(lastIndex, match.index);
      if (text) segments.push({ text, style: { ...currentStyle } });
    }
    lastIndex = match.index + match[0].length;

    const codes = match[1].split(';').map(Number);
    const type = match[2];

    if (type !== 'm') continue; // Only handle SGR (Select Graphic Rendition)

    for (const code of codes) {
      if (code === 0) {
        currentStyle = {}; // Reset
      } else if (code === 1) {
        currentStyle.bold = true;
      } else if (code === 2) {
        currentStyle.dim = true;
      } else if (code === 3) {
        currentStyle.italic = true;
      } else if (code === 4) {
        currentStyle.underline = true;
      } else if (code === 22) {
        currentStyle.bold = false;
        currentStyle.dim = false;
      } else if (code === 23) {
        currentStyle.italic = false;
      } else if (code === 24) {
        currentStyle.underline = false;
      } else if (ANSI_COLORS[code]) {
        currentStyle.color = ANSI_COLORS[code];
      } else if (code === 39) {
        currentStyle.color = undefined; // Default color
      }
    }
  }

  // Remaining text after last escape
  if (lastIndex < cleaned.length) {
    const text = cleaned.slice(lastIndex);
    if (text) segments.push({ text, style: { ...currentStyle } });
  }

  return segments;
}

/**
 * Convert ANSI segments to inline CSS style string.
 */
export function segmentToStyle(style: SpanStyle): React.CSSProperties {
  const css: React.CSSProperties = {};
  if (style.color) css.color = style.color;
  if (style.bold) css.fontWeight = 'bold';
  if (style.dim) css.opacity = 0.6;
  if (style.italic) css.fontStyle = 'italic';
  if (style.underline) css.textDecoration = 'underline';
  return css;
}

/**
 * Strip all ANSI escape codes from a string, returning plain text.
 */
export function stripAnsi(input: string): string {
  return input.replace(OSC_RE, '').replace(ANSI_RE, '');
}

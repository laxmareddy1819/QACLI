/**
 * Shared ANSI stripping utility for all test result parsers.
 * Removes ANSI escape codes (colors, cursor movement, OSC sequences)
 * so that error messages and stack traces display cleanly in the UI.
 */

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
// eslint-disable-next-line no-control-regex
const OSC_RE = /\x1b\].*?(?:\x07|\x1b\\)/g;

/**
 * Strip ANSI escape codes from a string.
 * Handles both CSI sequences ([31m, [0m, etc.) and OSC sequences (hyperlinks, titles).
 */
export function stripAnsi(str: string): string {
  return str.replace(OSC_RE, '').replace(ANSI_RE, '');
}

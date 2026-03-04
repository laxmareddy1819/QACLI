import chalk, { Chalk } from 'chalk';
import ora, { type Ora } from 'ora';
import { highlight } from 'cli-highlight';
import { truncate, decodeHtmlEntities } from '../utils/index.js';

// Force a chalk instance with color level 2 (256 colors).
// This ensures styling works even when stdout is not a TTY at import time
// (e.g. bundled ESM, piped output).
const c = new Chalk({ level: 2 });

/**
 * Lightweight markdown-to-terminal renderer.
 * Handles the common patterns in LLM output without relying on marked-terminal
 * (which has compatibility issues with marked v14 — inline formatting inside
 * list items is silently dropped).
 */
function renderMarkdownToTerminal(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // ── Code block fences ──
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        // End of code block — syntax highlight and emit
        inCodeBlock = false;
        const code = codeBlockLines.join('\n');
        try {
          const highlighted = highlight(code, {
            language: codeBlockLang || 'plaintext',
            ignoreIllegals: true,
          });
          out.push('');
          for (const hl of highlighted.split('\n')) {
            out.push(`  ${hl}`);
          }
          out.push('');
        } catch {
          for (const cl of codeBlockLines) {
            out.push(`  ${c.yellow(cl)}`);
          }
          out.push('');
        }
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // ── Headings ──
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = formatInline(headingMatch[2]!);
      if (level <= 2) {
        out.push('');
        out.push(c.bold.magenta.underline(text));
      } else {
        out.push('');
        out.push(c.bold.cyan(text));
      }
      continue;
    }

    // ── Horizontal rule ──
    if (/^[-*_]{3,}\s*$/.test(line)) {
      out.push(c.dim('─'.repeat(50)));
      continue;
    }

    // ── Table rows (pipe-delimited) — collect the entire table, then render ──
    if (line.includes('|') && line.trim().startsWith('|')) {
      // Collect all contiguous table lines
      const tableLines: string[] = [];
      let ti = i;
      while (ti < lines.length && lines[ti]!.trim().startsWith('|')) {
        tableLines.push(lines[ti]!);
        ti++;
      }
      // Advance outer loop past the table
      i = ti - 1;

      // Parse rows: extract cells, identify separator row index
      const parsedRows: string[][] = [];
      let separatorIdx = -1;
      for (let r = 0; r < tableLines.length; r++) {
        const raw = tableLines[r]!.trim();
        if (/^\|[\s:|-]+\|$/.test(raw)) {
          separatorIdx = r;
          parsedRows.push([]); // placeholder
          continue;
        }
        const cells = raw.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
        parsedRows.push(cells);
      }

      // Compute natural column widths based on visual text (after stripping markdown)
      const colCount = Math.max(...parsedRows.map(r => r.length));
      const naturalWidths: number[] = new Array(colCount).fill(0);
      for (const row of parsedRows) {
        if (row.length === 0) continue; // separator placeholder
        for (let ci = 0; ci < colCount; ci++) {
          const visual = stripInlineMarkdown(row[ci] || '');
          naturalWidths[ci] = Math.max(naturalWidths[ci]!, visual.length);
        }
      }

      // Constrain table to terminal width
      // Total width = sum(colWidths) + 3*colCount + 1  (each col: " content " + │)
      const termWidth = process.stdout.columns || 120;
      const overhead = colCount * 3 + 1; // │ + space + space per col, plus final │
      const availableForContent = termWidth - overhead;
      let colWidths = [...naturalWidths];
      const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);

      if (totalNatural > availableForContent && availableForContent > colCount) {
        // Shrink columns to fit: give each column at least a minimum width,
        // then distribute remaining space proportionally
        const minColWidth = 6;
        const totalMin = colCount * minColWidth;

        if (availableForContent <= totalMin) {
          // Very narrow terminal — equal widths
          colWidths = new Array(colCount).fill(Math.max(3, Math.floor(availableForContent / colCount)));
        } else {
          // Proportional shrink: first assign minimum, then distribute surplus
          colWidths = new Array(colCount).fill(minColWidth);
          const surplus = availableForContent - totalMin;
          // Distribute surplus proportionally to natural widths
          for (let ci = 0; ci < colCount; ci++) {
            const share = Math.floor((naturalWidths[ci]! / totalNatural) * surplus);
            colWidths[ci] = minColWidth + share;
          }
          // Distribute rounding remainder to largest columns
          let used = colWidths.reduce((a, b) => a + b, 0);
          let ci = 0;
          while (used < availableForContent) {
            // Find column with most deficit
            let maxDeficit = -1, maxIdx = 0;
            for (let j = 0; j < colCount; j++) {
              const deficit = naturalWidths[j]! - colWidths[j]!;
              if (deficit > maxDeficit) { maxDeficit = deficit; maxIdx = j; }
            }
            colWidths[maxIdx]!++;
            used++;
            ci++;
            if (ci > colCount * 2) break; // safety
          }
        }
      }

      // Word-wrap a cell's text to fit within a given width
      const wrapText = (text: string, maxW: number): string[] => {
        if (text.length <= maxW) return [text];
        const words = text.split(/\s+/);
        const wrapped: string[] = [];
        let current = '';
        for (const word of words) {
          if (!current) {
            current = word;
          } else if (current.length + 1 + word.length <= maxW) {
            current += ' ' + word;
          } else {
            wrapped.push(current);
            current = word;
          }
        }
        if (current) wrapped.push(current);
        // If a single word is longer than maxW, force-break it
        const result: string[] = [];
        for (const line of wrapped) {
          if (line.length <= maxW) {
            result.push(line);
          } else {
            for (let s = 0; s < line.length; s += maxW) {
              result.push(line.slice(s, s + maxW));
            }
          }
        }
        return result.length > 0 ? result : [''];
      };

      // Render the table with proper padding and word-wrap
      const hBorder = (left: string, mid: string, right: string) =>
        c.dim(left + colWidths.map(w => '─'.repeat(w + 2)).join(mid) + right);

      out.push(hBorder('┌', '┬', '┐'));
      for (let r = 0; r < parsedRows.length; r++) {
        const row = parsedRows[r]!;
        if (row.length === 0) {
          // separator
          out.push(hBorder('├', '┼', '┤'));
          continue;
        }
        const isHeader = separatorIdx > 0 && r < separatorIdx;

        // Wrap each cell and determine max line count for this row
        const wrappedCells: string[][] = colWidths.map((w, ci) => {
          const cell = row[ci] || '';
          const visual = stripInlineMarkdown(cell);
          return wrapText(visual, w);
        });
        const maxLines = Math.max(...wrappedCells.map(wc => wc.length));

        // Emit each visual line of this row
        for (let ln = 0; ln < maxLines; ln++) {
          const paddedCells = colWidths.map((w, ci) => {
            const cellLine = wrappedCells[ci]![ln] || '';
            // Re-apply inline formatting only on the first line (where markdown was)
            // For wrapped continuation lines, use plain text
            let formatted: string;
            if (ln === 0) {
              // Find original cell and apply formatting if the visual matches
              const origCell = row[ci] || '';
              const origVisual = stripInlineMarkdown(origCell);
              if (origVisual === cellLine) {
                formatted = formatInline(origCell);
              } else {
                formatted = formatInline(cellLine);
              }
            } else {
              formatted = cellLine;
            }
            const pad = ' '.repeat(Math.max(0, w - cellLine.length));
            return ' ' + (isHeader ? c.bold(formatted) : formatted) + pad + ' ';
          });
          out.push(c.dim('│') + paddedCells.join(c.dim('│')) + c.dim('│'));
        }
      }
      out.push(hBorder('└', '┴', '┘'));
      continue;
    }

    // ── Bullet list items ──
    const bulletMatch = line.match(/^(\s*)[*+-]\s+(.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1]!;
      const content = formatInline(bulletMatch[2]!);
      const depth = Math.floor(indent.length / 2);
      const bullet = depth === 0 ? '•' : depth === 1 ? '◦' : '▸';
      out.push(`${'  '.repeat(depth + 1)}${bullet} ${content}`);
      continue;
    }

    // ── Numbered list items ──
    const numberedMatch = line.match(/^(\s*)\d+[.)]\s+(.*)/);
    if (numberedMatch) {
      const indent = numberedMatch[1]!;
      const content = formatInline(numberedMatch[2]!);
      const num = line.match(/(\d+)/)?.[1] || '1';
      out.push(`${'  '.repeat(Math.floor(indent.length / 2) + 1)}${num}. ${content}`);
      continue;
    }

    // ── Blockquote ──
    const bqMatch = line.match(/^>\s?(.*)/);
    if (bqMatch) {
      out.push(c.dim('  │ ') + c.italic(formatInline(bqMatch[1]!)));
      continue;
    }

    // ── Regular paragraph text ──
    out.push(formatInline(line));
  }

  // Handle unclosed code block
  if (inCodeBlock) {
    for (const cl of codeBlockLines) {
      out.push(`  ${c.yellow(cl)}`);
    }
  }

  return out.join('\n') + '\n';
}

/** Strip markdown syntax to get plain visible text (for width calculations) */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*{3}([^*]+)\*{3}/g, '$1')
    .replace(/_{3}([^_]+)_{3}/g, '$1')
    .replace(/\*{2}([^*]+)\*{2}/g, '$1')
    .replace(/_{2}([^_]+)_{2}/g, '$1')
    .replace(/(?<![\\*])\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2');
}

/** Apply inline markdown formatting: bold, italic, code, strikethrough, links */
function formatInline(text: string): string {
  return text
    // Inline code: `code`
    .replace(/`([^`]+)`/g, (_, code) => c.yellow(code))
    // Bold + italic: ***text*** or ___text___
    .replace(/\*{3}([^*]+)\*{3}/g, (_, t) => c.bold.italic(t))
    .replace(/_{3}([^_]+)_{3}/g, (_, t) => c.bold.italic(t))
    // Bold: **text** or __text__
    .replace(/\*{2}([^*]+)\*{2}/g, (_, t) => c.bold(t))
    .replace(/_{2}([^_]+)_{2}/g, (_, t) => c.bold(t))
    // Italic: *text* or _text_ (but not inside words with underscores)
    .replace(/(?<![\\*])\*([^*]+)\*(?!\*)/g, (_, t) => c.italic(t))
    // Strikethrough: ~~text~~
    .replace(/~~([^~]+)~~/g, (_, t) => c.strikethrough(t))
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `${c.blue(text)} ${c.dim.underline(url)}`);
}

export class Renderer {
  private spinner: Ora | null = null;
  private streamBuffer = '';
  private isStreaming = false;

  constructor() {}

  renderWelcome(provider: string, model: string): void {
    const border = chalk.dim('─'.repeat(50));
    console.log('');
    console.log(border);
    console.log(
      chalk.bold.cyan('  qabot') + chalk.dim(' — AI-Powered Test Automation CLI'),
    );
    console.log(border);
    console.log('');
    console.log(
      chalk.dim('  Model: ') +
        chalk.yellow(model) +
        chalk.dim(' | Provider: ') +
        chalk.yellow(provider),
    );
    console.log(
      chalk.dim('  Type your request or ') +
        chalk.cyan('/help') +
        chalk.dim(' for commands'),
    );
    console.log('');
  }

  getPrompt(): string {
    return chalk.bold.green('> ');
  }

  startSpinner(message: string): void {
    this.spinner = ora({
      text: chalk.dim(message),
      spinner: 'dots',
      // Disable ora's stdin-discarder: on Windows its #realStop() calls
      // process.stdin.pause() even though #realStart() is a no-op, which
      // silently pauses stdin behind readline's back and drains the event loop.
      discardStdin: false,
    }).start();
  }

  stopSpinner(success = true): void {
    if (this.spinner) {
      if (success) {
        this.spinner.stop();
      } else {
        this.spinner.fail();
      }
      this.spinner = null;
    }
  }

  startStream(): void {
    this.isStreaming = true;
    this.streamBuffer = '';
  }

  renderStreamChunk(text: string): void {
    this.streamBuffer += text;
    // Update spinner with character count so the user knows data is arriving
    if (this.spinner) {
      const len = this.streamBuffer.length;
      const label = len > 1000 ? `${(len / 1000).toFixed(1)}k` : `${len}`;
      this.spinner.text = chalk.dim(`Generating... (${label} chars)`);
    }
  }

  endStream(): void {
    if (this.isStreaming) {
      this.isStreaming = false;
      this.flushStreamBuffer();
    }
  }

  /**
   * Flush the stream buffer: render accumulated text as formatted markdown.
   * Called when tool calls interrupt the stream or when the stream ends.
   */
  private flushStreamBuffer(): void {
    if (!this.streamBuffer.trim()) {
      this.streamBuffer = '';
      return;
    }

    this.stopSpinner();

    try {
      console.log('');
      // Decode HTML entities that LLMs sometimes emit (e.g. &quot; &lt; &gt;)
      const decoded = decodeHtmlEntities(this.streamBuffer);
      const rendered = renderMarkdownToTerminal(decoded);
      process.stdout.write(rendered);
    } catch {
      console.log(this.streamBuffer);
    }

    this.streamBuffer = '';
  }

  renderMarkdown(text: string): void {
    try {
      const decoded = decodeHtmlEntities(text);
      const rendered = renderMarkdownToTerminal(decoded);
      process.stdout.write(rendered);
    } catch {
      console.log(text);
    }
  }

  renderCodeBlock(code: string, language?: string): void {
    try {
      const highlighted = highlight(code, {
        language: language || 'typescript',
        ignoreIllegals: true,
      });
      console.log(highlighted);
    } catch {
      console.log(code);
    }
  }

  renderToolCallStart(toolName: string, args: Record<string, unknown>): void {
    this.stopSpinner();
    // Flush any accumulated stream text as formatted markdown before
    // showing the tool call output, since tool calls interrupt the text stream
    this.flushStreamBuffer();
    const argsPreview = this.formatToolArgs(toolName, args);
    console.log(
      chalk.dim('  ') +
        chalk.yellow('⚡') +
        chalk.dim(' ') +
        chalk.bold(toolName) +
        (argsPreview ? chalk.dim(` ${argsPreview}`) : ''),
    );
  }

  renderToolCallResult(_toolName: string, result: unknown, isError = false): void {
    if (isError) {
      console.log(
        chalk.dim('    ') +
          chalk.red('✗') +
          chalk.dim(' ') +
          chalk.red(truncate(decodeHtmlEntities(String(result)), 200)),
      );
    } else {
      const preview = this.formatResultPreview(result);
      console.log(
        chalk.dim('    ') +
          chalk.green('✓') +
          chalk.dim(' ') +
          chalk.dim(decodeHtmlEntities(preview)),
      );
    }
  }

  renderPermissionPrompt(toolName: string, args: Record<string, unknown>): void {
    const argsPreview = this.formatToolArgs(toolName, args);
    console.log('');
    console.log(chalk.dim('  ┌─ ') + chalk.yellow('Permission Required'));
    console.log(
      chalk.dim('  │ ') +
        chalk.bold(toolName) +
        (argsPreview ? chalk.dim(` ${argsPreview}`) : ''),
    );
  }

  renderError(message: string, error?: Error): void {
    console.log('');
    console.log(chalk.red('  Error: ') + message);
    if (error?.stack) {
      console.log(chalk.dim(error.stack.split('\n').slice(1, 4).join('\n')));
    }
  }

  renderWarning(message: string): void {
    console.log(chalk.yellow('  Warning: ') + message);
  }

  renderInfo(message: string): void {
    console.log(chalk.cyan('  ') + message);
  }

  renderSuccess(message: string): void {
    console.log(chalk.green('  ✓ ') + message);
  }

  renderBox(title: string, content: string): void {
    const lines = content.split('\n');
    const maxLen = Math.max(title.length, ...lines.map((l) => l.length));
    const border = '─'.repeat(maxLen + 2);

    console.log('');
    console.log(chalk.dim(`  ┌${border}┐`));
    console.log(chalk.dim('  │ ') + chalk.bold(title.padEnd(maxLen)) + chalk.dim(' │'));
    console.log(chalk.dim(`  ├${border}┤`));
    for (const line of lines) {
      console.log(chalk.dim('  │ ') + line.padEnd(maxLen) + chalk.dim(' │'));
    }
    console.log(chalk.dim(`  └${border}┘`));
    console.log('');
  }

  renderTable(headers: string[], rows: string[][]): void {
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] || '').length)),
    );

    const headerLine = headers
      .map((h, i) => chalk.bold(h.padEnd(widths[i]!)))
      .join(chalk.dim(' │ '));
    const separator = widths.map((w) => '─'.repeat(w)).join(chalk.dim('─┼─'));

    console.log('');
    console.log('  ' + headerLine);
    console.log(chalk.dim('  ' + separator));
    for (const row of rows) {
      const line = row
        .map((cell, i) => cell.padEnd(widths[i]!))
        .join(chalk.dim(' │ '));
      console.log('  ' + line);
    }
    console.log('');
  }

  renderHelp(commands: Array<{ name: string; description: string }>): void {
    console.log('');
    console.log(chalk.bold.cyan('  qabot Commands'));
    console.log(chalk.dim('  ' + '─'.repeat(40)));
    console.log('');

    for (const cmd of commands) {
      console.log(
        chalk.cyan(`  /${cmd.name.padEnd(16)}`) + chalk.dim(cmd.description),
      );
    }

    console.log('');
    console.log(
      chalk.dim('  Type natural language to interact with the AI assistant'),
    );
    console.log('');
  }

  renderTokenUsage(inputTokens: number, outputTokens: number): void {
    console.log(
      chalk.dim(
        `  tokens: ${inputTokens} in / ${outputTokens} out (${inputTokens + outputTokens} total)`,
      ),
    );
  }

  clear(): void {
    console.clear();
  }

  private formatToolArgs(toolName: string, args: Record<string, unknown>): string {
    if (toolName === 'run_command' && args.command) {
      return truncate(String(args.command), 80);
    }
    if (toolName === 'read_file' && args.path) {
      return String(args.path);
    }
    if (toolName === 'write_file' && args.path) {
      return String(args.path);
    }
    if (toolName === 'edit_file' && args.path) {
      return String(args.path);
    }
    if (toolName === 'grep' && args.pattern) {
      return `"${args.pattern}"`;
    }
    if (toolName === 'browser_navigate' && args.url) {
      return String(args.url);
    }
    if (toolName === 'browser_click' && args.selector) {
      return String(args.selector);
    }
    if (toolName === 'glob_search' && args.pattern) {
      return String(args.pattern);
    }

    const keys = Object.keys(args);
    if (keys.length === 0) return '';
    if (keys.length === 1) return truncate(String(args[keys[0]!]), 60);
    return truncate(JSON.stringify(args), 80);
  }

  private formatResultPreview(result: unknown): string {
    if (result === undefined || result === null) {
      return 'Done';
    }
    if (typeof result === 'string') {
      if (result.length === 0) return 'Done';
      if (result.length > 200) {
        return truncate(result, 200);
      }
      return result;
    }
    return truncate(JSON.stringify(result), 200);
  }
}

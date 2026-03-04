/**
 * Shared streaming utilities for AI routes.
 *
 * Contains the core `streamScopedWithToolEvents` function, permission handling,
 * diff computation, and broadcast helpers used by multiple AI route modules
 * (api-ai.ts, api-recorder.ts, etc.).
 */
import type { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Orchestrator, PermissionCallback, ToolExecutionCallback } from '../../core/orchestrator.js';

// ── Permission resolution for UI-driven AI requests ─────────────────────────
// Pending permission requests keyed by a unique permission ID.
// The frontend sends back `ai-fix-permission-response` via WebSocket.
export const pendingPermissions = new Map<string, {
  resolve: (result: { granted: boolean; remember?: boolean }) => void;
  requestId: string;
}>();

/**
 * Set up WebSocket handler for permission responses.
 * Call once during route mounting; safe to call multiple times (handlers stack).
 */
export function setupPermissionHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ai-fix-permission-response') {
          const permId = msg.permissionId as string;
          const pending = pendingPermissions.get(permId);
          if (pending) {
            pendingPermissions.delete(permId);
            pending.resolve({
              granted: msg.granted === true,
              remember: msg.remember === true,
            });
          }
        }
      } catch { /* ignore malformed messages */ }
    });
  });
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcast(wss: WebSocketServer, message: object): void {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if ((client as WebSocket).readyState === 1) {
      client.send(data);
    }
  }
}

/**
 * Format tool arguments for display in the UI — short, readable summary.
 */
export function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
    return String(args.path || args.filePath || '');
  }
  if (toolName === 'run_command' || toolName === 'run_tests') {
    return String(args.command || '');
  }
  if (toolName === 'glob_search' || toolName === 'grep') {
    return String(args.pattern || '');
  }
  if (toolName === 'create_directory') {
    return String(args.path || '');
  }
  if (toolName.startsWith('browser_')) {
    return String(args.url || args.selector || args.text || '');
  }
  // Generic: show first string-valued arg
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.length > 0) return v.length > 80 ? v.slice(0, 77) + '...' : v;
  }
  return '';
}

/**
 * Truncate tool result for UI display (avoid huge payloads).
 */
export function truncateResult(result: unknown): string {
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (!str) return '';
  return str.length > 300 ? str.slice(0, 297) + '...' : str;
}

// ── Diff Computation ──────────────────────────────────────────────────────────

/**
 * Compute a unified diff between two strings with context lines.
 * Produces output similar to `git diff --unified=3`.
 * No external dependencies — simple LCS-based line diff.
 */
export function computeUnifiedDiff(filePath: string, before: string, after: string, isNew: boolean): string {
  const oldLines = before ? before.split('\n') : [];
  const newLines = after.split('\n');

  if (isNew) {
    // New file — all lines are additions
    const header = `--- /dev/null\n+++ b/${filePath}`;
    const hunk = `@@ -0,0 +1,${newLines.length} @@`;
    const body = newLines.map(l => `+${l}`).join('\n');
    return `${header}\n${hunk}\n${body}`;
  }

  // Simple line-by-line diff using LCS (Longest Common Subsequence)
  const CONTEXT = 3;
  const changes = diffLines(oldLines, newLines);

  // Group changes into hunks with context
  const hunks: string[] = [];
  let i = 0;
  while (i < changes.length) {
    // Find start of next changed region
    while (i < changes.length && changes[i]!.type === 'equal') i++;
    if (i >= changes.length) break;

    // Determine context start
    const contextStart = Math.max(0, i - CONTEXT);
    const hunkLines: string[] = [];

    // Calculate starting line numbers
    let oldLine = 1;
    let newLine = 1;
    for (let j = 0; j < contextStart; j++) {
      const c = changes[j]!;
      if (c.type === 'equal') { oldLine++; newLine++; }
      else if (c.type === 'remove') { oldLine++; }
      else if (c.type === 'add') { newLine++; }
    }
    const oldStart = oldLine;
    const newStart = newLine;

    // Add leading context
    for (let j = contextStart; j < i; j++) {
      hunkLines.push(` ${changes[j]!.line}`);
    }

    // Add changes and trailing context
    let oldCount = i - contextStart;
    let newCount = i - contextStart;
    while (i < changes.length) {
      const c = changes[i]!;
      if (c.type === 'equal') {
        // Check if we've left the changed region (enough context after)
        let nextChange = i + 1;
        while (nextChange < changes.length && changes[nextChange]!.type === 'equal') nextChange++;
        if (nextChange >= changes.length || nextChange - i > CONTEXT * 2) {
          // Add trailing context and end hunk
          const trailEnd = Math.min(i + CONTEXT, changes.length);
          for (let j = i; j < trailEnd; j++) {
            hunkLines.push(` ${changes[j]!.line}`);
            oldCount++;
            newCount++;
          }
          i = trailEnd;
          break;
        }
        hunkLines.push(` ${c.line}`);
        oldCount++;
        newCount++;
      } else if (c.type === 'remove') {
        hunkLines.push(`-${c.line}`);
        oldCount++;
      } else if (c.type === 'add') {
        hunkLines.push(`+${c.line}`);
        newCount++;
      }
      i++;
    }

    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${hunkLines.join('\n')}`);
  }

  if (hunks.length === 0) return ''; // No changes

  const header = `--- a/${filePath}\n+++ b/${filePath}`;
  return `${header}\n${hunks.join('\n')}`;
}

/**
 * Simple line diff using Myers' algorithm (simplified).
 * Returns an array of { type: 'equal'|'add'|'remove', line } entries.
 */
export function diffLines(oldLines: string[], newLines: string[]): Array<{ type: 'equal' | 'add' | 'remove'; line: string }> {
  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, use a simpler approach to avoid memory issues
  if (m + n > 10000) {
    return simpleDiff(oldLines, newLines);
  }

  // LCS dynamic programming
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to build diff
  const stack: Array<{ type: 'equal' | 'add' | 'remove'; line: string }> = [];
  let ci = m;
  let cj = n;

  while (ci > 0 || cj > 0) {
    if (ci > 0 && cj > 0 && oldLines[ci - 1] === newLines[cj - 1]) {
      stack.push({ type: 'equal', line: oldLines[ci - 1]! });
      ci--;
      cj--;
    } else if (cj > 0 && (ci === 0 || dp[ci]![cj - 1]! >= dp[ci - 1]![cj]!)) {
      stack.push({ type: 'add', line: newLines[cj - 1]! });
      cj--;
    } else {
      stack.push({ type: 'remove', line: oldLines[ci - 1]! });
      ci--;
    }
  }

  // Reverse the stack (we built it backwards)
  const result: Array<{ type: 'equal' | 'add' | 'remove'; line: string }> = [];
  while (stack.length > 0) {
    result.push(stack.pop()!);
  }

  return result;
}

/**
 * Simple diff for very large files — just show removed then added.
 */
export function simpleDiff(oldLines: string[], newLines: string[]): Array<{ type: 'equal' | 'add' | 'remove'; line: string }> {
  const result: Array<{ type: 'equal' | 'add' | 'remove'; line: string }> = [];
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Lines in both → equal, only in old → remove, only in new → add
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length && ni < newLines.length) {
    if (oldLines[oi] === newLines[ni]) {
      result.push({ type: 'equal', line: oldLines[oi]! });
      oi++;
      ni++;
    } else if (!newSet.has(oldLines[oi]!)) {
      result.push({ type: 'remove', line: oldLines[oi]! });
      oi++;
    } else if (!oldSet.has(newLines[ni]!)) {
      result.push({ type: 'add', line: newLines[ni]! });
      ni++;
    } else {
      result.push({ type: 'remove', line: oldLines[oi]! });
      oi++;
    }
  }
  while (oi < oldLines.length) {
    result.push({ type: 'remove', line: oldLines[oi]! });
    oi++;
  }
  while (ni < newLines.length) {
    result.push({ type: 'add', line: newLines[ni]! });
    ni++;
  }
  return result;
}

// ── Scoped Streaming with Tool Events ─────────────────────────────────────────

/**
 * Stream AI response scoped to a specific requestId, with full tool event
 * streaming and UI-driven permission handling.
 *
 * Temporarily overrides the orchestrator's permissionCallback and
 * toolExecutionCallback so that all tool activity is routed to the
 * WebSocket frontend instead of the CLI REPL. Restores original
 * callbacks when the stream is done.
 */
export async function streamScopedWithToolEvents(
  orchestrator: Orchestrator,
  wss: WebSocketServer,
  prompt: string,
  requestId: string,
): Promise<void> {
  // Save original callbacks so we can restore them after this request
  const origPermission = (orchestrator as any).permissionCallback as PermissionCallback | undefined;
  const origToolExec = (orchestrator as any).toolExecutionCallback as ToolExecutionCallback | undefined;

  let permCounter = 0;

  // UI-driven permission callback: sends a prompt to the frontend,
  // waits for the user to click Allow/Deny in the browser.
  const uiPermissionCallback: PermissionCallback = async (toolName, args) => {
    // Auto-approve read-level tools (same as CLI behavior)
    const readTools = [
      'read_file', 'file_exists', 'list_directory', 'glob_search', 'grep',
      'system_info', 'browser_get_text', 'browser_get_url', 'browser_get_title',
      'browser_inspect', 'browser_screenshot', 'get_test_results',
      'browser_list_tabs', 'browser_list_frames',
    ];
    if (readTools.includes(toolName)) {
      return { granted: true };
    }

    const permissionId = `${requestId}-perm-${++permCounter}`;

    // Broadcast permission request to UI
    broadcast(wss, {
      type: 'ai-fix-permission',
      requestId,
      permissionId,
      toolName,
      args: formatToolArgs(toolName, args),
    });

    // Wait for UI response (with 120s timeout)
    return new Promise<{ granted: boolean; remember?: boolean }>((resolve) => {
      const timeout = setTimeout(() => {
        pendingPermissions.delete(permissionId);
        resolve({ granted: false });
      }, 120_000);

      pendingPermissions.set(permissionId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        requestId,
      });
    });
  };

  // ── File diff capture ─────────────────────────────────────────────────────
  const fileSnapshots = new Map<string, string | null>();
  const projectPath = (orchestrator as any).workingDirectory || process.cwd();

  const captureBeforeSnapshot = async (toolName: string, args: Record<string, unknown>) => {
    if (toolName !== 'write_file' && toolName !== 'edit_file') return;
    const rawPath = (args.path || args.filePath || '') as string;
    if (!rawPath) return;
    const fullPath = rawPath.startsWith('/') || rawPath.match(/^[a-zA-Z]:[\\/]/) ? resolve(rawPath) : resolve(projectPath, rawPath);
    try {
      if (existsSync(fullPath)) {
        const content = await readFileAsync(fullPath, 'utf-8');
        fileSnapshots.set(fullPath, content);
      } else {
        fileSnapshots.set(fullPath, null); // new file
      }
    } catch {
      fileSnapshots.set(fullPath, null);
    }
  };

  const captureAfterAndBroadcastDiff = async (toolName: string, args: Record<string, unknown>) => {
    if (toolName !== 'write_file' && toolName !== 'edit_file') return;
    const rawPath = (args.path || args.filePath || '') as string;
    if (!rawPath) return;
    const fullPath = rawPath.startsWith('/') || rawPath.match(/^[a-zA-Z]:[\\/]/) ? resolve(rawPath) : resolve(projectPath, rawPath);
    const before = fileSnapshots.get(fullPath);
    fileSnapshots.delete(fullPath);
    try {
      const after = await readFileAsync(fullPath, 'utf-8');
      const isNew = before === null || before === undefined;
      const relPath = relative(projectPath, fullPath).replace(/\\/g, '/');
      const diff = computeUnifiedDiff(relPath, before || '', after, isNew);
      const linesAdded = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const linesRemoved = diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length;

      broadcast(wss, {
        type: 'ai-fix-file-diff',
        requestId,
        filePath: relPath,
        diffType: isNew ? 'new' : 'modified',
        diff,
        linesAdded,
        linesRemoved,
      });
    } catch { /* file may have been deleted or moved — skip diff */ }
  };

  // UI-driven tool execution callback: streams tool start/complete/error/denied
  const uiToolCallback: ToolExecutionCallback = (phase, toolName, args, result, error) => {
    // Capture file snapshot before write/edit
    if (phase === 'start') {
      captureBeforeSnapshot(toolName, args).catch(() => {});
    }
    // Compute and broadcast diff after write/edit completes
    if (phase === 'complete') {
      captureAfterAndBroadcastDiff(toolName, args).catch(() => {});
    }

    broadcast(wss, {
      type: 'ai-fix-tool',
      requestId,
      phase,
      toolName,
      args: formatToolArgs(toolName, args),
      result: phase === 'complete' ? truncateResult(result) : undefined,
      error: phase === 'error' ? (error?.message || String(error)) : undefined,
    });
  };

  // Install UI callbacks
  orchestrator.setPermissionCallback(uiPermissionCallback);
  orchestrator.setToolExecutionCallback(uiToolCallback);

  try {
    // IMPORTANT: The orchestrator yields 'done' chunks on EVERY LLM turn,
    // not just at the end. We must NOT forward intermediate 'done' chunks
    // as 'ai-fix-done' (which tells the frontend the whole process is
    // finished). Instead, we only send 'ai-fix-done' ONCE, after the
    // entire processStream() generator is exhausted.
    for await (const chunk of orchestrator.processStream(prompt)) {
      if (chunk.type === 'text') {
        broadcast(wss, { type: 'ai-fix-stream', requestId, content: chunk.content });
      } else if (chunk.type === 'status') {
        broadcast(wss, { type: 'ai-fix-status', requestId, message: chunk.message });
      } else if (chunk.type === 'done') {
        // Don't forward yet — this is just an intermediate LLM turn ending.
      } else if (chunk.type === 'error') {
        broadcast(wss, { type: 'ai-fix-error', requestId, message: chunk.error });
      }
    }
    // NOW the stream is truly finished — send the final done signal
    broadcast(wss, { type: 'ai-fix-done', requestId });
  } catch (error) {
    broadcast(wss, { type: 'ai-fix-error', requestId, message: String(error) });
  } finally {
    // Restore original CLI callbacks
    if (origPermission) orchestrator.setPermissionCallback(origPermission);
    if (origToolExec) orchestrator.setToolExecutionCallback(origToolExec);

    // Clean up any pending permissions for this request
    for (const [id, pending] of pendingPermissions) {
      if (pending.requestId === requestId) {
        pendingPermissions.delete(id);
      }
    }
  }
}

/**
 * Stream AI response scoped to a specific requestId, WITHOUT tool access.
 *
 * Uses the orchestrator's LLM router directly, sending the prompt as a
 * user message with NO tool definitions. The LLM can only output text,
 * making it ideal for structured data generation (JSON output, analysis, etc.)
 * where tool execution would interfere with the expected output format.
 *
 * Broadcasts:
 *  - `ai-fix-stream`  with `{ requestId, content }` for each text chunk
 *  - `ai-fix-done`    with `{ requestId }` when complete
 *  - `ai-fix-error`   with `{ requestId, message }` on error
 */
export async function streamTextOnlyScoped(
  orchestrator: Orchestrator,
  wss: WebSocketServer,
  prompt: string,
  requestId: string,
): Promise<void> {
  try {
    const router = (orchestrator as any).getRouter
      ? (orchestrator as any).getRouter()
      : (orchestrator as any).router;

    if (!router) {
      broadcast(wss, { type: 'ai-fix-error', requestId, message: 'LLM router not available' });
      return;
    }

    const request = {
      messages: [
        { role: 'user' as const, content: prompt },
      ],
      // NO tools — LLM can only produce text output
    };

    for await (const chunk of router.stream(request)) {
      if (chunk.type === 'text') {
        broadcast(wss, { type: 'ai-fix-stream', requestId, content: chunk.content });
      } else if (chunk.type === 'error') {
        broadcast(wss, { type: 'ai-fix-error', requestId, message: chunk.error });
      }
      // 'done' and 'status' chunks are ignored — we send our own done below
    }

    broadcast(wss, { type: 'ai-fix-done', requestId });
  } catch (error) {
    broadcast(wss, { type: 'ai-fix-error', requestId, message: String(error) });
  }
}

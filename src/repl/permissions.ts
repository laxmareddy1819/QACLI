import chalk from 'chalk';

export type PermissionLevel = 'read' | 'write' | 'execute' | 'browser' | 'dangerous';

const TOOL_PERMISSION_LEVELS: Record<string, PermissionLevel> = {
  read_file: 'read',
  file_exists: 'read',
  list_directory: 'read',
  glob_search: 'read',
  grep: 'read',
  system_info: 'read',
  browser_get_text: 'read',
  browser_get_url: 'read',
  browser_get_title: 'read',
  browser_inspect: 'read',
  browser_screenshot: 'read',
  get_test_results: 'read',

  write_file: 'write',
  edit_file: 'write',
  create_directory: 'write',
  find_replace: 'write',
  generate_test_code: 'write',

  run_command: 'execute',
  run_tests: 'execute',
  api_request: 'execute',
  api_validate_schema: 'read',

  browser_launch: 'browser',
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_evaluate: 'browser',
  browser_wait_for: 'browser',
  browser_press_key: 'browser',
  browser_hover: 'browser',
  browser_select: 'browser',
  browser_close: 'browser',

  // Tab/Window management
  browser_list_tabs: 'read',
  browser_switch_tab: 'browser',
  browser_new_tab: 'browser',
  browser_close_tab: 'browser',

  // Frame/IFrame management
  browser_list_frames: 'read',
  browser_switch_frame: 'browser',

  delete_file: 'dangerous',
};

// Callback type for writing prompts — set by the REPL to use its own readline
type PromptWriter = (question: string) => Promise<string>;

export class PermissionManager {
  private trustMode = false;
  private sessionApprovals = new Set<string>();
  private categoryApprovals = new Set<PermissionLevel>();
  private promptWriter: PromptWriter | null = null;

  /**
   * Set a prompt writer callback. This must be called by the REPL
   * so permission prompts use the same readline interface instead of
   * creating a conflicting one on stdin.
   */
  setPromptWriter(writer: PromptWriter): void {
    this.promptWriter = writer;
  }

  isTrustMode(): boolean {
    return this.trustMode;
  }

  toggleTrustMode(): boolean {
    this.trustMode = !this.trustMode;
    return this.trustMode;
  }

  needsPermission(toolName: string): boolean {
    if (this.trustMode) return false;

    const level = TOOL_PERMISSION_LEVELS[toolName] || 'execute';

    // Read operations are always auto-approved
    if (level === 'read') return false;

    // Check session-level approvals
    if (this.sessionApprovals.has(toolName)) return false;

    // Check category-level approvals
    if (this.categoryApprovals.has(level)) return false;

    return true;
  }

  async requestPermission(
    toolName: string,
    _args: Record<string, unknown>,
  ): Promise<{ granted: boolean; remember?: boolean }> {
    if (!this.needsPermission(toolName)) {
      return { granted: true };
    }

    const level = TOOL_PERMISSION_LEVELS[toolName] || 'execute';
    const question = chalk.yellow(`  Allow ${toolName}?`) +
      chalk.dim(` [y]es / [n]o / [a]lways for ${level}: `);

    const answer = await this.promptUser(question);
    const lower = answer.toLowerCase().trim();

    if (lower === 'y' || lower === 'yes') {
      this.sessionApprovals.add(toolName);
      return { granted: true };
    }

    if (lower === 'a' || lower === 'always') {
      this.categoryApprovals.add(level);
      return { granted: true, remember: true };
    }

    return { granted: false };
  }

  reset(): void {
    this.sessionApprovals.clear();
    this.categoryApprovals.clear();
    this.trustMode = false;
  }

  private async promptUser(question: string): Promise<string> {
    if (this.promptWriter) {
      return this.promptWriter(question);
    }
    // Fallback: write directly to stdout and read one line from stdin
    // This avoids creating a conflicting readline interface
    return new Promise((resolve) => {
      process.stdout.write(question);
      const onData = (data: Buffer) => {
        process.stdin.removeListener('data', onData);
        resolve(data.toString().trim());
      };
      process.stdin.once('data', onData);
    });
  }
}

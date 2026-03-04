import simpleGit, { type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { StoredRun, StoredTestCase } from '../types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitBlameEntry {
  line: number;
  author: string;
  email: string;
  commitSha: string;
  commitMessage: string;
  timestamp: string;
}

export interface GitBlameResult {
  filePath: string;
  entries: GitBlameEntry[];
  lastModifiedBy: string;
  lastModifiedAt: string;
  lastCommitSha: string;
  lastCommitMessage: string;
}

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  message: string;
  timestamp: string;
  filesChanged?: string[];
}

export interface GitStatusResult {
  available: boolean;
  branch?: string;
  isClean?: boolean;
  lastCommit?: GitCommitInfo;
  uncommittedChanges?: Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' }>;
  ahead?: number;
  behind?: number;
}

export interface CommitCorrelation {
  commit: GitCommitInfo;
  newFailures: string[];
  fixedTests: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface FailureOwnership {
  testName: string;
  suggestedOwner: {
    name: string;
    email: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  };
  alternativeOwners: Array<{
    name: string;
    email: string;
    reason: string;
  }>;
}

export interface ChurnResult {
  filePath: string;
  editCount: number;
  daysSpan: number;
  churnScore: number;
  contributors: string[];
}

export interface CommitDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface CommitDiff {
  sha: string;
  author: string;
  message: string;
  timestamp: string;
  files: CommitDiffFile[];
}

export interface UncommittedDiffFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface UncommittedDiffResult {
  files: UncommittedDiffFile[];
  stagedCount: number;
  unstagedCount: number;
}

// ── GitService ───────────────────────────────────────────────────────────────

export class GitService {
  private git: SimpleGit;
  private projectPath: string;
  private available: boolean | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.git = simpleGit(projectPath);
  }

  /** Check if the project is inside a git working tree */
  async checkAvailability(): Promise<boolean> {
    // Only cache positive results — if git was not available, always recheck
    // so that `git init` is picked up without restarting the server
    if (this.available === true) return true;
    try {
      const result = await this.git.raw(['rev-parse', '--is-inside-work-tree']);
      this.available = result.trim() === 'true';
    } catch {
      this.available = false;
    }
    return this.available;
  }

  isAvailable(): boolean {
    return this.available === true;
  }

  // ── Status ──────────────────────────────────────────────────────────────

  async getStatus(): Promise<GitStatusResult> {
    if (!(await this.checkAvailability())) {
      return { available: false };
    }

    try {
      const status = await this.git.status();

      // git log throws on empty repos (no commits yet) — handle gracefully
      let latest: { hash: string; author_name: string; author_email: string; message: string; date: string } | null = null;
      try {
        const logResult = await this.git.log({ maxCount: 1 });
        latest = logResult.latest || null;
      } catch { /* empty repo — no commits yet */ }

      let ahead = 0;
      let behind = 0;
      try {
        const tracking = status.tracking;
        if (tracking) {
          const abResult = await this.git.raw(['rev-list', '--left-right', '--count', `${tracking}...HEAD`]);
          const parts = abResult.trim().split(/\s+/);
          behind = parseInt(parts[0] || '0', 10);
          ahead = parseInt(parts[1] || '0', 10);
        }
      } catch { /* no tracking branch */ }

      const uncommittedChanges: GitStatusResult['uncommittedChanges'] = [];
      for (const f of status.modified) uncommittedChanges.push({ path: f, status: 'modified' });
      for (const f of status.not_added) uncommittedChanges.push({ path: f, status: 'untracked' });
      for (const f of status.created) uncommittedChanges.push({ path: f, status: 'added' });
      for (const f of status.deleted) uncommittedChanges.push({ path: f, status: 'deleted' });
      for (const f of status.renamed) uncommittedChanges.push({ path: (f as any).to || String(f), status: 'renamed' });

      return {
        available: true,
        branch: status.current || undefined,
        isClean: status.isClean(),
        lastCommit: latest ? {
          sha: latest.hash,
          shortSha: latest.hash.slice(0, 7),
          author: latest.author_name,
          email: latest.author_email,
          message: latest.message,
          timestamp: latest.date,
        } : undefined,
        uncommittedChanges,
        ahead,
        behind,
      };
    } catch {
      return { available: false };
    }
  }

  // ── Blame ───────────────────────────────────────────────────────────────

  async blame(filePath: string): Promise<GitBlameResult | null> {
    if (!(await this.checkAvailability())) return null;

    try {
      const raw = await this.git.raw(['blame', '--porcelain', filePath]);
      const entries = this.parsePorcelainBlame(raw);

      if (entries.length === 0) return null;

      // Find the most recent entry
      let latest = entries[0]!;
      for (const e of entries) {
        if (new Date(e.timestamp).getTime() > new Date(latest.timestamp).getTime()) {
          latest = e;
        }
      }

      return {
        filePath,
        entries,
        lastModifiedBy: latest.author,
        lastModifiedAt: latest.timestamp,
        lastCommitSha: latest.commitSha,
        lastCommitMessage: latest.commitMessage,
      };
    } catch {
      return null;
    }
  }

  private parsePorcelainBlame(raw: string): GitBlameEntry[] {
    const lines = raw.split('\n');
    const entries: GitBlameEntry[] = [];
    const commitCache = new Map<string, { author: string; email: string; message: string; timestamp: string }>();

    let i = 0;
    while (i < lines.length) {
      const headerMatch = lines[i]?.match(/^([a-f0-9]{40})\s+(\d+)\s+(\d+)/);
      if (!headerMatch) { i++; continue; }

      const commitSha = headerMatch[1]!;
      const lineNum = parseInt(headerMatch[3]!, 10);

      // Parse header fields until we hit the content line (starts with \t)
      let author = '';
      let email = '';
      let message = '';
      let timestamp = '';
      i++;

      while (i < lines.length && !lines[i]?.startsWith('\t')) {
        const line = lines[i]!;
        if (line.startsWith('author ')) author = line.slice(7);
        else if (line.startsWith('author-mail ')) email = line.slice(12).replace(/[<>]/g, '');
        else if (line.startsWith('author-time ')) {
          const unixTs = parseInt(line.slice(12), 10);
          timestamp = new Date(unixTs * 1000).toISOString();
        }
        else if (line.startsWith('summary ')) message = line.slice(8);
        i++;
      }

      // Skip the content line (starts with \t)
      if (i < lines.length && lines[i]?.startsWith('\t')) i++;

      // Cache commit data for dedup
      if (!commitCache.has(commitSha)) {
        commitCache.set(commitSha, { author, email, message, timestamp });
      }

      const cached = commitCache.get(commitSha)!;
      entries.push({
        line: lineNum,
        author: author || cached.author,
        email: email || cached.email,
        commitSha: commitSha.slice(0, 7),
        commitMessage: message || cached.message,
        timestamp: timestamp || cached.timestamp,
      });
    }

    return entries;
  }

  // ── Log / History ───────────────────────────────────────────────────────

  async getRecentCommits(limit = 20): Promise<GitCommitInfo[]> {
    if (!(await this.checkAvailability())) return [];

    try {
      const logResult = await this.git.log({ maxCount: limit, '--name-only': null } as any);
      return logResult.all.map(entry => ({
        sha: entry.hash,
        shortSha: entry.hash.slice(0, 7),
        author: entry.author_name,
        email: entry.author_email,
        message: entry.message,
        timestamp: entry.date,
        filesChanged: (entry as any).diff?.files?.map((f: any) => f.file) || this.extractFilesFromBody(entry.body),
      }));
    } catch {
      return [];
    }
  }

  async getFileHistory(filePath: string, limit = 20): Promise<GitCommitInfo[]> {
    if (!(await this.checkAvailability())) return [];

    try {
      const logResult = await this.git.log({ maxCount: limit, file: filePath, '--follow': null, '--stat': null } as any);
      return logResult.all.map(entry => {
        // Extract lines changed from diff stat
        return {
          sha: entry.hash,
          shortSha: entry.hash.slice(0, 7),
          author: entry.author_name,
          email: entry.author_email,
          message: entry.message,
          timestamp: entry.date,
        };
      });
    } catch {
      return [];
    }
  }

  async getCommitsBetween(fromSha: string, toSha: string): Promise<GitCommitInfo[]> {
    if (!(await this.checkAvailability())) return [];

    try {
      const raw = await this.git.raw([
        'log', '--format=%H|%h|%an|%ae|%s|%aI', '--name-only',
        `${fromSha}..${toSha}`,
      ]);

      return this.parseCustomLog(raw);
    } catch {
      return [];
    }
  }

  private extractFilesFromBody(body: string): string[] {
    if (!body) return [];
    return body.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('*') && !l.includes(' '));
  }

  private parseCustomLog(raw: string): GitCommitInfo[] {
    const commits: GitCommitInfo[] = [];
    const lines = raw.trim().split('\n');
    let current: GitCommitInfo | null = null;

    for (const line of lines) {
      if (line.includes('|')) {
        const parts = line.split('|');
        if (parts.length >= 6) {
          if (current) commits.push(current);
          current = {
            sha: parts[0]!,
            shortSha: parts[1]!,
            author: parts[2]!,
            email: parts[3]!,
            message: parts[4]!,
            timestamp: parts[5]!,
            filesChanged: [],
          };
          continue;
        }
      }
      // File name line (part of --name-only output)
      if (current && line.trim().length > 0) {
        current.filesChanged?.push(line.trim());
      }
    }
    if (current) commits.push(current);
    return commits;
  }

  // ── Diff ────────────────────────────────────────────────────────────────

  async getCommitDiff(sha: string): Promise<CommitDiff | null> {
    if (!(await this.checkAvailability())) return null;

    try {
      const logResult = await this.git.log({ maxCount: 1, from: `${sha}~1`, to: sha } as any);
      const entry = logResult.latest;
      if (!entry) return null;

      // Get the diff with stat + patch
      const diffRaw = await this.git.raw(['diff', '--stat', '--patch', `${sha}~1`, sha]);
      const files = this.parseDiffOutput(diffRaw);

      return {
        sha: entry.hash,
        author: entry.author_name,
        message: entry.message,
        timestamp: entry.date,
        files,
      };
    } catch {
      return null;
    }
  }

  private parseDiffOutput(raw: string): CommitDiffFile[] {
    const files: CommitDiffFile[] = [];
    // Parse unified diff output for file-level info
    const diffSections = raw.split(/^diff --git /m).filter(Boolean);

    for (const section of diffSections) {
      const headerLine = section.split('\n')[0] || '';
      const pathMatch = headerLine.match(/b\/(.+)$/);
      if (!pathMatch) continue;

      const path = pathMatch[1]!;
      let status: CommitDiffFile['status'] = 'modified';
      if (section.includes('new file mode')) status = 'added';
      else if (section.includes('deleted file mode')) status = 'deleted';
      else if (section.includes('rename from')) status = 'renamed';

      // Count additions/deletions
      let additions = 0;
      let deletions = 0;
      const patchLines = section.split('\n');
      for (const pl of patchLines) {
        if (pl.startsWith('+') && !pl.startsWith('+++')) additions++;
        else if (pl.startsWith('-') && !pl.startsWith('---')) deletions++;
      }

      // Extract patch (limit size)
      const patchStart = section.indexOf('@@');
      const patch = patchStart >= 0 ? section.slice(patchStart).slice(0, 5000) : undefined;

      files.push({ path, status, additions, deletions, patch });
    }

    return files;
  }

  // ── Uncommitted Diff ──────────────────────────────────────────────────

  /**
   * Get unified diff for all uncommitted changes (staged + unstaged).
   * If filePath is provided, returns diff for that single file only.
   */
  async getUncommittedDiff(filePath?: string): Promise<UncommittedDiffResult> {
    if (!(await this.checkAvailability())) {
      return { files: [], stagedCount: 0, unstagedCount: 0 };
    }

    try {
      const files: UncommittedDiffFile[] = [];

      // 1. Staged changes (git diff --cached)
      const stagedArgs = ['diff', '--cached'];
      if (filePath) stagedArgs.push('--', filePath);
      try {
        const stagedRaw = await this.git.raw(stagedArgs);
        if (stagedRaw.trim()) {
          const stagedFiles = this.parseDiffOutput(stagedRaw);
          for (const f of stagedFiles) {
            files.push({
              path: f.path,
              status: f.status === 'added' ? 'added' : f.status,
              staged: true,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            });
          }
        }
      } catch { /* no staged changes */ }

      // 2. Unstaged changes (git diff)
      const unstagedArgs = ['diff'];
      if (filePath) unstagedArgs.push('--', filePath);
      try {
        const unstagedRaw = await this.git.raw(unstagedArgs);
        if (unstagedRaw.trim()) {
          const unstagedFiles = this.parseDiffOutput(unstagedRaw);
          for (const f of unstagedFiles) {
            files.push({
              path: f.path,
              status: f.status === 'added' ? 'added' : f.status,
              staged: false,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            });
          }
        }
      } catch { /* no unstaged changes */ }

      // 3. Untracked files (not shown by git diff)
      try {
        const status = await this.git.status();
        const untrackedFiles = filePath
          ? status.not_added.filter(f => f === filePath || filePath.endsWith(f))
          : status.not_added;

        for (const f of untrackedFiles.slice(0, 20)) {
          try {
            const fullPath = join(this.projectPath, f);
            const fileContent = await readFile(fullPath, 'utf-8');
            const lines = fileContent.split('\n');
            const patch = lines.map(l => `+${l}`).join('\n').slice(0, 5000);
            files.push({
              path: f,
              status: 'untracked',
              staged: false,
              additions: lines.length,
              deletions: 0,
              patch,
            });
          } catch { /* skip unreadable files */ }
        }
      } catch { /* ignore status errors */ }

      return {
        files,
        stagedCount: files.filter(f => f.staged).length,
        unstagedCount: files.filter(f => !f.staged).length,
      };
    } catch {
      return { files: [], stagedCount: 0, unstagedCount: 0 };
    }
  }

  // ── Churn ───────────────────────────────────────────────────────────────

  async getChurnScore(filePath: string, days = 30): Promise<ChurnResult | null> {
    if (!(await this.checkAvailability())) return null;

    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const logResult = await this.git.log({
        maxCount: 100,
        file: filePath,
        '--follow': null,
        '--since': since,
      } as any);

      const contributors = new Set<string>();
      for (const entry of logResult.all) {
        contributors.add(entry.author_name);
      }

      const editCount = logResult.total;
      return {
        filePath,
        editCount,
        daysSpan: days,
        churnScore: editCount,
        contributors: Array.from(contributors),
      };
    } catch {
      return null;
    }
  }

  // ── Phase 2: Correlation ───────────────────────────────────────────────

  async correlateFailures(currentRun: StoredRun, previousRun: StoredRun | null): Promise<CommitCorrelation[]> {
    if (!(await this.checkAvailability())) return [];
    if (!currentRun.gitCommitSha || !previousRun?.gitCommitSha) return [];
    if (currentRun.gitCommitSha === previousRun.gitCommitSha) return [];

    try {
      // Resolve short SHAs to full SHAs for range query
      let fromSha: string;
      let toSha: string;
      try {
        fromSha = (await this.git.raw(['rev-parse', previousRun.gitCommitSha])).trim();
        toSha = (await this.git.raw(['rev-parse', currentRun.gitCommitSha])).trim();
      } catch {
        return [];
      }

      const commits = await this.getCommitsBetween(fromSha, toSha);
      if (commits.length === 0) return [];

      // Find new failures (failed in current, passed or not present in previous)
      const prevPassedSet = new Set(
        previousRun.tests.filter(t => t.status === 'passed').map(t => t.name),
      );
      const currentFailed = currentRun.tests.filter(t => t.status === 'failed');
      const newFailures = currentFailed.filter(t => prevPassedSet.has(t.name));

      // Find fixed tests (passed in current, failed in previous)
      const prevFailedSet = new Set(
        previousRun.tests.filter(t => t.status === 'failed').map(t => t.name),
      );
      const fixedTests = currentRun.tests
        .filter(t => t.status === 'passed' && prevFailedSet.has(t.name))
        .map(t => t.name);

      if (newFailures.length === 0 && fixedTests.length === 0) return [];

      // For each commit, check if its changed files correlate with failures
      const correlations: CommitCorrelation[] = [];

      for (const commit of commits) {
        const changedFiles = commit.filesChanged || [];
        const relatedFailures: string[] = [];
        let highestConfidence: 'high' | 'medium' | 'low' = 'low';
        let reason = 'Temporal correlation — commit occurred between runs';

        for (const failure of newFailures) {
          // High confidence: commit modified the test file itself
          if (failure.file && changedFiles.some(f => f.endsWith(failure.file!))) {
            relatedFailures.push(failure.name);
            highestConfidence = 'high';
            reason = `Commit modified test file ${failure.file}`;
            continue;
          }

          // Medium confidence: commit modified a file mentioned in stack trace
          if (failure.stackTrace) {
            const stackFiles = this.extractFilesFromStackTrace(failure.stackTrace);
            const overlap = stackFiles.filter(sf => changedFiles.some(cf => cf.endsWith(sf)));
            if (overlap.length > 0) {
              relatedFailures.push(failure.name);
              if (highestConfidence !== 'high') {
                highestConfidence = 'medium';
                reason = `Commit modified ${overlap.length} file(s) referenced in stack traces`;
              }
            }
          }
        }

        if (relatedFailures.length > 0 || fixedTests.length > 0) {
          correlations.push({
            commit,
            newFailures: relatedFailures,
            fixedTests: relatedFailures.length > 0 ? [] : fixedTests,
            confidence: highestConfidence,
            reason,
          });
        }
      }

      // If we have new failures but no direct correlations, add a low-confidence entry for the latest commit
      if (correlations.length === 0 && newFailures.length > 0 && commits.length > 0) {
        correlations.push({
          commit: commits[0]!,
          newFailures: newFailures.map(f => f.name),
          fixedTests: [],
          confidence: 'low',
          reason: 'Temporal correlation — failures appeared after these commits',
        });
      }

      return correlations;
    } catch {
      return [];
    }
  }

  private extractFilesFromStackTrace(stackTrace: string): string[] {
    const files = new Set<string>();
    // Match common patterns: at file.ts:42:15, (file.ts:42:15), file.spec.ts:42
    const patterns = [
      /(?:at\s+)?(?:\S+\s+\()?([^\s()]+\.[a-zA-Z]{1,5}):(\d+)/g,
      /([a-zA-Z0-9_/\\.-]+\.[a-zA-Z]{1,5}):\d+:\d+/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(stackTrace)) !== null) {
        const filePath = match[1]!;
        // Filter out node_modules and internal paths
        if (!filePath.includes('node_modules') && !filePath.startsWith('internal/')) {
          // Normalize path separators
          const normalized = filePath.replace(/\\/g, '/');
          // Get relative path (take last 3 segments)
          const segments = normalized.split('/');
          files.add(segments.slice(-Math.min(segments.length, 3)).join('/'));
        }
      }
    }

    return Array.from(files);
  }

  // ── Phase 2: Ownership ─────────────────────────────────────────────────

  async getFailureOwnership(test: StoredTestCase): Promise<FailureOwnership | null> {
    if (!(await this.checkAvailability())) return null;
    if (!test.file && !test.stackTrace) return null;

    try {
      const alternativeOwners: FailureOwnership['alternativeOwners'] = [];
      let suggestedOwner: FailureOwnership['suggestedOwner'] | null = null;

      // 1. Try to blame the specific failing line from stack trace
      if (test.stackTrace && test.file) {
        const lineMatch = test.stackTrace.match(new RegExp(
          test.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)',
        ));

        if (lineMatch) {
          const lineNum = parseInt(lineMatch[1]!, 10);
          const blameResult = await this.blame(test.file);
          if (blameResult) {
            const lineEntry = blameResult.entries.find(e => e.line === lineNum);
            if (lineEntry) {
              suggestedOwner = {
                name: lineEntry.author,
                email: lineEntry.email,
                reason: `Authored the failing line (${test.file}:${lineNum})`,
                confidence: 'high',
              };
            }
          }
        }
      }

      // 2. Blame the test file — last modifier
      if (test.file) {
        const blameResult = await this.blame(test.file);
        if (blameResult) {
          const owner = {
            name: blameResult.lastModifiedBy,
            email: blameResult.entries.find(e => e.author === blameResult.lastModifiedBy)?.email || '',
            reason: `Last modified ${test.file}`,
          };

          if (!suggestedOwner) {
            suggestedOwner = { ...owner, confidence: 'medium' };
          } else if (suggestedOwner.name !== owner.name) {
            alternativeOwners.push(owner);
          }

          // 3. Most frequent contributor
          const authorCounts = new Map<string, number>();
          for (const entry of blameResult.entries) {
            authorCounts.set(entry.author, (authorCounts.get(entry.author) || 0) + 1);
          }
          const sorted = Array.from(authorCounts.entries()).sort((a, b) => b[1] - a[1]);
          for (const [authorName] of sorted.slice(0, 3)) {
            if (authorName !== suggestedOwner?.name && !alternativeOwners.some(o => o.name === authorName)) {
              alternativeOwners.push({
                name: authorName,
                email: blameResult.entries.find(e => e.author === authorName)?.email || '',
                reason: `Authored ${authorCounts.get(authorName)} lines in ${test.file}`,
              });
            }
          }
        }
      }

      if (!suggestedOwner) return null;

      return {
        testName: test.name,
        suggestedOwner,
        alternativeOwners: alternativeOwners.slice(0, 3),
      };
    } catch {
      return null;
    }
  }

  // ── Git Write Operations ────────────────────────────────────────────────

  /** Stage one or more files. */
  async stageFiles(files: string[]): Promise<{ staged: string[] }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');
    await this.git.add(files);
    return { staged: files };
  }

  /** Unstage one or more files (git reset HEAD -- files). */
  async unstageFiles(files: string[]): Promise<{ unstaged: string[] }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');
    await this.git.raw(['reset', 'HEAD', '--', ...files]);
    return { unstaged: files };
  }

  /** Commit staged changes with a message. */
  async commitChanges(message: string): Promise<{
    commit: string;
    branch: string;
    summary: { changes: number; insertions: number; deletions: number };
  }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');
    if (!message || !message.trim()) throw new Error('Commit message is required');

    const result = await this.git.commit(message.trim());
    return {
      commit: result.commit || '',
      branch: result.branch || '',
      summary: {
        changes: (result.summary as any)?.changes || 0,
        insertions: (result.summary as any)?.insertions || 0,
        deletions: (result.summary as any)?.deletions || 0,
      },
    };
  }

  /** Fetch from remote (defaults to origin). */
  async fetchRemote(remote?: string): Promise<{ raw: string }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');
    const result = await this.git.fetch(remote || 'origin');
    return { raw: result?.raw || 'Fetch complete' };
  }

  /** Pull from remote. */
  async pull(remote?: string, branch?: string): Promise<{
    files: string[];
    summary: { changes: number; insertions: number; deletions: number };
  }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');
    const result = await this.git.pull(remote, branch);
    return {
      files: result?.files || [],
      summary: {
        changes: result?.summary?.changes || 0,
        insertions: result?.summary?.insertions || 0,
        deletions: result?.summary?.deletions || 0,
      },
    };
  }

  /** Push to remote. No force push allowed. */
  async push(remote?: string, branch?: string): Promise<{ pushed: boolean; message: string }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');
    // SECURITY: Never allow force push
    const args: string[] = ['push'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const result = await this.git.raw(args);
    return { pushed: true, message: result || 'Push complete' };
  }

  /** List local branches with current indicator. */
  async getBranches(): Promise<{
    current: string;
    all: string[];
    branches: Array<{ name: string; current: boolean; commit: string; label: string }>;
  }> {
    if (!(await this.checkAvailability())) {
      return { current: '', all: [], branches: [] };
    }

    try {
      const result = await this.git.branchLocal();
      const branches = Object.entries(result.branches).map(([name, info]) => ({
        name,
        current: info.current,
        commit: info.commit,
        label: info.label || info.commit?.slice(0, 7) || '',
      }));

      return {
        current: result.current,
        all: result.all,
        branches,
      };
    } catch {
      return { current: '', all: [], branches: [] };
    }
  }

  /** Create a new local branch and optionally switch to it. */
  async createBranch(name: string, checkout = true): Promise<{ branch: string; switched: boolean }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');

    // Validate branch name
    if (!name || /[\s~^:\\]|\.\./.test(name) || name.startsWith('-')) {
      throw new Error('Invalid branch name. Cannot contain spaces, .., ~, ^, :, \\ or start with -');
    }

    if (checkout) {
      await this.git.checkoutLocalBranch(name);
    } else {
      await this.git.branch([name]);
    }

    return { branch: name, switched: checkout };
  }

  /** Switch to an existing branch. */
  async switchBranch(name: string): Promise<{ branch: string; switched: boolean }> {
    if (!(await this.checkAvailability())) throw new Error('Git not available');

    // SECURITY: reject names starting with - (argument injection)
    if (!name || name.startsWith('-')) {
      throw new Error('Invalid branch name');
    }

    await this.git.checkout(name);
    return { branch: name, switched: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  async getCurrentHeadSha(): Promise<string | null> {
    try {
      const sha = await this.git.revparse(['HEAD']);
      return sha.trim();
    } catch {
      return null;
    }
  }
}

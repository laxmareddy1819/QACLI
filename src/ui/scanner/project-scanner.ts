import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { FrameworkDetector } from '../../codegen/detector.js';
import { analyzeProject, scanProjectStructure } from '../../recorder/formatter.js';
import { classifyFile, classifyDirectory, detectLanguage, deriveModuleLabel } from './file-classifier.js';
import { extractMetadata } from './metadata-extractor.js';
import type { ProjectInfo, ProjectModule, FileMetadata, FileNode, ModuleType } from '../types.js';
import { MODULE_ICONS } from '../types.js';

// ── Ignore Patterns ──────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', '.svn',
  '.idea', '.vscode', '.vs', '__pycache__', '.tox', '.mypy_cache',
  '.pytest_cache', '.nyc_output', '.next', '.nuxt', 'target',
  'bin', 'obj', 'coverage', '.gradle', '.mvn', 'vendor',
]);

const SOURCE_EXTS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.mts', '.mjs',
  '.py', '.java', '.cs', '.rb', '.go',
  '.feature', '.robot',
  '.json', '.yaml', '.yml', '.xml', '.csv',
  '.html', '.htm', '.env',
  '.toml', '.ini', '.cfg', '.properties',
]);

// ── Project Scanner ──────────────────────────────────────────────────────────

export class ProjectScanner {
  private projectPath: string;
  private detector: FrameworkDetector;
  private cachedInfo: ProjectInfo | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.detector = new FrameworkDetector();
  }

  /**
   * Perform a full project scan: detect framework, discover modules, count files.
   */
  async scan(): Promise<ProjectInfo> {
    // 1. Detect frameworks
    const detected = await this.detector.detect(this.projectPath);
    const top = detected[0];

    // 2. Get existing project analysis
    const projectCtx = await analyzeProject(this.projectPath);

    // 3. Discover all modules by walking the directory tree
    const modules = this.discoverModules();

    // 4. Compute stats
    let totalFiles = 0;
    let totalLines = 0;
    for (const mod of modules) {
      totalFiles += mod.count;
    }
    // Approximate line count from modules
    for (const mod of modules) {
      const files = this.listModuleFiles(mod.path);
      for (const f of files) {
        totalLines += f.lines;
      }
    }

    const info: ProjectInfo = {
      name: basename(this.projectPath),
      framework: top?.framework || null,
      language: top?.language || projectCtx.language || 'unknown',
      rootPath: this.projectPath,
      modules,
      stats: {
        totalFiles,
        totalLines,
        totalModules: modules.length,
      },
    };

    this.cachedInfo = info;
    return info;
  }

  /**
   * Get the cached project info, or scan if not cached.
   */
  async getInfo(): Promise<ProjectInfo> {
    if (this.cachedInfo) return this.cachedInfo;
    return this.scan();
  }

  /**
   * Invalidate the cache (e.g., when files change).
   */
  invalidateCache(): void {
    this.cachedInfo = null;
  }

  /**
   * Discover all project modules by walking the directory tree.
   * Groups files by directory and classifies each directory.
   */
  private discoverModules(): ProjectModule[] {
    const dirMap = new Map<string, { files: string[]; types: string[] }>();

    // Walk the tree and group files by their parent directory
    this.walkTree(this.projectPath, '', (relPath, isDir) => {
      if (isDir) return;
      const ext = extname(relPath).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) return;

      // Find the "module directory" — the first meaningful parent
      const moduleDir = this.getModuleDirectory(relPath);
      if (!moduleDir) return;

      const entry = dirMap.get(moduleDir) || { files: [], types: [] };
      entry.files.push(relPath);

      const fileType = classifyFile(relPath);
      entry.types.push(fileType);

      dirMap.set(moduleDir, entry);
    });

    // Also add config files at root as a "config" module
    const rootConfigs = this.findRootConfigs();
    if (rootConfigs.length > 0) {
      dirMap.set('.', {
        files: rootConfigs,
        types: rootConfigs.map(() => 'config'),
      });
    }

    // Convert to modules
    const modules: ProjectModule[] = [];
    for (const [dirPath, { files, types }] of dirMap) {
      if (files.length === 0) continue;

      const dirName = dirPath === '.' ? 'config' : basename(dirPath);
      const moduleType = dirPath === '.'
        ? 'config' as ModuleType
        : classifyDirectory(dirPath, types as any);

      // Detect dominant language
      const langCounts = new Map<string, number>();
      for (const f of files) {
        const lang = detectLanguage(f);
        langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
      }
      const dominantLang = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

      // Find last modified time
      let lastModified = '';
      for (const f of files) {
        try {
          const s = statSync(join(this.projectPath, f));
          const mtime = s.mtime.toISOString();
          if (mtime > lastModified) lastModified = mtime;
        } catch { /* skip */ }
      }

      modules.push({
        id: this.slugify(dirPath === '.' ? 'config' : dirPath),
        label: deriveModuleLabel(dirName, moduleType),
        icon: MODULE_ICONS[moduleType] || 'folder',
        path: dirPath,
        type: moduleType,
        count: files.length,
        language: dominantLang,
        lastModified,
      });
    }

    // Sort: tests first, then by type, then alphabetically
    const typeOrder: Record<string, number> = {
      tests: 0, bdd: 1, steps: 2, pages: 3, api: 4,
      data: 5, fixtures: 6, helpers: 7, keywords: 8,
      env: 9, config: 10, reports: 11, custom: 12,
    };
    modules.sort((a, b) => {
      const orderA = typeOrder[a.type] ?? 99;
      const orderB = typeOrder[b.type] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label);
    });

    return modules;
  }

  /**
   * List files in a specific module directory with metadata.
   */
  listModuleFiles(modulePath: string): FileMetadata[] {
    const fullDir = join(this.projectPath, modulePath);
    const files: FileMetadata[] = [];

    try {
      const entries = readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) continue;
        const ext = extname(entry.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext) && ext !== '.env') continue;

        const relPath = join(modulePath, entry.name);
        const fullPath = join(this.projectPath, relPath);

        try {
          const stat = statSync(fullPath);
          const content = readFileSync(fullPath, 'utf-8');

          files.push({
            path: relPath,
            name: entry.name,
            type: classifyFile(relPath, content),
            language: detectLanguage(relPath),
            lines: content.split('\n').length,
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
            metadata: extractMetadata(relPath, content),
          });
        } catch { /* skip unreadable */ }
      }
    } catch { /* dir doesn't exist or unreadable */ }

    return files;
  }

  /**
   * Get full metadata for a single file (including content-based extraction).
   */
  getFileMetadata(filePath: string): FileMetadata | null {
    const fullPath = join(this.projectPath, filePath);
    try {
      const stat = statSync(fullPath);
      const content = readFileSync(fullPath, 'utf-8');
      return {
        path: filePath,
        name: basename(filePath),
        type: classifyFile(filePath, content),
        language: detectLanguage(filePath),
        lines: content.split('\n').length,
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
        metadata: extractMetadata(filePath, content),
      };
    } catch {
      return null;
    }
  }

  /**
   * Build a recursive file tree for the project.
   */
  buildFileTree(rootPath?: string): FileNode {
    const root = rootPath || this.projectPath;
    const relRoot = rootPath ? relative(this.projectPath, rootPath) : '';

    return this.buildTreeNode(root, relRoot || basename(this.projectPath), relRoot || '.');
  }

  private buildTreeNode(fullPath: string, name: string, relPath: string): FileNode {
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) {
      return {
        name,
        path: relPath,
        type: 'file',
        fileType: classifyFile(relPath),
        language: detectLanguage(relPath),
        size: stat.size,
      };
    }

    const children: FileNode[] = [];
    try {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;

        const childFull = join(fullPath, entry.name);
        const childRel = relPath === '.' ? entry.name : join(relPath, entry.name);
        children.push(this.buildTreeNode(childFull, entry.name, childRel));
      }
    } catch { /* permission error */ }

    // Sort: dirs first, then files alphabetically
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { name, path: relPath, type: 'directory', children };
  }

  /**
   * Search file contents across the project (grep-like).
   */
  searchFiles(pattern: string, maxResults = 50): Array<{ file: string; line: number; content: string }> {
    const regex = new RegExp(pattern, 'gi');
    const results: Array<{ file: string; line: number; content: string }> = [];

    this.walkTree(this.projectPath, '', (relPath, isDir) => {
      if (isDir || results.length >= maxResults) return;
      const ext = extname(relPath).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) return;

      try {
        const content = readFileSync(join(this.projectPath, relPath), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (regex.test(lines[i]!)) {
            results.push({ file: relPath, line: i + 1, content: lines[i]!.trim() });
          }
          regex.lastIndex = 0;
        }
      } catch { /* skip */ }
    });

    return results;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private walkTree(
    dir: string,
    relDir: string,
    callback: (relPath: string, isDir: boolean) => void,
  ): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.env' && !entry.name.startsWith('.env.')) continue;

        const relPath = relDir ? join(relDir, entry.name) : entry.name;

        if (entry.isDirectory()) {
          callback(relPath, true);
          this.walkTree(join(dir, entry.name), relPath, callback);
        } else {
          callback(relPath, false);
        }
      }
    } catch { /* permission error */ }
  }

  /**
   * Determine the "module directory" for a file.
   * This is the first meaningful parent directory (not root, not nested too deep).
   */
  private getModuleDirectory(relPath: string): string | null {
    const parts = relPath.replace(/\\/g, '/').split('/');
    if (parts.length <= 1) return null; // root-level files handled separately

    // For paths like 'tests/pages/LoginPage.ts', return 'tests/pages'
    // For paths like 'tests/login.spec.ts', return 'tests'
    // For paths like 'cypress/e2e/login.cy.ts', return 'cypress/e2e'
    // For paths like 'features/step_definitions/loginSteps.ts', return 'features/step_definitions'

    const dir = parts.slice(0, -1).join('/');
    return dir;
  }

  private findRootConfigs(): string[] {
    const configs: string[] = [];
    try {
      const entries = readdirSync(this.projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const type = classifyFile(entry.name);
        if (type === 'config' || type === 'env') {
          configs.push(entry.name);
        }
      }
    } catch { /* skip */ }
    return configs;
  }

  private slugify(s: string): string {
    return s.replace(/[/\\]/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase().replace(/^-|-$/g, '') || 'root';
  }
}

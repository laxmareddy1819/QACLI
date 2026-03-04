import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import type { RecordedAction, FormatterOptions, ElementSelector } from '../types/index.js';
import { FrameworkDetector } from '../codegen/detector.js';

// ── Project Context ─────────────────────────────────────────────────────────

export interface ProjectContext {
  /** Detected framework (playwright, cypress, selenium, puppeteer) or null */
  framework: 'playwright' | 'cypress' | 'selenium' | 'puppeteer' | null;
  /** Detected language */
  language: 'typescript' | 'javascript' | 'python' | 'java';
  /** Directory where tests live (e.g. "tests", "cypress/e2e", "src/test/java") */
  testDir: string;
  /** Directory where page objects live (e.g. "tests/pages", "pages") or null */
  pageDir: string | null;
  /** Existing base page class info, if found */
  basePage: {
    importPath: string;   // relative import path for test file
    className: string;    // e.g. "BasePage", "LoginPage"
    hasNavigate: boolean; // has a navigate/goto method
    methods: string[];    // known method names
  } | null;
  /** Existing page object files (relative paths) */
  existingPages: string[];
  /** Existing test files (relative paths) — to match naming patterns */
  existingTests: string[];
  /** Base URL from config file, if any */
  baseUrl: string | null;
  /** Whether the project uses BDD/Cucumber (feature files + step definitions) */
  isBDD: boolean;
  /** Directory where feature files live (e.g. "features", "tests/features") */
  featureDir: string | null;
  /** Directory where step definitions live */
  stepsDir: string | null;
  /** Existing feature files (relative paths) */
  existingFeatures: string[];
  /** Existing step definition files (relative paths) */
  existingSteps: string[];
}

/**
 * Analyze the working directory to detect the existing project context:
 * framework, language, page objects, test patterns, base URL, etc.
 */
export async function analyzeProject(cwd: string): Promise<ProjectContext> {
  const detector = new FrameworkDetector();
  const detected = await detector.detect(cwd);
  const top = detected[0];

  // Map detected framework to our supported output formats
  let framework: ProjectContext['framework'] = null;
  let language: ProjectContext['language'] = 'typescript';
  let isCucumber = false;

  if (top) {
    const fw = top.framework;
    if (fw === 'playwright') { framework = 'playwright'; }
    else if (fw === 'cypress') { framework = 'cypress'; }
    else if (fw === 'selenium') { framework = 'selenium'; }
    else if (fw === 'puppeteer') { framework = 'puppeteer'; }
    else if (fw === 'webdriverio' || fw === 'appium') { framework = 'puppeteer'; }
    else if (fw === 'cucumber') { isCucumber = true; }

    const lang = top.language;
    if (lang === 'python') language = 'python';
    else if (lang === 'java') language = 'java';
    else if (lang === 'typescript') language = 'typescript';
    else language = 'javascript';
  }

  // Check for BDD even if Cucumber isn't the top framework — a project could
  // use Playwright + Cucumber together, or have .feature files alongside specs
  const { isBDD, featureDir, stepsDir, existingFeatures, existingSteps } =
    detectBDD(cwd, isCucumber);

  // If cucumber is detected but no other framework, try to find secondary framework
  // (e.g. Playwright used as the browser driver under Cucumber)
  if (isCucumber && !framework) {
    for (const d of detected) {
      if (d.framework === 'playwright') { framework = 'playwright'; break; }
      if (d.framework === 'cypress') { framework = 'cypress'; break; }
    }
    // Default to playwright if no browser framework found
    if (!framework) framework = 'playwright';
  }

  const testDir = detectTestDir(cwd, framework, language);
  const { pageDir, existingPages, basePage } = detectPageObjects(cwd, testDir, language);
  const existingTests = detectTestFiles(cwd, testDir, language);
  const baseUrl = readBaseUrl(cwd, framework);

  return {
    framework, language, testDir, pageDir, basePage, existingPages, existingTests, baseUrl,
    isBDD, featureDir, stepsDir, existingFeatures, existingSteps,
  };
}

// ── Project analysis helpers ─────────────────────────────────────────────────

function detectTestDir(
  cwd: string,
  framework: ProjectContext['framework'],
  language: ProjectContext['language'],
): string {
  if (framework === 'cypress') {
    if (existsSync(join(cwd, 'cypress/e2e'))) return 'cypress/e2e';
    if (existsSync(join(cwd, 'cypress/integration'))) return 'cypress/integration';
    return 'cypress/e2e';
  }
  if (language === 'java') {
    if (existsSync(join(cwd, 'src/test/java'))) return 'src/test/java';
    return 'src/test/java';
  }
  const candidates = ['tests', 'test', 'e2e', 'spec', '__tests__', 'src/tests', 'src/test'];
  for (const dir of candidates) {
    if (existsSync(join(cwd, dir)) && statSync(join(cwd, dir)).isDirectory()) {
      return dir;
    }
  }
  return 'tests';
}

function detectPageObjects(
  cwd: string,
  testDir: string,
  language: ProjectContext['language'],
): { pageDir: string | null; existingPages: string[]; basePage: ProjectContext['basePage'] } {
  const existingPages: string[] = [];
  let pageDir: string | null = null;

  const candidates = [
    join(testDir, 'pages'),
    join(testDir, 'page-objects'),
    join(testDir, 'pom'),
    'pages',
    'page-objects',
    'src/pages',
    'src/main/java/pages',
  ];

  for (const dir of candidates) {
    const fullPath = join(cwd, dir);
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      pageDir = dir;
      try {
        for (const f of readdirSync(fullPath)) {
          const ext = extname(f).toLowerCase();
          if (['.ts', '.js', '.py', '.java'].includes(ext)) {
            existingPages.push(join(dir, f));
          }
        }
      } catch { /* permission errors */ }
      break;
    }
  }

  let basePage: ProjectContext['basePage'] = null;
  if (pageDir) basePage = findBasePage(cwd, pageDir, language);
  return { pageDir, existingPages, basePage };
}

function findBasePage(cwd: string, pageDir: string, language: ProjectContext['language']): ProjectContext['basePage'] {
  const baseNames = ['BasePage', 'base_page', 'base-page', 'Page', 'AbstractPage'];
  const exts: Record<string, string[]> = {
    typescript: ['.ts'], javascript: ['.js', '.ts'], python: ['.py'], java: ['.java'],
  };

  for (const name of baseNames) {
    for (const ext of exts[language] || ['.ts']) {
      const filePath = join(cwd, pageDir, `${name}${ext}`);
      if (!existsSync(filePath)) continue;
      try {
        const content = readFileSync(filePath, 'utf-8');
        const className = extractClassName(content, language) || 'BasePage';
        const methods = extractMethods(content, language);
        const hasNavigate = methods.some(m => /^(navigate|goto|go_to|open|visit)$/i.test(m));
        return {
          importPath: `./${name.replace(ext, '')}`,
          className,
          hasNavigate,
          methods,
        };
      } catch { /* skip */ }
    }
  }
  return null;
}

function extractClassName(content: string, language: ProjectContext['language']): string | null {
  if (language === 'python') { const m = content.match(/class\s+(\w+)/); return m?.[1] || null; }
  if (language === 'java') { const m = content.match(/class\s+(\w+)/); return m?.[1] || null; }
  const m = content.match(/(?:export\s+)?class\s+(\w+)/);
  return m?.[1] || null;
}

function extractMethods(content: string, language: ProjectContext['language']): string[] {
  const methods: string[] = [];
  if (language === 'python') {
    const re = /def\s+(\w+)\s*\(/g; let m;
    while ((m = re.exec(content))) { if (m[1] !== '__init__') methods.push(m[1]!); }
  } else if (language === 'java') {
    const re = /(?:public|protected|private)\s+\w+\s+(\w+)\s*\(/g; let m;
    while ((m = re.exec(content))) methods.push(m[1]!);
  } else {
    const re = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g; let m;
    while ((m = re.exec(content))) { if (m[1] !== 'constructor') methods.push(m[1]!); }
  }
  return methods;
}

function detectTestFiles(cwd: string, testDir: string, language: ProjectContext['language']): string[] {
  const fullPath = join(cwd, testDir);
  if (!existsSync(fullPath)) return [];
  const tests: string[] = [];
  try {
    for (const f of readdirSync(fullPath)) {
      const lower = f.toLowerCase();
      const isTest =
        language === 'python' ? lower.startsWith('test_') && lower.endsWith('.py') :
        language === 'java' ? lower.endsWith('test.java') :
        /\.(spec|test|cy)\.(ts|js|mjs)$/i.test(f);
      if (isTest) tests.push(join(testDir, f));
    }
  } catch { /* ignore */ }
  return tests;
}

function readBaseUrl(cwd: string, framework: ProjectContext['framework']): string | null {
  try {
    if (framework === 'playwright') {
      for (const cfg of ['playwright.config.ts', 'playwright.config.js']) {
        const p = join(cwd, cfg);
        if (!existsSync(p)) continue;
        const m = readFileSync(p, 'utf-8').match(/baseURL:\s*['"]([^'"]+)['"]/);
        if (m) return m[1]!;
      }
    }
    if (framework === 'cypress') {
      for (const cfg of ['cypress.config.ts', 'cypress.config.js']) {
        const p = join(cwd, cfg);
        if (!existsSync(p)) continue;
        const m = readFileSync(p, 'utf-8').match(/baseUrl:\s*['"]([^'"]+)['"]/);
        if (m) return m[1]!;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ── BDD / Cucumber Detection ─────────────────────────────────────────────────

function detectBDD(
  cwd: string,
  isCucumberDetected: boolean,
): {
  isBDD: boolean;
  featureDir: string | null;
  stepsDir: string | null;
  existingFeatures: string[];
  existingSteps: string[];
} {
  const existingFeatures: string[] = [];
  const existingSteps: string[] = [];
  let featureDir: string | null = null;
  let stepsDir: string | null = null;

  // Search for feature files in common locations
  const featureDirCandidates = [
    'features', 'tests/features', 'test/features', 'e2e/features',
    'cypress/e2e', // Cypress BDD
    'src/test/resources/features', // Java/Gradle
    'specs', 'tests/specs',
  ];

  for (const dir of featureDirCandidates) {
    const fullPath = join(cwd, dir);
    if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) continue;
    const features = findFilesRecursive(fullPath, '.feature');
    if (features.length > 0) {
      featureDir = dir;
      for (const f of features) {
        existingFeatures.push(relative(cwd, f).replace(/\\/g, '/'));
      }
      break;
    }
  }

  // Search for step definitions
  const stepDirCandidates = [
    'features/step_definitions', 'features/steps', 'step_definitions', 'steps',
    'tests/steps', 'tests/step_definitions', 'test/steps',
    'src/test/java/steps', 'src/test/resources/steps',
    'e2e/steps', 'e2e/step_definitions',
  ];

  for (const dir of stepDirCandidates) {
    const fullPath = join(cwd, dir);
    if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) continue;
    stepsDir = dir;
    try {
      for (const f of readdirSync(fullPath)) {
        const ext = extname(f).toLowerCase();
        if (['.ts', '.js', '.py', '.java', '.mjs'].includes(ext)) {
          const lower = f.toLowerCase();
          if (lower.includes('step') || lower.includes('def')) {
            existingSteps.push(join(dir, f));
          }
        }
      }
    } catch { /* skip */ }
    if (existingSteps.length > 0) break;
  }

  // Also check for step files that live alongside feature files
  if (featureDir && !stepsDir) {
    const fullPath = join(cwd, featureDir);
    try {
      for (const f of readdirSync(fullPath)) {
        const ext = extname(f).toLowerCase();
        if (['.ts', '.js', '.py', '.java'].includes(ext)) {
          const lower = f.toLowerCase();
          if (lower.includes('step')) {
            existingSteps.push(join(featureDir, f));
            if (!stepsDir) stepsDir = featureDir;
          }
        }
      }
    } catch { /* skip */ }
  }

  const isBDD = isCucumberDetected || existingFeatures.length > 0;

  return { isBDD, featureDir, stepsDir, existingFeatures, existingSteps };
}

/** Recursively find files with a given extension */
function findFilesRecursive(dir: string, ext: string, maxDepth = 3): string[] {
  if (maxDepth <= 0) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry.endsWith(ext)) {
          results.push(fullPath);
        } else if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          results.push(...findFilesRecursive(fullPath, ext, maxDepth - 1));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

// ── Project Structure Scan (for LLM context) ────────────────────────────────

export interface ProjectStructure {
  /** Files in the page object directory (name + line count + content) */
  pageObjectFiles: Array<{ path: string; lines: number; content?: string }>;
  /** Files in the test directory (name + line count + content) */
  testFiles: Array<{ path: string; lines: number; content?: string }>;
  /** Config files found at project root */
  configFiles: string[];
  /** Utility/helper directories and files found */
  helperFiles: Array<{ path: string; lines: number; content?: string }>;
  /** Config file contents (key framework configs) */
  configContents: Array<{ path: string; content: string }>;
  /** BDD feature files (name + content) */
  featureFiles: Array<{ path: string; lines: number; content?: string }>;
  /** Step definition files (name + content) */
  stepFiles: Array<{ path: string; lines: number; content?: string }>;
}

/**
 * Scan the project structure and READ actual file contents for key files.
 * The LLM needs to see existing code to reuse methods, patterns, and styles.
 * We read contents inline (up to size limits) to minimize tool round-trips.
 */
export function scanProjectStructure(
  cwd: string,
  ctx: ProjectContext,
): ProjectStructure {
  const result: ProjectStructure = {
    pageObjectFiles: [],
    testFiles: [],
    configFiles: [],
    helperFiles: [],
    configContents: [],
    featureFiles: [],
    stepFiles: [],
  };

  const sourceExts = new Set(['.ts', '.js', '.py', '.java', '.mjs', '.mts']);

  // 1. List page object files — READ ALL CONTENTS (these are critical for reuse)
  if (ctx.pageDir) {
    result.pageObjectFiles = listSourceFilesWithContent(cwd, ctx.pageDir, sourceExts, 500);
  }

  // 2. List test files — read content for first few as style examples
  result.testFiles = listSourceFilesWithContent(cwd, ctx.testDir, sourceExts, 300);

  // 3. Find config files at project root
  const configCandidates = [
    'playwright.config.ts', 'playwright.config.js',
    'cypress.config.ts', 'cypress.config.js',
    'jest.config.ts', 'jest.config.js',
    'vitest.config.ts', 'vitest.config.js',
    'wdio.conf.js', 'wdio.conf.ts',
    'conftest.py', 'pom.xml', 'build.gradle',
    'tsconfig.json', 'package.json',
  ];
  for (const cfg of configCandidates) {
    if (existsSync(join(cwd, cfg))) {
      result.configFiles.push(cfg);
      // Read key config file contents
      if (cfg.includes('playwright') || cfg.includes('cypress') || cfg.includes('wdio')) {
        try {
          const content = readFileSync(join(cwd, cfg), 'utf-8');
          if (content.length < 10000) {
            result.configContents.push({ path: cfg, content });
          }
        } catch { /* skip */ }
      }
    }
  }

  // 4. Scan for helper/utility directories — read content
  const helperCandidates = [
    join(ctx.testDir, 'helpers'), join(ctx.testDir, 'utils'), join(ctx.testDir, 'fixtures'),
    join(ctx.testDir, 'support'), join(ctx.testDir, 'lib'), join(ctx.testDir, 'common'),
    'helpers', 'utils', 'support', 'lib', 'src/helpers', 'src/utils',
    'cypress/support', 'cypress/fixtures',
  ];
  for (const dir of helperCandidates) {
    const fullPath = join(cwd, dir);
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      result.helperFiles.push(...listSourceFilesWithContent(cwd, dir, sourceExts, 300));
    }
  }

  // 5. Scan BDD feature files and step definitions
  if (ctx.isBDD) {
    const featureExts = new Set(['.feature']);
    if (ctx.featureDir) {
      result.featureFiles = listSourceFilesWithContent(cwd, ctx.featureDir, featureExts, 200);
    }
    if (ctx.stepsDir) {
      result.stepFiles = listSourceFilesWithContent(cwd, ctx.stepsDir, sourceExts, 300);
    }
  }

  return result;
}

function listSourceFilesWithContent(
  cwd: string, dir: string, exts: Set<string>, maxLines: number,
): Array<{ path: string; lines: number; content?: string }> {
  const fullPath = join(cwd, dir);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) return [];
  const files: Array<{ path: string; lines: number; content?: string }> = [];
  try {
    for (const entry of readdirSync(fullPath)) {
      const entryPath = join(fullPath, entry);
      const ext = extname(entry).toLowerCase();
      if (!exts.has(ext)) continue;
      try {
        if (statSync(entryPath).isFile()) {
          const content = readFileSync(entryPath, 'utf-8');
          const lineCount = content.split('\n').length;
          files.push({
            path: join(dir, entry),
            lines: lineCount,
            // Include content if under maxLines (avoid massive files)
            content: lineCount <= maxLines ? content : undefined,
          });
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dir */ }
  return files;
}

// Legacy compat: keep old signature that just returns line counts
function listSourceFiles(
  cwd: string, dir: string, exts: Set<string>,
): Array<{ path: string; lines: number }> {
  return listSourceFilesWithContent(cwd, dir, exts, 0);
}

// ── LLM Prompt Builder ──────────────────────────────────────────────────────

/**
 * Build a rich prompt for the LLM to generate test code from recorded actions.
 * Includes ACTUAL file contents inline so the LLM can immediately understand
 * existing patterns, methods, and styles without needing extra tool calls.
 */
export function buildCodegenPrompt(
  session: { actions: RecordedAction[] },
  projectCtx: ProjectContext,
  projectStructure: ProjectStructure,
  options: { testName: string; format?: string },
): string {
  const sections: string[] = [];

  // Header with critical reuse instruction
  sections.push(
    '# Generate Test Code from Recorded Browser Actions\n' +
    'Your PRIMARY goal is to produce code that **integrates perfectly with the existing project**.\n' +
    '## CRITICAL RULES (read these CAREFULLY):\n' +
    '1. **DO NOT create new utility/helper/base classes** — the project already has them. REUSE what exists.\n' +
    '2. **DO NOT duplicate existing methods** — if BasePage has `navigate()`, `click()`, `fill()`, etc., CALL them instead of writing raw Playwright/Cypress calls.\n' +
    '3. **MATCH the exact coding style** of existing files — imports, naming, indentation, patterns, assertions.\n' +
    '4. **CHECK if a similar page object already exists** before creating a new one. If it does, ADD methods to it or extend it.\n' +
    '5. **Use Playwright-native locators** in this priority order: `getByTestId()` > `getByRole()` > `getByLabel()` > `getByPlaceholder()` > `getByText()` > `locator()`\n' +
    '6. Only create the MINIMUM files needed — typically one page object + one test file.\n',
  );

  // Project context
  sections.push('## Project Context');
  sections.push(`- **Framework:** ${projectCtx.framework || 'none detected (generate standalone Playwright test)'}`);
  sections.push(`- **Language:** ${projectCtx.language}`);
  sections.push(`- **Test directory:** \`${projectCtx.testDir}\``);
  sections.push(`- **Page object directory:** \`${projectCtx.pageDir || 'none'}\``);
  sections.push(`- **Base URL:** ${projectCtx.baseUrl || 'not configured'}`);
  if (projectCtx.basePage) {
    sections.push(`- **Base page class:** \`${projectCtx.basePage.className}\` (methods: \`${projectCtx.basePage.methods.join('`, `')}\`)`);
    sections.push(`  - import path: \`${projectCtx.basePage.importPath}\``);
    sections.push(`  - has navigate method: ${projectCtx.basePage.hasNavigate}`);
  }
  if (projectCtx.isBDD) {
    sections.push(`- **🔖 BDD Project:** YES — uses feature files + step definitions`);
    if (projectCtx.featureDir) sections.push(`- **Feature directory:** \`${projectCtx.featureDir}\``);
    if (projectCtx.stepsDir) sections.push(`- **Steps directory:** \`${projectCtx.stepsDir}\``);
    sections.push(`- **Existing features:** ${projectCtx.existingFeatures.length} file(s)`);
    sections.push(`- **Existing step defs:** ${projectCtx.existingSteps.length} file(s)`);
  }
  sections.push('');

  // ── EXISTING CODE (inline) — this is what makes the LLM understand the project ──
  sections.push('## Existing Project Code');
  sections.push('Below are the actual contents of existing project files. Study them carefully to understand patterns, methods, and styles you MUST follow and reuse.\n');

  // Page Objects (FULL content — most important for reuse)
  if (projectStructure.pageObjectFiles.length > 0) {
    sections.push('### Existing Page Objects');
    sections.push('**IMPORTANT: Read ALL methods in these files. Reuse them instead of writing raw framework calls.**\n');
    for (const f of projectStructure.pageObjectFiles) {
      if (f.content) {
        sections.push(`#### \`${f.path}\` (${f.lines} lines)`);
        sections.push('```' + (f.path.endsWith('.ts') ? 'typescript' : f.path.endsWith('.py') ? 'python' : f.path.endsWith('.java') ? 'java' : 'javascript'));
        sections.push(f.content);
        sections.push('```\n');
      } else {
        sections.push(`- \`${f.path}\` (${f.lines} lines) — *too large to include, use \`read_file\` to view*`);
      }
    }
  }

  // Test Files (content for style reference)
  if (projectStructure.testFiles.length > 0) {
    sections.push('### Existing Test Files');
    sections.push('**Match this exact structure: imports, describe/it nesting, beforeEach, assertions, etc.**\n');
    // Show first 3 test files with content as style examples
    let shown = 0;
    for (const f of projectStructure.testFiles) {
      if (f.content && shown < 3) {
        sections.push(`#### \`${f.path}\` (${f.lines} lines) — STYLE REFERENCE`);
        sections.push('```' + (f.path.endsWith('.ts') ? 'typescript' : f.path.endsWith('.py') ? 'python' : f.path.endsWith('.java') ? 'java' : 'javascript'));
        sections.push(f.content);
        sections.push('```\n');
        shown++;
      } else {
        sections.push(`- \`${f.path}\` (${f.lines} lines)`);
      }
    }
  }

  // Helper/Utility files
  if (projectStructure.helperFiles.length > 0) {
    sections.push('### Helpers / Utilities / Fixtures');
    sections.push('**Reuse these shared utilities instead of creating new ones.**\n');
    for (const f of projectStructure.helperFiles) {
      if (f.content) {
        sections.push(`#### \`${f.path}\` (${f.lines} lines)`);
        sections.push('```' + (f.path.endsWith('.ts') ? 'typescript' : f.path.endsWith('.py') ? 'python' : 'javascript'));
        sections.push(f.content);
        sections.push('```\n');
      } else {
        sections.push(`- \`${f.path}\` (${f.lines} lines)`);
      }
    }
  }

  // Config file contents
  if (projectStructure.configContents && projectStructure.configContents.length > 0) {
    sections.push('### Config Files');
    for (const cfg of projectStructure.configContents) {
      sections.push(`#### \`${cfg.path}\``);
      sections.push('```' + (cfg.path.endsWith('.ts') ? 'typescript' : 'javascript'));
      sections.push(cfg.content);
      sections.push('```\n');
    }
  } else if (projectStructure.configFiles.length > 0) {
    sections.push('### Config Files');
    for (const f of projectStructure.configFiles) {
      sections.push(`- \`${f}\``);
    }
    sections.push('');
  }

  // BDD Feature files
  if (projectStructure.featureFiles && projectStructure.featureFiles.length > 0) {
    sections.push('### Existing Feature Files (BDD/Gherkin)');
    sections.push('**This is a BDD project! Generate feature file + step definitions, NOT spec/test files.**\n');
    for (const f of projectStructure.featureFiles) {
      if (f.content) {
        sections.push(`#### \`${f.path}\` (${f.lines} lines) — STYLE REFERENCE`);
        sections.push('```gherkin');
        sections.push(f.content);
        sections.push('```\n');
      } else {
        sections.push(`- \`${f.path}\` (${f.lines} lines)`);
      }
    }
  }

  // Step definition files
  if (projectStructure.stepFiles && projectStructure.stepFiles.length > 0) {
    sections.push('### Existing Step Definitions');
    sections.push('**REUSE existing step definitions. Only add NEW steps that don\'t already exist.**\n');
    for (const f of projectStructure.stepFiles) {
      if (f.content) {
        sections.push(`#### \`${f.path}\` (${f.lines} lines)`);
        sections.push('```' + (f.path.endsWith('.ts') ? 'typescript' : f.path.endsWith('.py') ? 'python' : f.path.endsWith('.java') ? 'java' : 'javascript'));
        sections.push(f.content);
        sections.push('```\n');
      } else {
        sections.push(`- \`${f.path}\` (${f.lines} lines)`);
      }
    }
  }

  // If there are files we couldn't include inline, instruct reading
  const unreadFiles = [
    ...projectStructure.pageObjectFiles.filter(f => !f.content && f.lines > 0),
    ...projectStructure.testFiles.filter(f => !f.content && f.lines > 0),
    ...projectStructure.helperFiles.filter(f => !f.content && f.lines > 0),
    ...(projectStructure.featureFiles || []).filter(f => !f.content && f.lines > 0),
    ...(projectStructure.stepFiles || []).filter(f => !f.content && f.lines > 0),
  ];
  if (unreadFiles.length > 0) {
    sections.push('### Files Not Included Above');
    sections.push('Use `read_file` to read these before generating code:');
    for (const f of unreadFiles) {
      sections.push(`- \`${f.path}\` (${f.lines} lines)`);
    }
    sections.push('');
  }

  // Recorded actions (rich format with ALL selector info including fallbacks)
  sections.push('## Recorded Browser Actions');
  sections.push(`The user performed these ${session.actions.length} browser interaction(s):\n`);
  const actions = session.actions.slice(0, 50);
  const cleaned = actions.map((a, i) => {
    const entry: Record<string, unknown> = { step: i + 1, type: a.type };
    if (a.url) entry.url = a.url;
    if (a.selector) {
      // Include the full selector with strategy for better locator generation
      entry.selector = {
        primary: `${a.selector.strategy}: ${a.selector.value}`,
        strategy: a.selector.strategy,
        value: a.selector.value,
      };
      // Include fallback selectors so LLM can pick the best one
      if (a.selector.fallbacks && a.selector.fallbacks.length > 0) {
        (entry.selector as any).fallbacks = a.selector.fallbacks.map(f => `${f.strategy}: ${f.value}`);
      }
    }
    if (a.value) entry.value = a.value;
    if (a.key) entry.key = a.key;
    if (a.description) entry.description = a.description;
    if (a.frameName) entry.frameName = a.frameName;
    if (a.tabIndex !== undefined && a.tabIndex > 0) entry.tabIndex = a.tabIndex;
    // Assertion fields
    if (a.assertType) entry.assertType = a.assertType;
    if (a.expectedValue) entry.expectedValue = a.expectedValue;
    if (a.actualValue) entry.actualValue = a.actualValue;
    if (a.assertAttribute) entry.assertAttribute = a.assertAttribute;
    return entry;
  });
  sections.push('```json\n' + JSON.stringify(cleaned, null, 2) + '\n```');
  if (session.actions.length > 50) {
    sections.push(`*(${session.actions.length - 50} more actions truncated — focus on the first 50)*`);
  }

  // ── MANDATORY WORKFLOW — modeled on the proven buildNewTestPrompt pattern ──
  const MAX_ATTEMPTS = 3;
  const slug = options.testName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');

  sections.push('\n## MANDATORY WORKFLOW — Follow These Steps In Order\n');

  // ── Phase 1: Verify Project Understanding ──
  sections.push('### Phase 1: Verify Project Understanding (DO NOT SKIP)\n');
  sections.push('The existing project code has been provided above. You MUST verify your understanding before writing code:\n');
  sections.push('1. **Read any files marked "too large to include"** — use `read_file` to view them');
  sections.push('2. **Search for existing page objects** that cover the recorded page/URL:');
  sections.push('   - Use `grep` to search for the URL path, page name, or domain in existing page objects');
  sections.push('   - If a page object ALREADY exists for this page, you MUST ADD methods to it using `edit_file` — do NOT create a duplicate');
  sections.push('3. **Search for existing tests** covering similar scenarios — use `grep` with keywords from the recorded actions');
  sections.push('4. **Read package.json** (or equivalent) to identify the test run command');
  sections.push('5. **Confirm framework and patterns** — verify what you see in the provided code matches your understanding\n');

  // ── Phase 2: Plan ──
  sections.push('### Phase 2: Plan the Code\n');
  sections.push('Before writing any code, plan what needs to be created:\n');
  sections.push('1. **List what already exists and CAN be reused:**');
  sections.push('   - Existing page objects with methods that cover parts of the scenario');
  sections.push('   - Existing step definitions that match scenario steps (BDD)');
  sections.push('   - Existing utility functions, base classes, helpers');
  sections.push('   - Existing test data or fixtures\n');
  sections.push('2. **List what is MISSING and needs to be created:**');
  sections.push('   - New page object methods (NOT entire new page objects if the page already has one)');
  sections.push('   - New step definitions (only for steps not already defined)');
  sections.push('   - New test file / feature file');
  sections.push('   - New utility methods (only if nothing existing covers the need)\n');
  sections.push('3. **CRITICAL — File Operation Rules:**');
  sections.push('   - For adding methods to EXISTING files: use `edit_file` to surgically add new methods');
  sections.push('   - For creating NEW files: use `write_file` with complete, runnable content');
  sections.push('   - NEVER overwrite an existing file completely with `write_file` — use `edit_file` to add to it');
  sections.push('   - NEVER create a new page object if one already exists for that page — ADD methods using `edit_file`\n');

  // ── Phase 3: Create Code ──
  sections.push('### Phase 3: Create the Code\n');

  if (projectCtx.isBDD) {
    // BDD project
    sections.push('#### ⚠️ THIS IS A BDD PROJECT — Generate Feature + Step Definitions');
    sections.push('**DO NOT generate .spec.ts or .test.ts files. Generate `.feature` file + step definition file instead.**\n');

    sections.push('**What to Generate:**');
    sections.push('1. **Feature File** (`.feature`) — Gherkin scenario describing the recorded user journey');
    sections.push('2. **Step Definition File** — implements the steps using the page object pattern');
    sections.push('3. **Page Object** (if needed) — only if no existing page object covers this page\n');

    sections.push('**Feature File Requirements:**');
    sections.push('- Match the exact Gherkin style of existing feature files shown above');
    sections.push('- Use meaningful Given/When/Then steps that describe user intent, NOT implementation details');
    sections.push('- Parameterize values using Cucumber expressions: `{string}`, `{int}`, etc.');
    sections.push('- Group related actions into single steps (e.g. "When I login with {string} and {string}")');
    sections.push(`- Feature name: "${options.testName}"\n`);

    sections.push('**Step Definition Requirements:**');
    sections.push('- REUSE existing step definitions — check the step files shown above first');
    sections.push('- Only write NEW steps that don\'t already exist');
    sections.push('- Match the exact style of existing step definition files');
    sections.push('- Use the page object pattern — step definitions should call page object methods\n');

    const featureDir = projectCtx.featureDir || 'features';
    const stepsDir = projectCtx.stepsDir || join(featureDir, 'step_definitions');
    const pageDir = projectCtx.pageDir || join(projectCtx.testDir, 'pages');
    sections.push('**File Paths:**');
    sections.push(`- Feature file: \`${featureDir}/${slug}.feature\``);
    sections.push(`- Step definitions: \`${stepsDir}/\` + appropriate filename`);
    sections.push(`- Page object (if new): \`${pageDir}/\` + appropriate filename\n`);
  } else {
    // Standard project
    sections.push('**What to Generate:**');
    if (projectCtx.framework) {
      sections.push('1. **Page Object** — encapsulates locators and methods for the page under test');
      sections.push('2. **Test File** — imports the page object and runs the recorded scenario\n');
    } else {
      sections.push('Generate a **single standalone test file** (no framework detected).\n');
    }
  }

  sections.push('**Page Object Requirements:**');
  if (projectCtx.basePage) {
    sections.push(`- **EXTEND** \`${projectCtx.basePage.className}\` — import it from \`${projectCtx.basePage.importPath}\``);
    sections.push(`- **REUSE** these base methods instead of raw framework calls: \`${projectCtx.basePage.methods.join('`, `')}\``);
    sections.push('- Only add NEW methods that don\'t exist in the base class');
  } else {
    sections.push('- Create a self-contained page object class');
  }
  sections.push('- **Selector strategy** (priority order): `getByTestId()` > `getByRole()` > `getByLabel()` > `getByPlaceholder()` > `getByText()` > `locator()`');
  sections.push('- Extract meaningful method names from actions (e.g. `login(username, password)`, `searchProduct(query)`)');
  sections.push('- Parameterize form inputs as method parameters — no hardcoded values');
  sections.push('- Define locators as class properties or getters\n');

  if (!projectCtx.isBDD) {
    sections.push('**Test File Requirements:**');
    sections.push('- Copy the exact structure from the existing test files shown above');
    sections.push('- Import the page object using the same import style as existing tests');
    sections.push(`- Test name: "${options.testName}"`);
    sections.push('- Include meaningful assertions — especially for recorded assert actions');
    sections.push('- Use the same assertion patterns as existing tests\n');

    if (projectCtx.framework) {
      const pageDir = projectCtx.pageDir || join(projectCtx.testDir, 'pages');
      sections.push('**File Paths:**');
      sections.push(`- Page object: \`${pageDir}/\` + appropriate filename`);
      sections.push(`- Test file: \`${projectCtx.testDir}/${slug}\` + appropriate extension\n`);
    } else {
      sections.push(`**File Path:** \`tests/${slug}.spec.ts\`\n`);
    }
  }

  // Assertion-specific guidance if recorded actions include assertions
  const hasAssertions = session.actions.some(a => a.type === 'assert');
  if (hasAssertions) {
    sections.push('**Assertion Conversion Rules** (for recorded "assert" actions):');
    sections.push('Convert each recorded assertion to the framework\'s native assertion syntax:');
    sections.push('- `text` / `not-text` → `expect(locator).toContainText()` / `.not.toContainText()`');
    sections.push('- `visible` / `not-visible` → `expect(locator).toBeVisible()` / `.not.toBeVisible()`');
    sections.push('- `value` / `not-value` → `expect(locator).toHaveValue()` / `.not.toHaveValue()`');
    sections.push('- `attribute` → `expect(locator).toHaveAttribute(name, value)`');
    sections.push('- `class` / `not-class` → `expect(locator).toHaveClass()` / `.not.toHaveClass()`');
    sections.push('- `checked` / `not-checked` → `expect(locator).toBeChecked()` / `.not.toBeChecked()`');
    sections.push('- `enabled` / `not-enabled` → `expect(locator).toBeEnabled()` / `.not.toBeEnabled()`');
    sections.push('- `url` / `not-url` → `expect(page).toHaveURL()` / `.not.toHaveURL()`');
    sections.push('- `title` / `not-title` → `expect(page).toHaveTitle()` / `.not.toHaveTitle()`');
    sections.push('- `count` / `not-count` / `min-count` → `expect(locator).toHaveCount()` / `.not.toHaveCount()` / `toBeGreaterThanOrEqual()`');
    sections.push('- `placeholder` → `expect(locator).toHaveAttribute("placeholder", value)`');
    sections.push('- `href` → `expect(locator).toHaveAttribute("href", /pattern/)`\n');
  }

  // ── Phase 4: Run & Verify ──
  sections.push('### Phase 4: Run and Verify\n');
  sections.push('After writing ALL code, you MUST run the test to verify it works.\n');
  sections.push('**Step 4.1: Determine the run command**');
  sections.push('- Look at existing scripts in package.json or project config');
  if (projectCtx.isBDD) {
    sections.push('- For Cucumber/BDD: use `--name "scenario name"` filter to run ONLY the specific scenario');
  }
  sections.push('- For Playwright: use `--grep "test name"` or specify the exact test file');
  sections.push('- For Jest: use `--testPathPattern` + `--testNamePattern` for the exact test');
  sections.push('- Run ONLY the new test — do NOT run the entire test suite\n');
  sections.push('**Step 4.2: Run the test using `run_command`**\n');
  sections.push('**Step 4.3: Check result**');
  sections.push('- **PASS** → Proceed to Final Result');
  sections.push(`- **FAIL** → Enter the self-healing loop (Phase 5)\n`);

  // ── Phase 5: Self-Healing ──
  sections.push(`### Phase 5: Self-Healing Loop (If Test Fails) — Up to ${MAX_ATTEMPTS} Total Attempts\n`);
  sections.push(`If the test fails, you MUST try to fix it. You have ${MAX_ATTEMPTS} total attempts.\n`);
  sections.push('For each retry attempt:');
  sections.push('1. **Analyze the error** — Read the full error output carefully');
  sections.push('2. **Re-read the affected files** to understand current state');
  sections.push('3. **Diagnose the issue:**');
  sections.push('   - Wrong selector? → Use `browser_launch` + `browser_navigate` + `browser_inspect` to discover the real selectors');
  sections.push('   - Missing import? → Check paths and module names');
  sections.push('   - Wrong API/method? → Read the framework docs in the project');
  sections.push('   - Timing issue? → Add explicit waits');
  sections.push('   - Missing step definition? → Create it');
  sections.push('4. **Apply the fix** using `edit_file` (preferred) or `write_file`');
  sections.push('5. **Re-run the test** — ALWAYS re-run after fixing');
  sections.push('6. **Check result** — PASS → Final Result, FAIL → next attempt\n');
  sections.push('**Each attempt MUST try something different.** If the same approach fails twice, use a fundamentally different strategy.\n');

  // ── Output Format ──
  sections.push('## Output Format (MANDATORY — the UI parses these headings)\n');
  sections.push('### Project Analysis');
  sections.push('[Brief summary: framework, language, existing page objects, what can be reused]\n');
  sections.push('### Plan');
  sections.push('**Reusing:**');
  sections.push('- [list existing files/methods being reused]\n');
  sections.push('**Creating:**');
  sections.push('- [list new files/methods being created]\n');
  sections.push('### Implementation');
  sections.push('[Your tool calls for creating code. Explain each file change before making it.]\n');
  sections.push(`### Attempt 1 of ${MAX_ATTEMPTS}\n`);
  sections.push('**Action:** Running the new test to verify it works.\n');
  sections.push('[run_command tool call]\n');
  sections.push('**Test Result:** PASS or FAIL\n');
  sections.push('---\n');
  sections.push(`[If FAIL, continue with "### Attempt N of ${MAX_ATTEMPTS}" headings]\n`);
  sections.push('### Final Result\n');
  sections.push('**Status:** PASS or FAIL');
  sections.push(`**Total Attempts:** N of ${MAX_ATTEMPTS}`);
  sections.push('**Files Created:** [list]');
  sections.push('**Files Modified:** [list]');
  sections.push('**Reused From Existing Code:** [list with file paths]');
  sections.push('**Summary:** [Brief description]\n');

  // ── Critical Rules ──
  sections.push('## CRITICAL RULES — VIOLATION OF THESE IS NOT ACCEPTABLE\n');
  sections.push('1. **NEVER skip the project verification phase** — you MUST check for existing page objects before creating new ones');
  sections.push('2. **NEVER duplicate existing code** — search thoroughly and REUSE what exists');
  sections.push('3. **NEVER create a new page object if one already exists for that page** — ADD methods using `edit_file`');
  sections.push('4. **NEVER create a new step definition if one already exists** — REUSE the existing step');
  sections.push('5. **NEVER skip running the test** — you MUST verify the code works');
  sections.push(`6. **NEVER stop after a failure** unless all ${MAX_ATTEMPTS} attempts are exhausted`);
  sections.push('7. **ALWAYS match the project\'s existing style** — imports, naming, structure, assertions, locator strategies');
  sections.push('8. **ALWAYS make new code reusable** — parameterized, modular, well-documented');
  sections.push('9. **Use `edit_file` for surgical additions to existing files** — do NOT rewrite entire files with `write_file`');
  sections.push(`10. **Your heading format MUST include "### Attempt N of ${MAX_ATTEMPTS}"** — the UI parses this for progress tracking`);
  sections.push('11. **NEVER use `browser_evaluate` for clicking, typing, or hovering** — use the proper browser tools');
  sections.push(`12. **Goal: GREEN TEST** — do whatever it takes within ${MAX_ATTEMPTS} attempts`);

  return sections.join('\n');
}

// ── Output Formatter ─────────────────────────────────────────────────────────

export class OutputFormatter {
  /**
   * Smart format: generates POM + test when project context is available,
   * or a single standalone file when no framework is detected.
   */
  format(
    actions: RecordedAction[],
    options: FormatterOptions,
    projectCtx?: ProjectContext,
  ): { code: string; pageCode?: string; testFile: string; pageFile?: string } {
    if (projectCtx?.framework) {
      return this.formatWithContext(actions, options, projectCtx);
    }
    return this.formatStandalone(actions, options);
  }

  /** Legacy single-string output for backward compat. */
  formatLegacy(actions: RecordedAction[], options: FormatterOptions): string {
    switch (options.format) {
      case 'playwright': return this.genPlaywrightTest(actions, options);
      case 'cypress': return this.genCypressTest(actions, options);
      case 'puppeteer': return this.genPuppeteerStandalone(actions, options);
      case 'selenium': return options.language === 'java'
        ? this.genSeleniumJavaStandalone(actions, options)
        : this.genSeleniumPythonStandalone(actions, options);
      default: return this.genPlaywrightTest(actions, options);
    }
  }

  // ── Smart context-aware generation ──────────────────────────────────────

  private formatWithContext(
    actions: RecordedAction[],
    options: FormatterOptions,
    ctx: ProjectContext,
  ): { code: string; pageCode?: string; testFile: string; pageFile?: string } {
    const testName = options.testName || 'recorded test';
    const slug = this.slugify(testName);
    const pageUrl = actions.find(a => a.url && a.url !== 'about:blank')?.url || '';
    const pageName = this.derivePageName(pageUrl, slug);

    switch (ctx.framework) {
      case 'playwright': return this.formatPlaywrightPOM(actions, options, ctx, pageName, slug);
      case 'cypress': return this.formatCypressPOM(actions, options, ctx, pageName, slug);
      case 'selenium':
        return ctx.language === 'java'
          ? this.formatSeleniumJavaPOM(actions, options, ctx, pageName, slug)
          : this.formatSeleniumPythonPOM(actions, options, ctx, pageName, slug);
      case 'puppeteer': return this.formatPuppeteerPOM(actions, options, ctx, pageName, slug);
      default: return this.formatStandalone(actions, options);
    }
  }

  // ── Playwright POM + Test ──────────────────────────────────────────────

  private formatPlaywrightPOM(
    actions: RecordedAction[], options: FormatterOptions, ctx: ProjectContext,
    pageName: string, slug: string,
  ): { code: string; pageCode: string; testFile: string; pageFile: string } {
    const className = `${pageName}Page`;
    const pageDir = ctx.pageDir || join(ctx.testDir, 'pages');
    const ext = ctx.language === 'typescript' ? '.ts' : '.js';

    // ── Page Object ──
    const p: string[] = [];
    p.push(`import { type Page, type Locator } from '@playwright/test';`);
    if (ctx.basePage) {
      p.push(`import { ${ctx.basePage.className} } from '${ctx.basePage.importPath}';`);
      p.push('');
      p.push(`export class ${className} extends ${ctx.basePage.className} {`);
    } else {
      p.push('');
      p.push(`export class ${className} {`);
      p.push(`  readonly page: Page;`);
      p.push('');
      p.push(`  constructor(page: Page) {`);
      p.push(`    this.page = page;`);
      p.push(`  }`);
    }

    const locators = this.extractUniqueLocators(actions);
    if (locators.length > 0) {
      p.push('');
      p.push('  // ── Locators ──');
      for (const loc of locators) {
        p.push(`  get ${loc.name}(): Locator { return this.page.${this.pwLocator(loc.selector)}; }`);
      }
    }

    p.push('');
    p.push('  // ── Actions ──');
    const methods = this.groupMethods(actions, 'playwright');
    for (const m of methods) {
      p.push('');
      p.push(`  /** ${m.desc} */`);
      p.push(`  async ${m.name}(${m.params}) {`);
      for (const l of m.body) p.push(`    ${l}`);
      p.push(`  }`);
    }
    p.push('}');
    p.push('');

    // ── Test ──
    const t: string[] = [];
    t.push(`import { test, expect } from '@playwright/test';`);
    const imp = `./${relative(ctx.testDir, join(pageDir, className))}`.replace(/\\/g, '/');
    t.push(`import { ${className} } from '${imp}';`);
    t.push('');
    t.push(`test.describe('${options.suiteName || pageName} Tests', () => {`);
    t.push(`  let ${this.camel(pageName)}: ${className};`);
    t.push('');
    t.push(`  test.beforeEach(async ({ page }) => {`);
    t.push(`    ${this.camel(pageName)} = new ${className}(page);`);
    t.push(`  });`);
    t.push('');
    t.push(`  test('${options.testName || 'recorded interaction'}', async () => {`);
    for (const m of methods) t.push(`    await ${this.camel(pageName)}.${m.name}(${m.args});`);
    t.push(`  });`);
    t.push(`});`);
    t.push('');

    return {
      code: t.join('\n'), pageCode: p.join('\n'),
      testFile: join(ctx.testDir, `${slug}.spec${ext}`),
      pageFile: join(pageDir, `${className}${ext}`),
    };
  }

  // ── Cypress POM + Test ──────────────────────────────────────────────────

  private formatCypressPOM(
    actions: RecordedAction[], options: FormatterOptions, ctx: ProjectContext,
    pageName: string, slug: string,
  ): { code: string; pageCode: string; testFile: string; pageFile: string } {
    const className = `${pageName}Page`;
    const pageDir = ctx.pageDir || 'cypress/pages';
    const ext = ctx.language === 'typescript' ? '.ts' : '.js';

    const p: string[] = [];
    if (ctx.basePage) {
      p.push(`import { ${ctx.basePage.className} } from '${ctx.basePage.importPath}';`);
      p.push('');
      p.push(`export class ${className} extends ${ctx.basePage.className} {`);
    } else {
      p.push(`export class ${className} {`);
    }

    const locators = this.extractUniqueLocators(actions);
    if (locators.length > 0) {
      p.push('  // ── Selectors ──');
      for (const loc of locators) {
        p.push(`  get ${loc.name}() { return cy.get('${this.esc(loc.selector.value)}'); }`);
      }
    }
    p.push('');
    p.push('  // ── Actions ──');
    const methods = this.groupMethods(actions, 'cypress');
    for (const m of methods) {
      p.push('');
      p.push(`  /** ${m.desc} */`);
      p.push(`  ${m.name}(${m.params}) {`);
      for (const l of m.body) p.push(`    ${l}`);
      if (m.body.length > 0) p.push(`    return this;`);
      p.push(`  }`);
    }
    p.push('}');
    p.push('');

    const t: string[] = [];
    const imp = `../../pages/${className}`;
    t.push(`import { ${className} } from '${imp}';`);
    t.push('');
    t.push(`describe('${options.suiteName || pageName} Tests', () => {`);
    t.push(`  const ${this.camel(pageName)} = new ${className}();`);
    t.push('');
    t.push(`  it('${options.testName || 'recorded interaction'}', () => {`);
    for (const m of methods) t.push(`    ${this.camel(pageName)}.${m.name}(${m.args});`);
    t.push(`  });`);
    t.push(`});`);
    t.push('');

    return {
      code: t.join('\n'), pageCode: p.join('\n'),
      testFile: join(ctx.testDir, `${slug}.cy${ext}`),
      pageFile: join(pageDir, `${className}${ext}`),
    };
  }

  // ── Selenium Python POM + Test ──────────────────────────────────────────

  private formatSeleniumPythonPOM(
    actions: RecordedAction[], options: FormatterOptions, ctx: ProjectContext,
    pageName: string, slug: string,
  ): { code: string; pageCode: string; testFile: string; pageFile: string } {
    const className = `${pageName}Page`;
    const snake = this.snake(pageName);
    const pageDir = ctx.pageDir || 'pages';

    const p: string[] = [];
    p.push('from selenium.webdriver.common.by import By');
    p.push('from selenium.webdriver.support.ui import WebDriverWait');
    p.push('from selenium.webdriver.support import expected_conditions as EC');
    if (ctx.basePage) {
      p.push(`from ${ctx.basePage.importPath.replace(/[/\\]/g, '.')} import ${ctx.basePage.className}`);
      p.push('');
      p.push('');
      p.push(`class ${className}(${ctx.basePage.className}):`);
    } else {
      p.push('');
      p.push('');
      p.push(`class ${className}:`);
      p.push('    def __init__(self, driver):');
      p.push('        self.driver = driver');
      p.push('        self.wait = WebDriverWait(driver, 10)');
    }

    const locators = this.extractUniqueLocators(actions);
    if (locators.length > 0) {
      p.push('');
      p.push('    # ── Locators ──');
      for (const loc of locators) {
        p.push(`    ${this.snake(loc.name).toUpperCase()} = (${this.selByPy(loc.selector)})`);
      }
    }

    const methods = this.groupMethods(actions, 'selenium-python');
    p.push('');
    p.push('    # ── Actions ──');
    for (const m of methods) {
      p.push('');
      p.push(`    def ${this.snake(m.name)}(self${m.params ? ', ' + m.params : ''}):`);
      p.push(`        """${m.desc}"""`);
      for (const l of m.body) p.push(`        ${l}`);
    }
    p.push('');

    const t: string[] = [];
    t.push('import pytest');
    t.push(`from ${pageDir.replace(/[/\\]/g, '.')}.${snake}_page import ${className}`);
    t.push('');
    t.push('');
    t.push(`class Test${pageName}:`);
    t.push(`    def test_${this.snake(options.testName || 'recorded interaction')}(self, driver):`);
    t.push(`        page = ${className}(driver)`);
    for (const m of methods) t.push(`        page.${this.snake(m.name)}(${m.args})`);
    t.push('');

    return {
      code: t.join('\n'), pageCode: p.join('\n'),
      testFile: join(ctx.testDir, `test_${snake}.py`),
      pageFile: join(pageDir, `${snake}_page.py`),
    };
  }

  // ── Selenium Java POM + Test ────────────────────────────────────────────

  private formatSeleniumJavaPOM(
    actions: RecordedAction[], options: FormatterOptions, ctx: ProjectContext,
    pageName: string, slug: string,
  ): { code: string; pageCode: string; testFile: string; pageFile: string } {
    const className = `${pageName}Page`;
    const pageDir = ctx.pageDir || 'src/main/java/pages';
    const testDir = ctx.testDir || 'src/test/java/tests';

    const p: string[] = [];
    p.push('package pages;');
    p.push('');
    p.push('import org.openqa.selenium.*;');
    p.push('import org.openqa.selenium.support.ui.*;');
    if (ctx.basePage) {
      p.push('');
      p.push(`public class ${className} extends ${ctx.basePage.className} {`);
      p.push(`    public ${className}(WebDriver driver) { super(driver); }`);
    } else {
      p.push('');
      p.push(`public class ${className} {`);
      p.push('    protected WebDriver driver;');
      p.push('    protected WebDriverWait wait;');
      p.push('');
      p.push(`    public ${className}(WebDriver driver) {`);
      p.push('        this.driver = driver;');
      p.push('        this.wait = new WebDriverWait(driver, java.time.Duration.ofSeconds(10));');
      p.push('    }');
    }

    const locators = this.extractUniqueLocators(actions);
    if (locators.length > 0) {
      p.push('');
      p.push('    // ── Locators ──');
      for (const loc of locators) {
        p.push(`    private final By ${loc.name}Locator = ${this.selByJava(loc.selector)};`);
      }
    }

    const methods = this.groupMethods(actions, 'selenium-java');
    p.push('');
    for (const m of methods) {
      p.push(`    /** ${m.desc} */`);
      p.push(`    public void ${m.name}(${m.params}) {`);
      for (const l of m.body) p.push(`        ${l}`);
      p.push('    }');
      p.push('');
    }
    p.push('}');
    p.push('');

    const t: string[] = [];
    t.push('package tests;');
    t.push('');
    t.push('import org.junit.jupiter.api.*;');
    t.push('import org.openqa.selenium.*;');
    t.push('import org.openqa.selenium.chrome.ChromeDriver;');
    t.push(`import pages.${className};`);
    t.push('');
    t.push(`class ${pageName}Test {`);
    t.push('    WebDriver driver;');
    t.push(`    ${className} page;`);
    t.push('');
    t.push('    @BeforeEach');
    t.push('    void setUp() {');
    t.push('        driver = new ChromeDriver();');
    t.push(`        page = new ${className}(driver);`);
    t.push('    }');
    t.push('');
    t.push('    @Test');
    t.push(`    void test${pageName}() {`);
    for (const m of methods) t.push(`        page.${m.name}(${m.args});`);
    t.push('    }');
    t.push('');
    t.push('    @AfterEach');
    t.push('    void tearDown() { if (driver != null) driver.quit(); }');
    t.push('}');
    t.push('');

    return {
      code: t.join('\n'), pageCode: p.join('\n'),
      testFile: join(testDir, `${pageName}Test.java`),
      pageFile: join(pageDir, `${className}.java`),
    };
  }

  // ── Puppeteer POM + Test ────────────────────────────────────────────────

  private formatPuppeteerPOM(
    actions: RecordedAction[], options: FormatterOptions, ctx: ProjectContext,
    pageName: string, slug: string,
  ): { code: string; pageCode: string; testFile: string; pageFile: string } {
    const className = `${pageName}Page`;
    const pageDir = ctx.pageDir || join(ctx.testDir, 'pages');
    const ext = ctx.language === 'typescript' ? '.ts' : '.js';

    const p: string[] = [];
    if (ctx.basePage) {
      p.push(`const { ${ctx.basePage.className} } = require('${ctx.basePage.importPath}');`);
      p.push('');
      p.push(`class ${className} extends ${ctx.basePage.className} {`);
    } else {
      p.push(`class ${className} {`);
      p.push(`  constructor(page) { this.page = page; }`);
    }

    const methods = this.groupMethods(actions, 'puppeteer');
    p.push('');
    for (const m of methods) {
      p.push(`  /** ${m.desc} */`);
      p.push(`  async ${m.name}(${m.params}) {`);
      for (const l of m.body) p.push(`    ${l}`);
      p.push(`  }`);
      p.push('');
    }
    p.push('}');
    p.push(`module.exports = { ${className} };`);
    p.push('');

    const t: string[] = [];
    t.push(`const puppeteer = require('puppeteer');`);
    const imp = `./${relative(ctx.testDir, join(pageDir, className))}`.replace(/\\/g, '/');
    t.push(`const { ${className} } = require('${imp}');`);
    t.push('');
    t.push(`describe('${pageName} Tests', () => {`);
    t.push('  let browser, page, pom;');
    t.push('  beforeAll(async () => {');
    t.push('    browser = await puppeteer.launch({ headless: false });');
    t.push('    page = await browser.newPage();');
    t.push(`    pom = new ${className}(page);`);
    t.push('  });');
    t.push('  afterAll(async () => { await browser.close(); });');
    t.push('');
    t.push(`  test('${options.testName || 'recorded interaction'}', async () => {`);
    for (const m of methods) t.push(`    await pom.${m.name}(${m.args});`);
    t.push('  });');
    t.push('});');
    t.push('');

    return {
      code: t.join('\n'), pageCode: p.join('\n'),
      testFile: join(ctx.testDir, `${slug}.test${ext}`),
      pageFile: join(pageDir, `${className}${ext}`),
    };
  }

  // ── Standalone (no framework) ───────────────────────────────────────────

  private formatStandalone(
    actions: RecordedAction[], options: FormatterOptions,
  ): { code: string; testFile: string } {
    const fmt = options.format || 'playwright';
    let code: string;
    let ext: string;
    switch (fmt) {
      case 'selenium':
        code = options.language === 'java'
          ? this.genSeleniumJavaStandalone(actions, options)
          : this.genSeleniumPythonStandalone(actions, options);
        ext = options.language === 'java' ? '.java' : '.py';
        break;
      case 'puppeteer':
        code = this.genPuppeteerStandalone(actions, options); ext = '.js'; break;
      case 'cypress':
        code = this.genCypressTest(actions, options); ext = '.cy.js'; break;
      default:
        code = this.genPlaywrightTest(actions, options); ext = '.spec.ts';
    }
    const slug = this.slugify(options.testName || 'recorded-test');
    return { code, testFile: `tests/${slug}${ext}` };
  }

  // ── Simple generators (standalone / legacy) ─────────────────────────────

  private genPlaywrightTest(actions: RecordedAction[], o: FormatterOptions): string {
    const L: string[] = [];
    L.push(`import { test, expect } from '@playwright/test';`);
    L.push('');
    L.push(`test.describe('Recorded Tests', () => {`);
    L.push(`  test('${o.testName || 'recorded test'}', async ({ page }) => {`);
    for (const a of actions) { const c = this.aPlaywright(a); if (c) L.push(`    ${c}`); }
    L.push('  });');
    L.push('});');
    L.push('');
    return L.join('\n');
  }

  private genCypressTest(actions: RecordedAction[], o: FormatterOptions): string {
    const L: string[] = [];
    L.push(`describe('Recorded Tests', () => {`);
    L.push(`  it('${o.testName || 'recorded test'}', () => {`);
    for (const a of actions) { const c = this.aCypress(a); if (c) L.push(`    ${c}`); }
    L.push('  });');
    L.push('});');
    L.push('');
    return L.join('\n');
  }

  private genPuppeteerStandalone(actions: RecordedAction[], _o: FormatterOptions): string {
    const L: string[] = [];
    L.push(`const puppeteer = require('puppeteer');`);
    L.push('');
    L.push('(async () => {');
    L.push('  const browser = await puppeteer.launch({ headless: false });');
    L.push('  const page = await browser.newPage();');
    for (const a of actions) { const c = this.aPuppeteer(a); if (c) L.push(`  ${c}`); }
    L.push('  await browser.close();');
    L.push('  console.log("Test completed!");');
    L.push('})();');
    L.push('');
    return L.join('\n');
  }

  private genSeleniumPythonStandalone(actions: RecordedAction[], _o: FormatterOptions): string {
    const L: string[] = [];
    L.push('from selenium import webdriver');
    L.push('from selenium.webdriver.common.by import By');
    L.push('');
    L.push('def test_recorded():');
    L.push('    driver = webdriver.Chrome()');
    L.push('    try:');
    for (const a of actions) { const c = this.aSelPy(a); if (c) L.push(`        ${c}`); }
    L.push('    finally:');
    L.push('        driver.quit()');
    L.push('');
    L.push('if __name__ == "__main__":');
    L.push('    test_recorded()');
    L.push('');
    return L.join('\n');
  }

  private genSeleniumJavaStandalone(actions: RecordedAction[], _o: FormatterOptions): string {
    const L: string[] = [];
    L.push('import org.openqa.selenium.*;');
    L.push('import org.openqa.selenium.chrome.ChromeDriver;');
    L.push('');
    L.push('public class RecordedTest {');
    L.push('    public static void main(String[] args) {');
    L.push('        WebDriver driver = new ChromeDriver();');
    L.push('        try {');
    for (const a of actions) { const c = this.aSelJava(a); if (c) L.push(`            ${c}`); }
    L.push('        } finally { driver.quit(); }');
    L.push('    }');
    L.push('}');
    L.push('');
    return L.join('\n');
  }

  // ── Method grouping ─────────────────────────────────────────────────────

  private groupMethods(actions: RecordedAction[], style: string): Array<{
    name: string; desc: string; params: string; args: string; body: string[];
  }> {
    const result: Array<{ name: string; desc: string; params: string; args: string; body: string[] }> = [];
    let group: RecordedAction[] = [];
    let url = '';

    for (const a of actions) {
      if (a.type === 'navigate' && group.length > 0) {
        result.push(this.buildMethod(group, url, style));
        group = [];
      }
      if (a.type === 'navigate') url = a.url || '';
      group.push(a);
    }
    if (group.length > 0) result.push(this.buildMethod(group, url, style));

    // Deduplicate method names
    const nameCount = new Map<string, number>();
    for (const m of result) {
      const count = (nameCount.get(m.name) || 0) + 1;
      nameCount.set(m.name, count);
      if (count > 1) m.name = `${m.name}${count}`;
    }
    return result;
  }

  private buildMethod(
    actions: RecordedAction[], url: string, style: string,
  ): { name: string; desc: string; params: string; args: string; body: string[] } {
    const nav = actions.find(a => a.type === 'navigate');
    const fills = actions.filter(a => a.type === 'fill' || a.type === 'type');
    const clicks = actions.filter(a => a.type === 'click');
    const asserts = actions.filter(a => a.type === 'assert');

    let name: string;
    let desc: string;
    if (nav && fills.length > 0) {
      name = 'navigateAndFillForm'; desc = `Navigate to ${this.shortUrl(url)} and fill form`;
    } else if (nav && clicks.length > 0) {
      name = 'navigateAndInteract'; desc = `Navigate to ${this.shortUrl(url)} and interact`;
    } else if (fills.length > 0) {
      name = 'fillForm'; desc = 'Fill in form fields';
    } else if (nav) {
      name = 'navigateTo'; desc = `Navigate to ${this.shortUrl(url)}`;
    } else if (clicks.length > 0) {
      name = 'clickElements'; desc = 'Click page elements';
    } else if (asserts.length > 0) {
      name = 'verifyState'; desc = 'Verify page state assertions';
    } else {
      name = 'performActions'; desc = 'Perform recorded actions';
    }
    if (asserts.length > 0 && name !== 'verifyState') {
      desc += ` and verify assertions`;
    }

    const body: string[] = [];
    for (const a of actions) {
      let line: string | null = null;
      switch (style) {
        case 'cypress': line = this.aCypress(a); break;
        case 'puppeteer': line = this.aPuppeteer(a); break;
        case 'selenium-python': line = this.aSelPy(a); break;
        case 'selenium-java': line = this.aSelJava(a); break;
        default: line = this.aPlaywright(a);
      }
      if (line) body.push(line);
    }

    let params = '';
    let args = '';
    if (fills.length > 0 && (style === 'playwright' || style === 'cypress' || style === 'puppeteer')) {
      const pNames = fills.slice(0, 3).map((f, i) => {
        const sel = f.selector?.value || '';
        return this.camel(sel.replace(/[^a-zA-Z0-9]/g, ' ').trim().slice(0, 20)) || `value${i + 1}`;
      });
      if (style === 'playwright') params = pNames.map(n => `${n}?: string`).join(', ');
      else params = pNames.join(', ');
      args = fills.slice(0, 3).map(f => `'${this.esc(f.value || '')}'`).join(', ');
    }

    return { name, desc, params, args, body };
  }

  // ── Action converters (short names) ─────────────────────────────────────

  private aPlaywright(a: RecordedAction): string | null {
    const sel = a.selector ? `page.${this.pwLocator(a.selector)}` : '';
    switch (a.type) {
      case 'navigate': return `await page.goto('${this.esc(a.url || '')}');`;
      case 'click': return `await ${sel}.click();`;
      case 'dblclick': return `await ${sel}.dblclick();`;
      case 'fill': case 'type': return `await ${sel}.fill('${this.esc(a.value || '')}');`;
      case 'press': return `await page.keyboard.press('${a.key || ''}');`;
      case 'select': return `await ${sel}.selectOption('${this.esc(a.value || '')}');`;
      case 'check': return `await ${sel}.check();`;
      case 'uncheck': return `await ${sel}.uncheck();`;
      case 'hover': return `await ${sel}.hover();`;
      case 'assert': return this.aPlaywrightAssert(a, sel);
      default: return null;
    }
  }

  private aPlaywrightAssert(a: RecordedAction, sel: string): string | null {
    const expected = this.esc(a.expectedValue || '');
    const regexSafe = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const attr = this.esc(a.assertAttribute || '');
    const count = parseInt(a.expectedValue || '0', 10);
    switch (a.assertType) {
      // ── Positive ──
      case 'text':        return `await expect(${sel}).toContainText('${expected}');`;
      case 'visible':     return `await expect(${sel}).toBeVisible();`;
      case 'hidden':      return `await expect(${sel}).toBeHidden();`;
      case 'value':       return `await expect(${sel}).toHaveValue('${expected}');`;
      case 'attribute':   return `await expect(${sel}).toHaveAttribute('${attr}', '${expected}');`;
      case 'url':         return `await expect(page).toHaveURL(/${regexSafe}/);`;
      case 'title':       return `await expect(page).toHaveTitle(/${regexSafe}/);`;
      case 'count':       return `await expect(${sel}).toHaveCount(${count});`;
      case 'enabled':     return `await expect(${sel}).toBeEnabled();`;
      case 'disabled':    return `await expect(${sel}).toBeDisabled();`;
      case 'checked':     return `await expect(${sel}).toBeChecked();`;
      case 'unchecked':   return `await expect(${sel}).not.toBeChecked();`;
      case 'class':       return `await expect(${sel}).toHaveClass(/${regexSafe}/);`;
      case 'placeholder': return `await expect(${sel}).toHaveAttribute('placeholder', '${expected}');`;
      case 'href':        return `await expect(${sel}).toHaveAttribute('href', /${regexSafe}/);`;
      case 'min-count':   return `expect(await ${sel}.count()).toBeGreaterThanOrEqual(${count});`;
      // ── Negative ──
      case 'not-text':    return `await expect(${sel}).not.toContainText('${expected}');`;
      case 'not-visible': return `await expect(${sel}).not.toBeVisible();`;
      case 'not-value':   return `await expect(${sel}).not.toHaveValue('${expected}');`;
      case 'not-enabled': return `await expect(${sel}).not.toBeEnabled();`;
      case 'not-checked': return `await expect(${sel}).not.toBeChecked();`;
      case 'not-url':     return `await expect(page).not.toHaveURL(/${regexSafe}/);`;
      case 'not-title':   return `await expect(page).not.toHaveTitle(/${regexSafe}/);`;
      case 'not-count':   return `await expect(${sel}).not.toHaveCount(${count});`;
      case 'not-class':   return `await expect(${sel}).not.toHaveClass(/${regexSafe}/);`;
      default: return `// Unknown assertion: ${a.assertType}`;
    }
  }

  private aCypress(a: RecordedAction): string | null {
    const sel = a.selector ? this.esc(a.selector.value) : '';
    switch (a.type) {
      case 'navigate': return `cy.visit('${this.esc(a.url || '')}');`;
      case 'click': return `cy.get('${sel}').click();`;
      case 'fill': case 'type': return `cy.get('${sel}').clear().type('${this.esc(a.value || '')}');`;
      case 'select': return `cy.get('${sel}').select('${this.esc(a.value || '')}');`;
      case 'check': return `cy.get('${sel}').check();`;
      case 'uncheck': return `cy.get('${sel}').uncheck();`;
      case 'assert': return this.aCypressAssert(a, sel);
      default: return null;
    }
  }

  private aCypressAssert(a: RecordedAction, sel: string): string | null {
    const expected = this.esc(a.expectedValue || '');
    const attr = this.esc(a.assertAttribute || '');
    const count = parseInt(a.expectedValue || '0', 10);
    switch (a.assertType) {
      // ── Positive ──
      case 'text':        return `cy.get('${sel}').should('contain.text', '${expected}');`;
      case 'visible':     return `cy.get('${sel}').should('be.visible');`;
      case 'hidden':      return `cy.get('${sel}').should('not.be.visible');`;
      case 'value':       return `cy.get('${sel}').should('have.value', '${expected}');`;
      case 'attribute':   return `cy.get('${sel}').should('have.attr', '${attr}', '${expected}');`;
      case 'url':         return `cy.url().should('include', '${expected}');`;
      case 'title':       return `cy.title().should('include', '${expected}');`;
      case 'count':       return `cy.get('${sel}').should('have.length', ${count});`;
      case 'enabled':     return `cy.get('${sel}').should('be.enabled');`;
      case 'disabled':    return `cy.get('${sel}').should('be.disabled');`;
      case 'checked':     return `cy.get('${sel}').should('be.checked');`;
      case 'unchecked':   return `cy.get('${sel}').should('not.be.checked');`;
      case 'class':       return `cy.get('${sel}').should('have.class', '${expected}');`;
      case 'placeholder': return `cy.get('${sel}').should('have.attr', 'placeholder', '${expected}');`;
      case 'href':        return `cy.get('${sel}').should('have.attr', 'href').and('include', '${expected}');`;
      case 'min-count':   return `cy.get('${sel}').should('have.length.at.least', ${count});`;
      // ── Negative ──
      case 'not-text':    return `cy.get('${sel}').should('not.contain.text', '${expected}');`;
      case 'not-visible': return `cy.get('${sel}').should('not.be.visible');`;
      case 'not-value':   return `cy.get('${sel}').should('not.have.value', '${expected}');`;
      case 'not-enabled': return `cy.get('${sel}').should('not.be.enabled');`;
      case 'not-checked': return `cy.get('${sel}').should('not.be.checked');`;
      case 'not-url':     return `cy.url().should('not.include', '${expected}');`;
      case 'not-title':   return `cy.title().should('not.include', '${expected}');`;
      case 'not-count':   return `cy.get('${sel}').should('not.have.length', ${count});`;
      case 'not-class':   return `cy.get('${sel}').should('not.have.class', '${expected}');`;
      default: return `// Unknown assertion: ${a.assertType}`;
    }
  }

  private aPuppeteer(a: RecordedAction): string | null {
    const sel = a.selector?.value || '';
    switch (a.type) {
      case 'navigate': return `await page.goto('${this.esc(a.url || '')}');`;
      case 'click': return `await page.click('${this.esc(sel)}');`;
      case 'fill': case 'type': return `await page.type('${this.esc(sel)}', '${this.esc(a.value || '')}');`;
      case 'press': return `await page.keyboard.press('${a.key || ''}');`;
      case 'assert': return this.aPuppeteerAssert(a, sel);
      default: return null;
    }
  }

  private aPuppeteerAssert(a: RecordedAction, sel: string): string | null {
    const expected = this.esc(a.expectedValue || '');
    const escapedSel = this.esc(sel);
    const attr = this.esc(a.assertAttribute || '');
    const count = parseInt(a.expectedValue || '0', 10);
    switch (a.assertType) {
      // ── Positive ──
      case 'text':        return `expect(await page.$eval('${escapedSel}', el => el.textContent)).toContain('${expected}');`;
      case 'visible':     return `expect(await page.$('${escapedSel}')).toBeTruthy();`;
      case 'hidden':      return `expect(await page.$('${escapedSel}')).toBeFalsy();`;
      case 'value':       return `expect(await page.$eval('${escapedSel}', el => el.value)).toBe('${expected}');`;
      case 'attribute':   return `expect(await page.$eval('${escapedSel}', el => el.getAttribute('${attr}'))).toBe('${expected}');`;
      case 'url':         return `expect(page.url()).toContain('${expected}');`;
      case 'title':       return `expect(await page.title()).toContain('${expected}');`;
      case 'count':       return `expect(await page.$$('${escapedSel}')).toHaveLength(${count});`;
      case 'enabled':     return `expect(await page.$eval('${escapedSel}', el => !el.disabled)).toBe(true);`;
      case 'disabled':    return `expect(await page.$eval('${escapedSel}', el => el.disabled)).toBe(true);`;
      case 'checked':     return `expect(await page.$eval('${escapedSel}', el => el.checked)).toBe(true);`;
      case 'unchecked':   return `expect(await page.$eval('${escapedSel}', el => el.checked)).toBe(false);`;
      case 'class':       return `expect(await page.$eval('${escapedSel}', el => el.className)).toContain('${expected}');`;
      case 'placeholder': return `expect(await page.$eval('${escapedSel}', el => el.getAttribute('placeholder'))).toBe('${expected}');`;
      case 'href':        return `expect(await page.$eval('${escapedSel}', el => el.getAttribute('href'))).toContain('${expected}');`;
      case 'min-count':   return `expect((await page.$$('${escapedSel}')).length).toBeGreaterThanOrEqual(${count});`;
      // ── Negative ──
      case 'not-text':    return `expect(await page.$eval('${escapedSel}', el => el.textContent)).not.toContain('${expected}');`;
      case 'not-visible': return `expect(await page.$('${escapedSel}')).toBeFalsy();`;
      case 'not-value':   return `expect(await page.$eval('${escapedSel}', el => el.value)).not.toBe('${expected}');`;
      case 'not-enabled': return `expect(await page.$eval('${escapedSel}', el => !el.disabled)).toBe(false);`;
      case 'not-checked': return `expect(await page.$eval('${escapedSel}', el => el.checked)).toBe(false);`;
      case 'not-url':     return `expect(page.url()).not.toContain('${expected}');`;
      case 'not-title':   return `expect(await page.title()).not.toContain('${expected}');`;
      case 'not-count':   return `expect((await page.$$('${escapedSel}')).length).not.toBe(${count});`;
      case 'not-class':   return `expect(await page.$eval('${escapedSel}', el => el.className)).not.toContain('${expected}');`;
      default: return `// Unknown assertion: ${a.assertType}`;
    }
  }

  private aSelPy(a: RecordedAction): string | null {
    const by = this.selByPy(a.selector);
    switch (a.type) {
      case 'navigate': return `driver.get("${a.url || ''}")`;
      case 'click': return `driver.find_element(${by}).click()`;
      case 'fill': case 'type': return `driver.find_element(${by}).send_keys("${this.esc(a.value || '')}")`;
      case 'assert': return this.aSelPyAssert(a, by);
      default: return null;
    }
  }

  private aSelPyAssert(a: RecordedAction, by: string): string | null {
    const expected = this.esc(a.expectedValue || '');
    const attr = this.esc(a.assertAttribute || '');
    const count = parseInt(a.expectedValue || '0', 10);
    switch (a.assertType) {
      // ── Positive ──
      case 'text':        return `assert "${expected}" in driver.find_element(${by}).text`;
      case 'visible':     return `assert driver.find_element(${by}).is_displayed()`;
      case 'hidden':      return `assert not driver.find_element(${by}).is_displayed()`;
      case 'value':       return `assert driver.find_element(${by}).get_attribute("value") == "${expected}"`;
      case 'attribute':   return `assert driver.find_element(${by}).get_attribute("${attr}") == "${expected}"`;
      case 'url':         return `assert "${expected}" in driver.current_url`;
      case 'title':       return `assert "${expected}" in driver.title`;
      case 'count':       return `assert len(driver.find_elements(${by})) == ${count}`;
      case 'enabled':     return `assert driver.find_element(${by}).is_enabled()`;
      case 'disabled':    return `assert not driver.find_element(${by}).is_enabled()`;
      case 'checked':     return `assert driver.find_element(${by}).is_selected()`;
      case 'unchecked':   return `assert not driver.find_element(${by}).is_selected()`;
      case 'class':       return `assert "${expected}" in driver.find_element(${by}).get_attribute("class")`;
      case 'placeholder': return `assert driver.find_element(${by}).get_attribute("placeholder") == "${expected}"`;
      case 'href':        return `assert "${expected}" in driver.find_element(${by}).get_attribute("href")`;
      case 'min-count':   return `assert len(driver.find_elements(${by})) >= ${count}`;
      // ── Negative ──
      case 'not-text':    return `assert "${expected}" not in driver.find_element(${by}).text`;
      case 'not-visible': return `assert not driver.find_element(${by}).is_displayed()`;
      case 'not-value':   return `assert driver.find_element(${by}).get_attribute("value") != "${expected}"`;
      case 'not-enabled': return `assert not driver.find_element(${by}).is_enabled()`;
      case 'not-checked': return `assert not driver.find_element(${by}).is_selected()`;
      case 'not-url':     return `assert "${expected}" not in driver.current_url`;
      case 'not-title':   return `assert "${expected}" not in driver.title`;
      case 'not-count':   return `assert len(driver.find_elements(${by})) != ${count}`;
      case 'not-class':   return `assert "${expected}" not in driver.find_element(${by}).get_attribute("class")`;
      default: return `# Unknown assertion: ${a.assertType}`;
    }
  }

  private aSelJava(a: RecordedAction): string | null {
    const by = this.selByJava(a.selector);
    switch (a.type) {
      case 'navigate': return `driver.get("${a.url || ''}");`;
      case 'click': return `driver.findElement(${by}).click();`;
      case 'fill': case 'type': return `driver.findElement(${by}).sendKeys("${this.esc(a.value || '')}");`;
      case 'assert': return this.aSelJavaAssert(a, by);
      default: return null;
    }
  }

  private aSelJavaAssert(a: RecordedAction, by: string): string | null {
    const expected = this.esc(a.expectedValue || '');
    const attr = this.esc(a.assertAttribute || '');
    const count = parseInt(a.expectedValue || '0', 10);
    switch (a.assertType) {
      // ── Positive ──
      case 'text':        return `assertTrue(driver.findElement(${by}).getText().contains("${expected}"));`;
      case 'visible':     return `assertTrue(driver.findElement(${by}).isDisplayed());`;
      case 'hidden':      return `assertFalse(driver.findElement(${by}).isDisplayed());`;
      case 'value':       return `assertEquals("${expected}", driver.findElement(${by}).getAttribute("value"));`;
      case 'attribute':   return `assertEquals("${expected}", driver.findElement(${by}).getAttribute("${attr}"));`;
      case 'url':         return `assertTrue(driver.getCurrentUrl().contains("${expected}"));`;
      case 'title':       return `assertTrue(driver.getTitle().contains("${expected}"));`;
      case 'count':       return `assertEquals(${count}, driver.findElements(${by}).size());`;
      case 'enabled':     return `assertTrue(driver.findElement(${by}).isEnabled());`;
      case 'disabled':    return `assertFalse(driver.findElement(${by}).isEnabled());`;
      case 'checked':     return `assertTrue(driver.findElement(${by}).isSelected());`;
      case 'unchecked':   return `assertFalse(driver.findElement(${by}).isSelected());`;
      case 'class':       return `assertTrue(driver.findElement(${by}).getAttribute("class").contains("${expected}"));`;
      case 'placeholder': return `assertEquals("${expected}", driver.findElement(${by}).getAttribute("placeholder"));`;
      case 'href':        return `assertTrue(driver.findElement(${by}).getAttribute("href").contains("${expected}"));`;
      case 'min-count':   return `assertTrue(driver.findElements(${by}).size() >= ${count});`;
      // ── Negative ──
      case 'not-text':    return `assertFalse(driver.findElement(${by}).getText().contains("${expected}"));`;
      case 'not-visible': return `assertFalse(driver.findElement(${by}).isDisplayed());`;
      case 'not-value':   return `assertNotEquals("${expected}", driver.findElement(${by}).getAttribute("value"));`;
      case 'not-enabled': return `assertFalse(driver.findElement(${by}).isEnabled());`;
      case 'not-checked': return `assertFalse(driver.findElement(${by}).isSelected());`;
      case 'not-url':     return `assertFalse(driver.getCurrentUrl().contains("${expected}"));`;
      case 'not-title':   return `assertFalse(driver.getTitle().contains("${expected}"));`;
      case 'not-count':   return `assertNotEquals(${count}, driver.findElements(${by}).size());`;
      case 'not-class':   return `assertFalse(driver.findElement(${by}).getAttribute("class").contains("${expected}"));`;
      default: return `// Unknown assertion: ${a.assertType}`;
    }
  }

  // ── Selector helpers ────────────────────────────────────────────────────

  private pwLocator(s: ElementSelector): string {
    switch (s.strategy) {
      case 'testId': return `getByTestId('${this.esc(s.value)}')`;
      case 'role': {
        // Role format is "role|name" (e.g. "button|Submit") or just "role"
        const parts = s.value.split('|');
        const role = parts[0]!;
        const name = parts[1];
        if (name) {
          return `getByRole('${this.esc(role)}', { name: '${this.esc(name)}' })`;
        }
        return `getByRole('${this.esc(role)}')`;
      }
      case 'label': return `getByLabel('${this.esc(s.value)}')`;
      case 'text': return `getByText('${this.esc(s.value)}')`;
      case 'placeholder': return `getByPlaceholder('${this.esc(s.value)}')`;
      default: return `locator('${this.esc(s.value)}')`;
    }
  }

  private selByPy(s?: ElementSelector): string {
    if (!s) return 'By.CSS_SELECTOR, ""';
    switch (s.strategy) {
      case 'testId': return `By.CSS_SELECTOR, "[data-testid='${this.esc(s.value)}']"`;
      case 'xpath': return `By.XPATH, "${this.esc(s.value)}"`;
      case 'text': return `By.XPATH, "//*[contains(text(), '${this.esc(s.value)}')]"`;
      case 'name': return `By.NAME, "${this.esc(s.value)}"`;
      default: return `By.CSS_SELECTOR, "${this.esc(s.value)}"`;
    }
  }

  private selByJava(s?: ElementSelector): string {
    if (!s) return 'By.cssSelector("")';
    switch (s.strategy) {
      case 'testId': return `By.cssSelector("[data-testid='${this.esc(s.value)}']")`;
      case 'xpath': return `By.xpath("${this.esc(s.value)}")`;
      case 'text': return `By.xpath("//*[contains(text(), '${this.esc(s.value)}')]")`;
      case 'name': return `By.name("${this.esc(s.value)}")`;
      default: return `By.cssSelector("${this.esc(s.value)}")`;
    }
  }

  // ── Locator extraction ──────────────────────────────────────────────────

  private extractUniqueLocators(actions: RecordedAction[]): Array<{ name: string; selector: ElementSelector }> {
    const seen = new Set<string>();
    const locators: Array<{ name: string; selector: ElementSelector }> = [];
    for (const a of actions) {
      if (!a.selector) continue;
      const key = `${a.selector.strategy}:${a.selector.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locators.push({ name: this.selectorToProp(a.selector, a.description), selector: a.selector });
    }
    return locators;
  }

  private selectorToProp(selector: ElementSelector, desc?: string): string {
    if (desc) {
      const cleaned = desc.replace(/^(Click|Type|Fill|Press|Select|Check|Uncheck|Hover)\s*/i, '')
        .replace(/["']/g, '').replace(/field$/i, '').trim();
      if (cleaned.length > 0 && cleaned.length < 30) return this.camel(cleaned);
    }
    const val = selector.value;
    if (val.startsWith('#')) return this.camel(val.slice(1));
    if (val.includes('[name="')) {
      const m = val.match(/\[name="([^"]+)"\]/);
      if (m) return this.camel(m[1]!);
    }
    return this.camel(val.replace(/[^a-zA-Z0-9]/g, ' ').trim().slice(0, 20) || 'element');
  }

  // ── String utils ────────────────────────────────────────────────────────

  private esc(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  }

  private slugify(s: string): string {
    return s.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
  }

  private camel(s: string): string {
    return s.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, c => c.toLowerCase()).replace(/[^a-zA-Z0-9]/g, '') || 'element';
  }

  private pascal(s: string): string {
    const c = this.camel(s); return c.charAt(0).toUpperCase() + c.slice(1);
  }

  private snake(s: string): string {
    return s.replace(/([A-Z])/g, '_$1').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase().replace(/^_|_$/g, '');
  }

  private shortUrl(url: string): string {
    try { const u = new URL(url); return u.hostname + (u.pathname !== '/' ? u.pathname : ''); }
    catch { return url.slice(0, 40); }
  }

  private derivePageName(url: string, fallback: string): string {
    try {
      const u = new URL(url);
      const host = u.hostname.replace('www.', '').split('.')[0] || fallback;
      const path = u.pathname.replace(/\//g, ' ').trim();
      if (path && path.length < 30) return this.pascal(`${host} ${path}`);
      return this.pascal(host);
    } catch { return this.pascal(fallback); }
  }
}

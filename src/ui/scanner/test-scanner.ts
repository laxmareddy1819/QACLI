import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { parseFeatureFile } from '../parsers/stdout-parser.js';
import { detectLanguage } from './file-classifier.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type TestFramework =
  | 'playwright' | 'jest' | 'cypress' | 'mocha' | 'vitest'
  | 'cucumber' | 'pytest' | 'junit' | 'testng'
  | 'nunit' | 'xunit' | 'mstest'
  | 'rspec' | 'robot' | 'unknown';

export interface ScannedTest {
  name: string;
  suite: string;
  file: string;                 // Relative path from project root
  framework: TestFramework;
  line?: number;                // 1-based line number
  endLine?: number;             // 1-based end line of test body
  steps?: Array<{ keyword: string; name: string }>;
}

export interface ScannedSuite {
  name: string;
  file: string;
  framework: TestFramework;
  tests: ScannedTest[];
}

export interface ScanResult {
  suites: ScannedSuite[];
  totalSuites: number;
  totalTests: number;
}

// ── Ignore Patterns ──────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.git', '.svn',
  '.idea', '.vscode', '.vs', '__pycache__', '.tox', '.mypy_cache',
  '.pytest_cache', '.nyc_output', '.next', '.nuxt', 'target',
  'bin', 'obj', 'coverage', '.gradle', '.mvn', 'vendor',
]);

// ── Main Scanner ─────────────────────────────────────────────────────────────

/**
 * Scan all test files in a project and extract individual test names.
 * Works with: Playwright, Jest, Cypress, Mocha, Vitest, Cucumber,
 * pytest, JUnit, TestNG, NUnit, xUnit, MSTest, RSpec, Robot Framework.
 */
export function scanAllTests(projectPath: string): ScanResult {
  const allTests: ScannedTest[] = [];

  walkTestFiles(projectPath, projectPath, (fullPath, relPath) => {
    const ext = extname(fullPath).toLowerCase();
    const name = basename(fullPath).toLowerCase();

    try {
      // Cucumber .feature files — use existing parser
      if (ext === '.feature') {
        const scenarios = parseFeatureFile(fullPath);
        for (const s of scenarios) {
          allTests.push({
            name: s.name,
            suite: s.feature || basename(fullPath, '.feature'),
            file: relPath,
            framework: 'cucumber',
            steps: s.steps,
          });
        }
        return;
      }

      // Robot Framework
      if (ext === '.robot') {
        const content = readFileSync(fullPath, 'utf-8');
        allTests.push(...extractRobotTests(content, relPath));
        return;
      }

      // Only read test files for code-based extraction
      if (!isTestFile(name, relPath.toLowerCase().replace(/\\/g, '/'), ext)) return;

      const content = readFileSync(fullPath, 'utf-8');
      const lang = detectLanguage(fullPath);

      switch (lang) {
        case 'typescript':
        case 'javascript':
          allTests.push(...extractJsTsTests(content, relPath));
          break;
        case 'python':
          allTests.push(...extractPythonTests(content, relPath));
          break;
        case 'java':
          allTests.push(...extractJavaTests(content, relPath));
          break;
        case 'csharp':
          allTests.push(...extractCSharpTests(content, relPath));
          break;
        case 'ruby':
          allTests.push(...extractRubyTests(content, relPath));
          break;
      }
    } catch { /* skip unreadable files */ }
  });

  // Group tests into suites by (file + suite name)
  const suiteMap = new Map<string, ScannedSuite>();
  for (const test of allTests) {
    const key = `${test.file}::${test.suite}`;
    const existing = suiteMap.get(key);
    if (existing) {
      existing.tests.push(test);
    } else {
      suiteMap.set(key, {
        name: test.suite,
        file: test.file,
        framework: test.framework,
        tests: [test],
      });
    }
  }

  const suites = Array.from(suiteMap.values());
  const totalTests = suites.reduce((sum, s) => sum + s.tests.length, 0);

  return { suites, totalSuites: suites.length, totalTests };
}

// ── File Walking ─────────────────────────────────────────────────────────────

function walkTestFiles(
  dir: string,
  rootDir: string,
  callback: (fullPath: string, relPath: string) => void,
  depth = 0,
): void {
  if (depth > 8) return; // Safety limit
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkTestFiles(fullPath, rootDir, callback, depth + 1);
      } else {
        const relPath = relative(rootDir, fullPath).replace(/\\/g, '/');
        callback(fullPath, relPath);
      }
    }
  } catch { /* permission error */ }
}

// ── Test File Detection ──────────────────────────────────────────────────────

function isTestFile(name: string, pathLower: string, ext: string): boolean {
  // JS/TS test patterns
  if (/\.(spec|test|cy|e2e)\.(ts|js|mts|mjs|tsx|jsx)$/i.test(name)) return true;
  // Python test patterns
  if (ext === '.py' && (name.startsWith('test_') || name.endsWith('_test.py'))) return true;
  // Java test patterns
  if (ext === '.java' && (name.endsWith('test.java') || name.endsWith('tests.java') || name.startsWith('test'))) return true;
  // C# test patterns
  if (ext === '.cs' && (name.endsWith('tests.cs') || name.endsWith('test.cs'))) return true;
  // Ruby test patterns
  if (ext === '.rb' && (name.endsWith('_spec.rb') || name.endsWith('_test.rb'))) return true;
  // Directory-based detection
  if (pathLower.includes('/tests/') || pathLower.includes('/test/') ||
      pathLower.includes('/specs/') || pathLower.includes('/spec/') ||
      pathLower.includes('/e2e/') || pathLower.includes('/__tests__/') ||
      pathLower.includes('/cypress/e2e/') || pathLower.includes('/cypress/integration/')) {
    const sourceExts = new Set(['.ts', '.js', '.py', '.java', '.cs', '.rb', '.mts', '.mjs']);
    if (sourceExts.has(ext)) return true;
  }
  return false;
}

// ── JS/TS Extractor ──────────────────────────────────────────────────────────

function extractJsTsTests(content: string, relPath: string): ScannedTest[] {
  const tests: ScannedTest[] = [];
  const lines = content.split('\n');
  const fileBase = basename(relPath).replace(/\.(spec|test|cy|e2e)\.(ts|js|mts|mjs|tsx|jsx)$/i, '');

  // Detect framework from imports
  const framework = detectJsFramework(content);

  // Track describe/test.describe nesting
  const describeStack: string[] = [];
  let braceDepth = 0;
  const describeDepths: number[] = []; // brace depth at each describe level

  // Track pending test for endLine detection
  let pendingTest: ScannedTest | null = null;
  let pendingTestBraceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Track describe blocks
    const describeMatch = trimmed.match(
      /^(?:test\.)?describe(?:\.(?:only|skip|serial|parallel))?\s*\(\s*(['"`])(.+?)\1/,
    );
    if (describeMatch) {
      describeStack.push(describeMatch[2]!);
      describeDepths.push(braceDepth);
    }

    // Track brace depth and detect endLine for pending test
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        // Close pending test if braces return to its start depth
        if (pendingTest && braceDepth <= pendingTestBraceDepth) {
          pendingTest.endLine = lineNum;
          pendingTest = null;
        }
        // Pop describe if we've closed past its opening brace
        while (describeDepths.length > 0 && braceDepth <= describeDepths[describeDepths.length - 1]!) {
          describeStack.pop();
          describeDepths.pop();
        }
      }
    }

    // Match test/it blocks
    const testMatch = trimmed.match(
      /^(?:test|it)(?:\.(?:only|skip|todo|fixme|concurrent))?\s*\(\s*(['"`])(.+?)\1/,
    );
    if (testMatch) {
      const testName = testMatch[2]!;
      const suiteName = describeStack.length > 0
        ? describeStack.join(' > ')
        : fileBase;

      const test: ScannedTest = {
        name: testName,
        suite: suiteName,
        file: relPath,
        framework,
        line: lineNum,
      };
      tests.push(test);

      // Track this test for endLine — use brace depth before this line's braces
      pendingTest = test;
      pendingTestBraceDepth = braceDepth - countChar(line, '{') + countChar(line, '}');
    }
  }

  return tests;
}

function detectJsFramework(content: string): TestFramework {
  if (/from\s+['"]@playwright\/test['"]/.test(content)) return 'playwright';
  if (/require\s*\(\s*['"]@playwright\/test['"]\s*\)/.test(content)) return 'playwright';
  if (/from\s+['"]cypress['"]/.test(content)) return 'cypress';
  if (/from\s+['"]vitest['"]/.test(content)) return 'vitest';
  if (/cy\.\w+\(/.test(content)) return 'cypress';
  if (/from\s+['"]@jest/.test(content)) return 'jest';
  if (/from\s+['"]mocha['"]/.test(content)) return 'mocha';
  // Default heuristic based on file extension patterns
  return 'jest';
}

// ── Python Extractor ─────────────────────────────────────────────────────────

function extractPythonTests(content: string, relPath: string): ScannedTest[] {
  const tests: ScannedTest[] = [];
  const lines = content.split('\n');
  const fileBase = basename(relPath, extname(relPath));

  let currentClass: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // Track class declarations
    const classMatch = line.match(/^class\s+(Test\w+|.*Test)\s*[:(]/);
    if (classMatch) {
      currentClass = classMatch[1]!;
    }

    // Detect unindented lines = exit class scope
    if (currentClass && /^\S/.test(line) && !line.startsWith('class') && line.trim() !== '') {
      if (!line.startsWith('#') && !line.startsWith('@')) {
        currentClass = null;
      }
    }

    // Match test functions
    const testMatch = line.match(/^\s*def\s+(test_\w+)\s*\(/);
    if (testMatch) {
      const testName = testMatch[1]!;
      const suiteName = currentClass || fileBase;
      const defIndent = line.search(/\S/);

      // Find endLine by looking for the first non-blank line at same or lesser indentation
      let endLine: number | undefined;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]!;
        if (nextLine.trim() === '') continue; // skip blank lines
        const nextIndent = nextLine.search(/\S/);
        if (nextIndent <= defIndent) {
          endLine = j; // line before this is the last line of the test body
          break;
        }
      }
      if (!endLine) endLine = lines.length; // test runs to end of file

      tests.push({
        name: testName,
        suite: suiteName,
        file: relPath,
        framework: 'pytest',
        line: lineNum,
        endLine,
      });
    }
  }

  return tests;
}

// ── Java Extractor ───────────────────────────────────────────────────────────

function extractJavaTests(content: string, relPath: string): ScannedTest[] {
  const tests: ScannedTest[] = [];
  const lines = content.split('\n');
  const fileBase = basename(relPath, '.java');

  // Detect framework
  const framework: TestFramework = content.includes('org.testng') ? 'testng' : 'junit';

  // Find class name
  let className = fileBase;
  const classMatch = content.match(/(?:public\s+)?class\s+(\w+)/);
  if (classMatch) className = classMatch[1]!;

  // Find @Test annotated methods
  let expectingMethod = false;
  let pendingTest: ScannedTest | null = null;
  let methodBraceDepth = 0;
  let trackingBraces = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNum = i + 1;

    if (trimmed === '@Test' || trimmed.startsWith('@Test(')) {
      expectingMethod = true;
      continue;
    }

    if (expectingMethod) {
      // Match method declaration
      const methodMatch = trimmed.match(
        /(?:public|protected|private)?\s*(?:static\s+)?(?:void|[\w<>[\]]+)\s+(\w+)\s*\(/,
      );
      if (methodMatch) {
        const test: ScannedTest = {
          name: methodMatch[1]!,
          suite: className,
          file: relPath,
          framework,
          line: lineNum,
        };
        tests.push(test);
        expectingMethod = false;
        pendingTest = test;
        methodBraceDepth = 0;
        trackingBraces = true;
      }
      // Skip annotations between @Test and method
      if (!trimmed.startsWith('@')) {
        expectingMethod = false;
      }
    }

    // Track braces for endLine detection
    if (trackingBraces && pendingTest) {
      for (const ch of line) {
        if (ch === '{') methodBraceDepth++;
        if (ch === '}') {
          methodBraceDepth--;
          if (methodBraceDepth <= 0) {
            pendingTest.endLine = lineNum;
            pendingTest = null;
            trackingBraces = false;
            break;
          }
        }
      }
    }
  }

  return tests;
}

// ── C# Extractor ─────────────────────────────────────────────────────────────

function extractCSharpTests(content: string, relPath: string): ScannedTest[] {
  const tests: ScannedTest[] = [];
  const lines = content.split('\n');
  const fileBase = basename(relPath, '.cs');

  // Find class name
  let className = fileBase;
  const classMatch = content.match(/class\s+(\w+)/);
  if (classMatch) className = classMatch[1]!;

  // Find test-annotated methods
  let expectingMethod = false;
  let detectedFramework: TestFramework = 'nunit';
  let pendingTest: ScannedTest | null = null;
  let methodBraceDepth = 0;
  let trackingBraces = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Detect test attributes
    if (/\[Test\b/.test(trimmed) || /\[TestCase\b/.test(trimmed)) {
      expectingMethod = true;
      detectedFramework = 'nunit';
      continue;
    }
    if (/\[Fact\b/.test(trimmed) || /\[Theory\b/.test(trimmed)) {
      expectingMethod = true;
      detectedFramework = 'xunit';
      continue;
    }
    if (/\[TestMethod\b/.test(trimmed)) {
      expectingMethod = true;
      detectedFramework = 'mstest';
      continue;
    }

    if (expectingMethod) {
      const methodMatch = trimmed.match(
        /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:Task|void|\w+)\s+(\w+)\s*\(/,
      );
      if (methodMatch) {
        const test: ScannedTest = {
          name: methodMatch[1]!,
          suite: className,
          file: relPath,
          framework: detectedFramework,
          line: lineNum,
        };
        tests.push(test);
        expectingMethod = false;
        pendingTest = test;
        methodBraceDepth = 0;
        trackingBraces = true;
      }
      if (!trimmed.startsWith('[')) {
        expectingMethod = false;
      }
    }

    // Track braces for endLine detection
    if (trackingBraces && pendingTest) {
      for (const ch of line) {
        if (ch === '{') methodBraceDepth++;
        if (ch === '}') {
          methodBraceDepth--;
          if (methodBraceDepth <= 0) {
            pendingTest.endLine = lineNum;
            pendingTest = null;
            trackingBraces = false;
            break;
          }
        }
      }
    }
  }

  return tests;
}

// ── Ruby Extractor ───────────────────────────────────────────────────────────

function extractRubyTests(content: string, relPath: string): ScannedTest[] {
  const tests: ScannedTest[] = [];
  const lines = content.split('\n');
  const fileBase = basename(relPath).replace(/(_spec|_test)\.rb$/i, '');

  const describeStack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Track describe/context blocks
    const describeMatch = trimmed.match(/^(?:describe|context)\s+['"](.+?)['"]/);
    if (describeMatch) {
      describeStack.push(describeMatch[1]!);
    }

    // Track end blocks (approximate — count indentation)
    if (trimmed === 'end') {
      // Simple heuristic: indent level determines which describe we're closing
      const indent = line.length - trimmed.length;
      if (indent <= (describeStack.length - 1) * 2 && describeStack.length > 0) {
        describeStack.pop();
      }
    }

    // Match it blocks
    const itMatch = trimmed.match(/^it\s+['"](.+?)['"]/);
    if (itMatch) {
      const suiteName = describeStack.length > 0
        ? describeStack.join(' > ')
        : fileBase;

      const itIndent = line.search(/\S/);

      // Find matching 'end' at same indentation level
      let endLine: number | undefined;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]!;
        if (nextLine.trim() === 'end') {
          const endIndent = nextLine.search(/\S/);
          if (endIndent <= itIndent) {
            endLine = j + 1; // 1-based
            break;
          }
        }
      }

      tests.push({
        name: itMatch[1]!,
        suite: suiteName,
        file: relPath,
        framework: 'rspec',
        line: lineNum,
        endLine,
      });
    }
  }

  return tests;
}

// ── Robot Framework Extractor ────────────────────────────────────────────────

function extractRobotTests(content: string, relPath: string): ScannedTest[] {
  const tests: ScannedTest[] = [];
  const lines = content.split('\n');
  const fileBase = basename(relPath, '.robot');
  let inTestCases = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // Detect section headers
    if (/^\*{3}\s*Test Cases?\s*\*{3}/i.test(line.trim())) {
      inTestCases = true;
      continue;
    }
    if (/^\*{3}\s*(Keywords?|Settings?|Variables?)\s*\*{3}/i.test(line.trim())) {
      inTestCases = false;
      // Set endLine for the last test before this section
      if (tests.length > 0 && !tests[tests.length - 1]!.endLine) {
        tests[tests.length - 1]!.endLine = i; // previous line (0-based i = 1-based i)
      }
      continue;
    }

    // In Test Cases section, non-indented non-empty lines are test names
    if (inTestCases && /^\S/.test(line) && line.trim() !== '') {
      // Close previous test's endLine
      if (tests.length > 0 && !tests[tests.length - 1]!.endLine) {
        tests[tests.length - 1]!.endLine = i; // previous line
      }

      tests.push({
        name: line.trim(),
        suite: fileBase,
        file: relPath,
        framework: 'robot',
        line: lineNum,
      });
    }
  }

  // Close last test's endLine at end of file
  if (tests.length > 0 && !tests[tests.length - 1]!.endLine) {
    tests[tests.length - 1]!.endLine = lines.length;
  }

  return tests;
}

// ── Utility ─────────────────────────────────────────────────────────────────

function countChar(str: string, ch: string): number {
  let count = 0;
  for (const c of str) if (c === ch) count++;
  return count;
}

import { extname, basename } from 'node:path';
import type { FileType, ModuleType } from '../types.js';

// ── Language Detection ───────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.go': 'go',
  '.feature': 'gherkin',
  '.robot': 'robot',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml',
  '.csv': 'csv',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss',
  '.md': 'markdown',
  '.env': 'env',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.properties': 'properties',
};

export function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext]!;

  const name = basename(filePath).toLowerCase();
  if (name.startsWith('.env')) return 'env';
  if (name === 'makefile' || name === 'dockerfile') return 'shell';
  if (name === 'gemfile' || name === 'rakefile') return 'ruby';

  return 'text';
}

// ── File Type Classification ─────────────────────────────────────────────────

/**
 * Classify a file into a FileType based on its path, name, and optionally content.
 * This is the core intelligence for the dynamic module discovery.
 */
export function classifyFile(filePath: string, content?: string): FileType {
  const name = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();
  const pathLower = filePath.toLowerCase().replace(/\\/g, '/');

  // 1. Config files (check first — highest specificity)
  if (isConfigFile(name, pathLower)) return 'config';

  // 2. Environment files
  if (isEnvFile(name, pathLower)) return 'env';

  // 3. Report files
  if (isReportFile(name, pathLower, ext)) return 'report';

  // 4. Gherkin/BDD feature files
  if (ext === '.feature') return 'test'; // features are tests in BDD

  // 5. Robot Framework keyword/test files
  if (ext === '.robot') {
    if (pathLower.includes('/keywords/') || pathLower.includes('/resources/')) return 'keyword';
    return 'test';
  }

  // 6. Step definitions
  if (isStepDefinition(name, pathLower)) return 'step';

  // 7. Data files
  if (isDataFile(name, pathLower, ext)) return 'data';

  // 8. Fixture files
  if (isFixtureFile(pathLower)) return 'fixture';

  // 9. Test files (broad detection)
  if (isTestFile(name, pathLower, ext)) return 'test';

  // 10. Page object files
  if (isPageFile(name, pathLower)) return 'page';

  // 11. API test files (content-based detection)
  if (content && isApiFile(content, pathLower)) return 'api';

  // 12. Helper/utility files
  if (isHelperFile(pathLower)) return 'source';

  return 'source';
}

/**
 * Classify a directory into a ModuleType based on its path and contents.
 */
export function classifyDirectory(dirPath: string, fileTypes: FileType[]): ModuleType {
  const pathLower = dirPath.toLowerCase().replace(/\\/g, '/');

  // Check path patterns first
  if (pathLower.includes('/step_definitions') || pathLower.includes('/steps')) return 'steps';
  if (pathLower.includes('/features')) {
    if (fileTypes.some(t => t === 'step')) return 'steps';
    return 'bdd';
  }
  if (pathLower.includes('/keywords') || pathLower.includes('/resources')) return 'keywords';
  if (pathLower.includes('/page') || pathLower.includes('/pom')) return 'pages';
  if (pathLower.includes('/api')) return 'api';
  if (pathLower.includes('/data') || pathLower.includes('/testdata')) return 'data';
  if (pathLower.includes('/fixture') || pathLower.includes('/mock')) return 'fixtures';
  if (pathLower.includes('/report') || pathLower.includes('/allure') || pathLower.includes('/mochawesome')) return 'reports';
  if (pathLower.includes('/env') || pathLower.includes('/environment')) return 'env';
  if (pathLower.includes('/helper') || pathLower.includes('/util') || pathLower.includes('/support') || pathLower.includes('/lib') || pathLower.includes('/common')) return 'helpers';

  // Classify by dominant file type
  const counts = new Map<FileType, number>();
  for (const ft of fileTypes) {
    counts.set(ft, (counts.get(ft) || 0) + 1);
  }

  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return 'custom';

  switch (dominant[0]) {
    case 'test': return 'tests';
    case 'page': return 'pages';
    case 'step': return 'steps';
    case 'api': return 'api';
    case 'data': return 'data';
    case 'fixture': return 'fixtures';
    case 'config': return 'config';
    case 'report': return 'reports';
    case 'keyword': return 'keywords';
    case 'env': return 'env';
    default: return 'custom';
  }
}

// ── Detection Helpers ────────────────────────────────────────────────────────

function isConfigFile(name: string, pathLower: string): boolean {
  const configNames = new Set([
    'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs',
    'cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs',
    'wdio.conf.ts', 'wdio.conf.js',
    'jest.config.ts', 'jest.config.js', 'jest.config.mjs',
    'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts',
    '.mocharc.yml', '.mocharc.json', '.mocharc.yaml',
    'pytest.ini', 'conftest.py', 'setup.cfg', 'setup.py', 'pyproject.toml',
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'tsconfig.json', 'package.json', 'babel.config.js',
    '.eslintrc.js', '.eslintrc.json', '.prettierrc',
    'karma.conf.js', 'protractor.conf.js',
    'codecept.conf.ts', 'codecept.conf.js',
    'nightwatch.conf.js', 'nightwatch.json',
    'appium.config.js', '.babelrc',
  ]);

  if (configNames.has(name)) return true;
  if (name.endsWith('.config.ts') || name.endsWith('.config.js')) return true;
  if (name.endsWith('.conf.ts') || name.endsWith('.conf.js')) return true;

  return false;
}

function isEnvFile(name: string, pathLower: string): boolean {
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (pathLower.includes('/environments/') || pathLower.includes('/envs/')) return true;
  return false;
}

function isReportFile(name: string, pathLower: string, ext: string): boolean {
  if (pathLower.includes('/reports/') || pathLower.includes('/allure-results/')) return true;
  if (pathLower.includes('/mochawesome-report/') || pathLower.includes('/coverage/')) return true;
  if (pathLower.includes('/test-results/') || pathLower.includes('/test-output/')) return true;
  if (ext === '.html' && (pathLower.includes('report') || pathLower.includes('result'))) return true;
  return false;
}

function isStepDefinition(name: string, pathLower: string): boolean {
  if (pathLower.includes('/step_definitions/') || pathLower.includes('/steps/')) return true;
  if (name.includes('steps.') || name.includes('step_def') || name.includes('step_definition')) return true;
  if (name.endsWith('.steps.ts') || name.endsWith('.steps.js') || name.endsWith('_steps.py')) return true;
  return false;
}

function isDataFile(name: string, pathLower: string, ext: string): boolean {
  if (pathLower.includes('/data/') || pathLower.includes('/testdata/') || pathLower.includes('/test-data/')) {
    if (['.csv', '.json', '.yaml', '.yml', '.xml', '.xlsx', '.xls'].includes(ext)) return true;
  }
  if (ext === '.csv') return true; // CSV is always data
  return false;
}

function isFixtureFile(pathLower: string): boolean {
  if (pathLower.includes('/fixtures/') || pathLower.includes('/mocks/') || pathLower.includes('/stubs/')) return true;
  return false;
}

function isTestFile(name: string, pathLower: string, ext: string): boolean {
  // TypeScript/JavaScript test patterns
  if (/\.(spec|test|cy|e2e)\.(ts|js|mts|mjs|tsx|jsx)$/i.test(name)) return true;

  // Python test patterns
  if (ext === '.py' && (name.startsWith('test_') || name.endsWith('_test.py'))) return true;

  // Java test patterns
  if (ext === '.java' && (name.endsWith('test.java') || name.endsWith('tests.java') || name.startsWith('test'))) return true;

  // C# test patterns
  if (ext === '.cs' && (name.endsWith('tests.cs') || name.endsWith('test.cs'))) return true;

  // Ruby test patterns
  if (ext === '.rb' && (name.endsWith('_spec.rb') || name.endsWith('_test.rb'))) return true;

  // Test directory detection
  if (pathLower.includes('/tests/') || pathLower.includes('/test/') ||
      pathLower.includes('/specs/') || pathLower.includes('/spec/') ||
      pathLower.includes('/e2e/') || pathLower.includes('/__tests__/') ||
      pathLower.includes('/cypress/e2e/') || pathLower.includes('/cypress/integration/')) {
    const sourceExts = new Set(['.ts', '.js', '.py', '.java', '.cs', '.rb', '.mts', '.mjs']);
    if (sourceExts.has(ext)) return true;
  }

  return false;
}

function isPageFile(name: string, pathLower: string): boolean {
  if (pathLower.includes('/pages/') || pathLower.includes('/page-objects/') ||
      pathLower.includes('/pageobjects/') || pathLower.includes('/pom/')) return true;
  if (/page\.(ts|js|py|java|cs)$/i.test(name)) return true;
  if (/Page\.(ts|js|java|cs)$/.test(basename(pathLower.replace(/\\/g, '/')))) return true;
  return false;
}

function isApiFile(content: string, pathLower: string): boolean {
  if (pathLower.includes('/api/')) return true;

  // Detect API testing patterns in content
  const apiPatterns = [
    /\baxios\b/, /\bsupertest\b/, /\bfetch\(/, /\brequest\(/,
    /\bapiRequestContext\b/, /\brequests\.(get|post|put|delete|patch)\b/,
    /\bgiven\(\)\.when\(\)\./,  // RestAssured
    /\bRestAssured\b/,
    /\.get\(['"]\//, /\.post\(['"]\//, /\.put\(['"]\//, /\.delete\(['"]\//,
    /\bcy\.request\b/,
  ];

  return apiPatterns.some(p => p.test(content));
}

function isHelperFile(pathLower: string): boolean {
  if (pathLower.includes('/helpers/') || pathLower.includes('/utils/') ||
      pathLower.includes('/utilities/') || pathLower.includes('/support/') ||
      pathLower.includes('/lib/') || pathLower.includes('/common/') ||
      pathLower.includes('/shared/')) return true;
  return false;
}

// ── Utility: Derive Module Label ─────────────────────────────────────────────

/**
 * Convert a directory path segment to a human-friendly label.
 * e.g. 'step_definitions' -> 'Step Definitions', 'tests' -> 'Tests'
 */
export function deriveModuleLabel(dirName: string, type: ModuleType): string {
  // Use type-specific labels for common types
  const TYPE_LABELS: Partial<Record<ModuleType, string>> = {
    tests: 'Test Specs',
    bdd: 'Features',
    steps: 'Step Definitions',
    pages: 'Page Objects',
    api: 'API Tests',
    data: 'Test Data',
    fixtures: 'Fixtures',
    helpers: 'Utilities',
    config: 'Configuration',
    reports: 'Reports',
    keywords: 'Keywords',
    env: 'Environments',
  };

  if (TYPE_LABELS[type]) return TYPE_LABELS[type]!;

  // Fall back to humanized directory name
  return dirName
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

import { detectLanguage } from './file-classifier.js';

export interface ExtractedMetadata {
  classes?: string[];
  methods?: string[];
  steps?: string[];
  endpoints?: Array<{ method: string; url: string }>;
  keywords?: string[];
  imports?: string[];
  testCount?: number;
}

/**
 * Extract structured metadata from a source file's content.
 * Dispatches to language-specific extractors based on file extension.
 */
export function extractMetadata(filePath: string, content: string): ExtractedMetadata {
  const lang = detectLanguage(filePath);
  const meta: ExtractedMetadata = {};

  switch (lang) {
    case 'typescript':
    case 'javascript':
      Object.assign(meta, extractJsTs(content));
      break;
    case 'python':
      Object.assign(meta, extractPython(content));
      break;
    case 'java':
      Object.assign(meta, extractJava(content));
      break;
    case 'csharp':
      Object.assign(meta, extractCSharp(content));
      break;
    case 'gherkin':
      Object.assign(meta, extractGherkin(content));
      break;
    case 'robot':
      Object.assign(meta, extractRobot(content));
      break;
    case 'ruby':
      Object.assign(meta, extractRuby(content));
      break;
    default:
      break;
  }

  // Extract API endpoints from any language
  const endpoints = extractApiEndpoints(content);
  if (endpoints.length > 0) meta.endpoints = endpoints;

  return meta;
}

// ── JavaScript/TypeScript Extractor ──────────────────────────────────────────

function extractJsTs(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};

  // Classes
  const classRe = /(?:export\s+)?class\s+(\w+)/g;
  const classes: string[] = [];
  let m;
  while ((m = classRe.exec(content))) classes.push(m[1]!);
  if (classes.length > 0) meta.classes = classes;

  // Methods (class methods + exported functions)
  const methods: string[] = [];
  const methodRe = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g;
  while ((m = methodRe.exec(content))) {
    const name = m[1]!;
    if (name !== 'constructor' && name !== 'if' && name !== 'for' && name !== 'while' && name !== 'switch') {
      methods.push(name);
    }
  }
  const fnRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  while ((m = fnRe.exec(content))) methods.push(m[1]!);
  if (methods.length > 0) meta.methods = [...new Set(methods)];

  // Imports
  const imports: string[] = [];
  const importRe = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content))) imports.push(m[1]!);
  const requireRe = /require\(['"]([^'"]+)['"]\)/g;
  while ((m = requireRe.exec(content))) imports.push(m[1]!);
  if (imports.length > 0) meta.imports = imports;

  // Test count: describe/it/test blocks
  let testCount = 0;
  const testRe = /\b(?:it|test|scenario)\s*\(\s*['"]/g;
  while (testRe.exec(content)) testCount++;
  if (testCount > 0) meta.testCount = testCount;

  // Cucumber step definitions (JS)
  const steps: string[] = [];
  const stepRe = /(?:Given|When|Then|And|But)\s*\(\s*['"\/]([^'"\/]+)['"\/]/g;
  while ((m = stepRe.exec(content))) steps.push(m[1]!);
  if (steps.length > 0) meta.steps = steps;

  return meta;
}

// ── Python Extractor ─────────────────────────────────────────────────────────

function extractPython(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};
  let m;

  // Classes
  const classes: string[] = [];
  const classRe = /class\s+(\w+)/g;
  while ((m = classRe.exec(content))) classes.push(m[1]!);
  if (classes.length > 0) meta.classes = classes;

  // Methods/functions
  const methods: string[] = [];
  const defRe = /def\s+(\w+)\s*\(/g;
  while ((m = defRe.exec(content))) {
    if (m[1] !== '__init__' && m[1] !== '__repr__' && m[1] !== '__str__') {
      methods.push(m[1]!);
    }
  }
  if (methods.length > 0) meta.methods = methods;

  // Imports
  const imports: string[] = [];
  const importRe = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
  while ((m = importRe.exec(content))) imports.push(m[1] || m[2]!);
  if (imports.length > 0) meta.imports = imports;

  // Test count (pytest)
  let testCount = 0;
  const testRe = /def\s+test_\w+/g;
  while (testRe.exec(content)) testCount++;
  if (testCount > 0) meta.testCount = testCount;

  // Cucumber step definitions (behave)
  const steps: string[] = [];
  const stepRe = /@(?:given|when|then|step)\s*\(\s*['"u]([^'"]+)['"]/gi;
  while ((m = stepRe.exec(content))) steps.push(m[1]!);
  if (steps.length > 0) meta.steps = steps;

  return meta;
}

// ── Java Extractor ───────────────────────────────────────────────────────────

function extractJava(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};
  let m;

  // Classes
  const classes: string[] = [];
  const classRe = /(?:public|protected|private)?\s*class\s+(\w+)/g;
  while ((m = classRe.exec(content))) classes.push(m[1]!);
  if (classes.length > 0) meta.classes = classes;

  // Methods
  const methods: string[] = [];
  const methodRe = /(?:public|protected|private)\s+\w+\s+(\w+)\s*\(/g;
  while ((m = methodRe.exec(content))) methods.push(m[1]!);
  if (methods.length > 0) meta.methods = methods;

  // Imports
  const imports: string[] = [];
  const importRe = /import\s+([\w.]+)/g;
  while ((m = importRe.exec(content))) imports.push(m[1]!);
  if (imports.length > 0) meta.imports = imports;

  // Test count (@Test annotations)
  let testCount = 0;
  const testRe = /@Test/g;
  while (testRe.exec(content)) testCount++;
  if (testCount > 0) meta.testCount = testCount;

  // Cucumber step definitions (Java)
  const steps: string[] = [];
  const stepRe = /@(?:Given|When|Then|And|But)\s*\(\s*"([^"]+)"/g;
  while ((m = stepRe.exec(content))) steps.push(m[1]!);
  if (steps.length > 0) meta.steps = steps;

  return meta;
}

// ── C# Extractor ─────────────────────────────────────────────────────────────

function extractCSharp(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};
  let m;

  const classes: string[] = [];
  const classRe = /class\s+(\w+)/g;
  while ((m = classRe.exec(content))) classes.push(m[1]!);
  if (classes.length > 0) meta.classes = classes;

  const methods: string[] = [];
  const methodRe = /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?\w+\s+(\w+)\s*\(/g;
  while ((m = methodRe.exec(content))) methods.push(m[1]!);
  if (methods.length > 0) meta.methods = methods;

  let testCount = 0;
  const testRe = /\[(?:Test|Fact|Theory|TestMethod)\]/g;
  while (testRe.exec(content)) testCount++;
  if (testCount > 0) meta.testCount = testCount;

  // SpecFlow step definitions
  const steps: string[] = [];
  const stepRe = /\[(?:Given|When|Then)\s*\(\s*@?"([^"]+)"\s*\)\]/g;
  while ((m = stepRe.exec(content))) steps.push(m[1]!);
  if (steps.length > 0) meta.steps = steps;

  return meta;
}

// ── Ruby Extractor ───────────────────────────────────────────────────────────

function extractRuby(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};
  let m;

  const classes: string[] = [];
  const classRe = /class\s+(\w+)/g;
  while ((m = classRe.exec(content))) classes.push(m[1]!);
  if (classes.length > 0) meta.classes = classes;

  const methods: string[] = [];
  const defRe = /def\s+(\w+)/g;
  while ((m = defRe.exec(content))) {
    if (m[1] !== 'initialize') methods.push(m[1]!);
  }
  if (methods.length > 0) meta.methods = methods;

  // RSpec test count
  let testCount = 0;
  const testRe = /\b(?:it|scenario|example)\s+['"]|it\s*\{/g;
  while (testRe.exec(content)) testCount++;
  if (testCount > 0) meta.testCount = testCount;

  return meta;
}

// ── Gherkin Extractor ────────────────────────────────────────────────────────

function extractGherkin(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};
  let m;

  const steps: string[] = [];
  const stepRe = /^\s*(?:Given|When|Then|And|But)\s+(.+)$/gm;
  while ((m = stepRe.exec(content))) steps.push(m[1]!.trim());
  if (steps.length > 0) meta.steps = steps;

  // Count scenarios as tests
  let testCount = 0;
  const scenarioRe = /^\s*(?:Scenario|Scenario Outline|Example):/gm;
  while (scenarioRe.exec(content)) testCount++;
  if (testCount > 0) meta.testCount = testCount;

  return meta;
}

// ── Robot Framework Extractor ────────────────────────────────────────────────

function extractRobot(content: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};

  const keywords: string[] = [];
  let inKeywords = false;
  let inTestCases = false;
  let testCount = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trimEnd();

    if (/^\*\*\*\s*Keywords?\s*\*\*\*/i.test(trimmed)) {
      inKeywords = true; inTestCases = false; continue;
    }
    if (/^\*\*\*\s*Test Cases?\s*\*\*\*/i.test(trimmed)) {
      inTestCases = true; inKeywords = false; continue;
    }
    if (/^\*\*\*/.test(trimmed)) {
      inKeywords = false; inTestCases = false; continue;
    }

    if (inKeywords && trimmed.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      keywords.push(trimmed.trim());
    }
    if (inTestCases && trimmed.length > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      testCount++;
    }
  }

  if (keywords.length > 0) meta.keywords = keywords;
  if (testCount > 0) meta.testCount = testCount;

  return meta;
}

// ── API Endpoint Extractor ───────────────────────────────────────────────────

function extractApiEndpoints(content: string): Array<{ method: string; url: string }> {
  const endpoints: Array<{ method: string; url: string }> = [];
  const seen = new Set<string>();
  let m;

  // Pattern: .get('/url'), .post('/url'), request.get('url'), etc.
  const restRe = /\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  while ((m = restRe.exec(content))) {
    const method = m[1]!.toUpperCase();
    const url = m[2]!;
    // Only capture URL-like strings (start with / or http)
    if (url.startsWith('/') || url.startsWith('http')) {
      const key = `${method} ${url}`;
      if (!seen.has(key)) { seen.add(key); endpoints.push({ method, url }); }
    }
  }

  // Pattern: fetch('url', { method: 'POST' }) or fetch('/url')
  const fetchRe = /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = fetchRe.exec(content))) {
    const url = m[1]!;
    if (url.startsWith('/') || url.startsWith('http')) {
      // Look for method in nearby content
      const nearby = content.slice(Math.max(0, m.index! - 10), m.index! + 200);
      const methodMatch = nearby.match(/method:\s*['"](\w+)['"]/i);
      const method = methodMatch ? methodMatch[1]!.toUpperCase() : 'GET';
      const key = `${method} ${url}`;
      if (!seen.has(key)) { seen.add(key); endpoints.push({ method, url }); }
    }
  }

  // Pattern: requests.get('url') (Python)
  const pyRe = /requests\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;
  while ((m = pyRe.exec(content))) {
    const method = m[1]!.toUpperCase();
    const url = m[2]!;
    const key = `${method} ${url}`;
    if (!seen.has(key)) { seen.add(key); endpoints.push({ method, url }); }
  }

  // Pattern: cy.request({ method: 'GET', url: '/api/...' })
  const cyRe = /cy\.request\s*\(\s*\{[^}]*method:\s*['"](\w+)['"][^}]*url:\s*['"]([^'"]+)['"]/gi;
  while ((m = cyRe.exec(content))) {
    const method = m[1]!.toUpperCase();
    const url = m[2]!;
    const key = `${method} ${url}`;
    if (!seen.has(key)) { seen.add(key); endpoints.push({ method, url }); }
  }

  return endpoints;
}

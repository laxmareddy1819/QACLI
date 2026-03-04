import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, relative, extname, join } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface StepDefinitionMatch {
  file: string;       // Relative path from project root
  line: number;       // 1-based line number of step definition
  endLine: number;    // 1-based end line of function body
  pattern: string;    // The raw pattern text
  keyword: string;    // Given/When/Then/And/But
  method?: string;    // Method/function name if available
  source: string;     // Source code of the step definition function
  language: string;   // Language for syntax highlighting
}

interface ParsedStepDef {
  keyword: string;
  pattern: string;
  line: number;       // 1-based
  method?: string;
}

// ── Language detection ───────────────────────────────────────────────────────

const EXT_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cs': 'csharp',
  '.rb': 'ruby',
};

// ── Directory exclusions ─────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '.nyc_output', '__pycache__', '.pytest_cache', '.tox',
  'target', 'bin', 'obj', '.gradle', 'vendor', '.bundle',
  '.qabot', '.claude',
]);

// ── Step definition file patterns ────────────────────────────────────────────

const STEP_DEF_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.py', '.java', '.cs', '.rb']);

function isStepDefFile(name: string, pathLower: string): boolean {
  const ext = extname(name).toLowerCase();
  if (!STEP_DEF_EXTENSIONS.has(ext)) return false;

  // Directory-based detection
  if (pathLower.includes('/step_definitions/') || pathLower.includes('/steps/') ||
      pathLower.includes('\\step_definitions\\') || pathLower.includes('\\steps\\')) {
    return true;
  }

  // Filename-based detection
  const lower = name.toLowerCase();
  if (lower.includes('steps.') || lower.includes('step_def') || lower.includes('step_definition')) return true;
  if (lower.endsWith('.steps.ts') || lower.endsWith('.steps.js') || lower.endsWith('_steps.py')) return true;
  if (lower.endsWith('_steps.rb') || lower.endsWith('steps.java') || lower.endsWith('steps.cs')) return true;

  return false;
}

// ── Find step definition files ───────────────────────────────────────────────

function findStepDefFiles(projectPath: string, dir?: string, depth = 0): string[] {
  if (depth > 8) return [];
  const currentDir = dir || projectPath;
  const results: string[] = [];

  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;

      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        results.push(...findStepDefFiles(projectPath, fullPath, depth + 1));
      } else if (entry.isFile()) {
        const relPath = relative(projectPath, fullPath).replace(/\\/g, '/');
        if (isStepDefFile(entry.name, relPath.toLowerCase())) {
          results.push(relPath);
        }
      }
    }
  } catch {
    // Permission error or similar — skip
  }

  return results;
}

// ── Extract function body source code ────────────────────────────────────────

/**
 * Extract the source code of a step definition function starting from the
 * definition line. Uses language-aware heuristics to find the function boundary.
 * @param lines - All lines of the file (0-indexed array)
 * @param startIdx - 0-indexed line where the step definition starts
 * @param ext - File extension (e.g. '.ts', '.py')
 * @returns { source, endLine (1-based) }
 */
function extractFunctionSource(lines: string[], startIdx: number, ext: string): { source: string; endLine: number } {
  const maxIdx = Math.min(startIdx + 60, lines.length);

  // ── Brace-based languages: JS/TS, Java, C# ──
  if (['.ts', '.js', '.mjs', '.java', '.cs'].includes(ext)) {
    let braceDepth = 0;
    let foundBrace = false;
    let endIdx = startIdx;

    for (let i = startIdx; i < maxIdx; i++) {
      const line = lines[i]!;
      for (const ch of line) {
        if (ch === '{') { braceDepth++; foundBrace = true; }
        if (ch === '}') braceDepth--;
      }
      endIdx = i;
      if (foundBrace && braceDepth <= 0) break;
    }

    return {
      source: lines.slice(startIdx, endIdx + 1).join('\n'),
      endLine: endIdx + 1,
    };
  }

  // ── Python: indentation-based ──
  if (ext === '.py') {
    let endIdx = startIdx;
    let bodyStarted = false;

    for (let i = startIdx + 1; i < maxIdx; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Empty lines are part of the body
      if (trimmed === '') { endIdx = i; continue; }

      // Next decorator or top-level def/class → stop before it
      if (/^\s*@/.test(line) || /^(?:def |class )/.test(line)) break;

      // Detect body start (indented line after def)
      if (!bodyStarted && (line.startsWith('    ') || line.startsWith('\t'))) {
        bodyStarted = true;
      }

      // If body started and we hit a non-indented line, stop
      if (bodyStarted && !/^\s/.test(line)) break;

      endIdx = i;
    }

    return {
      source: lines.slice(startIdx, endIdx + 1).join('\n'),
      endLine: endIdx + 1,
    };
  }

  // ── Ruby: end-based ──
  if (ext === '.rb') {
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < maxIdx; i++) {
      const trimmed = lines[i]!.trim();
      endIdx = i;
      if (trimmed === 'end') break;
    }
    return {
      source: lines.slice(startIdx, endIdx + 1).join('\n'),
      endLine: endIdx + 1,
    };
  }

  // ── Fallback: extract 20 lines ──
  const endIdx = Math.min(startIdx + 20, lines.length - 1);
  return {
    source: lines.slice(startIdx, endIdx + 1).join('\n'),
    endLine: endIdx + 1,
  };
}

// ── Parse step definitions from file content ─────────────────────────────────

function parseStepDefinitions(content: string, ext: string): ParsedStepDef[] {
  const defs: ParsedStepDef[] = [];
  const lines = content.split('\n');

  switch (ext) {
    case '.ts':
    case '.js':
    case '.mjs':
      parseJsTsStepDefs(lines, defs);
      break;
    case '.py':
      parsePythonStepDefs(lines, defs);
      break;
    case '.java':
      parseJavaStepDefs(lines, defs);
      break;
    case '.cs':
      parseCSharpStepDefs(lines, defs);
      break;
    case '.rb':
      parseRubyStepDefs(lines, defs);
      break;
  }

  return defs;
}

// ── JS/TS step definitions ───────────────────────────────────────────────────

function parseJsTsStepDefs(lines: string[], defs: ParsedStepDef[]): void {
  const stepRe = /\b(Given|When|Then|And|But)\s*\(\s*(?:['"]([^'"]+)['"]|\/([^/]+)\/)/;

  for (let i = 0; i < lines.length; i++) {
    const match = stepRe.exec(lines[i]!);
    if (match) {
      const keyword = match[1]!;
      const pattern = match[2] || match[3]!;
      let method: string | undefined;
      const fnMatch = lines[i]!.match(/(?:async\s+)?(?:function\s+)?(\w+)\s*\(/);
      if (fnMatch && fnMatch[1] !== keyword) method = fnMatch[1];
      defs.push({ keyword, pattern, line: i + 1, method });
    }
  }
}

// ── Python step definitions ──────────────────────────────────────────────────

function parsePythonStepDefs(lines: string[], defs: ParsedStepDef[]): void {
  const decoratorRe = /^\s*@(given|when|then|step)\s*\(\s*['"u]+([^'"]+)['"]\s*\)/i;
  const parserRe = /^\s*@(given|when|then|step)\s*\(\s*parsers?\.\w+\(\s*['"u]+([^'"]+)['"]\s*\)\s*\)/i;

  for (let i = 0; i < lines.length; i++) {
    let match = decoratorRe.exec(lines[i]!);
    if (!match) match = parserRe.exec(lines[i]!);
    if (match) {
      const keyword = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1);
      const pattern = match[2]!;
      let method: string | undefined;
      if (i + 1 < lines.length) {
        const defMatch = lines[i + 1]!.match(/def\s+(\w+)/);
        if (defMatch) method = defMatch[1];
      }
      defs.push({ keyword, pattern, line: i + 1, method });
    }
  }
}

// ── Java step definitions ────────────────────────────────────────────────────

function parseJavaStepDefs(lines: string[], defs: ParsedStepDef[]): void {
  const annotationRe = /^\s*@(Given|When|Then|And|But)\s*\(\s*"([^"]+)"\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    const match = annotationRe.exec(lines[i]!);
    if (match) {
      const keyword = match[1]!;
      const pattern = match[2]!;
      let method: string | undefined;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const methodMatch = lines[j]!.match(/(?:public|private|protected)\s+\w+\s+(\w+)\s*\(/);
        if (methodMatch) { method = methodMatch[1]; break; }
      }
      defs.push({ keyword, pattern, line: i + 1, method });
    }
  }
}

// ── C# step definitions ─────────────────────────────────────────────────────

function parseCSharpStepDefs(lines: string[], defs: ParsedStepDef[]): void {
  const attrRe = /^\s*\[(Given|When|Then)\s*\(\s*@?"([^"]+)"\s*\)\s*\]/;

  for (let i = 0; i < lines.length; i++) {
    const match = attrRe.exec(lines[i]!);
    if (match) {
      const keyword = match[1]!;
      const pattern = match[2]!;
      let method: string | undefined;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const methodMatch = lines[j]!.match(/(?:public|private|protected)\s+\w+\s+(\w+)\s*\(/);
        if (methodMatch) { method = methodMatch[1]; break; }
      }
      defs.push({ keyword, pattern, line: i + 1, method });
    }
  }
}

// ── Ruby step definitions ────────────────────────────────────────────────────

function parseRubyStepDefs(lines: string[], defs: ParsedStepDef[]): void {
  const stepRe = /^\s*(Given|When|Then|And|But)\s*\(\s*(?:['"]([^'"]+)['"]|\/([^/]+)\/)\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    const match = stepRe.exec(lines[i]!);
    if (match) {
      defs.push({
        keyword: match[1]!,
        pattern: match[2] || match[3]!,
        line: i + 1,
      });
    }
  }
}

// ── Step matching ────────────────────────────────────────────────────────────

function matchStep(stepText: string, pattern: string): boolean {
  // 1. Exact match
  if (stepText === pattern) return true;

  // 2. Case-insensitive exact match
  if (stepText.toLowerCase() === pattern.toLowerCase()) return true;

  // 3. Try treating pattern as regex
  try {
    const re = new RegExp(`^${pattern}$`, 'i');
    if (re.test(stepText)) return true;
  } catch {
    // Not a valid regex — ignore
  }

  // 4. Cucumber expression match:
  //    Convert {string}, {int}, {float}, {word}, {} to regex
  const cucumberExprPattern = pattern
    .replace(/\{string\}/g, '"[^"]*"')
    .replace(/\{int\}/g, '\\d+')
    .replace(/\{float\}/g, '[\\d.]+')
    .replace(/\{word\}/g, '\\S+')
    .replace(/\{\}/g, '.*?');

  if (cucumberExprPattern !== pattern) {
    try {
      const re = new RegExp(`^${cucumberExprPattern}$`, 'i');
      if (re.test(stepText)) return true;
    } catch {
      // ignore
    }
  }

  // 5. Fuzzy: strip quotes and extra whitespace and compare
  const normalize = (s: string) => s.replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalize(stepText) === normalize(pattern)) return true;

  // 6. Check if step text contains the pattern or vice versa (partial match)
  const normStep = normalize(stepText);
  const normPattern = normalize(pattern);
  if (normStep.includes(normPattern) || normPattern.includes(normStep)) return true;

  return false;
}

// ── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a Cucumber step text to its step definition file and line.
 */
export function resolveStepDefinition(
  projectPath: string,
  stepText: string,
  _stepKeyword?: string,
): StepDefinitionMatch | null {
  const stepDefFiles = findStepDefFiles(projectPath);
  if (stepDefFiles.length === 0) return null;

  const normalizedStep = stepText.trim();

  for (const file of stepDefFiles) {
    const fullPath = resolve(projectPath, file);
    if (!existsSync(fullPath)) continue;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const ext = extname(file).toLowerCase();
    const definitions = parseStepDefinitions(content, ext);
    const lines = content.split('\n');

    for (const def of definitions) {
      if (matchStep(normalizedStep, def.pattern)) {
        const { source, endLine } = extractFunctionSource(lines, def.line - 1, ext);
        return {
          file,
          line: def.line,
          endLine,
          pattern: def.pattern,
          keyword: def.keyword,
          method: def.method,
          source,
          language: EXT_LANGUAGE_MAP[ext] || 'plaintext',
        };
      }
    }
  }

  return null;
}

/**
 * Resolve multiple steps at once (batch mode for efficiency).
 * Reads step definition files once and matches all steps.
 * Returns source code for each matched step definition.
 */
export function resolveStepDefinitions(
  projectPath: string,
  steps: Array<{ keyword: string; name: string }>,
): Map<string, StepDefinitionMatch> {
  const results = new Map<string, StepDefinitionMatch>();
  const stepDefFiles = findStepDefFiles(projectPath);
  if (stepDefFiles.length === 0) return results;

  // Parse all step definition files once and keep their lines
  const allDefs: Array<{
    file: string;
    ext: string;
    lines: string[];
    defs: ParsedStepDef[];
  }> = [];

  for (const file of stepDefFiles) {
    const fullPath = resolve(projectPath, file);
    if (!existsSync(fullPath)) continue;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const ext = extname(file).toLowerCase();
    const defs = parseStepDefinitions(content, ext);
    if (defs.length > 0) {
      allDefs.push({ file, ext, lines: content.split('\n'), defs });
    }
  }

  // Match each step and extract source
  for (const step of steps) {
    const normalizedStep = step.name.trim();
    const key = `${step.keyword}:${step.name}`;

    for (const { file, ext, lines, defs } of allDefs) {
      let found = false;
      for (const def of defs) {
        if (matchStep(normalizedStep, def.pattern)) {
          const { source, endLine } = extractFunctionSource(lines, def.line - 1, ext);
          results.set(key, {
            file,
            line: def.line,
            endLine,
            pattern: def.pattern,
            keyword: def.keyword,
            method: def.method,
            source,
            language: EXT_LANGUAGE_MAP[ext] || 'plaintext',
          });
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  return results;
}

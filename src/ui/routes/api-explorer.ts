import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import type { Express } from 'express';
import type { ProjectScanner } from '../scanner/project-scanner.js';
import type { UIServerOptions } from '../server.js';
import type { TestResultsStore } from '../store/test-results-store.js';
import { scanAllTests, type ScannedTest, type TestFramework } from '../scanner/test-scanner.js';
import { detectLanguage } from '../scanner/file-classifier.js';
import { generateHumanSteps } from '../services/step-generator.js';
import { resolveStepDefinition, resolveStepDefinitions } from '../services/step-resolver.js';

export function mountExplorerRoutes(
  app: Express,
  _scanner: ProjectScanner,
  options: UIServerOptions,
  resultsStore: TestResultsStore,
): void {
  const { projectPath } = options;

  // GET /api/tests/explore — Universal test discovery (all frameworks)
  app.get('/api/tests/explore', (_req, res) => {
    try {
      const scanResult = scanAllTests(projectPath);

      // Enrich each test with execution history
      const suites = scanResult.suites.map(suite => {
        const tests = suite.tests.map(test => {
          const history = resultsStore.getTestHistory(test.name);
          const passCount = history.filter(h => h.status === 'passed').length;
          const failCount = history.filter(h => h.status === 'failed').length;
          const lastEntry = history[0];

          return {
            name: test.name,
            framework: test.framework,
            line: test.line,
            endLine: test.endLine,
            steps: test.steps || [],
            lastStatus: lastEntry?.status,
            runCount: history.length,
            passCount,
            failCount,
            lastRun: lastEntry?.timestamp,
            lastBrowser: lastEntry?.browser,
            runCommand: buildTestRunCommand(test),
          };
        });

        return {
          name: suite.name,
          file: suite.file,
          framework: suite.framework,
          testCount: tests.length,
          tests,
          // Backward compat aliases
          scenarioCount: tests.length,
          scenarios: tests,
        };
      });

      const totalTests = suites.reduce((sum, s) => sum + s.testCount, 0);

      res.json({
        suites,
        totalSuites: suites.length,
        totalTests,
        // Backward compat aliases
        features: suites,
        totalFeatures: suites.length,
        totalScenarios: totalTests,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/tests/scenario/:name/history — Execution history for a specific test
  app.get('/api/tests/scenario/:name/history', (req, res) => {
    try {
      const testName = decodeURIComponent(req.params.name!);
      const history = resultsStore.getTestHistory(testName);
      res.json({
        testName,
        history,
        count: history.length,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/tests/source — Fetch test source code + human-readable steps
  // Supports two modes:
  //   1. file + startLine [+ endLine] [+ framework]  — direct line range
  //   2. file + testName                             — lookup test by name in scanner
  app.get('/api/tests/source', (req, res) => {
    try {
      const file = req.query.file as string;
      const startLineStr = req.query.startLine as string | undefined;
      const endLineStr = req.query.endLine as string | undefined;
      const testName = req.query.testName as string | undefined;
      let framework = req.query.framework as string | undefined;

      if (!file) {
        res.status(400).json({ error: 'file is required' });
        return;
      }

      let fullPath = resolve(projectPath, file);
      let startLine: number;
      let endLine: number;

      if (startLineStr) {
        // Mode 1: Direct line range — resolve file directly
        const rel = relative(projectPath, fullPath);
        if (rel.startsWith('..') || rel.startsWith('/')) {
          res.status(403).json({ error: 'Path traversal not allowed' });
          return;
        }
        if (!existsSync(fullPath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        startLine = parseInt(startLineStr, 10);
        endLine = endLineStr ? parseInt(endLineStr, 10) : startLine + 50;
        if (isNaN(startLine) || startLine < 1) {
          res.status(400).json({ error: 'Invalid startLine' });
          return;
        }
      } else if (testName) {
        // Mode 2: Lookup test by name — scan project, match flexibly
        // Parsers may store just the filename (e.g. "cart.spec.ts")
        // while scanner stores relative paths (e.g. "tests/cart.spec.ts")
        const scanResult = scanAllTests(projectPath);
        const fileBasename = basename(file);
        const matchedTest = scanResult.suites
          .flatMap(s => s.tests)
          .find(t => t.name === testName && (
            t.file === file ||
            basename(t.file) === fileBasename ||
            t.file.endsWith(file) ||
            file.endsWith(t.file)
          ));

        if (!matchedTest || !matchedTest.line) {
          res.status(404).json({ error: 'Test not found in file' });
          return;
        }
        startLine = matchedTest.line;
        endLine = matchedTest.endLine || startLine + 50;
        if (!framework) framework = matchedTest.framework;

        // Resolve the ACTUAL file path from scanner (not the query param)
        fullPath = resolve(projectPath, matchedTest.file);
        if (!existsSync(fullPath)) {
          res.status(404).json({ error: 'Source file not found' });
          return;
        }
      } else {
        res.status(400).json({ error: 'Either startLine or testName is required' });
        return;
      }

      const content = readFileSync(fullPath, 'utf-8');
      const allLines = content.split('\n');
      const actualEnd = Math.min(endLine, allLines.length);
      const slicedLines = allLines.slice(startLine - 1, actualEnd);
      const source = slicedLines.join('\n');

      // Detect language for syntax highlighting
      const language = detectLanguage(fullPath) || 'plaintext';

      // Generate human-readable steps if framework is provided
      const humanSteps = framework
        ? generateHumanSteps(source, framework, startLine)
        : [];

      res.json({
        file,
        startLine,
        endLine: actualEnd,
        language,
        source,
        humanSteps,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/tests/step-definition — Resolve a step text to its definition file + line
  // Query params: step (required), keyword (optional)
  app.get('/api/tests/step-definition', (req, res) => {
    try {
      const step = req.query.step as string;
      const keyword = req.query.keyword as string | undefined;

      if (!step) {
        res.status(400).json({ error: 'step parameter is required' });
        return;
      }

      const match = resolveStepDefinition(projectPath, step, keyword);

      if (!match) {
        res.status(404).json({ error: 'Step definition not found' });
        return;
      }

      res.json(match);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/tests/step-definitions — Batch resolve multiple steps at once
  // Body: { steps: [{ keyword: string, name: string }] }
  app.post('/api/tests/step-definitions', (req, res) => {
    try {
      const { steps } = req.body as { steps: Array<{ keyword: string; name: string }> };

      if (!steps || !Array.isArray(steps) || steps.length === 0) {
        res.status(400).json({ error: 'steps array is required' });
        return;
      }

      const results = resolveStepDefinitions(projectPath, steps);

      // Convert Map to plain object for JSON response
      const matches: Record<string, {
        file: string;
        line: number;
        pattern: string;
        keyword: string;
        method?: string;
      }> = {};

      for (const [key, match] of results) {
        matches[key] = match;
      }

      res.json({ matches, totalResolved: results.size, totalSteps: steps.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}

/**
 * Build a framework-specific command to run a single test.
 */
function buildTestRunCommand(test: ScannedTest): string {
  const escaped = test.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  switch (test.framework) {
    case 'cucumber':
      return `npx cucumber-js --name "${escaped}" --format progress --format json:.qabot-results.json`;
    case 'playwright':
      return `npx playwright test -g "${escaped}"`;
    case 'jest':
      return `npx jest -t "${escaped}"`;
    case 'vitest':
      return `npx vitest run -t "${escaped}"`;
    case 'cypress':
      return `npx cypress run --spec "${test.file}"`;
    case 'mocha':
      return `npx mocha --grep "${escaped}"`;
    case 'pytest':
      return `python -m pytest "${test.file}" -k "${test.name}"`;
    case 'junit':
    case 'testng':
      return `mvn test -Dtest="${test.suite}#${test.name}"`;
    case 'nunit':
    case 'xunit':
    case 'mstest':
      return `dotnet test --filter "FullyQualifiedName~${test.name}"`;
    case 'rspec':
      return `bundle exec rspec --example "${escaped}"`;
    case 'robot':
      return `robot --test "${test.name}" ${test.file}`;
    default:
      return `npm test`;
  }
}

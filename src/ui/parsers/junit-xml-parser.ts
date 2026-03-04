import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredTestCase } from '../types.js';
import { normalizeBrowserName } from './browser-detect.js';
import { stripAnsi } from './strip-ansi.js';

/**
 * Parse JUnit XML format — universal across pytest, Maven/Surefire, .NET, Robot Framework.
 * Handles both single file and directory of XML files.
 */
export function parseJUnitXML(pathOrDir: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];

  if (!existsSync(pathOrDir)) return tests;

  // Check if it's a directory (e.g., Maven surefire-reports)
  try {
    const files = readdirSync(pathOrDir);
    for (const file of files) {
      if (file.endsWith('.xml')) {
        parseXMLFile(join(pathOrDir, file), tests);
      }
    }
    return tests;
  } catch {
    // Not a directory — treat as single file
  }

  parseXMLFile(pathOrDir, tests);
  return tests;
}

function parseXMLFile(filePath: string, tests: StoredTestCase[]): void {
  try {
    const xml = readFileSync(filePath, 'utf-8');
    parseTestCases(xml, tests);
  } catch {
    // Skip unparseable files
  }
}

function parseTestCases(xml: string, tests: StoredTestCase[]): void {
  // Extract browser from <properties> at testsuite level
  // Formats: <property name="browser" value="chrome"/>
  //          <property name="browser.name" value="chrome"/>
  const suiteBrowser = extractBrowserFromProperties(xml);

  // Match all <testcase> elements (including self-closing)
  const testcasePattern = /<testcase\s[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g;
  let match: RegExpExecArray | null;

  while ((match = testcasePattern.exec(xml)) !== null) {
    const block = match[0];

    const name = extractAttr(block, 'name') || 'Unknown';
    const classname = extractAttr(block, 'classname');
    const file = extractAttr(block, 'file');
    const timeStr = extractAttr(block, 'time');
    const duration = timeStr ? Math.round(parseFloat(timeStr) * 1000) : undefined;

    // Check for browser attribute on testcase itself
    const testBrowser = extractAttr(block, 'browser');

    // Determine status
    let status: StoredTestCase['status'] = 'passed';
    let errorMessage: string | undefined;
    let stackTrace: string | undefined;

    // Check for <failure>
    const failureMatch = block.match(/<failure\s*([^>]*)>([\s\S]*?)<\/failure>/);
    if (failureMatch) {
      status = 'failed';
      errorMessage = extractAttr(failureMatch[1]!, 'message') || undefined;
      stackTrace = failureMatch[2]?.trim() || undefined;
    }

    // Check for <error>
    const errorMatch = block.match(/<error\s*([^>]*)>([\s\S]*?)<\/error>/);
    if (errorMatch) {
      status = 'error';
      errorMessage = extractAttr(errorMatch[1]!, 'message') || undefined;
      stackTrace = errorMatch[2]?.trim() || undefined;
    }

    // Check for <skipped>
    if (block.includes('<skipped')) {
      status = 'skipped';
      const skippedMatch = block.match(/<skipped\s*([^>]*)/);
      errorMessage = skippedMatch ? extractAttr(skippedMatch[1]!, 'message') || undefined : undefined;
    }

    // Decode XML entities and strip ANSI codes in error text
    if (errorMessage) errorMessage = stripAnsi(decodeXMLEntities(errorMessage));
    if (stackTrace) stackTrace = stripAnsi(decodeXMLEntities(stackTrace));

    tests.push({
      name,
      suite: classname || undefined,
      file: file || undefined,
      status,
      duration,
      errorMessage,
      stackTrace,
      browser: normalizeBrowserName(testBrowser || suiteBrowser || undefined),
    });
  }
}

/**
 * Extract browser name from <properties> section of JUnit XML.
 * Checks for common property names: browser, browser.name, browserName
 */
function extractBrowserFromProperties(xml: string): string | null {
  const propsMatch = xml.match(/<properties>([\s\S]*?)<\/properties>/);
  if (!propsMatch) return null;

  const propsBlock = propsMatch[1]!;
  // Check for browser-related property names
  for (const propName of ['browser', 'browser.name', 'browserName', 'browser_name']) {
    const valueMatch = propsBlock.match(
      new RegExp(`<property\\s+name=["']${propName}["']\\s+value=["']([^"']+)["']`, 'i'),
    );
    if (valueMatch) return valueMatch[1]!;
  }
  return null;
}

function extractAttr(text: string, attr: string): string | null {
  const pattern = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = text.match(pattern);
  return match ? match[1]! : null;
}

function decodeXMLEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

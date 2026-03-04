import type { TestFramework } from '../scanner/test-scanner.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HumanStep {
  keyword: string;   // 'Action' | 'Assert' | 'Comment' | 'Setup'
  name: string;      // e.g. "Open Login page"
  line: number;       // 1-based line number in source file
}

// ── Main Entry ───────────────────────────────────────────────────────────────

/**
 * Generate human-readable steps from test source code.
 * Dispatches to framework-specific pattern matchers.
 * Returns empty array when no patterns match (UI falls back to raw code).
 *
 * Steps use natural language: selectors are humanized, URLs show page names,
 * Wait methods are excluded (implementation detail, not user-facing).
 */
export function generateHumanSteps(
  source: string,
  framework: TestFramework | string,
  startLine: number,
): HumanStep[] {
  const lines = source.split('\n');
  const fw = framework.toLowerCase();

  if (fw === 'playwright') return extractPlaywrightSteps(lines, startLine);
  if (fw === 'cypress') return extractCypressSteps(lines, startLine);
  if (fw === 'jest' || fw === 'vitest' || fw === 'mocha') return extractGenericJsSteps(lines, startLine);
  if (fw === 'pytest') return extractPytestSteps(lines, startLine);
  if (fw === 'junit' || fw === 'testng') return extractJavaSteps(lines, startLine);
  if (fw === 'nunit' || fw === 'xunit' || fw === 'mstest') return extractCSharpSteps(lines, startLine);
  if (fw === 'rspec') return extractRubySteps(lines, startLine);
  if (fw === 'robot') return extractRobotSteps(lines, startLine);

  // Unknown framework — try generic patterns
  return extractGenericSteps(lines, startLine);
}

// ── Playwright Patterns ──────────────────────────────────────────────────────

function extractPlaywrightSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // Skip wait methods entirely — they're implementation details
    if (/page\.wait(ForSelector|ForURL|ForTimeout|ForLoadState|ForNavigation|ForResponse|ForRequest|ForEvent|ForFunction)\s*\(/.test(line)) continue;

    // page.goto
    const gotoMatch = line.match(/page\.goto\s*\(\s*['"`](.+?)['"`]/);
    if (gotoMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(gotoMatch[1]!)}`, line: lineNum }; }

    // page.click
    if (!step) {
      const clickMatch = line.match(/page\.click\s*\(\s*['"`](.+?)['"`]/);
      if (clickMatch) { step = { keyword: 'Action', name: `Click ${humanizeSelector(clickMatch[1]!)}`, line: lineNum }; }
    }

    // page.fill
    if (!step) {
      const fillMatch = line.match(/page\.fill\s*\(\s*['"`](.+?)['"`]\s*,\s*['"`](.+?)['"`]/);
      if (fillMatch) { step = { keyword: 'Action', name: `Enter "${fillMatch[2]}" in ${humanizeSelector(fillMatch[1]!)} field`, line: lineNum }; }
    }

    // page.type
    if (!step) {
      const typeMatch = line.match(/page\.type\s*\(\s*['"`](.+?)['"`]\s*,\s*['"`](.+?)['"`]/);
      if (typeMatch) { step = { keyword: 'Action', name: `Enter "${typeMatch[2]}" in ${humanizeSelector(typeMatch[1]!)} field`, line: lineNum }; }
    }

    // page.getByRole(...).click()
    if (!step) {
      const roleClickMatch = line.match(/page\.getByRole\s*\(\s*['"`](.+?)['"`](?:\s*,\s*\{[^}]*name:\s*['"`](.+?)['"`])?\)\.click/);
      if (roleClickMatch) {
        const role = roleClickMatch[1];
        const name = roleClickMatch[2];
        step = { keyword: 'Action', name: name ? `Click "${name}" ${role}` : `Click ${role}`, line: lineNum };
      }
    }

    // page.getByRole(...).fill(...)
    if (!step) {
      const roleFillMatch = line.match(/page\.getByRole\s*\(\s*['"`](.+?)['"`](?:\s*,\s*\{[^}]*name:\s*['"`](.+?)['"`])?\)\.fill\s*\(\s*['"`](.+?)['"`]/);
      if (roleFillMatch) {
        const name = roleFillMatch[2] || roleFillMatch[1];
        step = { keyword: 'Action', name: `Enter "${roleFillMatch[3]}" in ${name} field`, line: lineNum };
      }
    }

    // page.getByText(...).click()
    if (!step) {
      const textClickMatch = line.match(/page\.getByText\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (textClickMatch) { step = { keyword: 'Action', name: `Click "${textClickMatch[1]}" text`, line: lineNum }; }
    }

    // page.getByLabel(...).fill(...)
    if (!step) {
      const labelFillMatch = line.match(/page\.getByLabel\s*\(\s*['"`](.+?)['"`]\)\.fill\s*\(\s*['"`](.+?)['"`]/);
      if (labelFillMatch) { step = { keyword: 'Action', name: `Enter "${labelFillMatch[2]}" in ${labelFillMatch[1]} field`, line: lineNum }; }
    }

    // page.getByLabel(...).click()
    if (!step) {
      const labelClickMatch = line.match(/page\.getByLabel\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (labelClickMatch) { step = { keyword: 'Action', name: `Click ${labelClickMatch[1]} label`, line: lineNum }; }
    }

    // page.getByPlaceholder(...).fill(...)
    if (!step) {
      const placeholderFillMatch = line.match(/page\.getByPlaceholder\s*\(\s*['"`](.+?)['"`]\)\.fill\s*\(\s*['"`](.+?)['"`]/);
      if (placeholderFillMatch) { step = { keyword: 'Action', name: `Enter "${placeholderFillMatch[2]}" in ${placeholderFillMatch[1]} field`, line: lineNum }; }
    }

    // page.getByPlaceholder(...).click()
    if (!step) {
      const placeholderClickMatch = line.match(/page\.getByPlaceholder\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (placeholderClickMatch) { step = { keyword: 'Action', name: `Click ${placeholderClickMatch[1]} field`, line: lineNum }; }
    }

    // page.getByTestId(...).click()
    if (!step) {
      const testIdClickMatch = line.match(/page\.getByTestId\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (testIdClickMatch) { step = { keyword: 'Action', name: `Click ${humanizeIdentifier(testIdClickMatch[1]!)}`, line: lineNum }; }
    }

    // page.getByTestId(...).fill(...)
    if (!step) {
      const testIdFillMatch = line.match(/page\.getByTestId\s*\(\s*['"`](.+?)['"`]\)\.fill\s*\(\s*['"`](.+?)['"`]/);
      if (testIdFillMatch) { step = { keyword: 'Action', name: `Enter "${testIdFillMatch[2]}" in ${humanizeIdentifier(testIdFillMatch[1]!)} field`, line: lineNum }; }
    }

    // Generic locator .click()
    if (!step) {
      const locClickMatch = line.match(/(?:page\.locator|page\.\$)\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (locClickMatch) { step = { keyword: 'Action', name: `Click ${humanizeSelector(locClickMatch[1]!)}`, line: lineNum }; }
    }

    // Generic locator .fill(...)
    if (!step) {
      const locFillMatch = line.match(/\.locator\s*\(\s*['"`](.+?)['"`]\)\.fill\s*\(\s*['"`](.+?)['"`]/);
      if (locFillMatch) { step = { keyword: 'Action', name: `Enter "${locFillMatch[2]}" in ${humanizeSelector(locFillMatch[1]!)} field`, line: lineNum }; }
    }

    // page.selectOption
    if (!step) {
      const selectMatch = line.match(/page\.selectOption\s*\(\s*['"`](.+?)['"`]\s*,\s*['"`](.+?)['"`]/);
      if (selectMatch) { step = { keyword: 'Action', name: `Select "${selectMatch[2]}" from ${humanizeSelector(selectMatch[1]!)} dropdown`, line: lineNum }; }
    }

    // page.check / page.uncheck
    if (!step) {
      const checkMatch = line.match(/page\.(check|uncheck)\s*\(\s*['"`](.+?)['"`]/);
      if (checkMatch) { step = { keyword: 'Action', name: `${checkMatch[1] === 'check' ? 'Check' : 'Uncheck'} ${humanizeSelector(checkMatch[2]!)} checkbox`, line: lineNum }; }
    }

    // page.hover
    if (!step) {
      const hoverMatch = line.match(/page\.hover\s*\(\s*['"`](.+?)['"`]/);
      if (hoverMatch) { step = { keyword: 'Action', name: `Hover over ${humanizeSelector(hoverMatch[1]!)}`, line: lineNum }; }
    }

    // page.screenshot
    if (!step && /page\.screenshot\s*\(/.test(line)) {
      step = { keyword: 'Action', name: 'Take screenshot', line: lineNum };
    }

    // page.press
    if (!step) {
      const pressMatch = line.match(/page\.press\s*\(\s*['"`](.+?)['"`]\s*,\s*['"`](.+?)['"`]/);
      if (pressMatch) { step = { keyword: 'Action', name: `Press "${pressMatch[2]}" key on ${humanizeSelector(pressMatch[1]!)}`, line: lineNum }; }
    }

    // page.dblclick
    if (!step) {
      const dblclickMatch = line.match(/page\.dblclick\s*\(\s*['"`](.+?)['"`]/);
      if (dblclickMatch) { step = { keyword: 'Action', name: `Double-click ${humanizeSelector(dblclickMatch[1]!)}`, line: lineNum }; }
    }

    // expect(...).toBeVisible()
    if (!step) {
      const visibleMatch = line.match(/expect\s*\((.+?)\)\.toBeVisible/);
      if (visibleMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(visibleMatch[1]!)} is visible`, line: lineNum }; }
    }

    // expect(...).toHaveText(...)
    if (!step) {
      const textMatch = line.match(/expect\s*\((.+?)\)\.toHaveText\s*\(\s*['"`](.+?)['"`]/);
      if (textMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(textMatch[1]!)} has text "${textMatch[2]}"`, line: lineNum }; }
    }

    // expect(...).toHaveURL(...)
    if (!step) {
      const urlMatch = line.match(/expect\s*\((.+?)\)\.toHaveURL\s*\(\s*['"`](.+?)['"`]/);
      if (urlMatch) { step = { keyword: 'Assert', name: `Verify URL is ${humanizeUrl(urlMatch[2]!)}`, line: lineNum }; }
    }

    // expect(...).toHaveTitle(...)
    if (!step) {
      const titleMatch = line.match(/expect\s*\((.+?)\)\.toHaveTitle\s*\(\s*['"`](.+?)['"`]/);
      if (titleMatch) { step = { keyword: 'Assert', name: `Verify page title is "${titleMatch[2]}"`, line: lineNum }; }
    }

    // expect(...).toContainText(...)
    if (!step) {
      const containMatch = line.match(/expect\s*\((.+?)\)\.toContainText\s*\(\s*['"`](.+?)['"`]/);
      if (containMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(containMatch[1]!)} contains "${containMatch[2]}"`, line: lineNum }; }
    }

    // expect(...).toHaveCount(...)
    if (!step) {
      const countMatch = line.match(/expect\s*\((.+?)\)\.toHaveCount\s*\(\s*(\d+)/);
      if (countMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(countMatch[1]!)} count is ${countMatch[2]}`, line: lineNum }; }
    }

    // expect(...).toBeHidden()
    if (!step) {
      const hiddenMatch = line.match(/expect\s*\((.+?)\)\.toBeHidden/);
      if (hiddenMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(hiddenMatch[1]!)} is hidden`, line: lineNum }; }
    }

    // expect(...).toBeEnabled() / toBeDisabled()
    if (!step) {
      const enabledMatch = line.match(/expect\s*\((.+?)\)\.(toBeEnabled|toBeDisabled)/);
      if (enabledMatch) {
        const state = enabledMatch[2] === 'toBeEnabled' ? 'enabled' : 'disabled';
        step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(enabledMatch[1]!)} is ${state}`, line: lineNum };
      }
    }

    // expect(...).toBeChecked()
    if (!step) {
      const checkedMatch = line.match(/expect\s*\((.+?)\)\.toBeChecked/);
      if (checkedMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(checkedMatch[1]!)} is checked`, line: lineNum }; }
    }

    // expect(...).toHaveValue(...)
    if (!step) {
      const valueMatch = line.match(/expect\s*\((.+?)\)\.toHaveValue\s*\(\s*['"`](.+?)['"`]/);
      if (valueMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(valueMatch[1]!)} has value "${valueMatch[2]}"`, line: lineNum }; }
    }

    // expect(...).toHaveAttribute(...)
    if (!step) {
      const attrMatch = line.match(/expect\s*\((.+?)\)\.toHaveAttribute\s*\(\s*['"`](.+?)['"`]\s*,\s*['"`](.+?)['"`]/);
      if (attrMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(attrMatch[1]!)} has ${attrMatch[2]} "${attrMatch[3]}"`, line: lineNum }; }
    }

    // Generic expect(...).not. assertions
    if (!step) {
      const notMatch = line.match(/expect\s*\((.+?)\)\.not\.(to\w+)/);
      if (notMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeLocatorExpr(notMatch[1]!)} is NOT ${camelToWords(notMatch[2]!)}`, line: lineNum }; }
    }

    // Page Object Method calls: loginPage.enterUsername("admin")
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
      if (commentMatch && !line.includes('eslint') && !line.includes('@ts-')) {
        step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum };
      }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Cypress Patterns ─────────────────────────────────────────────────────────

function extractCypressSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // Skip wait methods entirely
    if (/cy\.wait\s*\(/.test(line)) continue;

    // cy.visit
    const visitMatch = line.match(/cy\.visit\s*\(\s*['"`](.+?)['"`]/);
    if (visitMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(visitMatch[1]!)}`, line: lineNum }; }

    // cy.get(...).click()
    if (!step) {
      const getClickMatch = line.match(/cy\.get\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (getClickMatch) { step = { keyword: 'Action', name: `Click ${humanizeSelector(getClickMatch[1]!)}`, line: lineNum }; }
    }

    // cy.get(...).type(...)
    if (!step) {
      const getTypeMatch = line.match(/cy\.get\s*\(\s*['"`](.+?)['"`]\)\.type\s*\(\s*['"`](.+?)['"`]/);
      if (getTypeMatch) { step = { keyword: 'Action', name: `Enter "${getTypeMatch[2]}" in ${humanizeSelector(getTypeMatch[1]!)} field`, line: lineNum }; }
    }

    // cy.get(...).clear()
    if (!step) {
      const getClearMatch = line.match(/cy\.get\s*\(\s*['"`](.+?)['"`]\)\.clear/);
      if (getClearMatch) { step = { keyword: 'Action', name: `Clear ${humanizeSelector(getClearMatch[1]!)} field`, line: lineNum }; }
    }

    // cy.get(...).select(...)
    if (!step) {
      const getSelectMatch = line.match(/cy\.get\s*\(\s*['"`](.+?)['"`]\)\.select\s*\(\s*['"`](.+?)['"`]/);
      if (getSelectMatch) { step = { keyword: 'Action', name: `Select "${getSelectMatch[2]}" from ${humanizeSelector(getSelectMatch[1]!)} dropdown`, line: lineNum }; }
    }

    // cy.get(...).check() / cy.get(...).uncheck()
    if (!step) {
      const checkMatch = line.match(/cy\.get\s*\(\s*['"`](.+?)['"`]\)\.(check|uncheck)/);
      if (checkMatch) { step = { keyword: 'Action', name: `${checkMatch[2] === 'check' ? 'Check' : 'Uncheck'} ${humanizeSelector(checkMatch[1]!)} checkbox`, line: lineNum }; }
    }

    // cy.contains(...).click()
    if (!step) {
      const containsClickMatch = line.match(/cy\.contains\s*\(\s*['"`](.+?)['"`]\)\.click/);
      if (containsClickMatch) { step = { keyword: 'Action', name: `Click "${containsClickMatch[1]}" text`, line: lineNum }; }
    }

    // cy.get(...).should(...)
    if (!step) {
      const shouldMatch = line.match(/cy\.get\s*\(\s*['"`](.+?)['"`]\)\.should\s*\(\s*['"`](.+?)['"`](?:\s*,\s*['"`](.+?)['"`])?\)/);
      if (shouldMatch) {
        const el = humanizeSelector(shouldMatch[1]!);
        const assertion = shouldMatch[2]!.replace(/\./g, ' ');
        const value = shouldMatch[3] ? ` "${shouldMatch[3]}"` : '';
        step = { keyword: 'Assert', name: `Verify ${el} should ${assertion}${value}`, line: lineNum };
      }
    }

    // cy.url().should(...)
    if (!step) {
      const urlShouldMatch = line.match(/cy\.url\(\)\.should\s*\(\s*['"`](.+?)['"`](?:\s*,\s*['"`](.+?)['"`])?/);
      if (urlShouldMatch) {
        const assertion = urlShouldMatch[2] ? `${urlShouldMatch[1]!.replace(/\./g, ' ')} "${urlShouldMatch[2]}"` : urlShouldMatch[1]!.replace(/\./g, ' ');
        step = { keyword: 'Assert', name: `Verify URL should ${assertion}`, line: lineNum };
      }
    }

    // cy.title().should(...)
    if (!step) {
      const titleShouldMatch = line.match(/cy\.title\(\)\.should\s*\(\s*['"`](.+?)['"`](?:\s*,\s*['"`](.+?)['"`])?/);
      if (titleShouldMatch) {
        const assertion = titleShouldMatch[2] ? `${titleShouldMatch[1]!.replace(/\./g, ' ')} "${titleShouldMatch[2]}"` : titleShouldMatch[1]!.replace(/\./g, ' ');
        step = { keyword: 'Assert', name: `Verify page title should ${assertion}`, line: lineNum };
      }
    }

    // cy.intercept
    if (!step) {
      const interceptMatch = line.match(/cy\.intercept\s*\(\s*['"`](.+?)['"`](?:\s*,\s*['"`](.+?)['"`])?/);
      if (interceptMatch) {
        const route = interceptMatch[2] || interceptMatch[1];
        step = { keyword: 'Setup', name: `Intercept ${route}`, line: lineNum };
      }
    }

    // cy.screenshot
    if (!step && /cy\.screenshot\s*\(/.test(line)) {
      step = { keyword: 'Action', name: 'Take screenshot', line: lineNum };
    }

    // Page Object Method calls: loginPage.enterUsername("admin")
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
      if (commentMatch && !line.includes('eslint')) {
        step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum };
      }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Generic JS/TS (Jest, Vitest, Mocha) ──────────────────────────────────────

function extractGenericJsSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // expect(...).toBe / toEqual / toContain etc.
    const expectMatch = line.match(/expect\s*\((.+?)\)\.(not\.)?(to\w+)\s*\(\s*(.+?)?\s*\)/);
    if (expectMatch) {
      const subject = simplifyExpression(expectMatch[1]!);
      const negation = expectMatch[2] ? 'NOT ' : '';
      const matcher = camelToWords(expectMatch[3]!);
      const value = expectMatch[4] ? ` ${expectMatch[4].replace(/['"]/g, '')}` : '';
      step = { keyword: 'Assert', name: `${negation}Verify ${subject} ${matcher}${value}`, line: lineNum };
    }

    // Page Object Method calls: searchResultsPage.sortBy(TestData.sort.priceLowToHigh)
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
      if (commentMatch && !line.includes('eslint') && !line.includes('@ts-')) {
        step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum };
      }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Python / pytest Patterns ─────────────────────────────────────────────────

function extractPytestSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // Skip wait methods entirely
    if (/wait\.until\s*\(/.test(line) || /WebDriverWait/.test(line) || /time\.sleep\s*\(/.test(line)) continue;

    // Selenium patterns in Python
    // driver.get('url')
    const getMatch = line.match(/(?:driver|self\.driver|browser)\.get\s*\(\s*['"](.+?)['"]/);
    if (getMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(getMatch[1]!)}`, line: lineNum }; }

    // .find_element(...).click()
    if (!step) {
      const findClickMatch = line.match(/find_element\s*\(\s*(?:By\.(\w+)\s*,\s*)?['"](.+?)['"]\)\.click/);
      if (findClickMatch) {
        step = { keyword: 'Action', name: `Click ${humanizeIdentifier(findClickMatch[2]!)}`, line: lineNum };
      }
    }

    // .find_element(...).send_keys(...)
    if (!step) {
      const sendKeysMatch = line.match(/find_element\s*\(\s*(?:By\.(\w+)\s*,\s*)?['"](.+?)['"]\)\.send_keys\s*\(\s*['"](.+?)['"]/);
      if (sendKeysMatch) {
        step = { keyword: 'Action', name: `Enter "${sendKeysMatch[3]}" in ${humanizeIdentifier(sendKeysMatch[2]!)} field`, line: lineNum };
      }
    }

    // .find_element(...).clear()
    if (!step) {
      const clearMatch = line.match(/find_element\s*\(\s*(?:By\.(\w+)\s*,\s*)?['"](.+?)['"]\)\.clear/);
      if (clearMatch) {
        step = { keyword: 'Action', name: `Clear ${humanizeIdentifier(clearMatch[2]!)} field`, line: lineNum };
      }
    }

    // Select dropdown
    if (!step) {
      const selectMatch = line.match(/Select\s*\(.+?\)\.select_by_(\w+)\s*\(\s*['"](.+?)['"]/);
      if (selectMatch) { step = { keyword: 'Action', name: `Select by ${selectMatch[1]!.replace(/_/g, ' ')} "${selectMatch[2]}"`, line: lineNum }; }
    }

    // assert statements
    if (!step) {
      const assertMatch = line.match(/^assert\s+(.+)/);
      if (assertMatch) { step = { keyword: 'Assert', name: `Verify ${assertMatch[1].substring(0, 80)}`, line: lineNum }; }
    }

    // self.assertEqual, self.assertTrue, etc.
    if (!step) {
      const selfAssertMatch = line.match(/self\.(assert\w+)\s*\(/);
      if (selfAssertMatch) {
        step = { keyword: 'Assert', name: `Verify ${humanizeAssertMethod(selfAssertMatch[1]!)}`, line: lineNum };
      }
    }

    // pytest.raises
    if (!step) {
      const raisesMatch = line.match(/pytest\.raises\s*\(\s*(\w+)/);
      if (raisesMatch) { step = { keyword: 'Assert', name: `Verify ${raisesMatch[1]} exception is raised`, line: lineNum }; }
    }

    // Page Object Method calls: login_page.enter_username("admin")
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*#\s*(.+)/);
      if (commentMatch && !line.includes('noqa') && !line.includes('type:')) {
        step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum };
      }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Java / JUnit / TestNG Patterns ───────────────────────────────────────────

function extractJavaSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // Skip wait methods entirely
    if (/WebDriverWait/.test(line) || /wait\.until/.test(line) || /Thread\.sleep/.test(line)) continue;

    // driver.get("url")
    const getMatch = line.match(/driver\.get\s*\(\s*"(.+?)"/);
    if (getMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(getMatch[1]!)}`, line: lineNum }; }

    // driver.navigate().to("url")
    if (!step) {
      const navMatch = line.match(/driver\.navigate\(\)\.to\s*\(\s*"(.+?)"/);
      if (navMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(navMatch[1]!)}`, line: lineNum }; }
    }

    // findElement(By.id("x")).click()
    if (!step) {
      const findClickMatch = line.match(/findElement\s*\(\s*By\.(\w+)\s*\(\s*"(.+?)"\s*\)\s*\)\.click/);
      if (findClickMatch) { step = { keyword: 'Action', name: `Click ${humanizeIdentifier(findClickMatch[2]!)}`, line: lineNum }; }
    }

    // findElement(By.id("x")).sendKeys("val")
    if (!step) {
      const sendKeysMatch = line.match(/findElement\s*\(\s*By\.(\w+)\s*\(\s*"(.+?)"\s*\)\s*\)\.sendKeys\s*\(\s*"(.+?)"/);
      if (sendKeysMatch) { step = { keyword: 'Action', name: `Enter "${sendKeysMatch[3]}" in ${humanizeIdentifier(sendKeysMatch[2]!)} field`, line: lineNum }; }
    }

    // findElement(By.id("x")).clear()
    if (!step) {
      const clearMatch = line.match(/findElement\s*\(\s*By\.(\w+)\s*\(\s*"(.+?)"\s*\)\s*\)\.clear/);
      if (clearMatch) { step = { keyword: 'Action', name: `Clear ${humanizeIdentifier(clearMatch[2]!)} field`, line: lineNum }; }
    }

    // Select dropdown
    if (!step) {
      const selectMatch = line.match(/new\s+Select\s*\(.+?\)\.selectBy(\w+)\s*\(\s*"(.+?)"/);
      if (selectMatch) { step = { keyword: 'Action', name: `Select by ${camelToWords(selectMatch[1]!)} "${selectMatch[2]}"`, line: lineNum }; }
    }

    // Page Object Method calls: searchResultsPage.sortBy(value)
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Assert statements
    if (!step) {
      const assertMatch = line.match(/(assert\w+)\s*\(/i);
      if (assertMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeAssertMethod(assertMatch[1]!)}`, line: lineNum }; }
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
      if (commentMatch) { step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum }; }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── C# / NUnit / xUnit / MSTest Patterns ─────────────────────────────────────

function extractCSharpSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // Skip wait methods entirely
    if (/WebDriverWait/.test(line) || /wait\.Until/.test(line) || /Thread\.Sleep/.test(line) || /Task\.Delay/.test(line)) continue;

    // driver.Navigate().GoToUrl("url")
    const goMatch = line.match(/(?:driver|Driver)\.Navigate\(\)\.GoToUrl\s*\(\s*"(.+?)"/);
    if (goMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(goMatch[1]!)}`, line: lineNum }; }

    // driver.Url = "url"
    if (!step) {
      const urlMatch = line.match(/(?:driver|Driver)\.Url\s*=\s*"(.+?)"/);
      if (urlMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(urlMatch[1]!)}`, line: lineNum }; }
    }

    // FindElement(By.Id("x")).Click()
    if (!step) {
      const findClickMatch = line.match(/FindElement\s*\(\s*By\.(\w+)\s*\(\s*"(.+?)"\s*\)\s*\)\.Click/);
      if (findClickMatch) { step = { keyword: 'Action', name: `Click ${humanizeIdentifier(findClickMatch[2]!)}`, line: lineNum }; }
    }

    // FindElement(By.Id("x")).SendKeys("val")
    if (!step) {
      const sendKeysMatch = line.match(/FindElement\s*\(\s*By\.(\w+)\s*\(\s*"(.+?)"\s*\)\s*\)\.SendKeys\s*\(\s*"(.+?)"/);
      if (sendKeysMatch) { step = { keyword: 'Action', name: `Enter "${sendKeysMatch[3]}" in ${humanizeIdentifier(sendKeysMatch[2]!)} field`, line: lineNum }; }
    }

    // Page Object Method calls: SearchResultsPage.SortBy(value)
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Assert.That / Assert.AreEqual / Assert.IsTrue etc.
    if (!step) {
      const assertMatch = line.match(/Assert\.(\w+)\s*\(/);
      if (assertMatch) { step = { keyword: 'Assert', name: `Verify ${humanizeAssertMethod('Assert' + assertMatch[1]!)}`, line: lineNum }; }
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*\/\/\s*(.+)/);
      if (commentMatch) { step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum }; }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Ruby / RSpec Patterns ────────────────────────────────────────────────────

function extractRubySteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;
    let step: HumanStep | null = null;

    // Skip sleep
    if (/\bsleep\b/.test(line)) continue;

    // Capybara patterns
    // visit 'url'
    const visitMatch = line.match(/visit\s+['"](.+?)['"]/);
    if (visitMatch) { step = { keyword: 'Action', name: `Open ${humanizeUrl(visitMatch[1]!)}`, line: lineNum }; }

    // click_on / click_link / click_button
    if (!step) {
      const clickMatch = line.match(/(?:click_on|click_link|click_button)\s+['"](.+?)['"]/);
      if (clickMatch) { step = { keyword: 'Action', name: `Click "${clickMatch[1]}"`, line: lineNum }; }
    }

    // fill_in ... with: ...
    if (!step) {
      const fillMatch = line.match(/fill_in\s+['"](.+?)['"].*with:\s*['"](.+?)['"]/);
      if (fillMatch) { step = { keyword: 'Action', name: `Enter "${fillMatch[2]}" in ${fillMatch[1]} field`, line: lineNum }; }
    }

    // select ... from: ...
    if (!step) {
      const selectMatch = line.match(/select\s+['"](.+?)['"].*from:\s*['"](.+?)['"]/);
      if (selectMatch) { step = { keyword: 'Action', name: `Select "${selectMatch[1]}" from ${selectMatch[2]} dropdown`, line: lineNum }; }
    }

    // expect(...).to have_content / have_text / have_css etc.
    if (!step) {
      const expectMatch = line.match(/expect\s*\((.+?)\)\.to\s+(have_\w+|be_\w+|eq|include)/);
      if (expectMatch) { step = { keyword: 'Assert', name: `Verify ${simplifyExpression(expectMatch[1]!)} ${expectMatch[2].replace(/_/g, ' ')}`, line: lineNum }; }
    }

    // Page Object Method calls: login_page.enter_username("admin")
    if (!step) {
      step = tryMatchPomCall(line, lineNum);
    }

    // Comments
    if (!step) {
      const commentMatch = line.match(/^\s*#\s*(.+)/);
      if (commentMatch && !line.includes('rubocop') && !line.includes('frozen_string')) {
        step = { keyword: 'Comment', name: commentMatch[1]!.trim(), line: lineNum };
      }
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Robot Framework Patterns ─────────────────────────────────────────────────

function extractRobotSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = startLine + i;
    const trimmed = line.trim();

    // Skip empty lines and test name lines (non-indented)
    if (!trimmed || /^\S/.test(line)) continue;

    // Robot keyword lines are indented with spaces/tabs
    // Split by multiple spaces or tab
    const parts = trimmed.split(/\s{2,}|\t/).filter(Boolean);
    if (parts.length === 0) continue;

    const keyword = parts[0]!;
    const args = parts.slice(1).join(', ');

    // Skip wait/sleep keywords entirely
    if (/^(wait|sleep)/i.test(keyword)) continue;

    // Classify Robot keywords
    let step: HumanStep | null = null;

    if (/^(open browser)/i.test(keyword)) {
      step = { keyword: 'Action', name: `Open browser at ${args ? humanizeUrl(args.split(',')[0]!.trim()) : 'default page'}`, line: lineNum };
    } else if (/^(go to|navigate to)/i.test(keyword)) {
      step = { keyword: 'Action', name: `Open ${args ? humanizeUrl(args.trim()) : 'page'}`, line: lineNum };
    } else if (/^(click|press|select|input|type|choose|check|uncheck)/i.test(keyword)) {
      step = { keyword: 'Action', name: `${keyword} ${args}`, line: lineNum };
    } else if (/^(should|verify|assert|page should|element should|title should)/i.test(keyword)) {
      step = { keyword: 'Assert', name: `${keyword} ${args}`, line: lineNum };
    } else if (/^(log|comment|\[documentation\])/i.test(keyword)) {
      step = { keyword: 'Comment', name: args || keyword, line: lineNum };
    } else if (/^\[/i.test(keyword)) {
      // [Setup], [Teardown], [Tags], etc. — skip
      continue;
    } else {
      // Unknown keyword — treat as action
      step = { keyword: 'Action', name: `${keyword}${args ? ' ' + args : ''}`, line: lineNum };
    }

    if (step) steps.push(step);
  }

  return steps;
}

// ── Generic / Fallback Patterns ──────────────────────────────────────────────

function extractGenericSteps(lines: string[], startLine: number): HumanStep[] {
  const steps: HumanStep[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNum = startLine + i;

    // JS comments
    const jsCommentMatch = line.match(/^\s*\/\/\s*(.+)/);
    if (jsCommentMatch && !line.includes('eslint') && !line.includes('@ts-')) {
      steps.push({ keyword: 'Comment', name: jsCommentMatch[1]!.trim(), line: lineNum });
      continue;
    }

    // Python comments
    const pyCommentMatch = line.match(/^\s*#\s*(.+)/);
    if (pyCommentMatch && !line.includes('noqa')) {
      steps.push({ keyword: 'Comment', name: pyCommentMatch[1]!.trim(), line: lineNum });
      continue;
    }

    // Page Object Method calls
    const pomStep = tryMatchPomCall(line, lineNum);
    if (pomStep) {
      steps.push(pomStep);
      continue;
    }

    // Generic assert
    const assertMatch = line.match(/assert/i);
    if (assertMatch) {
      steps.push({ keyword: 'Assert', name: line.substring(0, 80), line: lineNum });
    }
  }

  return steps;
}

// ── Utility Helpers ──────────────────────────────────────────────────────────

/**
 * Convert a CSS selector to a human-readable name.
 * Examples:
 *   "#add-to-cart"       → "Add To Cart"
 *   ".search-input"      → "Search Input"
 *   "[data-testid='x']"  → humanize "x"
 *   "button.submit"      → "Submit button"
 *   "input[name='email']"→ "Email"
 *   "#loginBtn"          → "Login Btn"
 */
function humanizeSelector(selector: string): string {
  let s = selector.trim();

  // Handle attribute selectors: [data-testid="login-btn"], [name="email"], [aria-label="Search"]
  const attrMatch = s.match(/\[(?:data-(?:testid|test|cy|qa|id)|name|aria-label|placeholder|id)=['"](.+?)['"]\]/);
  if (attrMatch) {
    return humanizeIdentifier(attrMatch[1]!);
  }

  // Handle tag[attr="value"] pattern: input[name="email"] → "Email"
  const tagAttrMatch = s.match(/^\w+\[(?:name|id|aria-label|placeholder)=['"](.+?)['"]\]/);
  if (tagAttrMatch) {
    return humanizeIdentifier(tagAttrMatch[1]!);
  }

  // Handle tag.class pattern: button.submit → "Submit"
  const tagClassMatch = s.match(/^(\w+)\.(.+)/);
  if (tagClassMatch) {
    return humanizeIdentifier(tagClassMatch[2]!);
  }

  // Strip CSS prefix characters: #, .
  if (s.startsWith('#') || s.startsWith('.')) {
    s = s.substring(1);
  }

  // Handle compound selectors — take the last meaningful part
  // e.g. "div > .container .btn-submit" → "Btn Submit"
  const parts = s.split(/[\s>~+]+/);
  const lastPart = parts[parts.length - 1]!;
  // Strip remaining prefix
  const cleaned = lastPart.replace(/^[#.]/, '');

  return humanizeIdentifier(cleaned);
}

/**
 * Convert an identifier (camelCase, kebab-case, snake_case) to Title Case.
 * Examples:
 *   "add-to-cart"    → "Add To Cart"
 *   "loginButton"    → "Login Button"
 *   "cart_count"     → "Cart Count"
 *   "submitBtn"      → "Submit Btn"
 */
function humanizeIdentifier(id: string): string {
  return id
    // Split camelCase: "loginButton" → "login Button"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Replace hyphens and underscores with spaces
    .replace(/[-_]/g, ' ')
    // Title case each word
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/**
 * Convert a URL to a human-readable page description.
 * Examples:
 *   "https://www.flipkart.com/checkout/cart" - "Flipkart checkout cart page"
 *   "/login"        - "Login page"
 *   "/"             - "home page"
 *   "/api/products" - kept as-is
 *   glob patterns   - "Dashboard page"
 */
function humanizeUrl(url: string): string {
  // Root path
  if (url === '/' || url === '') return 'home page';

  // Glob patterns: e.g. glob/dashboard - "Dashboard page"
  if (url.startsWith('*')) {
    const path = url.replace(/^\*+\/?/, '');
    if (path) {
      const pageName = path.split('/').filter(Boolean).pop() || 'page';
      return `${humanizeIdentifier(pageName)} page`;
    }
    return url;
  }

  // API paths — keep as-is (they're technical, not pages)
  if (url.match(/^\/api\//i)) return url;

  // Full URL: extract domain + path
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const urlObj = new URL(url);
      // Domain name: strip www. and TLD
      let domain = urlObj.hostname.replace(/^www\./, '');
      domain = domain.replace(/\.(com|org|net|io|dev|co|in|uk|edu|gov)(\.\w+)?$/i, '');
      domain = humanizeIdentifier(domain);

      // Path segments
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length === 0) return domain;

      const pathDesc = pathParts.map(p => humanizeIdentifier(p).toLowerCase()).join(' ');
      return `${domain} ${pathDesc} page`;
    }
  } catch {
    // Not a valid URL, fall through
  }

  // Relative path: "/login" → "Login page"
  if (url.startsWith('/')) {
    const pathParts = url.split('/').filter(Boolean);
    if (pathParts.length === 0) return 'home page';
    const pageName = pathParts.map(p => humanizeIdentifier(p)).join(' ');
    return `${pageName} page`;
  }

  // Default — return as-is but clean up
  return url;
}

/**
 * Simplify a Playwright locator expression for human-readable display in assertions.
 * e.g. "page.locator('.cart-btn')" → "Cart Btn"
 *      "page.getByText('Login')"   → "'Login' text"
 */
function humanizeLocatorExpr(expr: string): string {
  // page.getByRole('button', { name: 'Submit' })
  const roleMatch = expr.match(/page\.getByRole\s*\(\s*['"`](.+?)['"`](?:\s*,\s*\{[^}]*name:\s*['"`](.+?)['"`])?\)/);
  if (roleMatch) return roleMatch[2] ? `"${roleMatch[2]}" ${roleMatch[1]}` : roleMatch[1]!;

  // page.getByText('...')
  const textMatch = expr.match(/page\.getByText\s*\(\s*['"`](.+?)['"`]\)/);
  if (textMatch) return `"${textMatch[1]}" text`;

  // page.getByLabel('...')
  const labelMatch = expr.match(/page\.getByLabel\s*\(\s*['"`](.+?)['"`]\)/);
  if (labelMatch) return `${labelMatch[1]} field`;

  // page.getByTestId('...')
  const testIdMatch = expr.match(/page\.getByTestId\s*\(\s*['"`](.+?)['"`]\)/);
  if (testIdMatch) return humanizeIdentifier(testIdMatch[1]!);

  // page.getByPlaceholder('...')
  const phMatch = expr.match(/page\.getByPlaceholder\s*\(\s*['"`](.+?)['"`]\)/);
  if (phMatch) return `${phMatch[1]} field`;

  // page.locator('...')
  const locMatch = expr.match(/page\.locator\s*\(\s*['"`](.+?)['"`]\)/);
  if (locMatch) return humanizeSelector(locMatch[1]!);

  // page (assertions like expect(page).toHaveURL)
  if (expr.trim() === 'page') return 'page';

  // Keep it short
  return expr.length > 40 ? expr.substring(0, 37) + '...' : expr;
}

/** Simplify a generic expression for display */
function simplifyExpression(expr: string): string {
  return expr.length > 50 ? expr.substring(0, 47) + '...' : expr;
}

/** Convert camelCase to human words: "toBeVisible" → "to be visible" */
function camelToWords(str: string): string {
  return str.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

/**
 * Humanize assertion method names.
 * Examples:
 *   "assertEqual"    → "values are equal"
 *   "assertTrue"     → "condition is true"
 *   "assertFalse"    → "condition is false"
 *   "assertNotNull"  → "value is not null"
 *   "assertContains" → "value contains expected"
 *   "AssertAreEqual" → "values are equal"
 *   "AssertIsTrue"   → "condition is true"
 */
function humanizeAssertMethod(method: string): string {
  const m = method.toLowerCase();

  if (m.includes('equal') || m.includes('equals')) return 'values are equal';
  if (m.includes('notequal')) return 'values are not equal';
  if (m.includes('true')) return 'condition is true';
  if (m.includes('false')) return 'condition is false';
  if (m.includes('null') && m.includes('not')) return 'value is not null';
  if (m.includes('null')) return 'value is null';
  if (m.includes('contain')) return 'value contains expected';
  if (m.includes('greater')) return 'value is greater';
  if (m.includes('less')) return 'value is less';
  if (m.includes('empty') && m.includes('not')) return 'value is not empty';
  if (m.includes('empty')) return 'value is empty';
  if (m.includes('same')) return 'objects are same reference';
  if (m.includes('instance')) return 'value is expected type';
  if (m.includes('that')) return 'condition matches';

  // Fallback: convert camelCase to words
  return camelToWords(method);
}

// ── Page Object Model (POM) Detection ────────────────────────────────────────

/** Objects that are NOT page objects — framework, runtime, browser internals */
const POM_SKIP_OBJECTS = new Set([
  'page', 'browser', 'context', 'frame', 'request', 'response',
  'console', 'JSON', 'Math', 'Array', 'Object', 'Promise', 'Date', 'RegExp', 'Error',
  'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Set', 'Map', 'WeakMap', 'WeakSet',
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'test', 'describe', 'it', 'cy', 'expect', 'assert', 'should',
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'before', 'after', 'setup', 'teardown',
  'driver', 'Driver', 'self',
  'fs', 'path', 'os', 'http', 'https', 'net', 'url', 'util', 'crypto',
  'process', 'Buffer', 'global',
  'require', 'module', 'exports',
  'pytest', 'unittest',
]);

/** Methods that are NOT meaningful POM actions — utility/array/runtime methods */
const POM_SKIP_METHODS = new Set([
  'sort', 'filter', 'map', 'forEach', 'reduce', 'find', 'findIndex',
  'some', 'every', 'flat', 'flatMap', 'fill',
  'includes', 'indexOf', 'lastIndexOf',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice',
  'concat', 'join', 'reverse',
  'split', 'trim', 'trimStart', 'trimEnd', 'padStart', 'padEnd',
  'replace', 'replaceAll', 'match', 'matchAll', 'search', 'startsWith', 'endsWith',
  'substring', 'substr', 'charAt', 'charCodeAt', 'codePointAt',
  'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase',
  'toString', 'valueOf', 'toFixed', 'toPrecision', 'toExponential',
  'keys', 'values', 'entries', 'assign', 'freeze', 'create', 'defineProperty',
  'log', 'warn', 'error', 'info', 'debug', 'trace', 'dir', 'table',
  'stringify', 'parse',
  'then', 'catch', 'finally',
  'resolve', 'reject', 'all', 'race', 'allSettled', 'any',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute',
  'querySelector', 'querySelectorAll', 'getElementById',
  'getElementsByClassName', 'getElementsByTagName',
  'createElement', 'appendChild', 'removeChild', 'insertBefore',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'apply', 'bind', 'call',
  'emit', 'on', 'off', 'once', 'removeListener',
]);

/**
 * Detect Page Object Model (POM) method calls and convert to readable steps.
 * Matches patterns like:
 *   await searchResultsPage.sortBy(TestData.sort.priceLowToHigh)
 *   const prices = await searchResultsPage.getAllProductPrices()
 *   loginPage.enterUsername("admin")
 *   self.login_page.enter_username("admin")   (Python)
 *
 * Converts method names to human language:
 *   sortBy(TestData.sort.priceLowToHigh) - "Sort By Price Low To High"
 *   getAllProductPrices()                 - "Get All Product Prices"
 *   enterUsername("admin")               - "Enter Username \"admin\""
 */
function tryMatchPomCall(line: string, lineNum: number): HumanStep | null {
  // Skip assertion lines, framework declarations, imports, control flow
  if (/^(?:expect|assert|test|it|describe|context|beforeEach|afterEach|beforeAll|afterAll|before|after|import|require|from|export|return|throw|if|else|for|while|switch|case|try|catch|finally)\b/.test(line)) return null;

  // Match: [const/let/var x =] [await] [self.|this.] object.method(args)
  const pomMatch = line.match(
    /(?:(?:const|let|var)\s+\w+\s*=\s*)?(?:await\s+)?(?:self\.|this\.)?(\w+)\.(\w+)\s*\(([^)]*)\)/
  );
  if (!pomMatch) return null;

  const objName = pomMatch[1]!;
  const methodName = pomMatch[2]!;
  const argsStr = pomMatch[3]!.trim();

  if (POM_SKIP_OBJECTS.has(objName)) return null;
  if (POM_SKIP_METHODS.has(methodName)) return null;

  // Skip wait/sleep methods
  if (/^(?:wait|sleep)/i.test(methodName)) return null;

  // Skip private/internal methods
  if (methodName.startsWith('_') || methodName.startsWith('$')) return null;

  // Skip if args contain callback patterns
  if (argsStr.includes('=>') || argsStr.includes('function(') || argsStr.includes('function (')) return null;

  const readableName = humanizeIdentifier(methodName);
  const argText = humanizeMethodArgs(argsStr);
  return {
    keyword: 'Action',
    name: argText ? `${readableName} ${argText}` : readableName,
    line: lineNum,
  };
}

/**
 * Convert method arguments to human-readable text.
 * Examples:
 *   "'admin'"                        - "admin"
 *   "TestData.sort.priceLowToHigh"   - "Price Low To High"
 *   "count"                          - "Count"
 *   ""                               - "" (empty)
 *   "(a, b) => a + b"               - "" (callback, skip)
 */
function humanizeMethodArgs(argsStr: string): string {
  if (!argsStr || !argsStr.trim()) return '';
  const args = argsStr.trim();

  // String literal: 'value' or "value" or `value`
  const strMatch = args.match(/^['"`](.+?)['"`]$/);
  if (strMatch) return `"${strMatch[1]}"`;

  // Object property chain: TestData.sort.priceLowToHigh - humanize last segment
  if (/^[\w.]+$/.test(args) && args.includes('.')) {
    const parts = args.split('.');
    const lastPart = parts[parts.length - 1]!;
    return humanizeIdentifier(lastPart);
  }

  // Simple identifier: count - humanize it
  if (/^\w+$/.test(args)) {
    return humanizeIdentifier(args);
  }

  // Complex expression — skip
  return '';
}

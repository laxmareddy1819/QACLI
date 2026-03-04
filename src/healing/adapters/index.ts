import type { HealingAdapter } from './base.js';
export { type HealingAdapter, type HealingAdapterConfig, DEFAULT_ADAPTER_CONFIG } from './base.js';
import { playwrightTsAdapter } from './playwright-ts.js';
import { playwrightCucumberTsAdapter } from './playwright-cucumber-ts.js';
import { playwrightPythonAdapter } from './playwright-python.js';
import { seleniumJavaAdapter } from './selenium-java.js';
import { seleniumPythonAdapter } from './selenium-python.js';
import { cypressTsAdapter } from './cypress-ts.js';
import { webdriverioTsAdapter } from './webdriverio-ts.js';
import { seleniumCSharpAdapter } from './selenium-csharp.js';
import { robotFrameworkAdapter } from './robot-framework.js';
import { appiumJavaAdapter } from './appium-java.js';

/**
 * All registered healing adapters.
 */
const adapters: HealingAdapter[] = [
  playwrightTsAdapter,
  playwrightCucumberTsAdapter,
  playwrightPythonAdapter,
  seleniumJavaAdapter,
  seleniumPythonAdapter,
  cypressTsAdapter,
  webdriverioTsAdapter,
  seleniumCSharpAdapter,
  robotFrameworkAdapter,
  appiumJavaAdapter,
];

/**
 * Get all registered adapters.
 */
export function getHealingAdapters(): HealingAdapter[] {
  return adapters;
}

/**
 * Find an adapter by framework + language.
 */
export function getHealingAdapter(
  framework: string,
  language: string,
): HealingAdapter | undefined {
  return adapters.find(
    (a) =>
      a.framework.toLowerCase() === framework.toLowerCase() &&
      a.language.toLowerCase() === language.toLowerCase(),
  );
}

/**
 * Get supported framework/language combinations.
 */
export function getSupportedAdapters(): Array<{
  framework: string;
  language: string;
  displayName: string;
}> {
  return adapters.map((a) => ({
    framework: a.framework,
    language: a.language,
    displayName: a.displayName,
  }));
}

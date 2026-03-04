import { ToolRegistry, getToolRegistry } from './registry.js';
import { filesystemTools } from './filesystem.js';
import { bashTools } from './bash.js';
import { searchTools } from './search.js';
import { browserTools } from './browser.js';
import { testRunnerTools } from './test-runner.js';
import { codegenTools } from './codegen.js';
import { apiTestingTools } from './api-testing.js';
import { healingTools } from './healing.js';

export { ToolRegistry, getToolRegistry, type ToolRegistration, type ToolExecutionContext } from './registry.js';

export function registerCoreTools(registry?: ToolRegistry): ToolRegistry {
  const reg = registry || getToolRegistry();

  const allTools = [
    ...filesystemTools,
    ...bashTools,
    ...searchTools,
    ...browserTools,
    ...testRunnerTools,
    ...codegenTools,
    ...apiTestingTools,
    ...healingTools,
  ];

  for (const tool of allTools) {
    reg.register(tool);
  }

  return reg;
}

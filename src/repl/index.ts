import { REPL } from './repl.js';

export { REPL } from './repl.js';
export { Renderer } from './renderer.js';
export { PermissionManager } from './permissions.js';
export { History } from './history.js';
export { Autocomplete } from './autocomplete.js';
export { SlashCommandRegistry, registerBuiltinCommands } from './slash-commands.js';

export async function startREPL(workingDirectory: string): Promise<void> {
  const repl = new REPL(workingDirectory);
  await repl.start();
}

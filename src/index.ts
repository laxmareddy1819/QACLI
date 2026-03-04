import { configDotenv } from 'dotenv';
import { resolve } from 'node:path';

// Load .env file — check working directory first, then qabot install directory
// configDotenv won't overwrite existing env vars, so the first .env found wins
configDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });
configDotenv({ path: resolve(import.meta.dirname || '.', '..', '.env'), quiet: true });

import { startREPL } from './repl/index.js';

const args = process.argv.slice(2);

// qabot only has interactive mode - launch directly into REPL
const workingDirectory = process.cwd();

// Handle --version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log('qabot v0.1.0');
  process.exit(0);
}

// Handle --help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  qabot - AI-Powered Test Automation CLI

  Usage:
    qabot              Launch interactive mode
    qabot --version    Show version
    qabot --help       Show this help

  Interactive Commands:
    /help              Show all slash commands
    /provider <name>   Switch LLM provider
    /model <name>      Switch model
    /record [url]      Start browser recording
    /run [files]       Run tests
    /fix [file]        Fix failing tests
    /scaffold <fw>     Create new test project
    /config            View/edit configuration
    /exit              Exit qabot

  Environment Variables (set in .env or shell):
    OPENAI_API_KEY       OpenAI API key
    ANTHROPIC_API_KEY    Anthropic API key
    GOOGLE_API_KEY       Google API key
    XAI_API_KEY          xAI API key

    OPENAI_MODEL         OpenAI model (default: gpt-4o)
    ANTHROPIC_MODEL      Anthropic model (default: claude-sonnet-4-20250514)
    GOOGLE_MODEL         Google model (default: gemini-2.0-flash)
    XAI_MODEL            xAI model (default: grok-2-latest)
    OLLAMA_MODEL         Ollama model (default: llama3)
    LMSTUDIO_MODEL       LM Studio model (default: default)

    OLLAMA_BASE_URL      Ollama URL (default: http://localhost:11434/v1)
    LMSTUDIO_BASE_URL    LM Studio URL (default: http://localhost:1234/v1)

    QABOT_DEFAULT_PROVIDER  Default provider (openai, anthropic, google, xai, ollama, lmstudio)
    QABOT_DEFAULT_MODEL     Override model for default provider

  Configuration:
    Place a .env file in your project directory or use 'export' in your shell.
    See .env.example for all options.
`);
  process.exit(0);
}

// Launch interactive REPL
startREPL(workingDirectory).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

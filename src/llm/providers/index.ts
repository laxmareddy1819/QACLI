import type { ProviderName } from '../../types/index.js';
import type { LLMProvider } from '../provider.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { XAIProvider, OllamaProvider, LMStudioProvider } from './openai-compatible.js';

export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { GoogleProvider } from './google.js';
export { XAIProvider, OllamaProvider, LMStudioProvider } from './openai-compatible.js';

export function createProvider(name: ProviderName): LLMProvider {
  switch (name) {
    case 'openai':
      return new OpenAIProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'google':
      return new GoogleProvider();
    case 'xai':
      return new XAIProvider();
    case 'ollama':
      return new OllamaProvider();
    case 'lmstudio':
      return new LMStudioProvider();
    case 'custom':
      throw new Error(
        'Custom provider requires explicit configuration. Use OpenAI-compatible setup.',
      );
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

import type { Express } from 'express';
import type { ProviderName } from '../../types/index.js';

const KEY_SENTINEL = '••••••••';
const ALL_PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'google', 'xai', 'ollama', 'lmstudio'];
const LOCAL_PROVIDERS: ProviderName[] = ['ollama', 'lmstudio'];

export function mountLLMRoutes(app: Express): void {

  // GET /api/llm/config — Read full LLM configuration (never returns raw API keys)
  app.get('/api/llm/config', async (_req, res) => {
    try {
      const { getConfig } = await import('../../config/config.js');
      const { ENV_API_KEY_MAP, DEFAULT_MODELS, DEFAULT_BASE_URLS } = await import('../../config/defaults.js');
      const config = getConfig();

      const providers: Record<string, unknown> = {};
      for (const p of ALL_PROVIDERS) {
        const envVar = ENV_API_KEY_MAP[p] || '';
        const hasEnvKey = !!(envVar && process.env[envVar]);
        const configProviders = config.getLLMConfig().providers as Record<string, { apiKey?: string }>;
        const hasConfigKey = !!(configProviders?.[p]?.apiKey);

        providers[p] = {
          model: config.getProviderModel(p),
          baseUrl: config.getProviderBaseUrl(p) || null,
          timeout: config.getProviderTimeout(p) || null,
          hasApiKey: config.hasApiKey(p),
          apiKeySource: hasEnvKey ? 'env' : hasConfigKey ? 'config' : 'none',
          isLocal: LOCAL_PROVIDERS.includes(p),
          defaultModel: DEFAULT_MODELS[p] || null,
          defaultBaseUrl: DEFAULT_BASE_URLS[p] || null,
          envVarName: envVar || null,
        };
      }

      res.json({
        defaultProvider: config.getDefaultProvider(),
        defaultModel: config.getDefaultModel() || null,
        maxToolIterations: config.getMaxToolIterations(),
        providers,
      });
    } catch (error) {
      res.status(500).json({ error: `Failed to load LLM config: ${error}` });
    }
  });

  // PUT /api/llm/config — Save LLM configuration (partial updates)
  app.put('/api/llm/config', async (req, res) => {
    try {
      const { getConfig } = await import('../../config/config.js');
      const config = getConfig();
      const { defaultProvider, defaultModel, maxToolIterations, providers } = req.body;

      if (defaultProvider && ALL_PROVIDERS.includes(defaultProvider)) {
        config.setDefaultProvider(defaultProvider);
      }
      if (defaultModel !== undefined) {
        if (defaultModel) config.setDefaultModel(defaultModel);
        else config.set('llm.defaultModel', undefined);
      }
      if (maxToolIterations !== undefined) {
        const val = Math.max(1, Math.min(100, Number(maxToolIterations)));
        if (!isNaN(val)) config.set('llm.maxToolIterations', val);
      }

      if (providers && typeof providers === 'object') {
        for (const [p, pConfig] of Object.entries(providers)) {
          if (!ALL_PROVIDERS.includes(p as ProviderName)) continue;
          const pc = pConfig as Record<string, unknown>;

          if (pc.apiKey && typeof pc.apiKey === 'string' && pc.apiKey !== KEY_SENTINEL) {
            config.setProviderApiKey(p as ProviderName, pc.apiKey);
          }
          if (pc.model !== undefined && typeof pc.model === 'string') {
            config.setProviderModel(p as ProviderName, pc.model);
          }
          if (pc.baseUrl !== undefined) {
            config.set(`llm.providers.${p}.baseUrl`, pc.baseUrl || undefined);
          }
          if (pc.timeout !== undefined) {
            const t = Number(pc.timeout);
            config.set(`llm.providers.${p}.timeout`, (!isNaN(t) && t > 0) ? t : undefined);
          }
        }
      }

      res.json({ saved: true });
    } catch (error) {
      res.status(500).json({ error: `Failed to save LLM config: ${error}` });
    }
  });

  // POST /api/llm/test-connection — Test provider connectivity
  app.post('/api/llm/test-connection', async (req, res) => {
    const { provider, apiKey, baseUrl, model } = req.body;
    if (!provider || !ALL_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: 'Invalid provider' });
      return;
    }

    try {
      const { getConfig } = await import('../../config/config.js');
      const { createProvider } = await import('../../llm/providers/index.js');
      const config = getConfig();

      const prov = createProvider(provider as ProviderName);
      const resolvedModel = model || config.getProviderModel(provider as ProviderName);
      const provConfig = {
        apiKey: (apiKey && apiKey !== KEY_SENTINEL) ? apiKey : config.getProviderApiKey(provider as ProviderName),
        baseUrl: baseUrl || config.getProviderBaseUrl(provider as ProviderName),
        model: resolvedModel,
        timeout: 15000,
      };

      await prov.initialize(provConfig);

      const start = Date.now();
      await prov.complete({
        messages: [{ role: 'user' as const, content: 'Respond with just the word "ok".' }],
        maxTokens: 10,
        temperature: 0,
      });
      const latencyMs = Date.now() - start;

      await prov.dispose();

      res.json({
        connected: true,
        message: `Connected successfully (${latencyMs}ms)`,
        model: resolvedModel,
        latencyMs,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      res.json({
        connected: false,
        message: msg,
      });
    }
  });
}

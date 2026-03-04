import type { Express } from 'express';
import type { WebSocketServer } from 'ws';
import type { HealingStore } from '../../healing/store.js';
import type { HealResolveRequest } from '../../types/healing.js';
import { ElementFingerprinter } from '../../healing/fingerprint.js';
import { getSupportedAdapters } from '../../healing/adapters/index.js';

function broadcastHealingEvent(wss: WebSocketServer | undefined, event: Record<string, unknown>): void {
  if (!wss) return;
  const data = JSON.stringify({ type: 'healing-event', event });
  for (const client of wss.clients) {
    if ((client as any).readyState === 1) client.send(data);
  }
}

/**
 * Universal Healing API — HTTP bridge for cross-framework self-healing.
 *
 * External test frameworks (Selenium Java, Python pytest, Cypress, etc.)
 * call these endpoints when they encounter element-not-found errors.
 * qabot runs its healing engine and returns healed selectors.
 */
export function mountUniversalHealingRoutes(
  app: Express,
  healingStore: HealingStore | null,
  wss?: WebSocketServer,
): void {
  const fingerprinter = new ElementFingerprinter();

  // ── POST /api/heal/resolve ─────────────────────────────────────────────────
  // Main healing endpoint: receives a broken selector + context, returns healed selector
  app.post('/api/heal/resolve', async (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    const start = Date.now();
    try {
      const body = req.body as HealResolveRequest;
      const { selector, selectorStrategy, fingerprint, pageUrl, framework, language, errorMessage, requestAI, testContext } = body;

      if (!selector || !pageUrl || !framework) {
        res.status(400).json({ error: 'selector, pageUrl, and framework are required' });
        return;
      }

      const selectorKey = `${selectorStrategy || 'css'}:${selector}`;

      // Extract test context fields for event storage
      const tctx = testContext as { scenarioName?: string; stepName?: string; actionType?: string } | undefined;

      // Get stored fingerprint for this selector (exact match first, then fuzzy)
      let stored = healingStore.get(selectorKey);

      // Fuzzy fallback: if no exact match, search for similar stored selectors
      if (!stored) {
        const similar = healingStore.findSimilar(selectorKey, pageUrl);
        if (similar) {
          stored = similar;
          console.log(`[healing] Fuzzy match: "${selectorKey}" → "${similar.selectorKey}" (similarity-based)`);
        }
      }

      if (!stored) {
        // No baseline fingerprint — cannot heal (neither exact nor fuzzy)
        healingStore.saveEvent({
          selectorKey,
          url: pageUrl,
          framework,
          language,
          originalSelector: selector,
          confidence: 0,
          success: false,
          durationMs: Date.now() - start,
          aiUsed: false,
          scenarioName: tctx?.scenarioName,
          stepName: tctx?.stepName,
          actionType: tctx?.actionType,
        });

        res.json({
          healed: false,
          confidence: 0,
          durationMs: Date.now() - start,
          aiUsed: false,
          message: 'No baseline fingerprint stored for this selector. Run tests successfully first to build a baseline.',
        });
        return;
      }

      // ── requestAI: client already tried all deterministic candidates — go straight to AI ──
      if (requestAI && stored) {
        try {
          const { AIHealer } = await import('../../healing/ai-healer.js');
          const aiHealer = new AIHealer();
          const domSnapshot = body.domSnapshot as string | undefined;
          const healContext = testContext ? { ...(testContext as Record<string, string>), errorMessage } : errorMessage ? { errorMessage } : undefined;
          const aiResult = await aiHealer.heal(selector, stored.fingerprint, domSnapshot, 'section', healContext);
          if (aiResult && aiResult.confidence >= 0.6) {
            const aiDuration = Date.now() - start;
            healingStore.saveEvent({
              selectorKey,
              url: pageUrl,
              framework,
              language,
              strategyUsed: 'aiHealing',
              originalSelector: selector,
              healedSelector: aiResult.selector,
              confidence: aiResult.confidence,
              success: true,
              durationMs: aiDuration,
              aiUsed: true,
              domSnapshotSize: domSnapshot?.length,
              scenarioName: tctx?.scenarioName,
              stepName: tctx?.stepName,
              actionType: tctx?.actionType,
            });
            healingStore.incrementSuccess(selectorKey);
            healingStore.updateInjectionActivityByFramework(framework);

            broadcastHealingEvent(wss, { selectorKey, url: pageUrl, framework, success: true, strategy: 'aiHealing', originalSelector: selector, healedSelector: aiResult.selector, confidence: aiResult.confidence, durationMs: aiDuration, aiUsed: true });

            res.json({
              healed: true,
              selector: aiResult.selector,
              selectorStrategy: 'css',
              confidence: aiResult.confidence,
              strategy: 'aiHealing',
              durationMs: aiDuration,
              aiUsed: true,
              reasoning: aiResult.reasoning,
            });
            return;
          }
        } catch {
          // AI healer not available
        }

        res.json({
          healed: false,
          confidence: 0,
          durationMs: Date.now() - start,
          aiUsed: true,
          message: 'AI healing could not suggest a selector with sufficient confidence.',
        });
        return;
      }

      // If the client sent a current fingerprint, compare with stored
      if (fingerprint) {
        const match = fingerprinter.compare(stored.fingerprint, fingerprint);
        if (match.confidence >= 0.7) {
          // The element is actually still matching — likely a timing issue
          const durationMs = Date.now() - start;
          healingStore.saveEvent({
            selectorKey,
            url: pageUrl,
            framework,
            language,
            strategyUsed: 'fingerprint',
            originalSelector: selector,
            healedSelector: selector,
            confidence: match.confidence,
            success: true,
            durationMs,
            aiUsed: false,
            scenarioName: tctx?.scenarioName,
            stepName: tctx?.stepName,
            actionType: tctx?.actionType,
          });

          broadcastHealingEvent(wss, { selectorKey, url: pageUrl, framework, success: true, strategy: 'fingerprint', originalSelector: selector, healedSelector: selector, confidence: match.confidence, durationMs });

          res.json({
            healed: true,
            selector,
            selectorStrategy: selectorStrategy || 'css',
            confidence: match.confidence,
            strategy: 'fingerprint',
            durationMs,
            aiUsed: false,
          });
          return;
        }
      }

      // Generate candidate selectors from stored fingerprint (multi-strategy)
      const candidates: Array<{ selector: string; strategy: string }> = [];
      const sf = stored.fingerprint;

      // ── Strategy 1: fingerprint — direct attribute selectors (highest specificity) ──
      if (sf.id) candidates.push({ selector: `#${sf.id}`, strategy: 'fingerprint' });
      if (sf.testId) candidates.push({ selector: `[data-testid="${sf.testId}"]`, strategy: 'fingerprint' });
      if (sf.ariaLabel) candidates.push({ selector: `[aria-label="${sf.ariaLabel}"]`, strategy: 'fingerprint' });
      if (sf.name) candidates.push({ selector: `${sf.tagName}[name="${sf.name}"]`, strategy: 'fingerprint' });
      if (sf.placeholder) candidates.push({ selector: `${sf.tagName}[placeholder="${sf.placeholder}"]`, strategy: 'fingerprint' });

      // ── Strategy 2: similarSelector — class-based and type-based variations ──
      if (sf.className) {
        const stableClasses = sf.className
          .split(/\s+/)
          .filter((c) => c && !/[a-z]+-[a-f0-9]{5,}/i.test(c));
        if (stableClasses.length > 0) {
          candidates.push({ selector: `${sf.tagName}.${stableClasses.join('.')}`, strategy: 'similarSelector' });
        }
      }
      if (sf.type) {
        candidates.push({ selector: `${sf.tagName}[type="${sf.type}"]`, strategy: 'similarSelector' });
      }

      // ── Strategy 3: textMatch — text content selector ──
      if (sf.textContent) {
        const text = sf.textContent.trim().slice(0, 50);
        candidates.push({ selector: `text=${text}`, strategy: 'textMatch' });
      }

      // ── Strategy 4: ancestorSearch — parent-child structural selectors ──
      if (sf.parentTag) {
        if (sf.siblingIndex !== undefined && sf.siblingIndex >= 0) {
          candidates.push({ selector: `${sf.parentTag} > ${sf.tagName}:nth-child(${sf.siblingIndex + 1})`, strategy: 'ancestorSearch' });
        }
        if (sf.textContent) {
          const ancestorText = sf.textContent.trim().slice(0, 30);
          candidates.push({ selector: `${sf.parentTag} ${sf.tagName}:has-text("${ancestorText}")`, strategy: 'ancestorSearch' });
        }
        if (sf.type) {
          candidates.push({ selector: `${sf.parentTag} > ${sf.tagName}[type="${sf.type}"]`, strategy: 'ancestorSearch' });
        }
        if (sf.ariaRole) {
          candidates.push({ selector: `${sf.parentTag} [role="${sf.ariaRole}"]`, strategy: 'ancestorSearch' });
        }
      }

      // ── Filter out candidates that match the original selector (healing to same is useless) ──
      const filtered = candidates.filter(c => c.selector !== selector);

      // ── Strict mode violation: add :visible specificity variants ──
      if (errorMessage && errorMessage.includes('strict mode')) {
        const specifics: typeof candidates = [];
        for (const c of filtered) {
          if (c.strategy !== 'textMatch') {
            specifics.push({ selector: `${c.selector}:visible`, strategy: c.strategy });
          }
        }
        // Also try combined attribute selectors for uniqueness
        if (sf.name && sf.type) {
          specifics.push({ selector: `${sf.tagName}[name="${sf.name}"][type="${sf.type}"]:visible`, strategy: 'fingerprint' });
        }
        if (sf.placeholder) {
          specifics.push({ selector: `${sf.tagName}[placeholder="${sf.placeholder}"]:visible`, strategy: 'fingerprint' });
        }
        // Prepend specifics (more specific = better for strict mode)
        filtered.unshift(...specifics);
      }

      // Return candidates ranked — the external framework will try them
      const durationMs = Date.now() - start;

      if (filtered.length > 0) {
        // Return the best candidate (most specific first: testId > id > ariaLabel > others)
        const best = filtered[0]!;
        const confidence = sf.testId ? 0.90 : sf.id ? 0.85 : sf.ariaLabel ? 0.80 : 0.75;

        healingStore.saveEvent({
          selectorKey,
          url: pageUrl,
          framework,
          language,
          strategyUsed: best.strategy as any,
          originalSelector: selector,
          healedSelector: best.selector,
          confidence,
          success: true,
          durationMs,
          aiUsed: false,
          scenarioName: tctx?.scenarioName,
          stepName: tctx?.stepName,
          actionType: tctx?.actionType,
        });

        healingStore.incrementSuccess(selectorKey);
        healingStore.updateInjectionActivityByFramework(framework);

        broadcastHealingEvent(wss, { selectorKey, url: pageUrl, framework, success: true, strategy: best.strategy, originalSelector: selector, healedSelector: best.selector, confidence, durationMs });

        res.json({
          healed: true,
          selector: best.selector,
          selectorStrategy: 'css',
          confidence,
          strategy: best.strategy,
          durationMs,
          aiUsed: false,
          candidates: filtered.slice(0, 8),
        });
      } else {
        // No deterministic candidates — try AI healing as fallback
        try {
          const { AIHealer } = await import('../../healing/ai-healer.js');
          const aiHealer = new AIHealer();
          const domSnapshot = body.domSnapshot as string | undefined;
          const fallbackContext = testContext ? { ...(testContext as Record<string, string>), errorMessage } : errorMessage ? { errorMessage } : undefined;
          const aiResult = await aiHealer.heal(selector, sf, domSnapshot, 'section', fallbackContext);
          if (aiResult && aiResult.confidence >= 0.6) {
            const aiDuration = Date.now() - start;
            healingStore.saveEvent({
              selectorKey,
              url: pageUrl,
              framework,
              language,
              strategyUsed: 'aiHealing',
              originalSelector: selector,
              healedSelector: aiResult.selector,
              confidence: aiResult.confidence,
              success: true,
              durationMs: aiDuration,
              aiUsed: true,
              domSnapshotSize: domSnapshot?.length,
              scenarioName: tctx?.scenarioName,
              stepName: tctx?.stepName,
              actionType: tctx?.actionType,
            });
            healingStore.incrementSuccess(selectorKey);
            healingStore.updateInjectionActivityByFramework(framework);

            broadcastHealingEvent(wss, { selectorKey, url: pageUrl, framework, success: true, strategy: 'aiHealing', originalSelector: selector, healedSelector: aiResult.selector, confidence: aiResult.confidence, durationMs: aiDuration, aiUsed: true });

            res.json({
              healed: true,
              selector: aiResult.selector,
              selectorStrategy: 'css',
              confidence: aiResult.confidence,
              strategy: 'aiHealing',
              durationMs: aiDuration,
              aiUsed: true,
              reasoning: aiResult.reasoning,
            });
            return;
          }
        } catch {
          // AI healer not available — continue to failure response
        }

        const failDuration = Date.now() - start;
        healingStore.saveEvent({
          selectorKey,
          url: pageUrl,
          framework,
          language,
          originalSelector: selector,
          confidence: 0,
          success: false,
          durationMs: failDuration,
          aiUsed: false,
          scenarioName: tctx?.scenarioName,
          stepName: tctx?.stepName,
          actionType: tctx?.actionType,
        });

        healingStore.incrementFailure(selectorKey);
        broadcastHealingEvent(wss, { selectorKey, url: pageUrl, framework, success: false, originalSelector: selector, confidence: 0, durationMs: failDuration });

        res.json({
          healed: false,
          confidence: 0,
          durationMs: failDuration,
          aiUsed: false,
          message: 'No alternative selectors could be generated from stored fingerprint.',
        });
      }
    } catch (error) {
      res.status(500).json({ error: `Healing failed: ${error}` });
    }
  });

  // ── POST /api/heal/fingerprint ─────────────────────────────────────────────
  // Store a baseline fingerprint (called when element is found successfully)
  app.post('/api/heal/fingerprint', (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      const { selectorKey, url, fingerprint, framework, testContext } = req.body;
      if (!selectorKey || !url || !fingerprint) {
        res.status(400).json({ error: 'selectorKey, url, and fingerprint are required' });
        return;
      }

      // Extract test context for fingerprint association
      const ctx = testContext as { scenarioName?: string; stepName?: string } | undefined;

      const id = healingStore.save({ selectorKey, url, fingerprint, scenarioName: ctx?.scenarioName, stepName: ctx?.stepName });

      // Update injection activity timestamp
      if (framework) {
        healingStore.updateInjectionActivityByFramework(framework);
      }

      res.json({ id, stored: true });
    } catch (error) {
      res.status(500).json({ error: `Failed to store fingerprint: ${error}` });
    }
  });

  // ── POST /api/heal/report ──────────────────────────────────────────────────
  // Report healing outcome (called after framework retries with healed selector)
  app.post('/api/heal/report', (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      const { selectorKey, url, healed, strategy, confidence, framework, language, originalSelector, healedSelector, durationMs, testContext } = req.body;
      if (!selectorKey || !framework) {
        res.status(400).json({ error: 'selectorKey and framework are required' });
        return;
      }

      // Extract test context fields
      const ctx = testContext as { scenarioName?: string; stepName?: string; actionType?: string } | undefined;

      // Update success/failure counts
      if (healed) {
        healingStore.incrementSuccess(selectorKey);
      } else {
        healingStore.incrementFailure(selectorKey);
      }

      // Store event
      const id = healingStore.saveEvent({
        selectorKey,
        url: url || '',
        framework,
        language,
        strategyUsed: strategy,
        originalSelector: originalSelector || selectorKey,
        healedSelector,
        confidence: confidence || 0,
        success: !!healed,
        durationMs: durationMs || 0,
        aiUsed: false,
        scenarioName: ctx?.scenarioName,
        stepName: ctx?.stepName,
        actionType: ctx?.actionType,
      });

      res.json({ id, recorded: true });
    } catch (error) {
      res.status(500).json({ error: `Failed to record report: ${error}` });
    }
  });

  // ── GET /api/heal/events ───────────────────────────────────────────────────
  // Healing event log with filters
  app.get('/api/heal/events', (req, res) => {
    if (!healingStore) {
      res.json({ events: [], total: 0 });
      return;
    }

    try {
      const framework = req.query.framework as string | undefined;
      const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;
      const success = req.query.success !== undefined ? req.query.success === 'true' : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      const result = healingStore.getEvents({ framework, days, success, limit, offset });
      res.json({ events: result.events, total: result.total });
    } catch (error) {
      res.json({ events: [], total: 0 });
    }
  });

  // ── GET /api/heal/analytics ────────────────────────────────────────────────
  // Rich analytics for the dashboard
  app.get('/api/heal/analytics', (req, res) => {
    if (!healingStore) {
      res.json({
        totalEvents: 0, totalHealed: 0, totalFailed: 0,
        overallSuccessRate: 0, averageConfidence: 0, averageDurationMs: 0,
        aiHealingRate: 0, strategyBreakdown: [], frameworkBreakdown: [],
        timeline: [], topFailures: [],
      });
      return;
    }

    try {
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      const analytics = healingStore.getAnalytics(days);
      res.json(analytics);
    } catch (error) {
      res.json({
        totalEvents: 0, totalHealed: 0, totalFailed: 0,
        overallSuccessRate: 0, averageConfidence: 0, averageDurationMs: 0,
        aiHealingRate: 0, strategyBreakdown: [], frameworkBreakdown: [],
        timeline: [], topFailures: [],
      });
    }
  });

  // ── GET /api/heal/injections ───────────────────────────────────────────────
  // List all injected projects
  app.get('/api/heal/injections', (req, res) => {
    if (!healingStore) {
      res.json({ injections: [], total: 0 });
      return;
    }

    try {
      const status = req.query.status as string | undefined;
      const injections = healingStore.getInjections(status as any);
      res.json({ injections, total: injections.length });
    } catch (error) {
      res.json({ injections: [], total: 0 });
    }
  });

  // ── POST /api/heal/inject ──────────────────────────────────────────────────
  // Trigger injection into a project (from UI)
  app.post('/api/heal/inject', async (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      const { projectPath, framework, language, filesCreated, healingServerUrl, confidenceThreshold, aiEnabled } = req.body;
      if (!projectPath || !framework || !language) {
        res.status(400).json({ error: 'projectPath, framework, and language are required' });
        return;
      }

      // Check if already injected
      const existing = healingStore.getInjectionByProject(projectPath);
      if (existing) {
        res.status(409).json({ error: 'Healing already injected into this project', injection: existing });
        return;
      }

      const id = healingStore.saveInjection({
        projectPath,
        framework,
        language,
        filesCreated: filesCreated || [],
        healingServerUrl: healingServerUrl || 'http://localhost:3700',
        confidenceThreshold: confidenceThreshold ?? 0.7,
        aiEnabled: aiEnabled ?? true,
        status: 'active',
      });

      res.json({ id, injected: true });
    } catch (error) {
      res.status(500).json({ error: `Failed to record injection: ${error}` });
    }
  });

  // ── GET /api/heal/adapters ────────────────────────────────────────────────
  // List supported healing adapters (framework + language combos)
  app.get('/api/heal/adapters', (_req, res) => {
    res.json({ adapters: getSupportedAdapters() });
  });

  // ── DELETE /api/heal/injections/:id ────────────────────────────────────────
  // Remove healing from a project (marks as removed)
  app.delete('/api/heal/injections/:id', (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      healingStore.updateInjectionStatus(req.params.id!, 'removed');
      res.json({ removed: true });
    } catch (error) {
      res.status(500).json({ error: `Failed to remove injection: ${error}` });
    }
  });

  // ── POST /api/heal/vision ───────────────────────────────────────────────
  // Vision-based healing: uses multimodal LLM with page screenshot
  app.post('/api/heal/vision', async (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    const start = Date.now();
    try {
      const { selector, fingerprint, screenshotBase64, pageUrl, framework, language, errorMessage, testContext } = req.body;
      if (!selector || !pageUrl || !screenshotBase64) {
        res.status(400).json({ error: 'selector, pageUrl, and screenshotBase64 are required' });
        return;
      }

      const { AIHealer } = await import('../../healing/ai-healer.js');
      const aiHealer = new AIHealer();

      // Use stored fingerprint from DB (much richer than what client typically sends)
      const selectorKeyLookup = `css:${selector}`;
      const storedForVision = healingStore.get(selectorKeyLookup) || healingStore.findSimilar(selectorKeyLookup, pageUrl);
      const fp = storedForVision?.fingerprint || fingerprint || { tagName: 'unknown' };
      const visionContext = testContext ? { ...(testContext as Record<string, string>), errorMessage } : errorMessage ? { errorMessage } : undefined;
      const result = await aiHealer.healWithVision(selector, fp, screenshotBase64, pageUrl, visionContext);

      if (result && result.confidence >= 0.5) {
        const durationMs = Date.now() - start;
        const selectorKey = `css:${selector}`;

        // Extract vision test context
        const vctx = testContext as { scenarioName?: string; stepName?: string; actionType?: string } | undefined;
        healingStore.saveEvent({
          selectorKey,
          url: pageUrl,
          framework: framework || 'unknown',
          language,
          strategyUsed: 'visionHealing',
          originalSelector: selector,
          healedSelector: result.selector,
          confidence: result.confidence,
          success: true,
          durationMs,
          aiUsed: true,
          scenarioName: vctx?.scenarioName,
          stepName: vctx?.stepName,
          actionType: vctx?.actionType,
        });

        broadcastHealingEvent(wss, { selectorKey, url: pageUrl, framework, success: true, strategy: 'visionHealing', originalSelector: selector, healedSelector: result.selector, confidence: result.confidence, durationMs, aiUsed: true });

        res.json({
          healed: true,
          selector: result.selector,
          confidence: result.confidence,
          strategy: 'visionHealing',
          reasoning: result.reasoning,
          elementDescription: result.elementDescription,
          durationMs,
          aiUsed: true,
          screenshotAnalyzed: true,
        });
      } else {
        res.json({
          healed: false,
          confidence: 0,
          durationMs: Date.now() - start,
          aiUsed: true,
          screenshotAnalyzed: true,
          message: 'Vision-based healing could not identify the element with sufficient confidence.',
        });
      }
    } catch (error) {
      res.status(500).json({ error: `Vision healing failed: ${error}` });
    }
  });

  // ── POST /api/heal/suggest-fixes ────────────────────────────────────────
  // AI-generated permanent fix suggestions based on healing history
  app.post('/api/heal/suggest-fixes', async (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      const days = req.body.days || 30;
      const limit = req.body.limit || 20;

      const { events } = healingStore.getEvents({ days, success: true, limit });
      if (events.length === 0) {
        res.json({ suggestions: [], message: 'No healed events found to analyze.' });
        return;
      }

      const { AIHealer } = await import('../../healing/ai-healer.js');
      const aiHealer = new AIHealer();

      const suggestions = await aiHealer.suggestPermanentFixes(
        events.map((e) => ({
          originalSelector: e.originalSelector,
          healedSelector: e.healedSelector,
          strategy: e.strategyUsed,
          confidence: e.confidence,
          framework: e.framework,
          url: e.url,
        })),
      );

      res.json({ suggestions, analyzedEvents: events.length });
    } catch (error) {
      res.status(500).json({ error: `Fix suggestion failed: ${error}` });
    }
  });

  // ── GET /api/heal/export ────────────────────────────────────────────────
  // Export healing report in JSON, CSV, or HTML format
  app.get('/api/heal/export', (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      const format = (req.query.format as string || 'json').toLowerCase();
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

      const analytics = healingStore.getAnalytics(days);
      const { events } = healingStore.getEvents({ days, limit: 1000 });
      const injections = healingStore.getInjections();
      const stats = healingStore.getStats();

      const report = {
        generatedAt: new Date().toISOString(),
        period: `Last ${days} days`,
        summary: {
          totalEvents: analytics.totalEvents,
          totalHealed: analytics.totalHealed,
          totalFailed: analytics.totalFailed,
          successRate: analytics.overallSuccessRate,
          averageConfidence: analytics.averageConfidence,
          averageDurationMs: analytics.averageDurationMs,
          aiHealingRate: analytics.aiHealingRate,
          fingerprintsStored: stats.total,
          activeProjects: injections.filter((i) => i.status === 'active').length,
        },
        strategyBreakdown: analytics.strategyBreakdown,
        frameworkBreakdown: analytics.frameworkBreakdown,
        timeline: analytics.timeline,
        topFailures: analytics.topFailures,
        events: events.map((e) => ({
          id: e.id,
          selectorKey: e.selectorKey,
          url: e.url,
          framework: e.framework,
          language: e.language,
          strategy: e.strategyUsed,
          originalSelector: e.originalSelector,
          healedSelector: e.healedSelector,
          confidence: e.confidence,
          success: e.success,
          durationMs: e.durationMs,
          aiUsed: e.aiUsed,
          scenarioName: e.scenarioName,
          stepName: e.stepName,
          actionType: e.actionType,
          timestamp: new Date(e.createdAt).toISOString(),
        })),
        injections: injections.map((i) => ({
          projectPath: i.projectPath,
          framework: i.framework,
          language: i.language,
          status: i.status,
          injectedAt: new Date(i.injectedAt).toISOString(),
        })),
      };

      if (format === 'csv') {
        // CSV export — events table
        const headers = ['ID', 'Timestamp', 'Selector', 'URL', 'Framework', 'Strategy', 'Original', 'Healed', 'Confidence', 'Success', 'Duration(ms)', 'AI Used', 'Scenario', 'Step', 'Action'];
        const rows = report.events.map((e) => [
          e.id, e.timestamp, e.selectorKey, e.url, e.framework,
          e.strategy || '', e.originalSelector, e.healedSelector || '',
          e.confidence, e.success, e.durationMs, e.aiUsed,
          e.scenarioName || '', e.stepName || '', e.actionType || '',
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=healing-report-${days}d.csv`);
        res.send(csv);
      } else if (format === 'html') {
        // HTML export — full report
        const html = generateHtmlReport(report, days);
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename=healing-report-${days}d.html`);
        res.send(html);
      } else {
        // JSON export
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=healing-report-${days}d.json`);
        res.json(report);
      }
    } catch (error) {
      res.status(500).json({ error: `Export failed: ${error}` });
    }
  });
}

// ── HTML Report Generator ──────────────────────────────────────────────────
function generateHtmlReport(report: any, days: number): string {
  const sr = report.summary;
  const successColor = sr.successRate >= 80 ? '#10b981' : sr.successRate >= 50 ? '#f59e0b' : '#ef4444';

  const eventsRows = report.events
    .slice(0, 100)
    .map(
      (e: any) =>
        `<tr>
          <td>${e.timestamp.split('T')[0]}</td>
          <td><code>${escHtml(e.originalSelector)}</code></td>
          <td><code>${escHtml(e.healedSelector || '-')}</code></td>
          <td>${escHtml(e.strategy || '-')}</td>
          <td>${escHtml(e.framework)}</td>
          <td>${Math.round(e.confidence * 100)}%</td>
          <td style="color:${e.success ? '#10b981' : '#ef4444'}">${e.success ? 'Healed' : 'Failed'}</td>
          <td>${e.durationMs}ms</td>
          <td>${escHtml(e.scenarioName || '-')}</td>
          <td>${escHtml(e.stepName || '-')}</td>
          <td>${escHtml(e.actionType || '-')}</td>
        </tr>`,
    )
    .join('\n');

  const strategyRows = report.strategyBreakdown
    .map((s: any) => `<tr><td>${escHtml(s.strategy)}</td><td>${s.count}</td><td>${s.successRate}%</td></tr>`)
    .join('\n');

  const frameworkRows = report.frameworkBreakdown
    .map((f: any) => `<tr><td>${escHtml(f.framework)}</td><td>${f.count}</td><td>${f.successRate}%</td></tr>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Healing Report — Last ${days} Days</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem}
  h1{font-size:1.5rem;margin-bottom:.5rem;color:#f8fafc}
  h2{font-size:1.1rem;margin:2rem 0 .75rem;color:#94a3b8;border-bottom:1px solid #1e293b;padding-bottom:.5rem}
  .meta{color:#64748b;font-size:.85rem;margin-bottom:2rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}
  .card{background:#1e293b;border-radius:.75rem;padding:1.25rem;border:1px solid #334155}
  .card .label{font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .card .value{font-size:1.5rem;font-weight:700;margin-top:.25rem}
  table{width:100%;border-collapse:collapse;font-size:.8rem;margin-bottom:1.5rem}
  th{text-align:left;padding:.5rem;color:#64748b;font-weight:500;border-bottom:1px solid #334155}
  td{padding:.5rem;border-bottom:1px solid #1e293b}
  code{font-size:.75rem;background:#1e293b;padding:2px 6px;border-radius:4px;color:#93c5fd}
  .footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #1e293b;color:#475569;font-size:.75rem;text-align:center}
</style></head><body>
<h1>Self-Healing Report</h1>
<p class="meta">Generated: ${report.generatedAt} &bull; Period: Last ${days} days</p>

<div class="cards">
  <div class="card"><div class="label">Total Events</div><div class="value">${sr.totalEvents}</div></div>
  <div class="card"><div class="label">Success Rate</div><div class="value" style="color:${successColor}">${sr.successRate}%</div></div>
  <div class="card"><div class="label">Healed</div><div class="value" style="color:#10b981">${sr.totalHealed}</div></div>
  <div class="card"><div class="label">Failed</div><div class="value" style="color:#ef4444">${sr.totalFailed}</div></div>
  <div class="card"><div class="label">Avg Confidence</div><div class="value">${sr.averageConfidence}</div></div>
  <div class="card"><div class="label">Avg Duration</div><div class="value">${sr.averageDurationMs}ms</div></div>
  <div class="card"><div class="label">AI Usage</div><div class="value">${sr.aiHealingRate}%</div></div>
  <div class="card"><div class="label">Fingerprints</div><div class="value">${sr.fingerprintsStored}</div></div>
</div>

<h2>Strategy Breakdown</h2>
<table><thead><tr><th>Strategy</th><th>Count</th><th>Success Rate</th></tr></thead>
<tbody>${strategyRows || '<tr><td colspan="3" style="text-align:center;color:#475569">No data</td></tr>'}</tbody></table>

<h2>Framework Breakdown</h2>
<table><thead><tr><th>Framework</th><th>Count</th><th>Success Rate</th></tr></thead>
<tbody>${frameworkRows || '<tr><td colspan="3" style="text-align:center;color:#475569">No data</td></tr>'}</tbody></table>

<h2>Healing Events (Latest ${Math.min(report.events.length, 100)})</h2>
<table><thead><tr><th>Date</th><th>Original</th><th>Healed To</th><th>Strategy</th><th>Framework</th><th>Confidence</th><th>Result</th><th>Duration</th><th>Scenario</th><th>Step</th><th>Action</th></tr></thead>
<tbody>${eventsRows || '<tr><td colspan="11" style="text-align:center;color:#475569">No events</td></tr>'}</tbody></table>

<div class="footer">qabot Self-Healing Report &bull; ${report.generatedAt}</div>
</body></html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Recording API routes — browser recording + AI code generation.
 *
 * Mirrors the terminal /record and /stop commands, providing REST endpoints
 * and WebSocket live-action streaming for the UI RecorderPanel.
 */
import type { Express } from 'express';
import type { WebSocketServer } from 'ws';
import type { Page } from 'playwright-core';
import type { UIServerOptions } from '../server.js';
import { ActionRecorder } from '../../recorder/index.js';
import { analyzeProject, scanProjectStructure, buildCodegenPrompt } from '../../recorder/formatter.js';
import { broadcast, streamScopedWithToolEvents } from './shared-streaming.js';
import type { RecordedAction, RecordingSession } from '../../types/index.js';
import { createLogger } from '../../utils/index.js';
import { audit } from './audit-helper.js';

const logger = createLogger('api-recorder');

// ── Module-level singleton — only one recording at a time ─────────────────
let activeRecorder: ActionRecorder | null = null;
let lastSession: RecordingSession | null = null;

export function mountRecorderRoutes(
  app: Express,
  wss: WebSocketServer,
  options: UIServerOptions,
): void {
  const { orchestrator, browserManager } = options;
  const projectPath = options.projectPath;

  // ── Disconnect listener: auto-stop recording if browser closes externally ──
  browserManager.onDisconnect(() => {
    if (!activeRecorder || !activeRecorder.isRecording()) return;

    logger.info('Browser disconnected during recording — auto-stopping recorder');

    // Collect whatever was recorded so far. stop() should be fast since
    // ownsBrowser=false (recorder reuses the shared browser, won't try to close it).
    activeRecorder.stop().then((session) => {
      lastSession = session;
      activeRecorder = null;

      broadcast(wss, {
        type: 'recorder-status',
        status: 'stopped',
        sessionId: session.id,
        actionCount: session.actions.length,
        duration: session.duration || 0,
      });

      logger.info(`Recording auto-stopped on browser disconnect: ${session.actions.length} actions captured`);
    }).catch((err) => {
      // If stop() fails (browser dead / state inconsistent), force-clear the recorder
      logger.info(`Recorder stop() failed on disconnect: ${err} — force-clearing`);
      activeRecorder = null;

      broadcast(wss, {
        type: 'recorder-status',
        status: 'stopped',
        actionCount: 0,
        duration: 0,
      });
    });
  });

  // ── POST /api/recorder/start — Start a recording session ────────────────
  app.post('/api/recorder/start', async (req, res) => {
    try {
      if (activeRecorder && activeRecorder.isRecording()) {
        res.status(409).json({
          error: 'Recording already in progress. Stop it first.',
        });
        return;
      }

      const { url, browser = 'chromium', headless = false } = req.body || {};

      // Create recorder
      activeRecorder = new ActionRecorder();

      // Set up live action callback — broadcast each captured action via WebSocket
      activeRecorder.onAction((action) => {
        // Special system message for assert mode toggle
        if (action.description === '__assert_mode_off__') {
          broadcast(wss, { type: 'recorder-assert-mode', active: false });
          return;
        }

        broadcast(wss, {
          type: 'recorder-action',
          action: {
            id: action.id,
            type: action.type,
            description: action.description || action.type,
            selector: action.selector
              ? {
                  primary: `${action.selector.strategy}: ${action.selector.value}`,
                  strategy: action.selector.strategy,
                  value: action.selector.value,
                }
              : undefined,
            value: action.value,
            key: action.key,
            url: action.url,
            timestamp: action.timestamp,
            frameName: action.frameName,
            tabIndex: action.tabIndex,
            // Assertion fields
            assertType: action.assertType,
            expectedValue: action.expectedValue,
            actualValue: action.actualValue,
            assertAttribute: action.assertAttribute,
          },
        });
      });

      // Start recording — pass browserManager so recorder reuses existing session
      await activeRecorder.start(
        {
          url: url || undefined,
          browser: browser as 'chromium' | 'firefox' | 'webkit',
          headless,
          outputFormat: 'playwright',
        },
        browserManager as any,
      );

      const sessionId = (activeRecorder as any).sessionId || `rec_${Date.now()}`;

      // Broadcast recording started
      broadcast(wss, {
        type: 'recorder-status',
        status: 'recording',
        sessionId,
        url: url || undefined,
      });

      // Broadcast browser-launched so LiveBrowserWrapper in any tab can detect it
      broadcast(wss, { type: 'browser-launched', url: url || '' });

      logger.info(`Recording started: ${sessionId}`);
      audit(req, 'recorder.start', { resourceType: 'recorder', resourceId: sessionId });
      res.json({ status: 'recording', sessionId });
    } catch (error) {
      logger.error('Failed to start recording:', error);
      activeRecorder = null;
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/recorder/stop — Stop recording session ────────────────────
  app.post('/api/recorder/stop', async (req, res) => {
    try {
      if (!activeRecorder || !activeRecorder.isRecording()) {
        res.status(409).json({
          error: 'No recording in progress.',
        });
        return;
      }

      const session = await activeRecorder.stop();
      lastSession = session;
      activeRecorder = null;

      const actionCount = session.actions.length;
      const duration = session.duration || 0;

      // Broadcast recording stopped
      broadcast(wss, {
        type: 'recorder-status',
        status: 'stopped',
        sessionId: session.id,
        actionCount,
        duration,
      });

      logger.info(`Recording stopped: ${actionCount} actions captured in ${(duration / 1000).toFixed(1)}s`);
      audit(req, 'recorder.stop', { resourceType: 'recorder', resourceId: session.id, details: { actionCount, duration } });

      // Return actions in a serializable format (keep full selector for display)
      const actions = session.actions.map((a) => ({
        id: a.id,
        type: a.type,
        timestamp: a.timestamp,
        description: a.description,
        selector: a.selector
          ? {
              primary: `${a.selector.strategy}: ${a.selector.value}`,
              strategy: a.selector.strategy,
              value: a.selector.value,
              fallbacks: a.selector.fallbacks?.map(f => `${f.strategy}: ${f.value}`),
            }
          : undefined,
        value: a.value,
        url: a.url,
        key: a.key,
        frameName: a.frameName,
        tabIndex: a.tabIndex,
        assertType: a.assertType,
        expectedValue: a.expectedValue,
        actualValue: a.actualValue,
        assertAttribute: a.assertAttribute,
      }));

      res.json({
        status: 'stopped',
        sessionId: session.id,
        actionCount,
        duration,
        actions,
      });
    } catch (error) {
      logger.error('Failed to stop recording:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  // ── GET /api/recorder/status — Check recording state ────────────────────
  app.get('/api/recorder/status', (_req, res) => {
    if (activeRecorder && activeRecorder.isRecording()) {
      const actions = activeRecorder.getActions();
      res.json({
        recording: true,
        sessionId: (activeRecorder as any).sessionId || null,
        actionCount: actions.length,
        hasSession: false,
      });
    } else {
      res.json({
        recording: false,
        hasSession: lastSession !== null,
        actionCount: lastSession ? lastSession.actions.length : 0,
        duration: lastSession?.duration || 0,
      });
    }
  });

  // ── GET /api/recorder/actions — Get recorded actions list ───────────────
  app.get('/api/recorder/actions', (_req, res) => {
    let actions: any[] = [];

    const mapAction = (a: any) => ({
      id: a.id,
      type: a.type,
      timestamp: a.timestamp,
      description: a.description,
      selector: a.selector
        ? {
            primary: `${a.selector.strategy}: ${a.selector.value}`,
            strategy: a.selector.strategy,
            value: a.selector.value,
          }
        : undefined,
      value: a.value,
      url: a.url,
      key: a.key,
    });

    if (activeRecorder && activeRecorder.isRecording()) {
      actions = activeRecorder.getActions().map(mapAction);
    } else if (lastSession) {
      actions = lastSession.actions.map(mapAction);
    }

    res.json({ actions });
  });

  // ── DELETE /api/recorder/actions/:id — Remove a single action from session ──
  app.delete('/api/recorder/actions/:id', (req, res) => {
    const actionId = req.params.id;
    if (!actionId) {
      res.status(400).json({ error: 'Action ID required' });
      return;
    }

    // Remove from active recorder if recording
    if (activeRecorder && activeRecorder.isRecording()) {
      if (activeRecorder.removeAction(actionId)) {
        res.json({ deleted: true, remaining: activeRecorder.getActions().length });
        return;
      }
    }

    // Remove from last session if stopped
    if (lastSession) {
      const idx = lastSession.actions.findIndex(a => a.id === actionId);
      if (idx >= 0) {
        lastSession.actions.splice(idx, 1);
        res.json({ deleted: true, remaining: lastSession.actions.length });
        return;
      }
    }

    res.status(404).json({ error: 'Action not found' });
  });

  // ── POST /api/recorder/generate — Generate code from recorded actions ───
  app.post('/api/recorder/generate', async (req, res) => {
    try {
      if (!lastSession) {
        res.status(409).json({
          error: 'No recorded session available. Record and stop first.',
        });
        return;
      }

      const {
        requestId,
        testName = 'recorded test',
        format,
      } = req.body || {};

      if (!requestId) {
        res.status(400).json({ error: 'requestId required' });
        return;
      }

      // 1. Analyze project structure (fast metadata scan)
      logger.info('Analyzing project structure...');
      const projectCtx = await analyzeProject(projectPath);

      // 2. Scan project files for LLM context
      const projectStructure = scanProjectStructure(projectPath, projectCtx);

      // 3. Build rich prompt with recorded actions + project map
      const prompt = buildCodegenPrompt(
        lastSession,
        projectCtx,
        projectStructure,
        { testName, format: format || undefined },
      );

      // Return immediately — streaming happens via WebSocket
      res.json({ status: 'streaming', requestId });

      // 4. Stream to LLM via orchestrator with full tool events
      // Reset orchestrator conversation for a clean context
      orchestrator.resetConversation();

      await streamScopedWithToolEvents(orchestrator, wss, prompt, requestId);

      // Clear session after generation
      lastSession = null;

      logger.info('Code generation complete');
    } catch (error) {
      logger.error('Failed to generate code:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/recorder/playback — Replay recorded actions in browser ────
  app.post('/api/recorder/playback', async (req, res) => {
    try {
      if (!lastSession || lastSession.actions.length === 0) {
        res.status(409).json({
          error: 'No recorded session available for playback. Record and stop first.',
        });
        return;
      }

      const { speed = 1 } = req.body || {};
      const actions = lastSession.actions;
      const totalActions = actions.length;

      // Respond immediately — playback progress streams via WebSocket
      res.json({ status: 'playing', totalActions });

      // Broadcast playback started
      broadcast(wss, {
        type: 'recorder-playback',
        status: 'started',
        totalActions,
      });

      // Get the browser for replay — start with the active page
      let currentPage = browserManager?.getPage();
      if (!currentPage) {
        broadcast(wss, {
          type: 'recorder-playback',
          status: 'error',
          error: 'No browser page available — launch a browser first.',
        });
        return;
      }

      let replayed = 0;
      let errors = 0;
      const baseDelay = Math.max(200, 800 / speed);
      let currentTabIndex = 0;

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]!;

        // Handle tab switching: if the action targets a different tab, switch to it
        if (action.tabIndex !== undefined && action.tabIndex !== currentTabIndex) {
          try {
            const allPages = browserManager?.getAllPages() || [];
            if (action.tabIndex < allPages.length) {
              currentPage = allPages[action.tabIndex]!;
              currentTabIndex = action.tabIndex;
              await currentPage.bringToFront();
              logger.info(`Playback: switched to tab ${currentTabIndex}`);
            }
          } catch (err) {
            logger.warn(`Playback: failed to switch to tab ${action.tabIndex}: ${err}`);
          }
        }

        try {
          await replayAction(currentPage, action, baseDelay);
          replayed++;
          broadcast(wss, {
            type: 'recorder-playback',
            status: 'action',
            index: i,
            actionType: action.type,
            description: action.type === 'assert'
              ? `✓ ${action.description || 'Assertion passed'}`
              : (action.description || action.type),
          });

          // After navigation, check if a new tab was opened
          if (action.type === 'click') {
            const allPages = browserManager?.getAllPages() || [];
            if (allPages.length > currentTabIndex + 1) {
              // A new tab might have been opened by the click
              const newestPage = allPages[allPages.length - 1]!;
              if (newestPage !== currentPage) {
                // Check if the next action targets this new tab
                const nextAction = actions[i + 1];
                if (nextAction?.tabIndex !== undefined && nextAction.tabIndex >= allPages.length - 1) {
                  currentPage = newestPage;
                  currentTabIndex = allPages.length - 1;
                  await currentPage.bringToFront();
                  await currentPage.waitForLoadState('domcontentloaded').catch(() => {});
                }
              }
            }
          }
        } catch (err) {
          errors++;
          logger.warn(`Playback action ${i} failed: ${err}`);
          broadcast(wss, {
            type: 'recorder-playback',
            status: 'action-error',
            index: i,
            actionType: action.type,
            description: action.description || action.type,
            error: String(err),
          });
        }
      }

      broadcast(wss, {
        type: 'recorder-playback',
        status: 'done',
        replayed,
        total: totalActions,
        errors,
      });

      logger.info(`Playback complete: ${replayed}/${totalActions} actions replayed (${errors} errors)`);
    } catch (error) {
      logger.error('Playback failed:', error);
      broadcast(wss, {
        type: 'recorder-playback',
        status: 'error',
        error: String(error),
      });
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/recorder/reset — Clear recording state ────────────────────
  app.post('/api/recorder/reset', async (_req, res) => {
    try {
      if (activeRecorder && activeRecorder.isRecording()) {
        await activeRecorder.stop();
      }
      activeRecorder = null;
      lastSession = null;

      broadcast(wss, {
        type: 'recorder-status',
        status: 'reset',
      });

      res.json({ status: 'reset' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/recorder/assert-mode — Toggle assertion mode on/off ────────
  app.post('/api/recorder/assert-mode', async (req, res) => {
    try {
      if (!activeRecorder || !activeRecorder.isRecording()) {
        res.status(409).json({ error: 'No active recording. Start recording first.' });
        return;
      }

      const { enable } = req.body || {};
      const active = await activeRecorder.toggleAssertMode(!!enable);

      broadcast(wss, {
        type: 'recorder-assert-mode',
        active,
      });

      res.json({ active });
    } catch (error) {
      logger.error('Failed to toggle assert mode:', error);
      res.status(500).json({ error: String(error) });
    }
  });
}

// ── Helper: Replay a single recorded action on the Playwright page ──────────

/**
 * Create a Playwright Locator from a strategy+value pair.
 */
function makeLocator(page: Page, strategy: string, value: string) {
  switch (strategy) {
    case 'testId':
      return page.getByTestId(value);
    case 'css':
      return page.locator(value);
    case 'xpath':
      return page.locator(value);
    case 'text':
      return page.getByText(value);
    case 'role': {
      // "role|name" format → getByRole('role', { name: 'name' })
      const parts = value.split('|');
      if (parts.length >= 2) {
        return page.getByRole(parts[0]! as any, { name: parts.slice(1).join('|') });
      }
      return page.getByRole(value as any);
    }
    case 'label':
      return page.getByLabel(value);
    case 'placeholder':
      return page.getByPlaceholder(value);
    default:
      return page.locator(value);
  }
}

/**
 * Build a Playwright locator from a recorded action's selector.
 * Tries primary strategy first, then iterates through fallback selectors.
 * Returns the first locator that finds at least one matching element.
 */
async function buildLocatorWithFallback(page: Page, action: RecordedAction) {
  const sel = action.selector;
  if (!sel) return null;

  // Try primary selector
  const primary = makeLocator(page, sel.strategy, sel.value);
  if (primary) {
    try {
      const count = await primary.count();
      if (count > 0) return primary;
    } catch {
      // Primary failed — try fallbacks
      logger.debug(`Primary selector failed: ${sel.strategy}=${sel.value}`);
    }
  }

  // Try fallback selectors
  if (sel.fallbacks && sel.fallbacks.length > 0) {
    for (const fb of sel.fallbacks) {
      const loc = makeLocator(page, fb.strategy, fb.value);
      if (loc) {
        try {
          const count = await loc.count();
          if (count > 0) {
            logger.debug(`Fallback selector matched: ${fb.strategy}=${fb.value}`);
            return loc;
          }
        } catch {
          // This fallback failed — try next
          continue;
        }
      }
    }
  }

  // All locators failed — return primary as last resort
  // (it will timeout in the caller, which can then try position-based fallback)
  logger.debug('All selectors failed, returning primary as last resort');
  return primary;
}

async function replayAction(page: Page, action: RecordedAction, delayMs: number): Promise<void> {
  // Small delay between actions for visual feedback
  await new Promise(r => setTimeout(r, delayMs));

  switch (action.type) {
    case 'navigate': {
      // Tab-switch actions only switch tabs — don't navigate to the URL
      const isTabSwitch = action.description?.includes('Switch to new tab') ||
                          action.description?.includes('switch to new tab');
      if (isTabSwitch) {
        // Tab switching is handled in the playback loop above — nothing more to do
        logger.debug(`Playback: tab switch only, skipping navigation to ${action.url}`);
        break;
      }
      if (action.url) {
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
      break;
    }
    case 'click': {
      const loc = await buildLocatorWithFallback(page, action);
      if (loc) {
        try {
          await loc.first().click({ timeout: 5000 });
        } catch (locatorError) {
          // Locator failed — try position-based fallback
          if (action.position) {
            logger.debug(`Locator failed for click, falling back to position (${action.position.x}, ${action.position.y})`);
            await page.mouse.click(action.position.x, action.position.y);
          } else {
            throw locatorError;
          }
        }
      } else if (action.position) {
        await page.mouse.click(action.position.x, action.position.y);
      }
      break;
    }
    case 'dblclick': {
      const loc = await buildLocatorWithFallback(page, action);
      if (loc) {
        try {
          await loc.first().dblclick({ timeout: 5000 });
        } catch (locatorError) {
          if (action.position) {
            logger.debug(`Locator failed for dblclick, falling back to position (${action.position.x}, ${action.position.y})`);
            await page.mouse.dblclick(action.position.x, action.position.y);
          } else {
            throw locatorError;
          }
        }
      } else if (action.position) {
        await page.mouse.dblclick(action.position.x, action.position.y);
      }
      break;
    }
    case 'fill': {
      const loc = await buildLocatorWithFallback(page, action);
      if (loc) {
        await loc.first().fill(action.value || '', { timeout: 8000 });
      }
      break;
    }
    case 'press': {
      if (action.key) {
        const loc = await buildLocatorWithFallback(page, action);
        if (loc) {
          await loc.first().press(action.key, { timeout: 5000 });
        } else {
          await page.keyboard.press(action.key);
        }
      }
      break;
    }
    case 'select': {
      const loc = await buildLocatorWithFallback(page, action);
      if (loc && action.value) {
        await loc.first().selectOption(action.value, { timeout: 8000 });
      }
      break;
    }
    case 'check': {
      const loc = await buildLocatorWithFallback(page, action);
      if (loc) {
        try {
          await loc.first().check({ timeout: 5000 });
        } catch {
          // Fallback to click for custom checkboxes (divs with role=checkbox, etc.)
          logger.debug('check() failed — falling back to click()');
          await loc.first().click({ timeout: 8000 });
        }
      }
      break;
    }
    case 'uncheck': {
      const loc = await buildLocatorWithFallback(page, action);
      if (loc) {
        try {
          await loc.first().uncheck({ timeout: 5000 });
        } catch {
          // Fallback to click for custom checkboxes
          logger.debug('uncheck() failed — falling back to click()');
          await loc.first().click({ timeout: 8000 });
        }
      }
      break;
    }
    case 'assert': {
      // Verify assertions during playback
      await verifyAssertion(page, action, delayMs);
      break;
    }
    default:
      logger.debug(`Playback: skipping unknown action type "${action.type}"`);
  }
}

/**
 * Verify an assertion during playback — checks the expected condition
 * instead of performing a user interaction.
 */
async function verifyAssertion(page: Page, action: RecordedAction, _delayMs: number): Promise<void> {
  const loc = await buildLocatorWithFallback(page, action);
  const expected = action.expectedValue || '';

  switch (action.assertType) {
    // ── Positive assertions ──
    case 'text': {
      if (loc) {
        const text = await loc.first().innerText({ timeout: 8000 }).catch(() => '');
        if (!text.includes(expected)) {
          throw new Error(`Text assertion failed: expected "${expected}" but got "${text.slice(0, 100)}"`);
        }
      }
      break;
    }
    case 'visible': {
      if (loc) {
        const visible = await loc.first().isVisible().catch(() => false);
        if (!visible) {
          throw new Error('Visibility assertion failed: element is not visible');
        }
      }
      break;
    }
    case 'hidden': {
      if (loc) {
        const visible = await loc.first().isVisible().catch(() => true);
        if (visible) {
          throw new Error('Hidden assertion failed: element is still visible');
        }
      }
      break;
    }
    case 'value': {
      if (loc) {
        const val = await loc.first().inputValue({ timeout: 8000 }).catch(() => '');
        if (val !== expected) {
          throw new Error(`Value assertion failed: expected "${expected}" but got "${val}"`);
        }
      }
      break;
    }
    case 'attribute': {
      if (loc && action.assertAttribute) {
        const attrVal = await loc.first().getAttribute(action.assertAttribute, { timeout: 8000 }).catch(() => null);
        if (attrVal !== expected) {
          throw new Error(`Attribute assertion failed: expected "${action.assertAttribute}" = "${expected}" but got "${attrVal}"`);
        }
      }
      break;
    }
    case 'url': {
      const currentUrl = page.url();
      if (!currentUrl.includes(expected)) {
        throw new Error(`URL assertion failed: expected URL to contain "${expected}" but got "${currentUrl}"`);
      }
      break;
    }
    case 'title': {
      const title = await page.title();
      if (!title.includes(expected)) {
        throw new Error(`Title assertion failed: expected title to contain "${expected}" but got "${title}"`);
      }
      break;
    }
    case 'count': {
      if (loc) {
        const count = await loc.count();
        const expectedCount = parseInt(expected, 10);
        if (!isNaN(expectedCount) && count !== expectedCount) {
          throw new Error(`Count assertion failed: expected ${expectedCount} elements but found ${count}`);
        }
      }
      break;
    }
    case 'enabled': {
      if (loc) {
        const enabled = await loc.first().isEnabled({ timeout: 5000 }).catch(() => false);
        if (!enabled) {
          throw new Error('Enabled assertion failed: element is disabled');
        }
      }
      break;
    }
    case 'disabled': {
      if (loc) {
        const enabled = await loc.first().isEnabled({ timeout: 5000 }).catch(() => true);
        if (enabled) {
          throw new Error('Disabled assertion failed: element is enabled');
        }
      }
      break;
    }
    case 'checked': {
      if (loc) {
        const checked = await loc.first().isChecked({ timeout: 5000 }).catch(() => false);
        if (!checked) {
          throw new Error('Checked assertion failed: element is not checked');
        }
      }
      break;
    }
    case 'unchecked': {
      if (loc) {
        const checked = await loc.first().isChecked({ timeout: 5000 }).catch(() => true);
        if (checked) {
          throw new Error('Unchecked assertion failed: element is still checked');
        }
      }
      break;
    }
    case 'class': {
      if (loc) {
        const cls = await loc.first().getAttribute('class', { timeout: 5000 }).catch(() => '');
        if (!cls || !cls.includes(expected)) {
          throw new Error(`Class assertion failed: expected class "${expected}" but got "${cls}"`);
        }
      }
      break;
    }
    case 'placeholder': {
      if (loc) {
        const ph = await loc.first().getAttribute('placeholder', { timeout: 5000 }).catch(() => '');
        if (ph !== expected) {
          throw new Error(`Placeholder assertion failed: expected "${expected}" but got "${ph}"`);
        }
      }
      break;
    }
    case 'href': {
      if (loc) {
        const href = await loc.first().getAttribute('href', { timeout: 5000 }).catch(() => '');
        if (!href || !href.includes(expected)) {
          throw new Error(`Href assertion failed: expected href to contain "${expected}" but got "${href}"`);
        }
      }
      break;
    }
    case 'min-count': {
      if (loc) {
        const count = await loc.count();
        const minCount = parseInt(expected, 10);
        if (!isNaN(minCount) && count < minCount) {
          throw new Error(`Min-count assertion failed: expected at least ${minCount} elements but found ${count}`);
        }
      }
      break;
    }
    // ── Negative assertions ──
    case 'not-text': {
      if (loc) {
        const text = await loc.first().innerText({ timeout: 8000 }).catch(() => '');
        if (text.includes(expected)) {
          throw new Error(`Not-text assertion failed: expected NOT to contain "${expected}" but it does`);
        }
      }
      break;
    }
    case 'not-visible': {
      if (loc) {
        const visible = await loc.first().isVisible().catch(() => true);
        if (visible) {
          throw new Error('Not-visible assertion failed: element IS visible');
        }
      }
      break;
    }
    case 'not-value': {
      if (loc) {
        const val = await loc.first().inputValue({ timeout: 8000 }).catch(() => '');
        if (val === expected) {
          throw new Error(`Not-value assertion failed: value IS "${expected}"`);
        }
      }
      break;
    }
    case 'not-enabled': {
      if (loc) {
        const enabled = await loc.first().isEnabled({ timeout: 5000 }).catch(() => true);
        if (enabled) {
          throw new Error('Not-enabled assertion failed: element IS enabled');
        }
      }
      break;
    }
    case 'not-checked': {
      if (loc) {
        const checked = await loc.first().isChecked({ timeout: 5000 }).catch(() => true);
        if (checked) {
          throw new Error('Not-checked assertion failed: element IS checked');
        }
      }
      break;
    }
    case 'not-url': {
      const currentUrl = page.url();
      if (currentUrl.includes(expected)) {
        throw new Error(`Not-URL assertion failed: URL contains "${expected}" but should not`);
      }
      break;
    }
    case 'not-title': {
      const pageTitle = await page.title();
      if (pageTitle.includes(expected)) {
        throw new Error(`Not-title assertion failed: title contains "${expected}" but should not`);
      }
      break;
    }
    case 'not-count': {
      if (loc) {
        const count = await loc.count();
        const expectedCount = parseInt(expected, 10);
        if (!isNaN(expectedCount) && count === expectedCount) {
          throw new Error(`Not-count assertion failed: count IS ${expectedCount}`);
        }
      }
      break;
    }
    case 'not-class': {
      if (loc) {
        const cls = await loc.first().getAttribute('class', { timeout: 5000 }).catch(() => '');
        if (cls && cls.includes(expected)) {
          throw new Error(`Not-class assertion failed: element HAS class "${expected}"`);
        }
      }
      break;
    }
    default:
      logger.debug(`Playback: unknown assertion type "${action.assertType}"`);
  }
}

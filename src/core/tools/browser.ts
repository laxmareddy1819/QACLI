import type { ToolRegistration } from './registry.js';

// Browser tools delegate to the browser adapter. The adapter is injected
// into the tool execution context at runtime by the orchestrator.

/**
 * Build an enhanced error message for browser interaction failures.
 * Adds recovery hints so the LLM knows what to try next instead of giving up.
 */
function buildBrowserError(
  action: string,
  selector: string,
  strategy: string | undefined,
  error: Error | string,
): string {
  const errMsg = typeof error === 'string' ? error : error.message || String(error);
  const isTimeout = /timeout/i.test(errMsg);
  const isNotFound = /not found|no element|no .* matching|waiting for (locator|selector)|0 elements/i.test(errMsg);
  const isHidden = /element is not visible|hidden|display: none/i.test(errMsg);
  const isDetached = /detached|removed|stale/i.test(errMsg);
  const isIntercept = /intercept|overlapping|pointer.+events/i.test(errMsg);

  let hint = '';

  if (isNotFound || isTimeout) {
    hint = `\n\nRecovery hints (try these in order):
1. Use browser_wait_for with selector="${selector}" state="visible" before retrying
2. Use browser_inspect with selector="*" or broader selector to discover what elements exist on the page
3. Try a DIFFERENT selector strategy:
   - strategy="text" with visible text content
   - strategy="testId" if element has data-testid
   - strategy="role" with ARIA role (e.g., "button", "link", "textbox")
   - strategy="label" with aria-label
   - strategy="placeholder" with placeholder text
4. Use browser_get_text to read the page and understand what's actually rendered
5. Check if the element is inside an iframe — use browser_list_frames, then browser_switch_frame
6. The page may not be fully loaded — use browser_wait_for on a parent container first`;
  } else if (isHidden) {
    hint = `\n\nRecovery hints:
1. The element exists but is not visible. Use browser_wait_for selector="${selector}" state="visible"
2. The element may need to be scrolled into view — try browser_evaluate with 'document.querySelector("${selector}")?.scrollIntoView()'
3. The element may be behind a modal/overlay — close or dismiss it first
4. Use browser_inspect selector="${selector}" to check the element's visibility state`;
  } else if (isDetached) {
    hint = `\n\nRecovery hints:
1. The element was removed/replaced in the DOM (page changed or re-rendered). Wait and retry.
2. Use browser_wait_for selector="${selector}" state="attached" before retrying
3. The page may have navigated — use browser_get_url to verify current page`;
  } else if (isIntercept) {
    hint = `\n\nRecovery hints:
1. Another element is overlapping the target. Close any popups, modals, or overlays first.
2. Use browser_evaluate to scroll the element into view and dismiss overlays
3. Try clicking with a more specific selector that targets the exact element`;
  } else {
    hint = `\n\nRecovery hints:
1. Use browser_inspect to verify the element exists and is interactable
2. Try a different selector or strategy (text, testId, role, label, placeholder)
3. Use browser_wait_for before retrying
4. Use browser_get_text to understand the current page state`;
  }

  return `${action} FAILED for selector="${selector}"${strategy ? ` strategy="${strategy}"` : ''}.\nError: ${errMsg}${hint}`;
}

export const browserLaunchTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_launch',
    description:
      'Launch a browser for automation. Returns a session ID. Browser stays open until closed.',
    parameters: {
      type: 'object',
      properties: {
        browser: {
          type: 'string',
          description: 'Browser type: chromium, firefox, or webkit (default: chromium)',
        },
        headless: {
          type: 'boolean',
          description: 'Run in headless mode (default: false)',
        },
        url: {
          type: 'string',
          description: 'Initial URL to navigate to',
        },
      },
    },
  },
  handler: async (args, ctx) => {
    // The browser manager is injected into context by the orchestrator
    const manager = (ctx as any)._browserManager;
    if (!manager) {
      throw new Error('No browser manager available. Browser automation is not initialized.');
    }
    const session = await manager.launch({
      browser: args.browser || 'chromium',
      headless: args.headless ?? false,
    });
    if (args.url) {
      await manager.navigate(session.id, args.url as string);
    }
    return `Browser launched (session: ${session.id})${args.url ? `. Navigated to: ${args.url}` : ''}`;
  },
};

export const browserNavigateTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_navigate',
    description: 'Navigate the browser to a URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    await manager.navigateActive(args.url as string);
    const title = await manager.getTitle();
    const url = await manager.getUrl();
    return `Navigated to: ${url}\nPage title: ${title}\nStatus: Page loaded successfully.`;
  },
};

export const browserClickTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_click',
    description: 'Click an element on the page using a CSS selector, text, or test ID.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector, text content, or test ID' },
        strategy: {
          type: 'string',
          description: 'Selector strategy: css, text, testId, role, label (default: css)',
        },
      },
      required: ['selector'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    try {
      await manager.click(args.selector as string, args.strategy as string);
      // Return current page state after the click for LLM awareness
      const url = await manager.getUrl().catch(() => 'unknown');
      const title = await manager.getTitle().catch(() => 'unknown');
      return `Clicked: ${args.selector}\nCurrent URL: ${url}\nPage title: ${title}`;
    } catch (err) {
      throw new Error(buildBrowserError('browser_click', args.selector as string, args.strategy as string, err as Error));
    }
  },
};

export const browserTypeTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_type',
    description: 'Type text into an input field.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input element' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear the field before typing (default: true)' },
      },
      required: ['selector', 'text'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    try {
      await manager.type(
        args.selector as string,
        args.text as string,
        args.clear !== false,
      );
      return `Typed "${args.text}" into ${args.selector}\nStatus: Text entered successfully.`;
    } catch (err) {
      throw new Error(buildBrowserError('browser_type', args.selector as string, undefined, err as Error));
    }
  },
};

export const browserPressKeyTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_press_key',
    description:
      'Press a keyboard key. Use this for Enter, Tab, Escape, arrow keys, and key combinations instead of browser_evaluate.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'Key to press. Examples: Enter, Tab, Escape, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Backspace, Delete, Home, End, PageUp, PageDown, Space, F1-F12. For combinations use + separator: Control+a, Shift+Tab, Meta+c, Alt+F4',
        },
      },
      required: ['key'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    await manager.press(args.key as string);
    const url = await manager.getUrl().catch(() => 'unknown');
    const title = await manager.getTitle().catch(() => 'unknown');
    return `Pressed key: ${args.key}\nCurrent URL: ${url}\nPage title: ${title}`;
  },
};

export const browserHoverTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_hover',
    description:
      'Hover over an element on the page. Useful for triggering dropdown menus, tooltips, and hover states.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector, text content, or test ID' },
        strategy: {
          type: 'string',
          description: 'Selector strategy: css, text, testId, role, label (default: css)',
        },
      },
      required: ['selector'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    try {
      await manager.hover(args.selector as string, args.strategy as string);
      return `Hovered over: ${args.selector}`;
    } catch (err) {
      throw new Error(buildBrowserError('browser_hover', args.selector as string, args.strategy as string, err as Error));
    }
  },
};

export const browserScreenshotTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to save screenshot' },
        full_page: { type: 'boolean', description: 'Capture full page (default: false)' },
      },
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const path = await manager.screenshot(args.path as string, args.full_page as boolean);
    return `Screenshot saved: ${path}`;
  },
};

export const browserInspectTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_inspect',
    description:
      'Inspect elements on the page matching a CSS selector. Returns structured info: tag, id, classes, attributes, text, data-testid, aria-label, role, placeholder, siblings, and parent info. Use this instead of browser_evaluate when discovering selectors for Page Object Models.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector to match elements. Examples: "input", "button", ".search-bar", "[data-testid]", "nav a", "form input[type=text]"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of elements to return (default: 10)',
        },
      },
      required: ['selector'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const results = await manager.inspectElements(
      args.selector as string,
      (args.max_results as number) || 10,
    );
    if (!Array.isArray(results) || results.length === 0) {
      return `No elements found matching: ${args.selector}`;
    }
    return `Found ${results.length} element(s) matching "${args.selector}":\n${JSON.stringify(results, null, 2)}`;
  },
};

export const browserEvaluateTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_evaluate',
    description: 'Execute raw JavaScript in the browser context. LAST RESORT — prefer dedicated tools: browser_click (click), browser_type (type), browser_press_key (keyboard), browser_get_text (read text), browser_hover (hover), browser_inspect (find elements/selectors). Only use evaluate for computed styles, complex calculations, or operations no other tool supports.',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['script'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const result = await manager.evaluate(args.script as string);
    return result;
  },
};

export const browserWaitTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_wait_for',
    description: 'Wait for an element to appear on the page.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        state: {
          type: 'string',
          description: 'State to wait for: visible, hidden, attached (default: visible)',
        },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['selector'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    try {
      await manager.waitFor(
        args.selector as string,
        (args.state as string) || 'visible',
        (args.timeout as number) || 30000,
      );
      return `Element found and ${(args.state as string) || 'visible'}: ${args.selector}`;
    } catch (err) {
      throw new Error(buildBrowserError('browser_wait_for', args.selector as string, undefined, err as Error));
    }
  },
};

export const browserGetTextTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_get_text',
    description: 'Get the text content of an element or the entire page.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector (if omitted, returns full page text)',
        },
      },
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const text = await manager.getText(args.selector as string);
    return text;
  },
};

export const browserGetUrlTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_get_url',
    description: 'Get the current page URL.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    return await manager.getUrl();
  },
};

export const browserSelectTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_select',
    description: 'Select an option from a dropdown/select element.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the select element' },
        value: { type: 'string', description: 'Option value or label to select' },
      },
      required: ['selector', 'value'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    try {
      await manager.select(args.selector as string, args.value as string);
      return `Selected "${args.value}" in ${args.selector}`;
    } catch (err) {
      throw new Error(buildBrowserError('browser_select', args.selector as string, undefined, err as Error));
    }
  },
};

export const browserCloseTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_close',
    description: 'Close the browser session.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    await manager.close();
    return 'Browser closed.';
  },
};

export const browserGetTitleTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_get_title',
    description: 'Get the title of the current page.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    return await manager.getTitle();
  },
};

// ── Tab/Window Management Tools ───────────────────────────────────────────────

export const browserListTabsTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_list_tabs',
    description:
      'List all open browser tabs/windows. Returns each tab\'s index, URL, title, and whether it is the active tab. Use browser_switch_tab to change the active tab.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const tabs = await manager.listTabs();
    if (tabs.length === 0) return 'No tabs open.';
    const lines = tabs.map((t: any) =>
      `[${t.index}]${t.active ? ' (active)' : ''} ${t.title || '(untitled)'} — ${t.url}`,
    );
    return `Open tabs (${tabs.length}):\n${lines.join('\n')}`;
  },
};

export const browserSwitchTabTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_switch_tab',
    description:
      'Switch the active browser tab by index. All subsequent browser actions will target this tab. Use browser_list_tabs to see available tabs. Resets frame context to main frame.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index to switch to (0-based)' },
      },
      required: ['index'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    manager.switchTab(args.index as number);
    const title = await manager.getTitle();
    const url = await manager.getUrl();
    return `Switched to tab ${args.index}.\nURL: ${url}\nTitle: ${title}`;
  },
};

export const browserNewTabTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_new_tab',
    description:
      'Open a new browser tab. Optionally navigate to a URL and switch to it.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to in the new tab' },
        switch_to: {
          type: 'boolean',
          description: 'Switch to the new tab (default: true)',
        },
      },
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const idx = await manager.newTab(
      args.url as string | undefined,
      args.switch_to !== false,
    );
    return `New tab opened (index: ${idx})${args.url ? `. Navigated to: ${args.url}` : ''}${args.switch_to !== false ? '. Switched to new tab.' : ''}`;
  },
};

export const browserCloseTabTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_close_tab',
    description:
      'Close a browser tab by index. If no index is given, closes the current active tab. Cannot close the last remaining tab.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index to close (default: active tab)' },
      },
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    await manager.closeTab(args.index as number | undefined);
    const tabs = await manager.listTabs();
    const active = tabs.find((t: any) => t.active);
    return `Tab closed. Active tab is now [${active?.index}]: ${active?.url}`;
  },
};

// ── Frame/IFrame Management Tools ─────────────────────────────────────────────

export const browserListFramesTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_list_frames',
    description:
      'List all frames (including iframes) on the current page. Returns each frame\'s index, name, URL, and whether it is the main frame. Use browser_switch_frame to interact with a specific frame.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');
    const frames = manager.listFrames();
    if (frames.length <= 1) return 'Only the main frame is present (no iframes).';
    const lines = frames.map((f: any) =>
      `[${f.index}]${f.isMainFrame ? ' (main)' : ''} ${f.name ? `name="${f.name}"` : '(unnamed)'} — ${f.url}`,
    );
    return `Frames on current page (${frames.length}):\n${lines.join('\n')}`;
  },
};

export const browserSwitchFrameTool: ToolRegistration = {
  category: 'browser',
  definition: {
    name: 'browser_switch_frame',
    description:
      'Switch interaction context to a specific frame/iframe. All subsequent interaction tools (click, type, getText, inspect, evaluate, etc.) will target this frame until you switch back. Pass "main" to return to the main frame, a frame name, a URL substring, or a numeric index.',
    parameters: {
      type: 'object',
      properties: {
        frame: {
          type: 'string',
          description:
            'Frame identifier: "main" for main frame, frame name, URL substring, or numeric index (as string)',
        },
      },
      required: ['frame'],
    },
  },
  handler: async (args, ctx) => {
    const manager = (ctx as any)._browserManager;
    if (!manager) throw new Error('No browser manager available');

    const frame = args.frame as string;

    if (frame === 'main' || frame === 'mainframe' || frame === 'top') {
      manager.switchToMainFrame();
      return 'Switched to main frame. All interactions will target the main page.';
    }

    // Try numeric index first
    const numIdx = parseInt(frame, 10);
    if (!isNaN(numIdx) && String(numIdx) === frame) {
      manager.switchToFrame(numIdx);
    } else {
      manager.switchToFrame(frame);
    }

    return `Switched to frame: "${frame}". All interactions will now target this frame.`;
  },
};

export const browserTools: ToolRegistration[] = [
  browserLaunchTool,
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserPressKeyTool,
  browserHoverTool,
  browserScreenshotTool,
  browserInspectTool,
  browserEvaluateTool,
  browserWaitTool,
  browserGetTextTool,
  browserGetUrlTool,
  browserSelectTool,
  browserCloseTool,
  browserGetTitleTool,
  // Tab/Window management
  browserListTabsTool,
  browserSwitchTabTool,
  browserNewTabTool,
  browserCloseTabTool,
  // Frame/IFrame management
  browserListFramesTool,
  browserSwitchFrameTool,
];

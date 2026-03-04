import { useRef, useCallback, useState, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { PanelRightClose, PanelRightOpen, Braces, Box, TestTube2, Footprints } from 'lucide-react';
import type { FileMetadata } from '../../api/types';
import { useChartTheme } from '../../hooks/useChartTheme';

const STORAGE_KEY = 'qabot_outline_visible';

const languageMap: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  csharp: 'csharp',
  ruby: 'ruby',
  gherkin: 'plaintext',
  robot: 'plaintext',
  json: 'json',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  markdown: 'markdown',
  shell: 'shell',
  sql: 'sql',
};

/**
 * Find the 1-based line number of a symbol in file content.
 */
function findSymbolLine(content: string, symbol: string, type: 'class' | 'method'): number | null {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (type === 'class') {
      const classPattern = new RegExp(`\\bclass\\s+${escapeRegExp(symbol)}\\b`);
      if (classPattern.test(line)) return i + 1;
    }

    if (type === 'method') {
      const methodPatterns = [
        new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`),
        new RegExp(`\\bdef\\s+${escapeRegExp(symbol)}\\b`),
        new RegExp(`\\bfunction\\s+${escapeRegExp(symbol)}\\s*\\(`),
      ];
      if (methodPatterns.some(p => p.test(line))) return i + 1;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(symbol)) return i + 1;
  }

  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STEP_COLORS: Record<string, string> = {
  Given: 'text-sky-300',
  When: 'text-amber-300',
  Then: 'text-emerald-300',
  And: 'text-gray-300',
  But: 'text-rose-300',
};

interface CodeViewerProps {
  content: string;
  metadata: FileMetadata;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
  onEditorReady?: (editor: any) => void;
  /** Step definition patterns to display in the outline panel */
  steps?: string[];
  /** Callback when a step is clicked */
  onStepClick?: (step: string) => void;
}

export function CodeViewer({
  content, metadata, onChange, readOnly = true, onEditorReady,
  steps, onStepClick,
}: CodeViewerProps) {
  const ct = useChartTheme();
  const lang = languageMap[metadata.language] ?? 'plaintext';
  const editorRef = useRef<any>(null);

  const classCount = metadata.metadata?.classes?.length ?? 0;
  const methodCount = metadata.metadata?.methods?.length ?? 0;
  const testCount = metadata.metadata?.testCount ?? 0;
  const stepCount = steps?.length ?? 0;

  const hasOutline = !!(classCount || methodCount || stepCount);

  const [outlineVisible, setOutlineVisible] = useState(() => {
    if (!hasOutline) return false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === '1';
    } catch { return true; }
  });

  // Re-evaluate visibility when hasOutline changes (e.g. switching files)
  useEffect(() => {
    if (hasOutline && outlineVisible === false) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === null || stored === '1') setOutlineVisible(true);
      } catch {}
    }
  }, [hasOutline]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hasOutline) {
      try { localStorage.setItem(STORAGE_KEY, outlineVisible ? '1' : '0'); } catch {}
    }
  }, [outlineVisible, hasOutline]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    onEditorReady?.(editor);
  }, [onEditorReady]);

  const highlightLine = useCallback((line: number) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();

    const decorations = editor.deltaDecorations([], [{
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: 'symbol-highlight-line',
        overviewRuler: { color: '#7c3aed', position: 1 },
      },
    }]);
    setTimeout(() => {
      editor.deltaDecorations(decorations, []);
    }, 1500);
  }, []);

  const navigateToSymbol = useCallback((symbol: string, type: 'class' | 'method') => {
    const line = findSymbolLine(content, symbol, type);
    if (line) highlightLine(line);
  }, [content, highlightLine]);

  const totalItems = classCount + methodCount + stepCount;

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0">
        <Editor
          height="100%"
          language={lang}
          value={content}
          onChange={onChange}
          onMount={handleEditorMount}
          theme={ct.monacoTheme}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            padding: { top: 12 },
            renderLineHighlight: 'gutter',
          }}
        />
      </div>

      {/* ── Unified outline panel — collapsible ──────────── */}
      {hasOutline && (
        <>
          {outlineVisible ? (
            <div className="w-52 border-l border-white/5 bg-surface-1 flex flex-col flex-shrink-0
              animate-[slideInRight_150ms_ease-out]">
              {/* Header */}
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 flex-shrink-0">
                <Braces size={12} className="text-gray-500" />
                <span className="text-[10px] uppercase font-semibold text-gray-500 flex-1 tracking-wider">
                  Outline
                </span>
                <button
                  onClick={() => setOutlineVisible(false)}
                  className="p-0.5 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
                  title="Hide outline panel"
                >
                  <PanelRightClose size={14} />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-3 pt-2">
                {/* Classes */}
                {metadata.metadata?.classes && classCount > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Box size={11} className="text-brand-400" />
                      <h4 className="text-[10px] uppercase font-semibold text-gray-500">Classes</h4>
                      <span className="text-[9px] text-gray-600 ml-auto">{classCount}</span>
                    </div>
                    {metadata.metadata.classes.map((c) => (
                      <button
                        key={c}
                        onClick={() => navigateToSymbol(c, 'class')}
                        className="block w-full text-left text-xs text-brand-300 py-1 px-1.5 -mx-1.5 rounded
                          hover:bg-brand-500/10 hover:text-brand-200 transition-colors truncate cursor-pointer"
                        title={`Go to class ${c}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Methods */}
                {metadata.metadata?.methods && methodCount > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Braces size={11} className="text-amber-400" />
                      <h4 className="text-[10px] uppercase font-semibold text-gray-500">Methods</h4>
                      <span className="text-[9px] text-gray-600 ml-auto">{methodCount}</span>
                    </div>
                    {metadata.metadata.methods.map((m) => (
                      <button
                        key={m}
                        onClick={() => navigateToSymbol(m, 'method')}
                        className="block w-full text-left text-xs text-gray-300 py-1 px-1.5 -mx-1.5 rounded font-mono
                          hover:bg-white/5 hover:text-gray-100 transition-colors truncate cursor-pointer"
                        title={`Go to ${m}()`}
                      >
                        {m}()
                      </button>
                    ))}
                  </div>
                )}

                {/* Step definitions */}
                {steps && stepCount > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Footprints size={11} className="text-emerald-400" />
                      <h4 className="text-[10px] uppercase font-semibold text-gray-500">Steps</h4>
                      <span className="text-[9px] text-gray-600 ml-auto">{stepCount}</span>
                    </div>
                    {steps.map((step, i) => {
                      const keyword = step.match(/^(Given|When|Then|And|But)/)?.[1];
                      const color = STEP_COLORS[keyword ?? ''] ?? 'text-gray-300';
                      return (
                        <button
                          key={i}
                          onClick={() => onStepClick?.(step)}
                          className={`block w-full text-left text-xs py-1 px-1.5 -mx-1.5 rounded truncate
                            transition-colors cursor-pointer ${color} hover:bg-white/5 hover:brightness-125`}
                          title={`Go to: ${step}`}
                        >
                          {step}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Test count */}
                {testCount > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <TestTube2 size={11} className="text-emerald-400" />
                      <h4 className="text-[10px] uppercase font-semibold text-gray-500">Tests</h4>
                    </div>
                    <div className="text-xs text-emerald-300 px-1.5">{testCount} test(s)</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── Collapsed strip ───────────────────────────── */
            <button
              onClick={() => setOutlineVisible(true)}
              className="w-7 border-l border-white/5 bg-surface-1 flex flex-col items-center justify-center
                gap-2 flex-shrink-0 hover:bg-white/[0.03] transition-colors group cursor-pointer"
              title="Show outline panel"
            >
              <PanelRightOpen size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
              <span className="text-[10px] font-medium text-gray-600 group-hover:text-gray-400 transition-colors
                [writing-mode:vertical-lr] tracking-wider select-none">
                OUTLINE
              </span>
              {totalItems > 0 && (
                <span className="text-[9px] text-gray-600 bg-surface-2 rounded-full px-1 min-w-[16px] text-center">
                  {totalItems}
                </span>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}

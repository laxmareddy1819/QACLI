import { useState, useRef, useEffect } from 'react';
import { Eye, Code, Maximize2, Minimize2 } from 'lucide-react';
import Editor from '@monaco-editor/react';
import type { FileMetadata } from '../../api/types';
import { useChartTheme } from '../../hooks/useChartTheme';

interface HtmlViewerProps {
  content: string;
  metadata: FileMetadata;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
}

/**
 * HTML file viewer with two modes:
 * - Preview: renders the HTML in a sandboxed iframe (default)
 * - Code: shows syntax-highlighted source in Monaco Editor
 */
export function HtmlViewer({ content, metadata, onChange, readOnly = true }: HtmlViewerProps) {
  const ct = useChartTheme();
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Write content to iframe on mount and content change
  useEffect(() => {
    if (mode === 'preview' && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(content);
        doc.close();
      }
    }
  }, [content, mode]);

  return (
    <div className={`h-full flex flex-col ${expanded ? 'fixed inset-0 z-50 bg-surface-0' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <button
          onClick={() => setMode('preview')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            mode === 'preview'
              ? 'bg-brand-500/15 text-brand-300'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <Eye size={12} />
          Preview
        </button>
        <button
          onClick={() => setMode('code')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            mode === 'code'
              ? 'bg-brand-500/15 text-brand-300'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <Code size={12} />
          Code
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          title={expanded ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {mode === 'preview' ? (
          <iframe
            ref={iframeRef}
            title="HTML Preview"
            className="w-full h-full border-0 bg-white"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
        ) : (
          <Editor
            height="100%"
            language="html"
            value={content}
            onChange={onChange}
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
        )}
      </div>
    </div>
  );
}

import { useRef, useEffect, useState } from 'react';
import { Copy, Check, Save, FileCode } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useChartTheme } from '../../hooks/useChartTheme';

interface ConfigPreviewProps {
  content: string;
  fileName: string;
  filePath: string;
  onChange: (content: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}

export function ConfigPreview({ content, fileName, filePath, onChange, onSave, saving, saved }: ConfigPreviewProps) {
  const ct = useChartTheme();
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Determine language for Monaco
  const language = fileName.endsWith('.yml') || fileName.endsWith('.yaml')
    ? 'yaml'
    : fileName === 'Jenkinsfile'
    ? 'groovy'
    : 'yaml';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-surface-1">
        <div className="flex items-center gap-2">
          <FileCode size={14} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-200">{fileName}</span>
          <span className="text-[11px] text-gray-500">{filePath}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 transition-colors"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all
              ${saved
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-brand-500 text-white hover:bg-brand-600'
              }
              ${saving ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            {saved ? <Check size={12} /> : <Save size={12} />}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save to Project'}
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={(v) => onChange(v ?? '')}
          theme={ct.monacoTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            readOnly: false,
            automaticLayout: true,
            padding: { top: 12 },
          }}
        />
      </div>
    </div>
  );
}

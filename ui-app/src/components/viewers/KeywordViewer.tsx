interface KeywordViewerProps {
  content: string;
  keywords?: string[];
}

export function KeywordViewer({ content, keywords }: KeywordViewerProps) {
  const lines = content.split('\n');

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        {lines.map((line, i) => {
          const trimmed = line.trimStart();
          let className = 'text-gray-300';

          if (trimmed.startsWith('***')) className = 'text-brand-300 font-bold';
          else if (trimmed.startsWith('[') && trimmed.includes(']')) className = 'text-amber-300';
          else if (trimmed.startsWith('#')) className = 'text-gray-500 italic';
          else if (trimmed.startsWith('$') || trimmed.startsWith('@')) className = 'text-sky-300';
          else if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.length > 0 && !trimmed.startsWith('*'))
            className = 'text-emerald-300 font-medium';

          return (
            <div key={i} className="flex">
              <span className="w-10 text-right text-gray-600 pr-3 select-none flex-shrink-0 text-xs leading-6">
                {i + 1}
              </span>
              <pre className={`${className} leading-6 whitespace-pre`}>{line}</pre>
            </div>
          );
        })}
      </div>

      {/* Keywords sidebar */}
      {keywords && keywords.length > 0 && (
        <div className="w-48 border-l border-white/5 bg-surface-1 overflow-y-auto p-3 flex-shrink-0">
          <h4 className="text-[10px] uppercase font-semibold text-gray-500 mb-2">Keywords</h4>
          {keywords.map((kw) => (
            <div key={kw} className="text-xs text-emerald-300 py-0.5 truncate">{kw}</div>
          ))}
        </div>
      )}
    </div>
  );
}

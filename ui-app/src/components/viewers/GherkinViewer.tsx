interface GherkinViewerProps {
  content: string;
}

export function GherkinViewer({ content }: GherkinViewerProps) {
  const lines = content.split('\n');

  return (
    <div className="h-full overflow-auto p-4 font-mono text-sm">
      {lines.map((line, i) => {
        const trimmed = line.trimStart();
        let className = 'text-gray-300';

        if (trimmed.startsWith('Feature:')) className = 'text-brand-300 font-bold text-base';
        else if (trimmed.startsWith('Scenario:') || trimmed.startsWith('Scenario Outline:'))
          className = 'text-amber-300 font-semibold mt-3';
        else if (trimmed.startsWith('Background:')) className = 'text-violet-300 font-semibold mt-3';
        else if (/^(Given|When|Then|And|But)\b/.test(trimmed)) className = 'text-emerald-300';
        else if (trimmed.startsWith('@')) className = 'text-sky-400 text-xs';
        else if (trimmed.startsWith('|')) className = 'text-cyan-300/80';
        else if (trimmed.startsWith('#')) className = 'text-gray-500 italic';
        else if (trimmed.startsWith('Examples:')) className = 'text-rose-300 font-medium mt-2';

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
  );
}

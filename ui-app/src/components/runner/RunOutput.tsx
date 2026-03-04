import { useEffect, useRef, useMemo } from 'react';
import { parseAnsi, segmentToStyle } from '../../utils/ansiToHtml';

interface RunOutputProps {
  output: Array<{ stream: 'stdout' | 'stderr'; data: string }>;
}

/**
 * Combines raw output chunks into proper lines split by newline.
 * This ensures ANSI escape sequences that span chunk boundaries are
 * preserved correctly — we first concatenate all chunks per stream,
 * then split by `\n` for line-by-line rendering.
 */
function combineIntoLines(
  output: Array<{ stream: 'stdout' | 'stderr'; data: string }>,
): Array<{ stream: 'stdout' | 'stderr'; data: string }> {
  const lines: Array<{ stream: 'stdout' | 'stderr'; data: string }> = [];
  let buffer = '';
  let currentStream: 'stdout' | 'stderr' = 'stdout';

  for (const chunk of output) {
    // When stream type changes, flush buffer first
    if (chunk.stream !== currentStream && buffer) {
      const parts = buffer.split('\n');
      for (const part of parts) {
        if (part) lines.push({ stream: currentStream, data: part });
      }
      buffer = '';
    }
    currentStream = chunk.stream;
    buffer += chunk.data;
  }

  // Flush remaining buffer
  if (buffer) {
    const parts = buffer.split('\n');
    for (const part of parts) {
      if (part) lines.push({ stream: currentStream, data: part });
    }
  }

  return lines;
}

export function RunOutput({ output }: RunOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  // Combine chunks into proper lines (handles ANSI codes across chunk boundaries)
  const lines = useMemo(() => combineIntoLines(output), [output]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-black/40 rounded-lg p-4 font-mono text-xs leading-5"
    >
      {lines.length === 0 && (
        <span className="text-gray-600">Waiting for output...</span>
      )}
      {lines.map((line, i) => (
        <AnsiLine key={i} data={line.data} stream={line.stream} />
      ))}
    </div>
  );
}

/** Renders a single output line with ANSI escape codes converted to styled spans. */
function AnsiLine({ data, stream }: { data: string; stream: 'stdout' | 'stderr' }) {
  const segments = useMemo(() => parseAnsi(data), [data]);
  const baseClass = stream === 'stderr' ? 'text-red-400' : 'text-gray-200';

  // Fast path: no ANSI codes found — render plain text
  if (segments.length <= 1 && !segments[0]?.style.color && !segments[0]?.style.bold && !segments[0]?.style.dim) {
    return <div className={baseClass}>{data}</div>;
  }

  return (
    <div className={baseClass}>
      {segments.map((seg, j) => {
        const style = segmentToStyle(seg.style);
        const hasStyle = Object.keys(style).length > 0;
        return hasStyle
          ? <span key={j} style={style}>{seg.text}</span>
          : <span key={j}>{seg.text}</span>;
      })}
    </div>
  );
}

import { useState, useCallback } from 'react';

export function useExpandedPaths() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback((paths: string[]) => {
    setExpanded(new Set(paths));
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return { expanded, toggle, expandAll, collapseAll };
}

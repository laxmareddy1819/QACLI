import { useState, useEffect } from 'react';

export interface ChartTheme {
  gridStroke: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipLabelColor: string;
  tooltipItemColor: string;
  axisFill: string;
  monacoTheme: 'vs' | 'vs-dark';
}

const darkTheme: ChartTheme = {
  gridStroke: '#1e293b',
  tooltipBackground: '#1e2030',
  tooltipBorder: '1px solid #334155',
  tooltipLabelColor: '#94a3b8',
  tooltipItemColor: '#e5e7eb',
  axisFill: '#64748b',
  monacoTheme: 'vs-dark',
};

const lightTheme: ChartTheme = {
  gridStroke: '#e2e8f0',
  tooltipBackground: '#ffffff',
  tooltipBorder: '1px solid #e2e8f0',
  tooltipLabelColor: '#475569',
  tooltipItemColor: '#1e293b',
  axisFill: '#64748b',
  monacoTheme: 'vs',
};

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(
    document.documentElement.classList.contains('light') ? lightTheme : darkTheme,
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isLight = document.documentElement.classList.contains('light');
      setTheme(isLight ? lightTheme : darkTheme);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

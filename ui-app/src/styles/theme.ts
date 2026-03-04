export function getTheme(): 'dark' | 'light' {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

export function toggleTheme(): void {
  const html = document.documentElement;
  const next = html.classList.contains('light') ? 'dark' : 'light';
  html.classList.remove('dark', 'light');
  html.classList.add(next);
  localStorage.setItem('qabot-theme', next);
}

export function initTheme(): void {
  const saved = localStorage.getItem('qabot-theme') as 'dark' | 'light' | null;
  const theme = saved ?? 'dark';
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.classList.add(theme);
}

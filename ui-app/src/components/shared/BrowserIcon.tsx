import { Globe } from 'lucide-react';

interface BrowserIconProps {
  browser?: string;
  size?: number;
  showLabel?: boolean;
}

/**
 * Renders a browser icon with optional label.
 * Supports Chrome, Firefox, Safari, and Edge with distinctive inline SVGs.
 * Falls back to Globe icon for unknown browsers.
 * Returns null when browser is undefined (graceful for non-browser tests).
 */
export function BrowserIcon({ browser, size = 14, showLabel = false }: BrowserIconProps) {
  if (!browser) return null;

  const lower = browser.toLowerCase();
  const icon = getBrowserIcon(lower, size);
  const color = getBrowserColor(lower);

  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      <span className={color}>{icon}</span>
      {showLabel && <span className="text-[11px] text-gray-400">{browser}</span>}
    </span>
  );
}

function getBrowserIcon(browser: string, size: number) {
  if (browser.includes('chrome') || browser.includes('chromium')) {
    return <ChromeIcon size={size} />;
  }
  if (browser.includes('firefox')) {
    return <FirefoxIcon size={size} />;
  }
  if (browser.includes('safari') || browser.includes('webkit')) {
    return <SafariIcon size={size} />;
  }
  if (browser.includes('edge')) {
    return <EdgeIcon size={size} />;
  }
  return <Globe size={size} />;
}

function getBrowserColor(browser: string): string {
  if (browser.includes('chrome') || browser.includes('chromium')) return 'text-blue-400';
  if (browser.includes('firefox')) return 'text-orange-400';
  if (browser.includes('safari') || browser.includes('webkit')) return 'text-sky-300';
  if (browser.includes('edge')) return 'text-cyan-400';
  return 'text-gray-500';
}

// ── Inline SVG Icons ────────────────────────────────────────────────────────

function ChromeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="8" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <line x1="8.5" y1="13.5" x2="3.5" y2="18" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <line x1="15.5" y1="13.5" x2="20.5" y2="18" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
    </svg>
  );
}

function FirefoxIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M12 4C8.5 4 6 6.5 6 10c0 1.5.5 3 1.5 4l1-2c-.3-.6-.5-1.3-.5-2 0-2.2 1.8-4 4-4 1 0 2 .4 2.7 1l1.5-1.5C15 4.5 13.5 4 12 4z" fill="currentColor" opacity="0.7" />
      <path d="M17 8c.6 1.2 1 2.5 1 4 0 3.3-2.7 6-6 6s-6-2.7-6-6c0-.3 0-.6.1-.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SafariIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      {/* Compass needle */}
      <path d="M10 14l-2 5 5-2 2-5-5 2z" fill="currentColor" opacity="0.5" />
      <path d="M14 10l2-5-5 2-2 5 5-2z" fill="currentColor" opacity="0.8" />
      {/* Cardinal marks */}
      <line x1="12" y1="2" x2="12" y2="4" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="12" y1="20" x2="12" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="2" y1="12" x2="4" y2="12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="20" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function EdgeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M7 12c0-2.8 2.2-5 5-5 1.4 0 2.6.6 3.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 12c0 2.8-2.2 5-5 5-1.8 0-3.4-1-4.2-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15" cy="14" r="2.5" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}

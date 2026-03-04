/** Shared utility for building JSONPath expressions and formatting JSON values */

export function computeJsonPath(parentPath: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${parentPath}[${key}]`;
  }
  // If key contains dots or special chars, use bracket notation
  if (/[.\s\-\[\]]/.test(key)) {
    return `${parentPath}["${key}"]`;
  }
  return parentPath ? `${parentPath}.${key}` : `$.${key}`;
}

export function getValueDisplay(value: unknown): { text: string; color: string } {
  if (value === null) return { text: 'null', color: 'text-gray-500' };
  if (value === undefined) return { text: 'undefined', color: 'text-gray-500' };
  if (typeof value === 'boolean') return { text: String(value), color: 'text-blue-400' };
  if (typeof value === 'number') return { text: String(value), color: 'text-amber-400' };
  if (typeof value === 'string') {
    const display = value.length > 60 ? `"${value.slice(0, 57)}..."` : `"${value}"`;
    return { text: display, color: 'text-emerald-400' };
  }
  if (Array.isArray(value)) return { text: `Array(${value.length})`, color: 'text-purple-400' };
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return { text: `Object{${keys.length}}`, color: 'text-purple-400' };
  }
  return { text: String(value), color: 'text-gray-400' };
}

export function isLeafValue(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

/** Auto-detect the best operator for a value type */
export function suggestOperator(value: unknown): string {
  if (value === null || value === undefined) return 'exists';
  if (typeof value === 'boolean') return 'equals';
  if (typeof value === 'number') return 'equals';
  if (typeof value === 'string') return value.length > 50 ? 'contains' : 'equals';
  return 'exists';
}

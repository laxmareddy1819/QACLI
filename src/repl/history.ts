import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../utils/index.js';

const MAX_HISTORY = 1000;

export class History {
  private entries: string[] = [];
  private position = -1;
  private filePath: string;

  constructor() {
    const dir = getQabotDir();
    this.filePath = join(dir, 'history.json');
    this.load();
  }

  add(entry: string): void {
    const trimmed = entry.trim();
    if (!trimmed) return;

    // Deduplicate last entry
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      return;
    }

    this.entries.push(trimmed);

    // Trim to max size
    if (this.entries.length > MAX_HISTORY) {
      this.entries = this.entries.slice(-MAX_HISTORY);
    }

    this.position = this.entries.length;
    this.save();
  }

  previous(): string | undefined {
    if (this.position > 0) {
      this.position--;
      return this.entries[this.position];
    }
    return undefined;
  }

  next(): string | undefined {
    if (this.position < this.entries.length - 1) {
      this.position++;
      return this.entries[this.position];
    }
    this.position = this.entries.length;
    return '';
  }

  search(query: string): string[] {
    const lower = query.toLowerCase();
    return this.entries
      .filter((e) => e.toLowerCase().includes(lower))
      .reverse()
      .slice(0, 20);
  }

  getRecent(count = 10): string[] {
    return this.entries.slice(-count).reverse();
  }

  getAll(): string[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.position = -1;
    this.save();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8');
        this.entries = JSON.parse(data);
        this.position = this.entries.length;
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      const dir = getQabotDir();
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf-8');
    } catch {
      // Silently ignore save failures
    }
  }
}

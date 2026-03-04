import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  outDir: 'dist',
  splitting: false,
  external: ['playwright-core', 'better-sqlite3', 'express', 'ws', 'chokidar', 'open', 'multer', 'pdf-parse', 'mammoth', 'xlsx', 'csv-parse'],
});

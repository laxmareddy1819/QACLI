import type { Express, Request } from 'express';
import { audit } from './audit-helper.js';
import multer from 'multer';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';

// ── Temp upload directory ────────────────────────────────────────────────────
// Create a temp directory for uploads that gets cleaned up periodically

const uploadDir = mkdtempSync(join(tmpdir(), 'qabot-uploads-'));

// Clean up uploaded files older than 30 minutes
setInterval(() => {
  try {
    if (!existsSync(uploadDir)) return;
    const now = Date.now();
    for (const file of readdirSync(uploadDir)) {
      const fp = join(uploadDir, file);
      try {
        const stat = statSync(fp);
        if (now - stat.mtimeMs > 30 * 60 * 1000) {
          unlinkSync(fp);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}, 10 * 60 * 1000); // every 10 minutes

// ── Multer config ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = extname(file.originalname);
    cb(null, `upload-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text & code
      'text/plain',
      'text/csv',
      'text/html',
      'text/markdown',
      'text/xml',
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
      // Images
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
    ];
    // Also accept by extension for less common MIME types
    const allowedExts = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.csv', '.html', '.htm', '.md', '.xml', '.json',
      '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.rb', '.go', '.rs',
      '.feature', '.gherkin', '.yaml', '.yml', '.toml', '.ini', '.cfg',
      '.spec.ts', '.test.ts', '.spec.js', '.test.js',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
    ];
    const ext = extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype} (${ext})`));
    }
  },
});

// ── File parsing functions ───────────────────────────────────────────────────

interface ParsedFile {
  id: string;
  originalName: string;
  type: 'pdf' | 'word' | 'excel' | 'csv' | 'text' | 'image' | 'code' | 'unknown';
  mimeType: string;
  size: number;
  content: string;          // Extracted text content (or base64 for images)
  isImage: boolean;
  metadata?: Record<string, unknown>;
}

async function parseUploadedFile(filePath: string, originalName: string, mimeType: string): Promise<ParsedFile> {
  const ext = extname(originalName).toLowerCase();
  const fileSize = (await readFile(filePath)).length;
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const base: Omit<ParsedFile, 'content' | 'type' | 'isImage'> = {
    id,
    originalName,
    mimeType,
    size: fileSize,
  };

  // ── Images → base64
  if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    const buffer = await readFile(filePath);
    return {
      ...base,
      type: 'image',
      isImage: true,
      content: buffer.toString('base64'),
      metadata: { width: undefined, height: undefined },
    };
  }

  // ── PDF
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = await readFile(filePath);
      const data = await pdfParse(buffer);
      return {
        ...base,
        type: 'pdf',
        isImage: false,
        content: data.text,
        metadata: { pages: data.numpages, info: data.info },
      };
    } catch (err) {
      return { ...base, type: 'pdf', isImage: false, content: `[PDF parsing failed: ${err}]` };
    }
  }

  // ── Word documents (.docx)
  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return {
        ...base,
        type: 'word',
        isImage: false,
        content: result.value,
        metadata: { messages: result.messages },
      };
    } catch (err) {
      return { ...base, type: 'word', isImage: false, content: `[Word parsing failed: ${err}]` };
    }
  }

  // ── Old Word (.doc) — mammoth doesn't support .doc, read as binary note
  if (ext === '.doc' || mimeType === 'application/msword') {
    return {
      ...base,
      type: 'word',
      isImage: false,
      content: '[.doc format not supported — please convert to .docx for text extraction]',
    };
  }

  // ── Excel (.xlsx, .xls)
  if (['.xlsx', '.xls'].includes(ext) || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheets: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]!;
        const csv = XLSX.utils.sheet_to_csv(sheet);
        sheets.push(`## Sheet: ${sheetName}\n\n${csv}`);
      }
      return {
        ...base,
        type: 'excel',
        isImage: false,
        content: sheets.join('\n\n---\n\n'),
        metadata: { sheetNames: workbook.SheetNames, sheetCount: workbook.SheetNames.length },
      };
    } catch (err) {
      return { ...base, type: 'excel', isImage: false, content: `[Excel parsing failed: ${err}]` };
    }
  }

  // ── CSV
  if (ext === '.csv' || mimeType === 'text/csv') {
    try {
      const text = await readFile(filePath, 'utf-8');
      return { ...base, type: 'csv', isImage: false, content: text };
    } catch (err) {
      return { ...base, type: 'csv', isImage: false, content: `[CSV read failed: ${err}]` };
    }
  }

  // ── Code / text files
  const textExts = [
    '.txt', '.md', '.html', '.htm', '.xml', '.json', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.rb', '.go', '.rs',
    '.feature', '.gherkin', '.toml', '.ini', '.cfg', '.sh', '.bat',
    '.spec.ts', '.test.ts', '.spec.js', '.test.js', '.css', '.scss',
  ];
  if (textExts.some(e => originalName.toLowerCase().endsWith(e)) || mimeType.startsWith('text/')) {
    try {
      const text = await readFile(filePath, 'utf-8');
      const isCode = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.rb', '.go', '.rs',
        '.feature', '.gherkin', '.sh', '.bat', '.css', '.scss'].some(e => ext === e);
      return {
        ...base,
        type: isCode ? 'code' : 'text',
        isImage: false,
        content: text,
      };
    } catch (err) {
      return { ...base, type: 'text', isImage: false, content: `[Text read failed: ${err}]` };
    }
  }

  // ── Unknown type — try reading as text
  try {
    const text = await readFile(filePath, 'utf-8');
    return { ...base, type: 'unknown', isImage: false, content: text };
  } catch {
    return { ...base, type: 'unknown', isImage: false, content: '[Unable to extract content from this file type]' };
  }
}

// ── Uploaded files store (in-memory, keyed by id) ────────────────────────────

const uploadedFiles = new Map<string, ParsedFile>();

// Auto-clean entries older than 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, file] of uploadedFiles) {
    const timestamp = parseInt(id.split('-')[1] || '0', 10);
    if (now - timestamp > 60 * 60 * 1000) {
      uploadedFiles.delete(id);
    }
  }
}, 15 * 60 * 1000);

// ── Mount routes ─────────────────────────────────────────────────────────────

export function mountUploadRoutes(app: Express): void {

  // POST /api/upload — Upload one or more files, parse them, return metadata
  app.post('/api/upload', upload.array('files', 10), async (req: Request, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
      }

      const parsed: ParsedFile[] = [];
      for (const file of files) {
        try {
          const result = await parseUploadedFile(file.path, file.originalname, file.mimetype);
          uploadedFiles.set(result.id, result);
          parsed.push(result);
        } catch (err) {
          parsed.push({
            id: `file-${Date.now()}-err`,
            originalName: file.originalname,
            type: 'unknown',
            mimeType: file.mimetype,
            size: file.size,
            content: `[Parse error: ${err}]`,
            isImage: false,
          });
        } finally {
          // Clean up temp file
          try { unlinkSync(file.path); } catch { /* ignore */ }
        }
      }

      // Return parsed files — omit full content for large files, include for images (base64 needed)
      const response = parsed.map(f => ({
        id: f.id,
        originalName: f.originalName,
        type: f.type,
        mimeType: f.mimeType,
        size: f.size,
        isImage: f.isImage,
        preview: f.isImage
          ? f.content.slice(0, 100)  // Tiny preview hint for images
          : f.content.slice(0, 500), // Text preview
        contentLength: f.content.length,
        metadata: f.metadata,
      }));

      audit(req, 'file.upload', { resourceType: 'upload', details: { fileCount: parsed.length, fileNames: parsed.map(f => f.originalName) } });
      res.json({ files: response });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/upload/:id — Get full parsed content of an uploaded file
  app.get('/api/upload/:id', (req, res) => {
    const file = uploadedFiles.get(req.params.id!);
    if (!file) {
      res.status(404).json({ error: 'File not found or expired' });
      return;
    }
    res.json(file);
  });

  // DELETE /api/upload/:id — Remove an uploaded file from memory
  app.delete('/api/upload/:id', (req, res) => {
    const deleted = uploadedFiles.delete(req.params.id!);
    res.json({ deleted });
  });
}

// ── Export for use in chat prompt building ────────────────────────────────────

export function getUploadedFile(id: string): ParsedFile | undefined {
  return uploadedFiles.get(id);
}

export type { ParsedFile };

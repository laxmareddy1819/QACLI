import {
  FileCode2, FileJson, FileText, FileType, File,
  Leaf, Coffee, Globe, Palette, BookOpen, Image,
  Settings, Database, Terminal, Braces, Hash,
  Shield, Lock, Cog, Package,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface FileIconResult {
  icon: ReactNode;
  color: string;
}

const SIZE = 14;

const EXT_MAP: Record<string, FileIconResult> = {
  // TypeScript
  '.ts':    { icon: <FileCode2 size={SIZE} />, color: 'text-blue-400' },
  '.tsx':   { icon: <FileCode2 size={SIZE} />, color: 'text-blue-400' },
  '.d.ts':  { icon: <FileCode2 size={SIZE} />, color: 'text-blue-300' },

  // JavaScript
  '.js':    { icon: <FileCode2 size={SIZE} />, color: 'text-yellow-400' },
  '.jsx':   { icon: <FileCode2 size={SIZE} />, color: 'text-yellow-400' },
  '.mjs':   { icon: <FileCode2 size={SIZE} />, color: 'text-yellow-400' },
  '.cjs':   { icon: <FileCode2 size={SIZE} />, color: 'text-yellow-400' },

  // Python
  '.py':    { icon: <FileCode2 size={SIZE} />, color: 'text-sky-400' },
  '.pyw':   { icon: <FileCode2 size={SIZE} />, color: 'text-sky-400' },

  // Java / Kotlin / Scala
  '.java':  { icon: <Coffee size={SIZE} />,    color: 'text-orange-400' },
  '.kt':    { icon: <Coffee size={SIZE} />,    color: 'text-purple-400' },
  '.scala': { icon: <Coffee size={SIZE} />,    color: 'text-red-400' },

  // C# / .NET
  '.cs':    { icon: <Hash size={SIZE} />,      color: 'text-green-400' },
  '.csproj':{ icon: <Settings size={SIZE} />,  color: 'text-green-300' },
  '.sln':   { icon: <Settings size={SIZE} />,  color: 'text-green-300' },

  // Ruby
  '.rb':    { icon: <FileCode2 size={SIZE} />, color: 'text-red-400' },

  // BDD / Gherkin
  '.feature': { icon: <Leaf size={SIZE} />,    color: 'text-emerald-400' },

  // Robot Framework
  '.robot': { icon: <Terminal size={SIZE} />,  color: 'text-teal-400' },

  // JSON / YAML / TOML
  '.json':  { icon: <Braces size={SIZE} />,    color: 'text-yellow-300' },
  '.jsonc': { icon: <Braces size={SIZE} />,    color: 'text-yellow-300' },
  '.yaml':  { icon: <FileText size={SIZE} />,  color: 'text-orange-300' },
  '.yml':   { icon: <FileText size={SIZE} />,  color: 'text-orange-300' },
  '.toml':  { icon: <FileText size={SIZE} />,  color: 'text-gray-400' },

  // HTML / XML
  '.html':  { icon: <Globe size={SIZE} />,     color: 'text-orange-400' },
  '.htm':   { icon: <Globe size={SIZE} />,     color: 'text-orange-400' },
  '.xml':   { icon: <Globe size={SIZE} />,     color: 'text-orange-300' },

  // CSS / Styling
  '.css':   { icon: <Palette size={SIZE} />,   color: 'text-blue-400' },
  '.scss':  { icon: <Palette size={SIZE} />,   color: 'text-pink-400' },
  '.sass':  { icon: <Palette size={SIZE} />,   color: 'text-pink-400' },
  '.less':  { icon: <Palette size={SIZE} />,   color: 'text-indigo-400' },

  // Markdown / Docs
  '.md':    { icon: <BookOpen size={SIZE} />,  color: 'text-gray-400' },
  '.mdx':   { icon: <BookOpen size={SIZE} />,  color: 'text-gray-400' },
  '.txt':   { icon: <FileText size={SIZE} />,  color: 'text-gray-400' },
  '.rst':   { icon: <FileText size={SIZE} />,  color: 'text-gray-400' },

  // Data
  '.csv':   { icon: <Database size={SIZE} />,  color: 'text-green-300' },
  '.sql':   { icon: <Database size={SIZE} />,  color: 'text-blue-300' },
  '.db':    { icon: <Database size={SIZE} />,  color: 'text-amber-400' },
  '.sqlite':{ icon: <Database size={SIZE} />,  color: 'text-amber-400' },

  // Images
  '.png':   { icon: <Image size={SIZE} />,     color: 'text-pink-300' },
  '.jpg':   { icon: <Image size={SIZE} />,     color: 'text-pink-300' },
  '.jpeg':  { icon: <Image size={SIZE} />,     color: 'text-pink-300' },
  '.gif':   { icon: <Image size={SIZE} />,     color: 'text-pink-300' },
  '.svg':   { icon: <Image size={SIZE} />,     color: 'text-amber-300' },
  '.webp':  { icon: <Image size={SIZE} />,     color: 'text-pink-300' },
  '.ico':   { icon: <Image size={SIZE} />,     color: 'text-pink-300' },

  // Config
  '.env':   { icon: <Lock size={SIZE} />,      color: 'text-yellow-500' },
  '.ini':   { icon: <Cog size={SIZE} />,       color: 'text-gray-400' },
  '.conf':  { icon: <Cog size={SIZE} />,       color: 'text-gray-400' },
  '.cfg':   { icon: <Cog size={SIZE} />,       color: 'text-gray-400' },
  '.properties': { icon: <Cog size={SIZE} />,  color: 'text-gray-400' },

  // Shell
  '.sh':    { icon: <Terminal size={SIZE} />,  color: 'text-green-400' },
  '.bash':  { icon: <Terminal size={SIZE} />,  color: 'text-green-400' },
  '.zsh':   { icon: <Terminal size={SIZE} />,  color: 'text-green-400' },
  '.bat':   { icon: <Terminal size={SIZE} />,  color: 'text-gray-400' },
  '.cmd':   { icon: <Terminal size={SIZE} />,  color: 'text-gray-400' },
  '.ps1':   { icon: <Terminal size={SIZE} />,  color: 'text-blue-300' },

  // Package
  '.zip':   { icon: <Package size={SIZE} />,   color: 'text-amber-400' },
  '.tar':   { icon: <Package size={SIZE} />,   color: 'text-amber-400' },
  '.gz':    { icon: <Package size={SIZE} />,   color: 'text-amber-400' },

  // Lock / Security
  '.pem':   { icon: <Shield size={SIZE} />,    color: 'text-red-300' },
  '.key':   { icon: <Shield size={SIZE} />,    color: 'text-red-300' },
  '.cert':  { icon: <Shield size={SIZE} />,    color: 'text-red-300' },
};

// Special full filenames
const NAME_MAP: Record<string, FileIconResult> = {
  'package.json':      { icon: <Package size={SIZE} />,  color: 'text-green-400' },
  'package-lock.json': { icon: <Package size={SIZE} />,  color: 'text-green-300' },
  'pnpm-lock.yaml':    { icon: <Package size={SIZE} />,  color: 'text-amber-400' },
  'yarn.lock':         { icon: <Package size={SIZE} />,  color: 'text-blue-300' },
  'tsconfig.json':     { icon: <Settings size={SIZE} />, color: 'text-blue-400' },
  'vite.config.ts':    { icon: <Settings size={SIZE} />, color: 'text-purple-400' },
  'webpack.config.js': { icon: <Settings size={SIZE} />, color: 'text-blue-400' },
  '.gitignore':        { icon: <Settings size={SIZE} />, color: 'text-gray-500' },
  '.eslintrc.json':    { icon: <Settings size={SIZE} />, color: 'text-purple-400' },
  '.prettierrc':       { icon: <Settings size={SIZE} />, color: 'text-pink-300' },
  'Dockerfile':        { icon: <FileType size={SIZE} />, color: 'text-blue-400' },
  'docker-compose.yml':{ icon: <FileType size={SIZE} />, color: 'text-blue-400' },
  '.env':              { icon: <Lock size={SIZE} />,     color: 'text-yellow-500' },
  '.env.local':        { icon: <Lock size={SIZE} />,     color: 'text-yellow-500' },
  '.env.example':      { icon: <Lock size={SIZE} />,     color: 'text-yellow-400' },
  'Makefile':          { icon: <Terminal size={SIZE} />,  color: 'text-amber-400' },
  'Gemfile':           { icon: <FileText size={SIZE} />,  color: 'text-red-400' },
  'requirements.txt':  { icon: <FileText size={SIZE} />,  color: 'text-sky-400' },
  'pom.xml':           { icon: <Settings size={SIZE} />,  color: 'text-orange-400' },
  'build.gradle':      { icon: <Settings size={SIZE} />,  color: 'text-green-400' },
};

const DEFAULT_ICON: FileIconResult = {
  icon: <File size={SIZE} />,
  color: 'text-gray-500',
};

/**
 * Get a color-coded icon for a file based on its name/extension.
 * Checks full filename first (e.g. package.json), then extension.
 */
export function getFileIcon(filename: string): FileIconResult {
  const lower = filename.toLowerCase();

  // Check full filename first
  if (NAME_MAP[lower]) return NAME_MAP[lower];

  // Check for .env.* pattern
  if (lower.startsWith('.env')) return EXT_MAP['.env'] ?? DEFAULT_ICON;

  // Check for .d.ts
  if (lower.endsWith('.d.ts')) return EXT_MAP['.d.ts'] ?? DEFAULT_ICON;

  // Check extension
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex >= 0) {
    const ext = lower.substring(dotIndex);
    if (EXT_MAP[ext]) return EXT_MAP[ext];
  }

  return DEFAULT_ICON;
}

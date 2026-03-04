import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbNavProps {
  path: string;
  onNavigate: (path: string) => void;
}

export function BreadcrumbNav({ path, onNavigate }: BreadcrumbNavProps) {
  const parts = path.split('/').filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-xs text-gray-400 px-1 overflow-x-auto">
      <button onClick={() => onNavigate('')} className="hover:text-gray-200 flex-shrink-0">
        <Home size={13} />
      </button>
      {parts.map((part, i) => {
        const fullPath = parts.slice(0, i + 1).join('/');
        return (
          <span key={fullPath} className="flex items-center gap-1 flex-shrink-0">
            <ChevronRight size={12} className="text-gray-600" />
            <button
              onClick={() => onNavigate(fullPath)}
              className={`hover:text-gray-200 truncate max-w-[120px] ${
                i === parts.length - 1 ? 'text-gray-200 font-medium' : ''
              }`}
            >
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

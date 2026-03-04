interface BadgeProps {
  label: string;
  color?: 'brand' | 'green' | 'red' | 'yellow' | 'gray' | 'blue';
}

const colorMap = {
  brand: 'bg-brand-500/20 text-brand-300',
  green: 'bg-emerald-500/20 text-emerald-300',
  red: 'bg-red-500/20 text-red-300',
  yellow: 'bg-amber-500/20 text-amber-300',
  gray: 'bg-gray-500/20 text-gray-300',
  blue: 'bg-sky-500/20 text-sky-300',
};

export function Badge({ label, color = 'brand' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorMap[color]}`}>
      {label}
    </span>
  );
}

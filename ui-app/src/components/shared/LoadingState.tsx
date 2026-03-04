export function LoadingState({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
      <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin mb-4" />
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  );
}

export function SkeletonLine({ width = 'w-full' }: { width?: string }) {
  return <div className={`h-4 ${width} bg-surface-2 rounded animate-pulse-soft`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-surface-1 rounded-lg p-4 space-y-3 border border-white/5">
      <SkeletonLine width="w-1/3" />
      <SkeletonLine width="w-2/3" />
      <SkeletonLine width="w-1/2" />
    </div>
  );
}

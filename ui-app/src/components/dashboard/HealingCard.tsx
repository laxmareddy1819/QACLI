import { useHealingStats } from '../../hooks/useHealing';
import { Heart, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function HealingCard() {
  const { data } = useHealingStats();
  const navigate = useNavigate();

  if (!data?.available) {
    return null;
  }

  return (
    <button
      onClick={() => navigate('/healing')}
      className="bg-surface-1 rounded-xl border border-white/5 p-5 text-left hover:bg-surface-2 transition-colors w-full"
    >
      <div className="flex items-center gap-2 mb-3">
        <Heart size={14} className="text-pink-400" />
        <h3 className="text-sm font-semibold text-gray-200">Self-Healing</h3>
      </div>
      <div className="flex items-center gap-4">
        <div>
          <p className="text-2xl font-bold text-gray-100">{data.total}</p>
          <p className="text-[10px] text-gray-500">Elements tracked</p>
        </div>
        <div>
          <p className={`text-2xl font-bold ${data.successRate >= 80 ? 'text-emerald-400' : data.successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {data.successRate}%
          </p>
          <p className="text-[10px] text-gray-500">Success rate</p>
        </div>
        <div className="ml-auto">
          <ShieldCheck size={24} className={data.successRate >= 80 ? 'text-emerald-400/30' : 'text-amber-400/30'} />
        </div>
      </div>
    </button>
  );
}

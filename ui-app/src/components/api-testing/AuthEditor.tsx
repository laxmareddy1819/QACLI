import type { RequestAuth } from '../../api/types';

interface AuthEditorProps {
  auth: RequestAuth;
  onChange: (auth: RequestAuth) => void;
}

const AUTH_TYPES: Array<{ value: RequestAuth['type']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'api-key', label: 'API Key' },
];

export function AuthEditor({ auth, onChange }: AuthEditorProps) {
  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-1">
        {AUTH_TYPES.map(at => (
          <button
            key={at.value}
            onClick={() => onChange({ ...auth, type: at.value })}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              auth.type === at.value
                ? 'bg-brand-500/20 text-brand-300'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {at.label}
          </button>
        ))}
      </div>

      {/* Auth fields */}
      {auth.type === 'none' && (
        <p className="text-[13px] text-gray-600 italic">No authentication</p>
      )}

      {auth.type === 'bearer' && (
        <div>
          <label className="text-[11px] uppercase text-gray-500 font-medium mb-1 block">Token</label>
          <input
            type="text"
            value={auth.bearerToken || ''}
            onChange={e => onChange({ ...auth, bearerToken: e.target.value })}
            placeholder="Enter bearer token or {{variable}}"
            className="w-full px-2.5 py-1.5 text-[13px] font-mono bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
          />
        </div>
      )}

      {auth.type === 'basic' && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] uppercase text-gray-500 font-medium mb-1 block">Username</label>
            <input
              type="text"
              value={auth.basicUsername || ''}
              onChange={e => onChange({ ...auth, basicUsername: e.target.value })}
              placeholder="Username"
              className="w-full px-2.5 py-1.5 text-[13px] bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase text-gray-500 font-medium mb-1 block">Password</label>
            <input
              type="password"
              value={auth.basicPassword || ''}
              onChange={e => onChange({ ...auth, basicPassword: e.target.value })}
              placeholder="Password"
              className="w-full px-2.5 py-1.5 text-[13px] bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
            />
          </div>
        </div>
      )}

      {auth.type === 'api-key' && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] uppercase text-gray-500 font-medium mb-1 block">Key Name</label>
            <input
              type="text"
              value={auth.apiKeyName || ''}
              onChange={e => onChange({ ...auth, apiKeyName: e.target.value })}
              placeholder="e.g. X-API-Key"
              className="w-full px-2.5 py-1.5 text-[13px] bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase text-gray-500 font-medium mb-1 block">Key Value</label>
            <input
              type="text"
              value={auth.apiKeyValue || ''}
              onChange={e => onChange({ ...auth, apiKeyValue: e.target.value })}
              placeholder="API key value or {{variable}}"
              className="w-full px-2.5 py-1.5 text-[13px] font-mono bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase text-gray-500 font-medium mb-1 block">Add to</label>
            <div className="flex gap-2">
              {(['header', 'query'] as const).map(loc => (
                <button
                  key={loc}
                  onClick={() => onChange({ ...auth, apiKeyIn: loc })}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    (auth.apiKeyIn || 'header') === loc
                      ? 'bg-brand-500/20 text-brand-300'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}
                >
                  {loc === 'header' ? 'Header' : 'Query Param'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

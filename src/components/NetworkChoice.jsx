import { Globe, Globe2, Lock, Shield } from 'lucide-react';
import { NETWORK_RULES, NETWORK_NAMES, networkOfRule } from '../lib/privateNetwork';

// Choix du réseau d'une app, d'un profil ou de tout Orbit : connexion
// normale, Tor, VPN intégré, VPN Orbit (sans compte) ou proxy personnalisé.
// `value` est la règle de proxy brute ('' | 'orbit:tor' | 'orbit:vpn' | URL).
const OPTIONS = [
  { id: 'none', label: 'Normale', icon: Globe },
  { id: 'tor', label: 'Tor', icon: Lock },
  { id: 'vpn', label: 'VPN', icon: Shield },
  { id: 'orbitvpn', label: 'VPN Orbit', icon: Globe2 },
  { id: 'custom', label: 'Proxy…', icon: null },
];

export default function NetworkChoice({ value, onChange, inheritLabel }) {
  const v = String(value || '').trim();
  const current = !v ? 'none' : networkOfRule(v) || 'custom';
  const pick = (id) => {
    if (id === 'none') onChange('');
    else if (id === 'tor') onChange(NETWORK_RULES.tor);
    else if (id === 'vpn') onChange(NETWORK_RULES.vpn);
    else if (id === 'orbitvpn') onChange(NETWORK_RULES.orbitvpn);
    else if (current !== 'custom') onChange('socks5://');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {OPTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={current === id}
            onClick={() => pick(id)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              current === id ? 'border-accent-primary bg-accent-primary/10 text-text-primary' : 'border-border text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {Icon ? <Icon size={12} /> : null}
            {id === 'none' && inheritLabel ? inheritLabel : label}
          </button>
        ))}
      </div>
      {current === 'custom' ? (
        <input
          type="text"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          placeholder="socks5://host:port"
          className="input mt-2 text-sm"
          autoFocus
        />
      ) : null}
      {current === 'tor' || current === 'vpn' || current === 'orbitvpn' ? (
        <p className="mt-1.5 text-[11px] text-text-muted">
          Réglages → Confidentialité → Réseau privé. Tant que {NETWORK_NAMES[current]} n’est pas connecté, ces pages ne
          chargent pas : rien ne part en direct.
        </p>
      ) : null}
    </div>
  );
}

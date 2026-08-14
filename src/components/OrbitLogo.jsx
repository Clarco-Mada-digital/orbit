// Logo Orbit — une planète avec son anneau et son satellite
// Utilisé dans la titlebar, l'écran d'accueil, la boutique…
export default function OrbitLogo({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="orbit-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {/* Fond arrondi en dégradé indigo → violet */}
      <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#orbit-logo-bg)" />
      {/* Anneau orbital */}
      <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="2.6" />
      {/* Planète centrale */}
      <circle cx="32" cy="32" r="5" fill="#ffffff" />
      {/* Satellite sur l'anneau */}
      <circle cx="48.4" cy="20.5" r="6.2" fill="#c7d2fe" />
    </svg>
  );
}

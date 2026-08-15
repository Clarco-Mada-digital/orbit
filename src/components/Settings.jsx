import { useState } from 'react';
import { X, User, Palette, Bell, Zap, Info, Keyboard, Puzzle, Check, KeyRound, ShieldCheck, Ban, Archive, Globe } from 'lucide-react';
import { useStore } from '../stores/useStore';
import ProfileManager from './ProfileManager';
import Extensions from './Extensions';
import KeepassSettings from './KeepassSettings';
import SecuritySettings from './SecuritySettings';
import BackupSettings from './BackupSettings';

// Polices proposées, groupées par style. Chaque entrée est rendue
// dans sa propre police → aperçu en direct avant de choisir.
const fontGroups = [
  {
    label: 'Sans-serif',
    fonts: [
      { value: 'Inter', label: 'Inter' },
      { value: 'Roboto', label: 'Roboto' },
      { value: 'Open Sans', label: 'Open Sans' },
      { value: 'Poppins', label: 'Poppins' },
      { value: 'Montserrat', label: 'Montserrat' },
      { value: 'Lato', label: 'Lato' },
      { value: 'Nunito', label: 'Nunito' },
      { value: 'DM Sans', label: 'DM Sans' },
      { value: 'Ubuntu', label: 'Ubuntu' },
      { value: 'Source Sans 3', label: 'Source Sans 3' },
      { value: 'system-ui', label: 'Système' },
      { value: 'Arial', label: 'Arial' },
      { value: 'Helvetica', label: 'Helvetica' },
      { value: 'Verdana', label: 'Verdana' },
    ],
  },
  {
    label: 'Serif',
    fonts: [
      { value: 'Georgia', label: 'Georgia' },
      { value: 'Merriweather', label: 'Merriweather' },
      { value: 'Playfair Display', label: 'Playfair Display' },
      { value: 'Lora', label: 'Lora' },
      { value: 'Times New Roman', label: 'Times New Roman' },
    ],
  },
  {
    label: 'Monospace',
    fonts: [
      { value: 'JetBrains Mono', label: 'JetBrains Mono' },
      { value: 'Fira Code', label: 'Fira Code' },
      { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
      { value: 'Courier New', label: 'Courier New' },
    ],
  },
];

export default function Settings({ onClose }) {
  const [activeTab, setActiveTab] = useState('general');
  const [showProfileManager, setShowProfileManager] = useState(false);
  const { settings, updateSettings } = useStore();

  const tabs = [
    { id: 'general', name: 'Général', icon: Zap },
    { id: 'appearance', name: 'Apparence', icon: Palette },
    { id: 'display', name: 'Affichage', icon: Palette },
    { id: 'profiles', name: 'Profils', icon: User },
    { id: 'shortcuts', name: 'Raccourcis', icon: Keyboard },
    { id: 'extensions', name: 'Extensions', icon: Puzzle },
    { id: 'keepass', name: 'KeePassXC', icon: KeyRound },
    { id: 'security', name: 'Sécurité', icon: ShieldCheck },
    { id: 'privacy', name: 'Confidentialité', icon: Ban },
    { id: 'backup', name: 'Sauvegarde', icon: Archive },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'about', name: 'À propos', icon: Info },
  ];

  const shortcuts = [
    { name: 'Quick Switcher', keys: 'Cmd/Ctrl + K' },
    { name: 'Paramètres', keys: 'Cmd/Ctrl + ,' },
    { name: 'App Store', keys: 'Cmd/Ctrl + Shift + O' },
    { name: 'Profils', keys: 'Cmd/Ctrl + Shift + P' },
    { name: 'Actualiser', keys: 'Cmd/Ctrl + R' },
    { name: 'Retour', keys: 'Cmd/Ctrl + [' },
    { name: 'Avancer', keys: 'Cmd/Ctrl + ]' },
    { name: 'Fermer overlay', keys: 'Escape' },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in">
        <div className="w-full max-w-4xl h-[80vh] bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden flex animate-scale-in">
          {/* Sidebar */}
          <div className="w-64 bg-bg-primary border-r border-border flex flex-col">
            <div className="p-6 border-b border-border">
              <h2 className="text-xl font-bold">Paramètres</h2>
            </div>
            <nav className="flex-1 p-3 overflow-y-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all mb-1 ${
                      activeTab === tab.id
                        ? 'bg-accent-primary text-white'
                        : 'text-text-secondary hover:bg-bg-secondary'
                    }`}
                  >
                    <Icon size={18} />
                    <span className="font-medium">{tab.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col">
            <div className="h-16 border-b border-border flex items-center justify-between px-6">
              <h3 className="text-lg font-semibold">
                {tabs.find(t => t.id === activeTab)?.name}
              </h3>
              <button onClick={onClose} className="btn-icon">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">Démarrage</h4>
                    <label className="flex items-center justify-between mb-3">
                      <span>Démarrer minimisé</span>
                      <input
                        type="checkbox"
                        checked={settings.startMinimized}
                        onChange={(e) => updateSettings({ startMinimized: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">Interface</h4>
                    <label className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium">Masquer la barre supérieure</div>
                        <div className="text-sm text-text-muted">En mode plein écran</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.autoHideTopbar}
                        onChange={(e) => updateSettings({ autoHideTopbar: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <label className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium">Picture-in-Picture automatique</div>
                        <div className="text-sm text-text-muted">
                          Sort la vidéo en mini-fenêtre flottante quand vous changez d'app
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.autoPictureInPicture !== false}
                        onChange={(e) => updateSettings({ autoPictureInPicture: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Touches média du clavier</div>
                        <div className="text-sm text-text-muted">
                          Les touches ⏯ ⏭ ⏮ pilotent la lecture en cours (même hors d'Orbit)
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.globalMediaKeys === true}
                        onChange={(e) => updateSettings({ globalMediaKeys: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">Ressources</h4>
                    <p className="text-sm text-text-muted mb-3">
                      Met en veille les apps inactives pour libérer la mémoire. L'app active,
                      l'écran partagé et les apps qui jouent un son ne sont jamais mises en veille.
                    </p>
                    <label className="block text-sm font-medium mb-1.5">Mise en veille automatique</label>
                    <select
                      value={settings.autoSleepMinutes || 0}
                      onChange={(e) => updateSettings({ autoSleepMinutes: parseInt(e.target.value, 10) })}
                      className="input max-w-xs"
                    >
                      <option value={0}>Désactivée</option>
                      <option value={15}>Après 15 minutes</option>
                      <option value={30}>Après 30 minutes</option>
                      <option value={60}>Après 1 heure</option>
                      <option value={120}>Après 2 heures</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'display' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">Taille de police</h4>
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        {[
                          { value: 'small', label: 'Petite', size: '12px' },
                          { value: 'medium', label: 'Moyenne', size: '14px' },
                          { value: 'large', label: 'Grande', size: '16px' },
                          { value: 'xlarge', label: 'Très grande', size: '18px' },
                        ].map((option) => (
                          <button
                            key={option.value}
                            onClick={() => updateSettings({ fontSize: option.value })}
                            className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all ${
                              settings.fontSize === option.value
                                ? 'border-accent-primary bg-accent-primary/10'
                                : 'border-border hover:border-accent-primary/50'
                            }`}
                          >
                            <div style={{ fontSize: option.size }}>{option.label}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">Police de caractères</h4>
                    <p className="text-sm text-text-muted mb-4">
                      Le changement s'applique instantanément à toute l'interface
                    </p>
                    <div className="space-y-5">
                      {fontGroups.map((group) => (
                        <div key={group.label}>
                          <div className="text-xs font-semibold text-text-muted uppercase mb-2">
                            {group.label}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {group.fonts.map((font) => {
                              const selected = settings.fontFamily === font.value;
                              return (
                                <button
                                  key={font.value}
                                  onClick={() => updateSettings({ fontFamily: font.value })}
                                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all text-left ${
                                    selected
                                      ? 'border-accent-primary bg-accent-primary/10'
                                      : 'border-border hover:border-accent-primary/50'
                                  }`}
                                  title={font.label}
                                >
                                  <span
                                    className="text-lg leading-none"
                                    style={{ fontFamily: `'${font.value}', sans-serif` }}
                                  >
                                    Aa
                                  </span>
                                  <span
                                    className="text-sm flex-1 truncate"
                                    style={{ fontFamily: `'${font.value}', sans-serif` }}
                                  >
                                    {font.label}
                                  </span>
                                  {selected && <Check size={15} className="text-accent-primary flex-shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">Zoom de l'interface</h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium min-w-[60px]">{settings.uiScale ?? 100}%</span>
                        <input
                          type="range"
                          min="80"
                          max="120"
                          step="5"
                          value={settings.uiScale ?? 100}
                          onChange={(e) => updateSettings({ uiScale: parseInt(e.target.value) })}
                          className="flex-1"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateSettings({ uiScale: 80 })}
                          className="btn btn-secondary btn-sm"
                        >
                          80%
                        </button>
                        <button
                          onClick={() => updateSettings({ uiScale: 100 })}
                          className="btn btn-secondary btn-sm"
                        >
                          100%
                        </button>
                        <button
                          onClick={() => updateSettings({ uiScale: 120 })}
                          className="btn btn-secondary btn-sm"
                        >
                          120%
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">Options d'affichage</h4>
                    <div className="space-y-3">
                      <label className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">Mode compact</div>
                          <div className="text-sm text-text-muted">Réduit l'espacement entre les éléments</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.compactMode}
                          onChange={(e) => updateSettings({ compactMode: e.target.checked })}
                          className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                        />
                      </label>

                      <label className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">Animations</div>
                          <div className="text-sm text-text-muted">Active les transitions et animations</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.animationsEnabled}
                          onChange={(e) => updateSettings({ animationsEnabled: e.target.checked })}
                          className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                        />
                      </label>

                      <label className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">Icônes d'applications</div>
                          <div className="text-sm text-text-muted">Affiche les icônes colorées dans la sidebar</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.showAppIcons}
                          onChange={(e) => updateSettings({ showAppIcons: e.target.checked })}
                          className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">Thème</h4>
                    <div className="flex gap-3">
                      {['dark', 'light', 'auto'].map((theme) => (
                        <button
                          key={theme}
                          onClick={() => updateSettings({ theme })}
                          className={`flex-1 py-3 px-4 rounded-lg border-2 transition-all ${
                            settings.theme === theme
                              ? 'border-accent-primary bg-accent-primary/10'
                              : 'border-border hover:border-accent-primary/50'
                          }`}
                        >
                          {theme === 'dark' && '🌙 Sombre'}
                          {theme === 'light' && '☀️ Clair'}
                          {theme === 'auto' && '🌓 Auto'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">Couleur d'accent</h4>
                    <div className="flex gap-3 flex-wrap">
                      {[
                        { name: 'Indigo', value: '#6366f1' },
                        { name: 'Blue', value: '#3b82f6' },
                        { name: 'Purple', value: '#a855f7' },
                        { name: 'Pink', value: '#ec4899' },
                        { name: 'Green', value: '#10b981' },
                        { name: 'Orange', value: '#f97316' },
                        { name: 'Red', value: '#ef4444' },
                        { name: 'Cyan', value: '#06b6d4' },
                      ].map((color) => (
                        <button
                          key={color.value}
                          onClick={() => updateSettings({ accentColor: color.value })}
                          className={`w-12 h-12 rounded-full border-2 transition-all ${
                            settings.accentColor === color.value
                              ? 'border-white scale-110'
                              : 'border-transparent hover:scale-105'
                          }`}
                          style={{ backgroundColor: color.value }}
                          title={color.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'profiles' && (
                <div className="space-y-6">
                  <div className="card">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold">Gestion des profils</h4>
                        <p className="text-sm text-text-muted">Créez et gérez vos espaces de travail</p>
                      </div>
                      <button 
                        onClick={() => setShowProfileManager(true)}
                        className="btn btn-primary"
                      >
                        Gérer
                      </button>
                    </div>
                    <p className="text-sm text-text-muted">
                      Les profils vous permettent de séparer vos applications en espaces distincts (Travail, Personnel, Projets, etc.)
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'shortcuts' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">Raccourcis clavier</h4>
                    <div className="space-y-3">
                      {shortcuts.map((shortcut) => (
                        <div key={shortcut.name} className="flex items-center justify-between py-2">
                          <span className="text-sm">{shortcut.name}</span>
                          <kbd className="px-3 py-1.5 bg-bg-elevated border border-border rounded font-mono text-xs">
                            {shortcut.keys}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'extensions' && <Extensions />}

              {activeTab === 'keepass' && <KeepassSettings />}

              {activeTab === 'security' && <SecuritySettings />}

              {activeTab === 'backup' && <BackupSettings />}

              {activeTab === 'privacy' && (
                <div className="space-y-6">
                  <div className="card">
                    <div className="flex items-center gap-2 mb-2">
                      <Ban size={18} className="text-accent-primary" />
                      <h4 className="font-semibold">Bloqueur de pub &amp; traceurs</h4>
                    </div>
                    <p className="text-sm text-text-muted mb-4">
                      Blocage natif intégré (listes type EasyList), au niveau réseau, pour toutes
                      les apps et tous les profils — sans extension. Plus efficace et fiable que les
                      extensions de blocage, qui ne fonctionnent pas dans Orbit.
                    </p>
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Activer le blocage</div>
                        <div className="text-sm text-text-muted">
                          Bloque les publicités et traceurs connus
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.adblock !== false}
                        onChange={(e) => updateSettings({ adblock: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <p className="text-xs text-text-muted mt-3">
                      Après changement, rechargez une app déjà ouverte (bouton ⟳) pour que l'effet
                      s'applique. La première activation télécharge les listes (puis elles sont mises
                      en cache, y compris hors-ligne).
                    </p>
                  </div>

                  <div className="card">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe size={18} className="text-accent-primary" />
                      <h4 className="font-semibold">Proxy / VPN</h4>
                    </div>
                    <p className="text-sm text-text-muted mb-3">
                      Fait passer le trafic par un proxy (SOCKS5 ou HTTP) — pratique pour utiliser un
                      VPN. Proxy <strong>global</strong> ici ; surchargeable <strong>par profil</strong>{' '}
                      (Profils) et <strong>par app</strong> (clic droit → Modifier). Vide = connexion
                      directe.
                    </p>
                    <input
                      type="text"
                      value={settings.globalProxy || ''}
                      onChange={(e) => updateSettings({ globalProxy: e.target.value })}
                      placeholder="socks5://127.0.0.1:1080"
                      className="input"
                    />
                    <p className="text-xs text-text-muted mt-2">
                      Ex. un serveur SOCKS5 de NordVPN, le proxy local de Mullvad, ou votre propre
                      proxy. Rechargez l'app après changement. Les proxys avec identifiant/mot de
                      passe ne sont pas encore pris en charge.
                    </p>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">Traduction &amp; lecture vocale</h4>
                    <p className="text-sm text-text-muted mb-4">
                      Clic droit sur une page → « Traduire la sélection » ou « Lire à voix haute »
                      (intégré, sans extension).
                    </p>

                    <label className="block text-sm font-medium mb-1.5">Langue de traduction</label>
                    <select
                      value={settings.translateTarget || 'fr'}
                      onChange={(e) => updateSettings({ translateTarget: e.target.value })}
                      className="input max-w-xs mb-4"
                    >
                      {[
                        { v: 'fr', l: 'Français' },
                        { v: 'en', l: 'Anglais' },
                        { v: 'es', l: 'Espagnol' },
                        { v: 'de', l: 'Allemand' },
                        { v: 'it', l: 'Italien' },
                        { v: 'pt', l: 'Portugais' },
                        { v: 'ar', l: 'Arabe' },
                        { v: 'zh-CN', l: 'Chinois (simplifié)' },
                        { v: 'ru', l: 'Russe' },
                        { v: 'ja', l: 'Japonais' },
                      ].map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.l}
                        </option>
                      ))}
                    </select>

                    <label className="block text-sm font-medium mb-1.5">Moteur de traduction</label>
                    <div className="flex gap-3 mb-3">
                      {[
                        { v: 'google', l: 'Google', d: 'Rapide, sans configuration' },
                        { v: 'libretranslate', l: 'LibreTranslate', d: 'Privé / auto-hébergé' },
                      ].map((o) => (
                        <button
                          key={o.v}
                          onClick={() => updateSettings({ translateEngine: o.v })}
                          className={`flex-1 py-2.5 px-3 rounded-lg border-2 text-left transition-all ${
                            (settings.translateEngine || 'google') === o.v
                              ? 'border-accent-primary bg-accent-primary/10'
                              : 'border-border hover:border-accent-primary/50'
                          }`}
                        >
                          <div className="font-medium text-sm">{o.l}</div>
                          <div className="text-xs text-text-muted">{o.d}</div>
                        </button>
                      ))}
                    </div>

                    {settings.translateEngine === 'libretranslate' && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={settings.libreTranslateUrl || ''}
                          onChange={(e) => updateSettings({ libreTranslateUrl: e.target.value })}
                          placeholder="URL du serveur (ex. http://localhost:5000)"
                          className="input"
                        />
                        <input
                          type="password"
                          value={settings.libreTranslateApiKey || ''}
                          onChange={(e) => updateSettings({ libreTranslateApiKey: e.target.value })}
                          placeholder="Clé API (optionnelle)"
                          className="input"
                        />
                        <p className="text-xs text-text-muted">
                          LibreTranslate est open-source et auto-hébergeable (Docker :{' '}
                          <code className="px-1 py-0.5 bg-bg-secondary border border-border rounded">
                            libretranslate/libretranslate
                          </code>
                          ). Avec un serveur local, vos textes ne quittent pas votre machine.
                        </p>
                      </div>
                    )}
                    {settings.translateEngine !== 'libretranslate' && (
                      <p className="text-xs text-text-muted">
                        Le moteur Google envoie le texte sélectionné à Google pour la traduction.
                        Pour un traitement privé, choisissez LibreTranslate.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">Notifications</h4>
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Notifications système</div>
                        <div className="text-sm text-text-muted">
                          Affiche une notification système quand une app reçoit de nouveaux messages
                          (sauf si elle est ouverte ou en veille)
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.notifications}
                        onChange={(e) => updateSettings({ notifications: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                  </div>
                  <div className="card">
                    <h4 className="font-semibold mb-4">Centre de notifications</h4>
                    <p className="text-sm text-text-muted">
                      Cliquez sur la cloche 🔔 dans la barre supérieure pour voir toutes vos apps
                      avec des messages non lus et y accéder en un clic.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'about' && (
                <div className="space-y-6">
                  <div className="card text-center">
                    <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-accent-primary to-purple-500 flex items-center justify-center mb-4">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1v6m0 6v6m8.66-15.66l-4.24 4.24m-4.84 4.84l-4.24 4.24m15.08.08l-4.24-4.24m-4.84-4.84L2.34 2.34" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Orbit 🛰</h2>
                    <p className="text-text-muted mb-1">Version 1.0.0</p>
                    <p className="text-sm text-text-muted mb-6">
                      Alternative moderne à Station
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button className="btn btn-secondary btn-sm">Documentation</button>
                      <button className="btn btn-secondary btn-sm">GitHub</button>
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">Technologies</h4>
                    <div className="text-sm text-text-muted space-y-1">
                      <p>• Electron + React + Vite</p>
                      <p>• TailwindCSS + Zustand</p>
                      <p>• &lt;webview&gt; avec sessions isolées par profil</p>
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">Licence</h4>
                    <p className="text-sm text-text-muted">
                      Orbit est un logiciel open-source sous licence MIT.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showProfileManager && (
        <ProfileManager onClose={() => setShowProfileManager(false)} />
      )}
    </>
  );
}

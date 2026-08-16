import { useState, useEffect } from 'react';
import { X, User, Palette, Bell, Zap, Info, Keyboard, Puzzle, Check, KeyRound, ShieldCheck, Ban, Archive, Globe } from 'lucide-react';
import { useStore } from '../stores/useStore';
import ProfileManager from './ProfileManager';
import Extensions from './Extensions';
import KeepassSettings from './KeepassSettings';
import SecuritySettings from './SecuritySettings';
import BackupSettings from './BackupSettings';
import { shortcutKeys } from '../lib/shortcuts';
import { useT } from '../lib/i18n';
import { builtinSoundNames, getBuiltinSound } from '../lib/sounds';

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
  const [appVersion, setAppVersion] = useState('');
  const [updateMsg, setUpdateMsg] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    window.electronAPI?.getVersion?.().then((v) => v && setAppVersion(v));
  }, []);

  const checkUpdate = async () => {
    setChecking(true);
    setUpdateMsg('');
    const r = await window.electronAPI?.checkForUpdate?.();
    setChecking(false);
    if (!r) return;
    if (r.success === false) {
      setUpdateMsg(
        r.reason === 'unsupported'
          ? t('st.upd.unsupported')
          : t('st.upd.cantCheck')
      );
    } else if (r.version && appVersion && r.version !== appVersion) {
      setUpdateMsg(t('st.upd.available', { version: r.version }));
    } else {
      setUpdateMsg(t('st.upd.upToDate'));
    }
  };
  const { settings, updateSettings, apps, profiles } = useStore();
  const t = useT();

  const tabs = [
    { id: 'general', name: t('st.tab.general'), icon: Zap },
    { id: 'appearance', name: t('st.tab.appearance'), icon: Palette },
    { id: 'display', name: t('st.tab.display'), icon: Palette },
    { id: 'profiles', name: t('st.tab.profiles'), icon: User },
    { id: 'shortcuts', name: t('st.tab.shortcuts'), icon: Keyboard },
    { id: 'extensions', name: t('st.tab.extensions'), icon: Puzzle },
    { id: 'keepass', name: 'KeePassXC', icon: KeyRound },
    { id: 'security', name: t('st.tab.security'), icon: ShieldCheck },
    { id: 'privacy', name: t('st.tab.privacy'), icon: Ban },
    { id: 'backup', name: t('st.tab.backup'), icon: Archive },
    { id: 'notifications', name: t('st.tab.notifications'), icon: Bell },
    { id: 'about', name: t('st.tab.about'), icon: Info },
  ];

  // Source unique des raccourcis (adaptés à la plateforme)
  const shortcuts = shortcutKeys().map((s) => ({
    name: s.desc,
    keys: s.keys.join(' + '),
  }));

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in">
        <div className="w-full max-w-4xl h-[80vh] bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden flex animate-scale-in">
          {/* Sidebar */}
          <div className="w-64 bg-bg-primary border-r border-border flex flex-col">
            <div className="p-6 border-b border-border">
              <h2 className="text-xl font-bold">{t('common.settings')}</h2>
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
                    <h4 className="font-semibold mb-3">{t('settings.language')}</h4>
                    <select
                      value={settings.language || 'auto'}
                      onChange={(e) => updateSettings({ language: e.target.value })}
                      className="input max-w-xs"
                    >
                      <option value="auto">{t('settings.language.auto')}</option>
                      <option value="fr">Français</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('st.startup')}</h4>
                    <label className="flex items-center justify-between mb-4">
                      <span>{t('st.startMinimized')}</span>
                      <input
                        type="checkbox"
                        checked={settings.startMinimized}
                        onChange={(e) => updateSettings({ startMinimized: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <label className="block text-sm font-medium mb-1.5">{t('st.startupApp')}</label>
                    <select
                      value={settings.startupApp || ''}
                      onChange={(e) => updateSettings({ startupApp: e.target.value })}
                      className="input max-w-sm"
                    >
                      <option value="">{t('st.resumeLast')}</option>
                      <option value="none">{t('st.startupNone')}</option>
                      {apps.map((a) => {
                        const prof = profiles.find((p) => p.id === a.profileId);
                        return (
                          <option key={a.id} value={a.id}>
                            {(prof ? prof.name + ' · ' : '') + a.name}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">{t('st.updates')}</h4>
                    <p className="text-sm text-text-muted mb-3">
                      {t('st.installedVersion')} <span className="font-medium">{appVersion || '—'}</span>
                    </p>
                    <button onClick={checkUpdate} disabled={checking} className="btn btn-secondary btn-sm">
                      {checking ? t('about.checking') : t('st.upd.check')}
                    </button>
                    {updateMsg && <p className="text-sm mt-2 text-text-muted">{updateMsg}</p>}
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('st.tray')}</h4>
                    <label className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium">{t('st.closeToTray')}</div>
                        <div className="text-sm text-text-muted">
                          {t('st.closeToTrayDesc')}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.closeToTray !== false}
                        onChange={(e) => updateSettings({ closeToTray: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <label className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-medium">{t('st.globalHotkey')}</div>
                        <div className="text-sm text-text-muted">
                          {t('st.globalHotkeyDesc')}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.globalHotkeyEnabled === true}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          updateSettings({ globalHotkeyEnabled: on });
                          if (on) {
                            const res = await window.electronAPI?.setSummonHotkey?.(
                              settings.globalHotkey || 'CommandOrControl+Alt+O'
                            );
                            if (res && res.success === false) {
                              alert(
                                t('st.hotkeyUnavailable')
                              );
                            }
                          }
                        }}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    {settings.globalHotkeyEnabled && (
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          value={settings.globalHotkey || ''}
                          onChange={(e) => updateSettings({ globalHotkey: e.target.value })}
                          onBlur={async () => {
                            const res = await window.electronAPI?.setSummonHotkey?.(
                              settings.globalHotkey || 'CommandOrControl+Alt+O'
                            );
                            if (res && res.success === false) {
                              alert(t('st.hotkeyUnavailable2'));
                            }
                          }}
                          placeholder="CommandOrControl+Alt+O"
                          className="input text-sm"
                        />
                        <p className="text-xs text-text-muted">
                          Ex. <code>CommandOrControl+Shift+O</code>, <code>Super+O</code>. Si rien ne
                          se passe, la combinaison est sûrement déjà prise par ton bureau — essayes-en
                          une autre.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('st.interface')}</h4>
                    <label className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium">{t('st.hideTopbar')}</div>
                        <div className="text-sm text-text-muted">{t('st.hideTopbarDesc')}</div>
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
                        <div className="font-medium">{t('st.autoPip')}</div>
                        <div className="text-sm text-text-muted">
                          {t('st.autoPipDesc')}
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
                        <div className="font-medium">{t('st.mediaKeys')}</div>
                        <div className="text-sm text-text-muted">
                          {t('st.mediaKeysDesc')}
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
                    <h4 className="font-semibold mb-2">{t('st.resources')}</h4>
                    <p className="text-sm text-text-muted mb-3">{t('st.resourcesDesc')}</p>
                    <label className="block text-sm font-medium mb-1.5">{t('st.autoSleep')}</label>
                    <select
                      value={settings.autoSleepMinutes || 0}
                      onChange={(e) => updateSettings({ autoSleepMinutes: parseInt(e.target.value, 10) })}
                      className="input max-w-xs"
                    >
                      <option value={0}>{t('st.sleepOff')}</option>
                      <option value={15}>{t('st.sleep15')}</option>
                      <option value={30}>{t('st.sleep30')}</option>
                      <option value={60}>{t('st.sleep60')}</option>
                      <option value={120}>{t('st.sleep120')}</option>
                    </select>
                  </div>
                </div>
              )}

              {activeTab === 'display' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('st.fontSize')}</h4>
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        {[
                          { value: 'small', label: t('st.small'), size: '12px' },
                          { value: 'medium', label: t('st.medium'), size: '14px' },
                          { value: 'large', label: t('st.large'), size: '16px' },
                          { value: 'xlarge', label: t('st.xlarge'), size: '18px' },
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
                    <h4 className="font-semibold mb-4">{t('st.fontFamily')}</h4>
                    <p className="text-sm text-text-muted mb-4">
                      {t('st.fontFamilyDesc')}
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
                    <h4 className="font-semibold mb-4">{t('st.uiZoom')}</h4>
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
                    <h4 className="font-semibold mb-4">{t('st.displayOptions')}</h4>
                    <div className="space-y-3">
                      <label className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{t('st.compact')}</div>
                          <div className="text-sm text-text-muted">{t('st.compactDesc')}</div>
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
                          <div className="font-medium">{t('st.animations')}</div>
                          <div className="text-sm text-text-muted">{t('st.animationsDesc')}</div>
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
                          <div className="font-medium">{t('st.appIcons')}</div>
                          <div className="text-sm text-text-muted">{t('st.appIconsDesc')}</div>
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
                    <h4 className="font-semibold mb-4">{t('st.theme')}</h4>
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
                          {theme === 'dark' && t('st.themeDark')}
                          {theme === 'light' && t('st.themeLight')}
                          {theme === 'auto' && t('st.themeAuto')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('st.accentColor')}</h4>
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
                    <label className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                      <div>
                        <div className="font-medium">{t('st.accentPerProfile')}</div>
                        <div className="text-sm text-text-muted">
                          {t('st.accentPerProfileDesc')}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.accentPerProfile === true}
                        onChange={(e) => updateSettings({ accentPerProfile: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'profiles' && (
                <div className="space-y-6">
                  <div className="card">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold">{t('pm.title')}</h4>
                        <p className="text-sm text-text-muted">{t('st.profilesDesc')}</p>
                      </div>
                      <button 
                        onClick={() => setShowProfileManager(true)}
                        className="btn btn-primary"
                      >
                        {t('st.manage')}
                      </button>
                    </div>
                    <p className="text-sm text-text-muted">
                      {t('st.profilesDesc2')}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'shortcuts' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('qs.shortcutsLabel')}</h4>
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
                      <h4 className="font-semibold">{t('st.adblockTitle')}</h4>
                    </div>
                    <p className="text-sm text-text-muted mb-4">{t('st.adblockDesc')}</p>
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{t('st.adblockEnable')}</div>
                        <div className="text-sm text-text-muted">{t('st.adblockEnableDesc')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.adblock !== false}
                        onChange={(e) => updateSettings({ adblock: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <p className="text-xs text-text-muted mt-3">{t('st.adblockHint')}</p>
                  </div>

                  <div className="card">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe size={18} className="text-accent-primary" />
                      <h4 className="font-semibold">{t('st.proxyTitle')}</h4>
                    </div>
                    <p className="text-sm text-text-muted mb-3">{t('st.proxyDesc')}</p>
                    <input
                      type="text"
                      value={settings.globalProxy || ''}
                      onChange={(e) => updateSettings({ globalProxy: e.target.value })}
                      placeholder="socks5://127.0.0.1:1080"
                      className="input"
                    />
                    <p className="text-xs text-text-muted mt-2">{t('st.proxyHint')}</p>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">{t('st.translateTitle')}</h4>
                    <p className="text-sm text-text-muted mb-4">{t('st.translateDesc')}</p>

                    <label className="block text-sm font-medium mb-1.5">{t('st.translateLang')}</label>
                    <select
                      value={settings.translateTarget || 'fr'}
                      onChange={(e) => updateSettings({ translateTarget: e.target.value })}
                      className="input max-w-xs mb-4"
                    >
                      {[
                        { v: 'fr', l: t('st.lang.fr') },
                        { v: 'en', l: t('st.lang.en') },
                        { v: 'es', l: t('st.lang.es') },
                        { v: 'de', l: t('st.lang.de') },
                        { v: 'it', l: t('st.lang.it') },
                        { v: 'pt', l: t('st.lang.pt') },
                        { v: 'ar', l: t('st.lang.ar') },
                        { v: 'zh-CN', l: t('st.lang.zh') },
                        { v: 'ru', l: t('st.lang.ru') },
                        { v: 'ja', l: t('st.lang.ja') },
                      ].map((o) => (
                        <option key={o.v} value={o.v}>
                          {o.l}
                        </option>
                      ))}
                    </select>

                    <label className="block text-sm font-medium mb-1.5">{t('st.translateEngine')}</label>
                    <div className="flex gap-3 mb-3">
                      {[
                        { v: 'google', l: 'Google', d: t('st.engineGoogleDesc') },
                        { v: 'libretranslate', l: 'LibreTranslate', d: t('st.engineLibreDesc') },
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
                          placeholder={t('st.libreUrlPlaceholder')}
                          className="input"
                        />
                        <input
                          type="password"
                          value={settings.libreTranslateApiKey || ''}
                          onChange={(e) => updateSettings({ libreTranslateApiKey: e.target.value })}
                          placeholder={t('st.libreKeyPlaceholder')}
                          className="input"
                        />
                        <p className="text-xs text-text-muted">{t('st.libreHint')}</p>
                      </div>
                    )}
                    {settings.translateEngine !== 'libretranslate' && (
                      <p className="text-xs text-text-muted">{t('st.googleHint')}</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('tb.notifications')}</h4>
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{t('st.notifSystem')}</div>
                        <div className="text-sm text-text-muted">{t('st.notifSystemDesc')}</div>
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
                    <h4 className="font-semibold mb-4">{t('tb.dnd')}</h4>
                    <label className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium">{t('st.dndNow')}</div>
                        <div className="text-sm text-text-muted">{t('st.dndNowDesc')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.dnd === true}
                        onChange={(e) => updateSettings({ dnd: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    <label className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-medium">{t('st.quietHours')}</div>
                        <div className="text-sm text-text-muted">{t('st.quietHoursDesc')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.quietHoursEnabled === true}
                        onChange={(e) => updateSettings({ quietHoursEnabled: e.target.checked })}
                        className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                      />
                    </label>
                    {settings.quietHoursEnabled && (
                      <div className="flex items-center gap-3">
                        <label className="text-sm text-text-secondary">{t('st.from')}</label>
                        <input
                          type="time"
                          value={settings.quietStart || '22:00'}
                          onChange={(e) => updateSettings({ quietStart: e.target.value })}
                          className="input max-w-[130px]"
                        />
                        <label className="text-sm text-text-secondary">{t('st.to')}</label>
                        <input
                          type="time"
                          value={settings.quietEnd || '07:00'}
                          onChange={(e) => updateSettings({ quietEnd: e.target.value })}
                          className="input max-w-[130px]"
                        />
                      </div>
                    )}
                  </div>
                  <div className="card">
                    <h4 className="font-semibold mb-2">{t('st.notifSound')}</h4>
                    <p className="text-sm text-text-muted mb-4">{t('st.notifSoundDesc')}</p>

                    {/* Sons proposés (intégrés) — clic = sélectionner + écouter */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {builtinSoundNames.map((name) => {
                        const selected = settings.notificationSoundName === name;
                        return (
                          <button
                            key={name}
                            onClick={() => {
                              const url = getBuiltinSound(name);
                              updateSettings({ notificationSound: url, notificationSoundName: name });
                              try {
                                new Audio(url).play().catch(() => {});
                              } catch {
                                /* ignore */
                              }
                            }}
                            className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
                          >
                            🔊 {name}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm text-text-secondary">
                        {settings.notificationSound
                          ? `🔊 ${settings.notificationSoundName || t('st.customSound')}`
                          : t('st.systemSound')}
                      </span>
                      <div className="flex gap-2 ml-auto">
                        <label className="btn btn-secondary btn-sm cursor-pointer">
                          {t('st.chooseSound')}
                          <input
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files && e.target.files[0];
                              e.target.value = '';
                              if (!file) return;
                              if (file.size > 1024 * 1024) {
                                alert(t('st.soundTooHeavy'));
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () =>
                                updateSettings({
                                  notificationSound: String(reader.result || ''),
                                  notificationSoundName: file.name,
                                });
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                        {settings.notificationSound && (
                          <>
                            <button
                              onClick={() => {
                                try {
                                  new Audio(settings.notificationSound).play().catch(() => {});
                                } catch {
                                  /* ignore */
                                }
                              }}
                              className="btn btn-secondary btn-sm"
                            >
                              {t('st.testSound')}
                            </button>
                            <button
                              onClick={() =>
                                updateSettings({ notificationSound: '', notificationSoundName: '' })
                              }
                              className="btn btn-sm text-error hover:bg-error/10"
                            >
                              {t('st.defaultSound')}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="card">
                    <h4 className="font-semibold mb-4">{t('st.notifCenter')}</h4>
                    <p className="text-sm text-text-muted">{t('st.notifCenterDesc')}</p>
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
                    <p className="text-text-muted mb-1">
                      {t('about.version', { version: appVersion || '—' })}
                    </p>
                    <p className="text-sm text-text-muted mb-6">{t('about.tagline')}</p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <button
                        onClick={() =>
                          window.open('https://github.com/Clarco-Mada-digital/orbit', '_blank')
                        }
                        className="btn btn-secondary btn-sm"
                      >
                        {t('about.github')}
                      </button>
                      <button
                        onClick={() =>
                          window.open(
                            'https://github.com/Clarco-Mada-digital/orbit/releases',
                            '_blank'
                          )
                        }
                        className="btn btn-secondary btn-sm"
                      >
                        {t('about.releaseNotes')}
                      </button>
                      <button onClick={checkUpdate} disabled={checking} className="btn btn-secondary btn-sm">
                        {checking ? t('about.checking') : t('about.checkUpdates')}
                      </button>
                    </div>
                    {updateMsg && <p className="text-xs text-text-muted mt-3">{updateMsg}</p>}
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-3">{t('about.features')}</h4>
                    <div className="text-sm text-text-muted grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                      <p>🎯 Profils multiples & sessions isolées</p>
                      <p>👥 Conteneurs multi-comptes</p>
                      <p>🖥️ Écran partagé & espaces de travail</p>
                      <p>🪟 Fenêtre détachée</p>
                      <p>🔎 Recherche dans la page & zoom par app</p>
                      <p>🔐 Verrouillage (global, profil, auto)</p>
                      <p>💾 Sauvegarde chiffrée</p>
                      <p>🎬 Téléchargement vidéo/audio</p>
                      <p>🛡️ Bloqueur de pub & KeePassXC</p>
                      <p>🔄 Mises à jour automatiques</p>
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">{t('about.tech')}</h4>
                    <div className="text-sm text-text-muted space-y-1">
                      <p>• Electron + React + Vite</p>
                      <p>• TailwindCSS + Zustand</p>
                      <p>• &lt;webview&gt; avec sessions isolées par profil</p>
                    </div>
                  </div>

                  <div className="card">
                    <h4 className="font-semibold mb-2">{t('st.license')}</h4>
                    <p className="text-sm text-text-muted">{t('st.licenseText')}</p>
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

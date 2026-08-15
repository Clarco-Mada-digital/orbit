import { useState } from 'react';
import { X, Plus, Edit2, Trash2 } from 'lucide-react';
import { useStore } from '../stores/useStore';

export default function ProfileManager({ onClose }) {
  const { profiles, activeProfile, setActiveProfile, addProfile, updateProfile, deleteProfile } = useStore();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({ name: '', emoji: '💼', color: '#6366f1' });

  const emojis = ['💼', '🏠', '🎯', '🎮', '🎨', '🎓', '💪', '🌟', '🚀', '💡', '🔥', '⚡', '🌈', '🎵', '📚', '🍕'];
  const colors = [
    '#6366f1', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899',
    '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9'
  ];

  const handleSave = () => {
    if (!formData.name.trim()) return;

    if (editing) {
      updateProfile(editing, formData);
      setEditing(null);
    } else {
      addProfile(formData);
      setCreating(false);
    }
    setFormData({ name: '', emoji: '💼', color: '#6366f1' });
  };

  const handleEdit = (profile) => {
    setEditing(profile.id);
    setFormData({ name: profile.name, emoji: profile.emoji, color: profile.color });
  };

  const handleDelete = (profileId) => {
    if (profiles.length === 1) {
      alert('Vous devez avoir au moins un profil !');
      return;
    }
    if (confirm('Êtes-vous sûr de vouloir supprimer ce profil ? Toutes les apps associées seront supprimées.')) {
      deleteProfile(profileId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-2xl bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="h-16 border-b border-border flex items-center justify-between px-6">
          <h2 className="text-xl font-bold">Gestion des profils</h2>
          <button onClick={onClose} className="btn-icon">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
          {/* Profiles list */}
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`card flex items-center gap-4 ${
                profile.id === activeProfile ? 'ring-2 ring-accent-primary' : ''
              }`}
            >
              {editing === profile.id ? (
                // Edit mode
                <div className="flex-1 space-y-3">
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nom du profil"
                    className="input"
                  />
                  <div className="flex gap-2">
                    <div>
                      <label className="text-xs text-text-muted block mb-2">Emoji</label>
                      <div className="flex gap-1 flex-wrap">
                        {emojis.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => setFormData({ ...formData, emoji })}
                            className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                              formData.emoji === emoji
                                ? 'bg-accent-primary scale-110'
                                : 'bg-bg-elevated hover:bg-bg-hover'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-text-muted block mb-2">Couleur</label>
                      <div className="flex gap-1 flex-wrap max-w-[200px]">
                        {colors.map((color) => (
                          <button
                            key={color}
                            onClick={() => setFormData({ ...formData, color })}
                            className={`w-8 h-8 rounded-lg transition-all ${
                              formData.color === color ? 'ring-2 ring-white scale-110' : ''
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSave} className="btn btn-primary">
                      Enregistrer
                    </button>
                    <button onClick={() => setEditing(null)} className="btn btn-secondary">
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <>
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl"
                    style={{ backgroundColor: `${profile.color}20` }}
                  >
                    {profile.emoji}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{profile.name}</h3>
                    <p className="text-sm text-text-muted mb-1.5">
                      {profile.id === activeProfile && '✓ Actif'}
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={!!profile.sharedSession}
                        onChange={() => {
                          const enabling = !profile.sharedSession;
                          if (
                            enabling &&
                            !confirm(
                              'Partager les connexions dans « ' +
                                profile.name +
                                ' » ?\n\nLes apps de ce profil partageront un seul compte par service, comme un navigateur : connectez-vous à Google une fois → Gmail, YouTube, Drive suivent (fini la 2FA à répéter).\n\nÀ savoir : les apps vont se recharger et il faudra vous reconnecter une fois. Ce mode empêche d’avoir 2 comptes du même service dans ce profil.'
                            )
                          ) {
                            return;
                          }
                          updateProfile(profile.id, { sharedSession: enabling });
                        }}
                        className="w-9 h-5 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-4"
                      />
                      <span>Partager les connexions (SSO navigateur)</span>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    {profile.id !== activeProfile && (
                      <button
                        onClick={() => setActiveProfile(profile.id)}
                        className="btn btn-secondary btn-sm"
                      >
                        Activer
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(profile)}
                      className="btn-icon"
                      title="Éditer"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(profile.id)}
                      className="btn-icon text-error"
                      title="Supprimer"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {/* Create new profile */}
          {creating ? (
            <div className="card space-y-3">
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nom du profil"
                className="input"
                autoFocus
              />
              <div className="flex gap-2">
                <div>
                  <label className="text-xs text-text-muted block mb-2">Emoji</label>
                  <div className="flex gap-1 flex-wrap">
                    {emojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => setFormData({ ...formData, emoji })}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                          formData.emoji === emoji
                            ? 'bg-accent-primary scale-110'
                            : 'bg-bg-elevated hover:bg-bg-hover'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-2">Couleur</label>
                  <div className="flex gap-1 flex-wrap max-w-[200px]">
                    {colors.map((color) => (
                      <button
                        key={color}
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-lg transition-all ${
                          formData.color === color ? 'ring-2 ring-white scale-110' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} className="btn btn-primary">
                  Créer
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setFormData({ name: '', emoji: '💼', color: '#6366f1' });
                  }}
                  className="btn btn-secondary"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full card hover:bg-bg-hover flex items-center justify-center gap-2 py-6 cursor-pointer transition-all border-2 border-dashed border-border hover:border-accent-primary"
            >
              <Plus size={24} />
              <span className="font-medium">Nouveau profil</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

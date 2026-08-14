import { useRef, useState } from 'react';
import { X, Search, Grid, Plus, Trash2, Globe, Wand2, ImageIcon, Upload } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { recipes, categories } from '../lib/recipes';
import { homeUrlFor } from '../lib/urls';
import { EMOJI_CHOICES, COLOR_CHOICES, getHostname, faviconServiceUrl } from '../lib/appIcons';
import AppIcon from './AppIcon';

// Aperçu du favicon avec repli automatique (Google s2 → icon.horse)
function FaviconPreview({ url, className = '' }) {
  const [useFallback, setUseFallback] = useState(false);
  const host = getHostname(url);
  if (!host) return null;
  return (
    <img
      src={faviconServiceUrl(url, useFallback)}
      alt=""
      className={`w-10 h-10 rounded-lg bg-bg-secondary border border-border object-contain p-1 ${className}`}
      draggable={false}
      onError={() => {
        if (!useFallback) setUseFallback(true);
      }}
    />
  );
}

// Normalise une URL : ajoute https:// si le protocole manque
function normalizeUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function AppStore({ onClose }) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [useFavicon, setUseFavicon] = useState(false);
  const [customImage, setCustomImage] = useState(''); // image téléversée (data URL)
  const [customForm, setCustomForm] = useState({
    name: '',
    url: '',
    icon: '🌐',
    color: '#6366f1',
  });
  const fileRef = useRef(null);

  const faviconPreview = useFavicon ? faviconServiceUrl(customForm.url) : '';

  const handleUploadImage = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCustomImage(String(reader.result || ''));
      setUseFavicon(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const { apps, activeProfile, activeApp, addApp, deleteApp } = useStore();

  // Apps installées dans le profil actif (recette OU personnalisée)
  const installedApps = apps.filter((a) => a.profileId === activeProfile);
  const installedAppIds = installedApps.map((a) => a.recipeId);

  // Instances d'une même recette (comptes multiples : 2 Gmail, 2 Slack…)
  const getInstances = (recipeId) => installedApps.filter((a) => a.recipeId === recipeId);

  // Filtrer les recettes
  const filteredRecipes = Object.values(recipes).filter((recipe) => {
    const matchSearch =
      recipe.name.toLowerCase().includes(search.toLowerCase()) ||
      recipe.url.toLowerCase().includes(search.toLowerCase());
    const matchCategory =
      selectedCategory === 'all' || recipe.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  const handleInstall = (recipe) => {
    const count = getInstances(recipe.id).length;
    // 2e, 3e… compte : on numérote le nom pour les distinguer dans la sidebar
    const name = count === 0 ? recipe.name : `${recipe.name} (${count + 1})`;
    addApp({
      profileId: activeProfile,
      recipeId: recipe.id,
      name,
      url: recipe.url,
      // URL « maison » = URL de la recette (au redémarrage, on n'atterrit
      // jamais sur une page de connexion persistée)
      homeUrl: recipe.url,
      icon: recipe.icon,
      color: recipe.color,
      // Icône de marque réelle dès l'installation : icône officielle de la
      // recette si elle existe (ex. Google Drive ≠ Gmail — les favicons
      // .google.com sont tous le même « G »), sinon favicon du site
      favicon: recipe.brandIcon || faviconServiceUrl(recipe.url),
      unread: 0,
      sleeping: false,
    });
  };

  // Désinstalle UN compte (une instance) de la recette — pas tous
  const handleUninstall = (recipe) => {
    const instances = getInstances(recipe.id);
    if (instances.length === 0) return;
    const target =
      instances.find((a) => a.id !== activeApp) || instances[instances.length - 1];
    if (confirm(`Désinstaller le compte « ${target.name} » ?`)) {
      handleDeleteApp(target);
    }
  };

  // Purge les cookies/session du compte désinstallé
  const handleDeleteApp = (app) => {
    deleteApp(app.id);
    window.electronAPI?.clearAppSession?.(app.profileId, app.id);
  };

  const handleAddCustom = () => {
    const url = normalizeUrl(customForm.url);
    if (!customForm.name.trim() || !url) return;

    addApp({
      profileId: activeProfile,
      recipeId: null, // pas une recette pré-définie
      name: customForm.name.trim(),
      url,
      // URL « maison » : l'URL saisie, repliée sur l'origine si c'est une page
      // de connexion éphémère (jeton cpsess, challenge…)
      homeUrl: homeUrlFor(url),
      icon: customForm.icon,
      color: customForm.color,
      // Image téléversée par l'utilisateur (prioritaire sur le favicon)
      iconImage: customImage || undefined,
      // Option : utiliser le favicon réel du site dès l'installation
      favicon: useFavicon && getHostname(url) ? faviconServiceUrl(url) : undefined,
      unread: 0,
      sleeping: false,
    });

    // Reset et ferme le formulaire
    setCustomForm({ name: '', url: '', icon: '🌐', color: '#6366f1' });
    setUseFavicon(false);
    setCustomImage('');
    setShowCustomForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-6xl h-[85vh] bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in">
        {/* Header */}
        <div className="h-16 border-b border-border flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Grid size={24} className="text-accent-primary" />
            <div>
              <h2 className="text-xl font-bold">App Store</h2>
              <p className="text-sm text-text-muted">
                {filteredRecipes.length} applications disponibles
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-icon">
            <X size={20} />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="p-6 border-b border-border space-y-4">
          {/* Search */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={20} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une application..."
                className="input pl-11"
              />
            </div>
            <button
              onClick={() => {
                setShowCustomForm(!showCustomForm);
                setSearch('');
              }}
              className={`btn ${showCustomForm ? 'btn-secondary' : 'btn-primary'} whitespace-nowrap`}
              title="Ajouter une application qui n'est pas dans la liste"
            >
              <Plus size={16} />
              Ajouter une app
            </button>
          </div>

          {/* Categories */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedCategory === 'all'
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
              }`}
            >
              Toutes
            </button>
            {Object.entries(categories).map(([id, cat]) => (
              <button
                key={id}
                onClick={() => setSelectedCategory(id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedCategory === id
                    ? 'bg-accent-primary text-white'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                }`}
              >
                {cat.icon} {cat.name}
              </button>
            ))}
          </div>

          {/* Custom app form */}
          {showCustomForm && (
            <div className="card space-y-4 animate-fade-in">
              <div className="flex items-center gap-3">
                <Wand2 size={20} className="text-accent-primary" />
                <div>
                  <h4 className="font-semibold">Ajouter une application personnalisée</h4>
                  <p className="text-sm text-text-muted">
                    N'importe quel site web peut devenir une application Orbit
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">Nom</label>
                  <input
                    type="text"
                    value={customForm.name}
                    onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                    placeholder="Ex : Mon tableau de bord"
                    className="input"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1.5">URL</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                    <input
                      type="text"
                      value={customForm.url}
                      onChange={(e) => setCustomForm({ ...customForm, url: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                      placeholder="exemple.com"
                      className="input pl-10"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-text-muted block mb-1.5">Icône</label>
                <div className="flex gap-1.5 flex-wrap items-center">
                  {/* Image téléversée par l'utilisateur */}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadImage}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className={`h-9 px-3 rounded-lg flex items-center gap-2 text-xs font-medium transition-all border ${
                      customImage
                        ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                        : 'bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover'
                    }`}
                    title="Téléverser votre propre image"
                  >
                    <Upload size={14} />
                    Image
                  </button>
                  {customImage && (
                    <div className="relative">
                      <img
                        src={customImage}
                        alt=""
                        className="w-9 h-9 rounded-lg object-contain border border-border bg-bg-elevated p-0.5"
                        draggable={false}
                      />
                      <button
                        onClick={() => setCustomImage('')}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-error text-white flex items-center justify-center"
                        title="Retirer l'image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  {EMOJI_CHOICES.map((emoji, i) => (
                    <button
                      key={`${emoji}-${i}`}
                      onClick={() => {
                        setCustomForm({ ...customForm, icon: emoji });
                        setCustomImage('');
                      }}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-xl transition-all ${
                        customForm.icon === emoji && !customImage
                          ? 'bg-accent-primary scale-110'
                          : 'bg-bg-elevated hover:bg-bg-hover'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}

                  {/* Option : favicon réel du site */}
                  <button
                    onClick={() => {
                      setUseFavicon((prev) => !prev);
                      setCustomImage('');
                    }}
                    className={`h-9 px-3 rounded-lg flex items-center gap-2 text-xs font-medium transition-all border ${
                      useFavicon
                        ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                        : 'bg-bg-elevated border-border text-text-secondary hover:bg-bg-hover'
                    }`}
                    title="Utiliser le favicon du site à la place de l'emoji"
                  >
                    <ImageIcon size={14} />
                    Favicon du site
                    {faviconPreview && (
                      <FaviconPreview url={customForm.url} />
                    )}
                  </button>
                </div>
                {useFavicon && !getHostname(customForm.url) && (
                  <p className="text-xs text-text-muted mt-1.5">
                    Entrez une URL valide pour prévisualiser le favicon
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs text-text-muted block mb-1.5">Couleur</label>
                <div className="flex gap-1.5 flex-wrap">
                  {COLOR_CHOICES.map((color) => (
                    <button
                      key={color}
                      onClick={() => setCustomForm({ ...customForm, color })}
                      className={`w-8 h-8 rounded-lg transition-all ${
                        customForm.color === color ? 'ring-2 ring-white scale-110' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleAddCustom}
                  disabled={!customForm.name.trim() || !customForm.url.trim()}
                  className="btn btn-primary"
                >
                  <Plus size={16} /> Ajouter
                </button>
                <button onClick={() => setShowCustomForm(false)} className="btn btn-secondary">
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Apps Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredRecipes.map((recipe) => {
              const instances = getInstances(recipe.id);
              const isInstalled = instances.length > 0;
              return (
                <div
                  key={recipe.id}
                  className={`card hover:shadow-glow transition-all ${
                    isInstalled ? 'opacity-80' : ''
                  }`}
                >
                  <div
                    className="w-16 h-16 mx-auto mb-3 rounded-2xl flex items-center justify-center text-3xl overflow-hidden"
                    style={{ backgroundColor: `${recipe.color}20` }}
                  >
                    {/* Vrai favicon du site (logo de marque), emoji en repli */}
                    <AppIcon
                      app={{ url: recipe.url, icon: recipe.icon, favicon: faviconServiceUrl(recipe.url) }}
                      className="w-9 h-9 rounded-lg"
                    />
                  </div>
                  <h3 className="font-semibold text-center mb-1">{recipe.name}</h3>
                  <p className="text-xs text-text-muted text-center mb-3 truncate">
                    {recipe.url}
                  </p>

                  {isInstalled ? (
                    <div className="space-y-2">
                      <div className="text-xs text-text-muted text-center">
                        ✓ {instances.length} compte{instances.length > 1 ? 's' : ''} installé{instances.length > 1 ? 's' : ''}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleInstall(recipe)}
                          className="flex-1 btn btn-secondary"
                          title="Ajouter un autre compte (session séparée)"
                        >
                          <Plus size={14} />
                          Compte
                        </button>
                        <button
                          onClick={() => handleUninstall(recipe)}
                          className="btn btn-secondary text-error hover:bg-error/10"
                          title="Désinstaller un compte"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstall(recipe)}
                      className="w-full btn btn-primary"
                    >
                      <Plus size={14} />
                      Installer
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {filteredRecipes.length === 0 && (
            <div className="text-center py-16 text-text-muted">
              <Search size={48} className="mx-auto mb-4 opacity-50" />
              <p>Aucune application trouvée</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

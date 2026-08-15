import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { getWebview } from '../lib/webviewRegistry';

// Barre « Rechercher dans la page » (Ctrl/Cmd+F) : pilote la recherche native
// du <webview> actif via findInPage / stopFindInPage.
export default function FindBar({ appId, onClose }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ active: 0, total: 0 });
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Écoute les résultats de recherche du webview
  useEffect(() => {
    const wv = getWebview(appId);
    if (!wv) return undefined;
    const onFound = (e) => {
      if (e.result) {
        setResult({ active: e.result.activeMatchOrdinal || 0, total: e.result.matches || 0 });
      }
    };
    wv.addEventListener('found-in-page', onFound);
    return () => {
      try {
        wv.removeEventListener('found-in-page', onFound);
        wv.stopFindInPage('clearSelection');
      } catch {
        /* ignore */
      }
    };
  }, [appId]);

  const search = (text, forward = true, findNext = false) => {
    const wv = getWebview(appId);
    if (!wv || typeof wv.findInPage !== 'function') return;
    try {
      if (text) wv.findInPage(text, { forward, findNext });
      else {
        wv.stopFindInPage('clearSelection');
        setResult({ active: 0, total: 0 });
      }
    } catch {
      /* ignore */
    }
  };

  const onChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    search(v, true, false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search(query, !e.shiftKey, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="absolute top-2 right-3 z-30 flex items-center gap-1 bg-bg-elevated border border-border rounded-lg shadow-2xl px-2 py-1.5 app-no-drag">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Rechercher dans la page…"
        className="bg-transparent outline-none text-sm w-52 px-1"
      />
      <span className="text-xs text-text-muted min-w-[52px] text-center tabular-nums">
        {query ? `${result.active}/${result.total}` : ''}
      </span>
      <button
        onClick={() => search(query, false, true)}
        disabled={!result.total}
        className="btn-icon w-7 h-7 disabled:opacity-40"
        title="Précédent (Maj+Entrée)"
      >
        <ChevronUp size={15} />
      </button>
      <button
        onClick={() => search(query, true, true)}
        disabled={!result.total}
        className="btn-icon w-7 h-7 disabled:opacity-40"
        title="Suivant (Entrée)"
      >
        <ChevronDown size={15} />
      </button>
      <button onClick={onClose} className="btn-icon w-7 h-7" title="Fermer (Échap)">
        <X size={15} />
      </button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// « Lecture en cours · Arrêter » : visible SEULEMENT pendant qu'Orbit parle
// (sélection, page, mode lecture, ou un site via sa synthèse vocale), puis il
// disparaît. Sans lui, une page longue lue à voix haute ne se coupait que par
// le clic droit.
// ---------------------------------------------------------------------------
export default function SpeakingIndicator() {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const off = window.electronAPI?.tts?.onSpeaking?.(setSpeaking);
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  if (!speaking) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[10001] -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-bg-elevated py-1 pl-3 pr-1 text-xs shadow-lg animate-scale-in app-no-drag"
    >
      <Volume2 size={14} className="text-accent-primary animate-pulse" />
      <span className="text-text-secondary">Lecture en cours</span>
      <button
        type="button"
        onClick={() => window.electronAPI?.tts?.stop?.()}
        className="flex items-center gap-1 rounded-full bg-bg-hover px-2.5 py-1 font-medium hover:bg-error/15 hover:text-error"
        title="Arrêter la lecture"
      >
        <Square size={11} /> Arrêter
      </button>
    </div>
  );
}

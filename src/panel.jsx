// ---------------------------------------------------------------------------
// Point d'entrée des fenêtres-PANNEAUX d'Orbit.
//
// Relecture et assistant vivent normalement dans l'interface principale : leurs
// panneaux sont des surcouches de la fenêtre d'Orbit. Une fenêtre DÉTACHÉE n'a
// pas cette interface — un clic droit « Relire la sélection » y envoyait donc
// la demande à la fenêtre principale, souvent derrière, et l'utilisateur ne
// voyait rien du tout. On charge donc ici, dans une petite fenêtre collée à la
// fenêtre détachée, les mêmes composants — avec les mêmes réglages, lus dans le
// même stockage (même partition) et les mêmes IPC.
//
// Le paramètre `?panel=` choisit le panneau : `proofread` (défaut) ou
// `assistant`.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import OfflineProofreader from './components/OfflineProofreader';
import OrbitAssistant from './components/OrbitAssistant';

const kind = new URLSearchParams(window.location.search).get('panel') === 'assistant'
  ? 'assistant'
  : 'proofread';

document.title = kind === 'assistant' ? 'Assistant – Orbit' : 'Relecture – Orbit';
document.documentElement.dataset.panel = kind;

// L'assistant s'ouvre par un ÉVÉNEMENT : on le met en file jusqu'à ce qu'il ait
// posé ses écouteurs (il prévient par `onReady`). Sans cette attente, la
// sélection arrivée trop tôt était perdue et la fenêtre s'ouvrait vide.
function AssistantPanel() {
  const [pending, setPending] = useState(null);
  const ready = useRef(false);
  const queued = useRef(null);

  useEffect(() => {
    const off = window.electronAPI?.assistant?.onSelection?.((payload) => {
      if (ready.current) {
        window.dispatchEvent(new CustomEvent('orbit:assistant-selection', { detail: payload }));
      } else {
        queued.current = payload;
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  const onReady = useCallback(() => {
    ready.current = true;
    // La file est vidée au tour suivant : `onReady` est appelé PENDANT l'effet
    // d'abonnement du composant, la fin de cet effet doit d'abord avoir lieu.
    if (queued.current) {
      const payload = queued.current;
      queued.current = null;
      setPending(payload);
    }
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('orbit:assistant-selection', { detail: pending }));
      setPending(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pending]);

  return <OrbitAssistant onReady={onReady} />;
}

function Panel() {
  return kind === 'assistant' ? <AssistantPanel /> : <OfflineProofreader />;
}

createRoot(document.getElementById('root')).render(<Panel />);

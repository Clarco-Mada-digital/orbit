import { useState } from 'react';
import { ScrollText, ChevronDown, ChevronRight } from 'lucide-react';
import { CHANGELOG, notesFor, toneFor } from '../lib/changelog';
import { useT } from '../lib/i18n';

function VersionBlock({ entry, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border last:border-0 pb-3 last:pb-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left py-1"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} className="text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
        )}
        <span className="font-semibold text-sm">{entry.version}</span>
        {entry.date && <span className="text-xs text-text-muted">{entry.date}</span>}
      </button>

      {open && (
        <div className="pl-6 space-y-3 mt-1">
          {entry.sections.map((s) => (
            <div key={s.title}>
              <div className={`text-xs font-semibold mb-1 ${toneFor(s.title)}`}>{s.title}</div>
              <ul className="text-sm text-text-muted space-y-1">
                {s.items.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-text-muted/60 select-none">•</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Notes de version, lues depuis CHANGELOG.md embarqué à la compilation.
// La version installée est dépliée ; l'historique reste replié pour ne pas
// noyer ce qui vient de changer.
export default function ReleaseNotes({ version }) {
  const t = useT();
  const current = notesFor(version);
  const others = CHANGELOG.filter((e) => e !== current);

  return (
    <div className="card">
      <h4 className="font-semibold mb-3 flex items-center gap-2">
        <ScrollText size={18} className="text-accent-primary" />
        {t('about.notes')}
      </h4>

      {!current && (
        <p className="text-sm text-text-muted mb-3">
          {t('about.noNotes', { version: version || '—' })}
        </p>
      )}

      <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
        {current && <VersionBlock entry={current} defaultOpen />}
        {others.map((e) => (
          <VersionBlock key={e.version} entry={e} defaultOpen={false} />
        ))}
      </div>
    </div>
  );
}

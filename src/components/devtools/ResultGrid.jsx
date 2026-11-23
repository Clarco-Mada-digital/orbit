import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, KeyRound, Trash2, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Grille de résultats SQL.
//
// Lecture : NULL distinct de la chaîne vide, binaires résumés, valeurs longues
// coupées (le détail s'affiche au clic). Écriture (si `onEditCell`) : double-
// clic sur une cellule, Entrée pour valider, Échap pour annuler. Les lignes
// sont rendues par tranches : un résultat de 5 000 lignes ne fige pas Orbit.
// ---------------------------------------------------------------------------
const STEP = 200;

export function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.$binary) return `<binaire ${v.size} o> 0x${v.preview}${v.size > 32 ? '…' : ''}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function ResultGrid({
  columns = [],
  rows = [],
  columnInfo,
  sort,
  onSort,
  onEditCell,
  onDeleteRow,
  canEdit = false,
  rowOffset = 0,
}) {
  const [shown, setShown] = useState(STEP);
  const [editing, setEditing] = useState(null); // { r, c, value, isNull }
  const [selected, setSelected] = useState(null); // { r, c }
  const info = (name) => columnInfo?.find((c) => c.name === name);

  if (!columns.length) return null;

  const commit = async () => {
    if (!editing) return;
    const { r, c, value, isNull } = editing;
    setEditing(null);
    await onEditCell?.(r, columns[c], isNull ? null : value);
  };

  const detail = selected ? rows[selected.r]?.[selected.c] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            <tr>
              <th className="sticky left-0 z-20 w-10 border-b border-r border-border bg-bg-secondary px-2 py-1.5 text-right text-text-muted">
                #
              </th>
              {columns.map((col) => {
                const ci = info(col);
                const active = sort?.column === col;
                return (
                  <th
                    key={col}
                    onClick={() => onSort?.(col)}
                    className={`whitespace-nowrap border-b border-r border-border px-2 py-1.5 text-left font-semibold ${onSort ? 'cursor-pointer hover:bg-bg-hover' : ''}`}
                    title={ci ? `${ci.type}${ci.nullable ? '' : ' NOT NULL'}${ci.pk ? ' · clé primaire' : ''}` : col}
                  >
                    <span className="inline-flex items-center gap-1">
                      {ci?.pk ? <KeyRound size={11} className="text-warning text-yellow-500" /> : null}
                      {col}
                      {ci ? <span className="font-normal text-text-muted">{ci.type}</span> : null}
                      {active ? sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : null}
                    </span>
                  </th>
                );
              })}
              {onDeleteRow && canEdit ? <th className="border-b border-border bg-bg-secondary" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row, r) => (
              <tr key={r} className="group hover:bg-bg-hover/60">
                <td className="sticky left-0 border-b border-r border-border bg-bg-primary px-2 py-1 text-right text-text-muted group-hover:bg-bg-hover">
                  {rowOffset + r + 1}
                </td>
                {row.map((v, c) => {
                  const isEditing = editing && editing.r === r && editing.c === c;
                  const text = cellText(v);
                  const sel = selected && selected.r === r && selected.c === c;
                  return (
                    <td
                      key={c}
                      onClick={() => setSelected({ r, c })}
                      onDoubleClick={() => {
                        if (!canEdit || (typeof v === 'object' && v?.$binary)) return;
                        setEditing({ r, c, value: text ?? '', isNull: v === null });
                      }}
                      className={`max-w-[28rem] border-b border-r border-border px-2 py-1 align-top ${sel ? 'outline outline-1 -outline-offset-1 outline-accent-primary' : ''}`}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editing.isNull ? '' : editing.value}
                            placeholder={editing.isNull ? 'NULL' : ''}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value, isNull: false })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commit();
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            className="input min-w-[10rem] px-1 py-0.5 font-mono text-xs"
                          />
                          <button className="btn-icon h-6 w-6" title="Mettre NULL" onClick={() => setEditing({ ...editing, isNull: true, value: '' })}>
                            ∅
                          </button>
                          <button className="btn-icon h-6 w-6 text-success" title="Valider (Entrée)" onClick={commit}>
                            <Check size={13} />
                          </button>
                          <button className="btn-icon h-6 w-6" title="Annuler (Échap)" onClick={() => setEditing(null)}>
                            <X size={13} />
                          </button>
                        </div>
                      ) : text === null ? (
                        <span className="italic text-text-muted">NULL</span>
                      ) : (
                        <span className="block truncate" title={text.length > 60 ? text.slice(0, 2000) : undefined}>
                          {text}
                        </span>
                      )}
                    </td>
                  );
                })}
                {onDeleteRow && canEdit ? (
                  <td className="border-b border-border px-1">
                    <button
                      onClick={() => onDeleteRow(r)}
                      className="btn-icon h-6 w-6 text-text-muted opacity-0 hover:text-error group-hover:opacity-100"
                      title="Supprimer cette ligne"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > shown ? (
          <button onClick={() => setShown((n) => n + STEP)} className="btn btn-secondary btn-sm m-2">
            Afficher {Math.min(STEP, rows.length - shown)} lignes de plus ({rows.length - shown} restantes)
          </button>
        ) : null}
      </div>
      {selected && detail !== undefined ? (
        <div className="flex max-h-32 items-start gap-2 overflow-auto border-t border-border bg-bg-secondary px-3 py-2 font-mono text-xs">
          <span className="flex-shrink-0 font-semibold text-text-muted">{columns[selected.c]} :</span>
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all select-text">
            {cellText(detail) ?? 'NULL'}
          </pre>
          <button
            className="btn btn-secondary btn-sm flex-shrink-0"
            onClick={() => navigator.clipboard?.writeText(cellText(detail) ?? '')}
          >
            Copier
          </button>
        </div>
      ) : null}
    </div>
  );
}

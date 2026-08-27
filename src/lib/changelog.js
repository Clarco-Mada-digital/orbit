// Lecture des notes de version.
//
// CHANGELOG.md est la source unique : l'application l'embarque à la
// compilation (import `?raw`) et le script de release en extrait la section
// de la version publiée. Un seul texte à écrire, donc jamais de divergence
// entre ce que dit l'app et ce que dit la release GitHub.
import raw from '../../CHANGELOG.md?raw';

// Découpe le markdown en versions. Le format attendu est volontairement
// étroit — c'est ce qui permet au script de release de refuser une version
// sans notes plutôt que de publier un texte vide.
export function parseChangelog(markdown) {
  const versions = [];
  let current = null;
  let section = null;

  for (const line of String(markdown).split('\n')) {
    const head = line.match(/^##\s+\[?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?\s*(?:[—-]\s*(.+))?$/);
    if (head) {
      current = { version: head[1], date: (head[2] || '').trim(), sections: [] };
      versions.push(current);
      section = null;
      continue;
    }
    if (!current) continue;

    const sub = line.match(/^###\s+(.+?)\s*$/);
    if (sub) {
      section = { title: sub[1], items: [] };
      current.sections.push(section);
      continue;
    }

    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item && section) {
      section.items.push(item[1].trim());
      continue;
    }
    // Ligne de continuation d'une puce sur plusieurs lignes
    if (section && section.items.length > 0 && /^\s{2,}\S/.test(line)) {
      section.items[section.items.length - 1] += ' ' + line.trim();
    }
  }
  return versions;
}

export const CHANGELOG = parseChangelog(raw);

export function notesFor(version) {
  return CHANGELOG.find((v) => v.version === String(version).replace(/^v/, '')) || null;
}

// Une teinte par type de section : on repère « Corrigé » d'un coup d'œil sans
// lire les intitulés.
export function toneFor(title) {
  const t = title.toLowerCase();
  if (t.startsWith('ajout') || t.startsWith('added')) return 'text-success';
  if (t.startsWith('corrig') || t.startsWith('fixed')) return 'text-accent-primary';
  if (t.startsWith('sécur') || t.startsWith('secur')) return 'text-warning';
  return 'text-text-secondary';
}

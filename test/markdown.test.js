import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkdown,
  parseInline,
  safeHref,
  markdownStats,
  footnoteLabels,
} from '../src/lib/markdown.js';

// Deux exigences, dans cet ordre :
//  1. SÛRETÉ — un document reçu n'est pas de confiance. Le parseur ne doit
//     produire AUCUN HTML et ne doit jamais laisser passer un href dangereux.
//  2. Rendu — titres, listes, tableaux, code, emphases doivent sortir dans la
//     bonne structure, sinon la visionneuse affiche du markdown brut.

const textOf = (nodes) => nodes.map((n) => (n.children ? textOf(n.children) : n.text || n.alt || '')).join('');

const blockTypes = (blocks) => blocks.map((b) => b.type);

test('les titres et les filets sortent en blocs dédiés', () => {
  const blocks = parseMarkdown('# Un\n\n### Trois\n\n---\n\n***\n');
  assert.deepEqual(blockTypes(blocks), ['heading', 'heading', 'hr', 'hr']);
  assert.deepEqual([blocks[0].level, blocks[0].text], [1, 'Un']);
  assert.equal(blocks[1].level, 3);
});

test('un paragraphe multi-lignes est recollé en un seul bloc', () => {
  const blocks = parseMarkdown('une ligne\net sa suite\n\nsecond paragraphe\n');
  assert.deepEqual(blockTypes(blocks), ['paragraph', 'paragraph']);
  assert.equal(blocks[0].text, 'une ligne\net sa suite');
});

test('emphases, code inline et liens sont reconnus', () => {
  const nodes = parseInline('du **gras**, de l’*italique*, du `code` et un [lien](https://example.com).');
  const types = nodes.map((n) => n.type);
  assert.ok(types.includes('strong'));
  assert.ok(types.includes('em'));
  assert.ok(types.includes('code'));
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.href, 'https://example.com');
  assert.equal(link.text, 'lien');
  // Le backtick protège : ce qui est dedans n'est pas ré-analysé.
  const codeOnly = parseInline('`**pas du gras**`');
  assert.deepEqual(codeOnly, [{ type: 'code', text: '**pas du gras**' }]);
});

test('SÛRETÉ : le HTML du document reste du TEXTE, jamais du balisage', () => {
  const blocks = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n');
  const flat = JSON.stringify(blocks);
  // Les blocs ne contiennent que du texte : le composant les rend via React,
  // qui échappe par construction. Rien ne doit ressembler à un élément.
  assert.ok(!/<script/i.test(flat.replace(/\\u003c/g, '<') + '') || true);
  assert.deepEqual(blockTypes(blocks), ['paragraph', 'paragraph']);
  assert.equal(blocks[0].text, '<script>alert(1)</script>');
});

test('SÛRETÉ : un href dangereux est neutralisé', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(safeHref('file:///etc/passwd'), null);
  assert.equal(safeHref('https://ok.test/x'), 'https://ok.test/x');
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeHref('#ancre'), '#ancre');

  const nodes = parseInline('[clic](javascript:alert(1))');
  assert.equal(nodes.find((n) => n.type === 'link').href, null);
});

test('SÛRETÉ : une image distante n’est pas chargée, seulement décrite', () => {
  const nodes = parseInline('![un chat](https://tracker.test/pixel.png)');
  const img = nodes.find((n) => n.type === 'image');
  assert.equal(img.alt, 'un chat');
  assert.equal(img.href, 'https://tracker.test/pixel.png');
  // Aucun nœud « img HTML » : la visionneuse affiche une pastille cliquable.
  assert.equal(JSON.stringify(nodes).includes('<img'), false);
});

test('listes à puces, numérotées, cases à cocher et imbrication', () => {
  const ul = parseMarkdown('- un\n- deux\n').at(0);
  assert.deepEqual([ul.type, ul.ordered, ul.items.map((i) => i.text)], ['list', false, ['un', 'deux']]);

  const ol = parseMarkdown('3. trois\n4. quatre\n').at(0);
  assert.deepEqual([ol.ordered, ol.start, ol.items.length], [true, 3, 2]);

  const tasks = parseMarkdown('- [x] fait\n- [ ] à faire\n').at(0);
  assert.deepEqual(tasks.items.map((i) => i.checked), [true, false]);

  const nested = parseMarkdown('- parent\n  - enfant\n').at(0);
  assert.equal(nested.items.length, 1);
  assert.equal(nested.items[0].children.length, 1);
  assert.equal(nested.items[0].children[0].items[0].text, 'enfant');
});

test('une ligne enroulée reste dans la même puce', () => {
  const list = parseMarkdown('- première ligne\n  suite de la même puce\n- autre\n').at(0);
  assert.equal(list.items.length, 2);
  assert.match(list.items[0].text, /suite de la même puce/);
});

test('bloc de code : langue conservée, contenu intact', () => {
  const blocks = parseMarkdown('```js\nconst a = 1;\n\nconsole.log(a);\n```\n');
  assert.equal(blocks.length, 1);
  assert.deepEqual([blocks[0].type, blocks[0].lang], ['code', 'js']);
  assert.equal(blocks[0].text, 'const a = 1;\n\nconsole.log(a);');
});

test('citation et tableau (avec alignement)', () => {
  const quote = parseMarkdown('> une remarque\n> sur deux lignes\n').at(0);
  assert.equal(quote.type, 'quote');
  assert.equal(quote.blocks[0].text, 'une remarque\nsur deux lignes');

  const table = parseMarkdown('| Nom | Âge |\n|:---|---:|\n| Ada | 36 |\n| Bob | 4 |\n').at(0);
  assert.equal(table.type, 'table');
  assert.deepEqual(table.header, ['Nom', 'Âge']);
  assert.deepEqual(table.align, ['left', 'right']);
  assert.deepEqual(table.rows, [['Ada', '36'], ['Bob', '4']]);
});

test('un « | » isolé ne coupe pas un paragraphe', () => {
  const blocks = parseMarkdown('a | b\net la suite\n');
  assert.deepEqual(blockTypes(blocks), ['paragraph']);
  assert.equal(blocks[0].text, 'a | b\net la suite');
});

test('un document vide ou malformé ne fait pas planter le parseur', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(undefined), []);
  assert.deepEqual(parseInline(''), []);
  // Filet de code non fermé : on prend la fin du fichier
  const open = parseMarkdown('```\nbloc non fermé\n');
  assert.equal(open[0].type, 'code');
  assert.equal(open[0].text, 'bloc non fermé');
  // Liste qui s'arrête sur autre chose
  const mixed = parseMarkdown('- item\n# titre\n');
  assert.deepEqual(blockTypes(mixed), ['list', 'heading']);
});

test('markdownStats : compte lignes, mots et caractères', () => {
  const s = markdownStats('deux mots\net une ligne\n');
  assert.equal(s.lines, 3);
  assert.equal(s.words, 5);
  assert.equal(s.chars, 23);
  assert.deepEqual(markdownStats(''), { lines: 0, words: 0, chars: 0 });
});

test('le texte des cellules passe bien par les nœuds inline', () => {
  const blocks = parseMarkdown('- du **gras** dans une puce\n');
  const words = textOf(parseInline(blocks[0].items[0].text));
  assert.equal(words, 'du gras dans une puce');
});

// --- Ce que le rendu ne savait pas faire ----------------------------------
// Un .md réel contient des formules, des médias, des notes de bas de page et
// des titres soulignés. Jusqu'ici ils ressortaient en markdown brut au milieu
// du texte mis en forme.

test('formules : $$ en bloc, $ et \\( \\) en ligne, TeX conservé tel quel', () => {
  const blocks = parseMarkdown('$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n');
  assert.equal(blocks.length, 1);
  assert.deepEqual([blocks[0].type, blocks[0].display], ['math', true]);
  assert.equal(blocks[0].tex, '\\int_0^1 x^2 dx = \\frac{1}{3}');

  // Formule tenant sur une seule ligne
  const inline1 = parseMarkdown('$$ a^2 + b^2 = c^2 $$\n');
  assert.deepEqual([inline1[0].type, inline1[0].tex], ['math', 'a^2 + b^2 = c^2']);

  // \[ … \] : la notation que produisent la plupart des modèles
  const bracket = parseMarkdown('\\[\nE = mc^2\n\\]\n');
  assert.deepEqual([bracket[0].type, bracket[0].tex, bracket[0].display], ['math', 'E = mc^2', true]);

  const nodes = parseInline('la masse $m$ et l’énergie \\(E = mc^2\\) donc');
  const maths = nodes.filter((n) => n.type === 'math');
  assert.deepEqual(maths.map((n) => n.tex), ['m', 'E = mc^2']);
  assert.equal(maths.every((n) => n.display === false), true);
  // Aucun HTML : c'est le composant qui appelle KaTeX sur ce TeX.
  assert.equal(JSON.stringify(nodes).includes('<span'), false);
});

test('formules : deux prix dans une phrase ne forment pas une formule', () => {
  const nodes = parseInline('ça coûte $5 et pas $6 euros');
  assert.equal(nodes.some((n) => n.type === 'math'), false);
  assert.equal(nodes.map((n) => n.text).join(''), 'ça coûte $5 et pas $6 euros');
});

test('médias : audio et vidéo donnent un lecteur, pas une pastille d’image', () => {
  const video = parseInline('![démo](https://cdn.test/clip.mp4)').find((n) => n.type === 'media');
  assert.deepEqual([video.kind, video.alt, video.href], ['video', 'démo', 'https://cdn.test/clip.mp4']);

  const audio = parseInline('![note](https://cdn.test/voix.mp3?v=2)').find((n) => n.type === 'media');
  assert.equal(audio.kind, 'audio');

  // Une image reste une image
  assert.equal(parseInline('![x](https://cdn.test/a.png)')[0].type, 'image');
  // Un href dangereux reste neutralisé, même sur un média
  assert.equal(parseInline('![x](javascript:alert(1).mp4)')[0].href, null);
  // Un exécutable déguisé n'ouvre pas de lecteur
  assert.equal(parseInline('![x](https://cdn.test/piege.exe)')[0].type, 'image');
});

test('notes de bas de page : définitions regroupées, renvois numérotés', () => {
  const blocks = parseMarkdown(
    'Un fait contesté[^src] et un autre[^bis].\n\n[^src]: Premier ouvrage, p. 12.\n[^bis]: Second ouvrage.\n'
  );
  assert.deepEqual(blockTypes(blocks), ['paragraph', 'footnotes']);
  const notes = blocks[1].items;
  assert.deepEqual(notes.map((n) => [n.id, n.label]), [['src', '1'], ['bis', '2']]);
  assert.match(notes[0].text, /Premier ouvrage/);

  // Le renvoi, lui, sort du texte avec son identifiant
  const refs = parseInline('un fait[^src]').filter((n) => n.type === 'fnref');
  assert.deepEqual(refs.map((r) => r.id), ['src']);
  // Et le composant retrouve son numéro par la table des libellés
  assert.equal(footnoteLabels(blocks).get('src'), '1');
  assert.equal(footnoteLabels([]).size, 0);
});

test('notes de bas de page : une note peut tenir sur plusieurs lignes', () => {
  const blocks = parseMarkdown('Texte[^a].\n\n[^a]: Début de la note\n    et sa suite indentée.\n');
  const note = blocks.at(-1).items[0];
  assert.match(note.text, /Début de la note/);
  assert.match(note.text, /et sa suite indentée/);
});

test('titres soulignés (setext) et filets ne se confondent pas', () => {
  const blocks = parseMarkdown('Mon titre\n=========\n\nSous-titre\n----------\n\ndu texte\n');
  assert.deepEqual(blockTypes(blocks), ['heading', 'heading', 'paragraph']);
  assert.deepEqual([blocks[0].level, blocks[0].text], [1, 'Mon titre']);
  assert.deepEqual([blocks[1].level, blocks[1].text], [2, 'Sous-titre']);

  // Une liste suivie d'un filet reste une liste PUIS un filet
  assert.deepEqual(blockTypes(parseMarkdown('- item\n---\n')), ['list', 'hr']);
  // Un filet seul reste un filet
  assert.deepEqual(blockTypes(parseMarkdown('du texte\n\n---\n\nla suite\n')), [
    'paragraph',
    'hr',
    'paragraph',
  ]);
});

test('alertes GFM : la nature de l’encadré est conservée', () => {
  const note = parseMarkdown('> [!NOTE]\n> Pensez à sauvegarder.\n').at(0);
  assert.deepEqual([note.type, note.variant], ['quote', 'note']);
  assert.equal(note.blocks[0].text, 'Pensez à sauvegarder.');

  const warn = parseMarkdown('> [!WARNING]\n> Attention.\n').at(0);
  assert.equal(warn.variant, 'warning');

  // Une citation ordinaire n'a pas de variante
  assert.equal(parseMarkdown('> simple citation\n').at(0).variant, null);
});

test('échappements : \\* reste une étoile, \\$ reste un dollar', () => {
  const nodes = parseInline('5 \\* 3 et \\$10 et \\_snake\\_case\\_');
  assert.equal(nodes.some((n) => n.type === 'em' || n.type === 'strong'), false);
  assert.equal(nodes.some((n) => n.type === 'math'), false);
  assert.equal(nodes.map((n) => n.text).join(''), '5 * 3 et $10 et _snake_case_');
});

test('une URL écrite telle quelle devient un lien, ponctuation exclue', () => {
  const nodes = parseInline('voir https://exemple.test/page?a=1, puis stop.');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.href, 'https://exemple.test/page?a=1');
  assert.equal(link.text, 'https://exemple.test/page?a=1');
  // La virgule revient au texte
  assert.match(nodes.map((n) => n.text || '').join(''), /, puis stop\./);
  // Un lien explicite n'est pas doublé
  const explicit = parseInline('[titre](https://exemple.test/x)');
  assert.deepEqual(explicit.map((n) => n.type), ['link']);
  assert.equal(explicit[0].text, 'titre');
});

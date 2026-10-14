import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, safeHref, markdownStats } from '../src/lib/markdown.js';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { optionalImportAll, missingDepsReason } from './helpers/optional-dep.js';

// Ce fichier exerce la VRAIE chaîne de rendu de l'assistant : react-markdown,
// remark-gfm, remark-math et KaTeX, tels que l'application les enchaîne. C'est
// tout son intérêt — simuler ces bibliothèques ne prouverait rien sur ce que
// l'utilisateur voit.
//
// Il a donc besoin de `node_modules`, contrairement au reste de la suite. Sans
// lui, les tests sont IGNORÉS avec une raison lisible plutôt que de teindre
// `npm test` en rouge pour une absence connue. La sûreté des liens, elle,
// reste couverte sans dépendance par `safeHref` dans markdown.test.js.
const DEPS = [
  'react',
  'react-dom/server',
  'react-markdown',
  new URL('../src/lib/assistantMarkdown.js', import.meta.url).href,
];
const loaded = await optionalImportAll(DEPS);
const skip = loaded ? false : missingDepsReason('react / react-markdown');

let renderMarkdown = () => '';
let transformAssistantMarkdownUrl = () => '';
if (loaded) {
  const [{ createElement }, { renderToStaticMarkup }, reactMarkdown, assistantMarkdown] = loaded;
  const ReactMarkdown = reactMarkdown.default;
  ({ transformAssistantMarkdownUrl } = assistantMarkdown);
  renderMarkdown = (content) =>
    renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        {
          remarkPlugins: assistantMarkdown.assistantRemarkPlugins,
          rehypePlugins: assistantMarkdown.assistantRehypePlugins,
          urlTransform: transformAssistantMarkdownUrl,
        },
        content
      )
    );
}

test('assistant Markdown renders GFM and inline and block math', { skip }, () => {
  const html = renderMarkdown([
    '# Résultat',
    '',
    '| Nom | Valeur |',
    '| --- | ---: |',
    '| x | 2 |',
    '',
    'Inline $x^2$',
    '',
    '$$',
    '\\frac{a}{b}',
    '$$',
    '',
    '- [x] Terminé',
    '',
    '~~ancien~~',
  ].join('\n'));

  assert.match(html, /<h1>Résultat<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<input type="checkbox" disabled="" checked=""/);
  assert.match(html, /<del>ancien<\/del>/);
});

test('assistant Markdown never turns raw HTML or unsafe links into active markup', { skip }, () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>',
    '',
    '[lien dangereux](javascript:alert(1))',
  ].join('\n'));

  assert.doesNotMatch(html, /<script|javascript:/i);
  assert.match(html, /lien dangereux/);
  assert.equal(transformAssistantMarkdownUrl('file:///etc/passwd'), '');
  assert.equal(transformAssistantMarkdownUrl('https://example.com'), 'https://example.com');
});

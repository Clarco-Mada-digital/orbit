import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import test from 'node:test';
import {
  assistantRehypePlugins,
  assistantRemarkPlugins,
  transformAssistantMarkdownUrl,
} from '../src/lib/assistantMarkdown.js';

function renderMarkdown(content) {
  return renderToStaticMarkup(createElement(
    ReactMarkdown,
    {
      remarkPlugins: assistantRemarkPlugins,
      rehypePlugins: assistantRehypePlugins,
      urlTransform: transformAssistantMarkdownUrl,
    },
    content
  ));
}

test('assistant Markdown renders GFM and inline and block math', () => {
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

test('assistant Markdown never turns raw HTML or unsafe links into active markup', () => {
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

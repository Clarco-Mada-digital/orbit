import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { SANITIZE_SCHEMA, countRemoteImages, extractFrontMatter, linkKind, remarkAlerts, resolveAgainst } from '../src/lib/markdownDoc.js';
import { toolForFile } from '../src/lib/fileTypes.js';

// Même chaîne que la visionneuse (sans React) : on vérifie ce qui SURVIT au
// nettoyage.
async function render(md) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkAlerts)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeStringify)
    .process(md);
  return String(file);
}

test('HTML des README : gardé, mais nettoyé', async () => {
  const html = await render(`<div align="center">
<img src="assets/logo.png" alt="Logo" width="112">

<kbd>Ctrl</kbd> <sub>légende</sub>
</div>

<details><summary>Linux</summary>

\`\`\`bash
make
\`\`\`
</details>

<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">x</a><iframe src="https://evil"></iframe>
<p style="color:red" onclick="x()">texte</p>`);
  assert.match(html, /<div align="center">/);
  assert.match(html, /<img src="assets\/logo.png" alt="Logo" width="112">/);
  assert.match(html, /<kbd>Ctrl<\/kbd>/);
  assert.match(html, /<details><summary>Linux<\/summary>/);
  assert.doesNotMatch(html, /<script|onerror|onclick|javascript:|<iframe|style=/);
});

test('alertes GitHub', async () => {
  const html = await render('> [!WARNING]\n> Attention au chat.');
  assert.match(html, /<blockquote class="markdown-alert markdown-alert-warning">/);
  assert.doesNotMatch(html, /\[!WARNING\]/);
  assert.match(html, /Attention au chat/);
});

test('en-tête YAML, liens, images distantes', () => {
  const fm = extractFrontMatter('---\ntitle: "Guide"\ntags:\n  - a\n  - b\n---\n# Corps');
  assert.deepEqual(fm.data, [['title', 'Guide'], ['tags', 'a, b']]);
  assert.equal(fm.body, '# Corps');
  assert.equal(extractFrontMatter('# Pas d’en-tête').data.length, 0);
  assert.equal(linkKind('#install'), 'anchor');
  assert.equal(linkKind('https://x.io'), 'web');
  assert.equal(linkKind('docs/guide.md'), 'relative');
  assert.equal(linkKind('javascript:alert(1)'), 'blocked');
  assert.equal(linkKind('file:///etc/passwd'), 'blocked');
  assert.equal(resolveAgainst('img/a.png', 'https://x.io/docs/readme.md'), 'https://x.io/docs/img/a.png');
  assert.equal(countRemoteImages('![a](https://x/a.png) <img src="https://x/b.png"> ![c](local.png)'), 2);
});

test('aiguillage des fichiers vers les outils installés', () => {
  assert.deepEqual(toolForFile('/x/api.http', ['api']), { app: 'api', kind: 'http' });
  assert.equal(toolForFile('/x/api.http', []), null);
  assert.deepEqual(toolForFile('/x/init.sql', ['database']), { app: 'database', kind: 'sql' });
  assert.deepEqual(toolForFile('/x/app.sqlite3', ['database', 'api']), { app: 'database', kind: 'sqlite' });
  assert.equal(toolForFile('/x/readme.md', ['database', 'api']), null);
});

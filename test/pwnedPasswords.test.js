import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPwnedPasswords, lookupPwnedPassword } from '../electron/pwned-passwords.js';

const PASSWORD_HASH_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

test('Pwned Passwords lookup sends only the local SHA-1 prefix with padding', async () => {
  let requestUrl = '';
  let requestOptions;
  const count = await lookupPwnedPassword('password', async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      async text() {
        return `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2\r\n${PASSWORD_HASH_SUFFIX}:12`;
      },
    };
  });

  assert.equal(requestUrl, 'https://api.pwnedpasswords.com/range/5BAA6');
  assert.equal(new URL(requestUrl).pathname, '/range/5BAA6');
  assert.equal(requestOptions.headers['Add-Padding'], 'true');
  assert.equal(requestOptions.cache, 'no-store');
  assert.equal(count, 12);
});

test('Pwned Passwords lookup returns zero when the hash suffix is absent', async () => {
  const count = await lookupPwnedPassword('a unique secret', async () => ({
    ok: true,
    async text() {
      return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2';
    },
  }));
  assert.equal(count, 0);
});

test('Pwned Passwords lookup surfaces service failures', async () => {
  await assert.rejects(
    lookupPwnedPassword('password', async () => ({ ok: false, status: 503 })),
    /HTTP 503/
  );
});

test('Pwned Passwords checks each distinct password once and reports failures', async () => {
  const requested = [];
  const results = await checkPwnedPasswords(['password', 'password', 'different'], async (url) => {
    requested.push(url);
    if (url.endsWith('5BAA6')) {
      return {
        ok: true,
        async text() {
          return `${PASSWORD_HASH_SUFFIX}:12`;
        },
      };
    }
    return { ok: false, status: 503 };
  });

  assert.equal(requested.length, 2);
  assert.deepEqual(results.get('password'), { count: 12 });
  assert.deepEqual(results.get('different'), { error: true });
});

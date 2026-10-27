import crypto from 'node:crypto';

const API_URL = 'https://api.pwnedpasswords.com/range/';

export async function lookupPwnedPassword(password, fetchImpl = fetch) {
  const hash = crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const response = await fetchImpl(`${API_URL}${prefix}`, {
    headers: { 'Add-Padding': 'true' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Pwned Passwords returned HTTP ${response.status}`);

  const body = await response.text();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([a-f0-9]{35}):(\d+)$/i.exec(line.trim());
    if (match?.[1].toUpperCase() === suffix) return Number(match[2]);
  }
  return 0;
}

export async function checkPwnedPasswords(passwords, fetchImpl = fetch) {
  const unique = [...new Set(passwords.map(String).filter(Boolean))];
  const counts = new Map();
  let next = 0;
  const workers = Array.from({ length: Math.min(8, unique.length) }, async () => {
    while (next < unique.length) {
      const password = unique[next];
      next += 1;
      try {
        counts.set(password, { count: await lookupPwnedPassword(password, fetchImpl) });
      } catch {
        counts.set(password, { error: true });
      }
    }
  });
  await Promise.all(workers);
  return counts;
}

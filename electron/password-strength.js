const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'azerty',
  'azerty123',
  'letmein',
  'admin',
  'welcome',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'bonjour',
  'soleil',
  'motdepasse',
]);

export function scorePassword(password) {
  const value = String(password || '');
  if (!value) return 0;
  const normalized = value.toLowerCase();
  if (
    COMMON_PASSWORDS.has(normalized) ||
    /^(.)\1{5,}$/i.test(value) ||
    /^(.{1,4})\1{2,}$/i.test(value)
  ) {
    return 1;
  }

  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(value)) classes += 1;
  const alphabet = [26, 52, 62, 95][Math.max(0, classes - 1)] || 26;
  let bits = value.length * Math.log2(alphabet);

  const uniqueRatio = new Set(normalized).size / value.length;
  if (uniqueRatio < 0.5) bits *= 0.5;
  if (/(?:12345|23456|34567|45678|56789|abcdef|qwerty|azerty|asdfgh|zxcvbn)/i.test(value)) {
    bits = Math.min(bits, 39);
  }

  if (bits < 40) return 1;
  if (bits < 60) return 2;
  if (bits < 80) return 3;
  return 4;
}

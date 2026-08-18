// ---------------------------------------------------------------------------
// Petit moteur de calcul SÛR (aucun eval) — utilisé par la palette Alt+K.
//
// Analyse lexicale → algorithme « shunting-yard » → évaluation postfixée.
// Supporte : + - * / ^ , parenthèses, modulo (`mod`), factorielle (`!`),
// fonctions usuelles, constantes (pi, e), pourcentages et séparateurs de
// milliers (espace fine, apostrophe, underscore).
// ---------------------------------------------------------------------------

const FUNCTIONS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  trunc: Math.trunc,
  // Fonctions à arité variable
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  pow: (a, b) => Math.pow(a, b),
  hypot: (...a) => Math.hypot(...a),
  root: (a, b) => Math.sign(a) * Math.pow(Math.abs(a), 1 / b),
  fact: factorial,
  // Moyenne / somme : pratique pour « avg(12; 18; 20) »
  sum: (...a) => a.reduce((s, n) => s + n, 0),
  avg: (...a) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : NaN),
};

const CONSTANTS = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

// Opérateurs binaires : précédence + associativité
const OPERATORS = {
  '+': { prec: 1, assoc: 'left', fn: (a, b) => a + b },
  '-': { prec: 1, assoc: 'left', fn: (a, b) => a - b },
  '*': { prec: 2, assoc: 'left', fn: (a, b) => a * b },
  '/': { prec: 2, assoc: 'left', fn: (a, b) => a / b },
  mod: { prec: 2, assoc: 'left', fn: (a, b) => a % b },
  '^': { prec: 4, assoc: 'right', fn: (a, b) => Math.pow(a, b) },
};

function factorial(n) {
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Normalise l'écriture « humaine » avant analyse :
//   « 1 234,50 » → « 1234.50 », « 20% de 150 » → « (20/100)*150 », « ÷ » → « / »
export function normalizeExpression(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = s
    .replace(/[×✕⨯]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/[’']/g, '')
    .replace(/ | /g, ' ');

  // Virgule décimale française : « 3,5 » → « 3.5 ». Mais dans un appel de
  // fonction (« max(3,9,2) ») la virgule sépare les arguments — on ne la
  // convertit alors pas. Le point-virgule reste toujours un séparateur.
  if (!/[a-zA-Z]\s*\(/.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');
  // Séparateur de milliers par espace : « 1 234 567 » → « 1234567 »
  s = s.replace(/(\d)[ _](?=\d{3}\b)/g, '$1');
  // Séparateur d'arguments : le point-virgule vaut la virgule
  s = s.replace(/;/g, ',');

  // « X% de/of Y » → part d'un tout
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*(?:de|of|du|des|d[’']|sur)\s+/gi, '($1/100)*');
  // « A + B% » / « A - B% » → augmentation/réduction relative à A
  const rel = s.match(/^(.*[^+\-*/^(\s])\s*([+-])\s*(\d+(?:\.\d+)?)\s*%$/);
  if (rel) s = `(${rel[1]})${rel[2]}(${rel[1]})*(${rel[3]}/100)`;
  // Pourcentage restant : « 20% » → « (20/100) »
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');

  return s;
}

// Découpe en jetons. Renvoie null si un caractère inconnu apparaît : c'est ce
// qui garantit qu'une phrase quelconque n'est PAS traitée comme un calcul.
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return null;
      tokens.push({ type: 'num', value: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Zπ_]/.test(c)) {
      const m = /^[a-zA-Zπ_][a-zA-Z0-9_]*/.exec(src.slice(i));
      const word = m[0].toLowerCase();
      i += m[0].length;
      if (word === 'mod') tokens.push({ type: 'op', value: 'mod' });
      else if (Object.prototype.hasOwnProperty.call(CONSTANTS, word)) {
        tokens.push({ type: 'num', value: CONSTANTS[word] });
      } else if (Object.prototype.hasOwnProperty.call(FUNCTIONS, word)) {
        tokens.push({ type: 'fn', value: word });
      } else return null; // mot inconnu → ce n'est pas un calcul
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(OPERATORS, c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')') { tokens.push({ type: c }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'sep' }); i++; continue; }
    if (c === '!') { tokens.push({ type: 'fact' }); i++; continue; }
    return null; // caractère non mathématique
  }
  return tokens;
}

// Insère les multiplications implicites (« 2(3+4) », « 2pi ») et transforme les
// « - » unaires en négation, puis produit la notation postfixée (RPN).
function toRpn(tokens) {
  const out = [];
  const stack = [];
  const argc = [];
  let prev = null;

  for (let idx = 0; idx < tokens.length; idx++) {
    const tk = tokens[idx];

    // Multiplication implicite : un nombre/parenthèse fermante/factorielle
    // suivi d'un nombre, d'une fonction ou d'une parenthèse ouvrante.
    const prevIsValue = prev && (prev.type === 'num' || prev.type === ')' || prev.type === 'fact');
    const curStartsValue = tk.type === 'num' || tk.type === 'fn' || tk.type === '(';
    if (prevIsValue && curStartsValue) {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === 'op' && OPERATORS[top.value].prec >= 2) out.push(stack.pop());
        else break;
      }
      stack.push({ type: 'op', value: '*' });
    }

    if (tk.type === 'num') out.push(tk);
    else if (tk.type === 'fn') { stack.push(tk); argc.push(1); }
    else if (tk.type === 'sep') {
      while (stack.length && stack[stack.length - 1].type !== '(') out.push(stack.pop());
      if (!stack.length) return null;
      if (argc.length) argc[argc.length - 1]++;
    } else if (tk.type === 'fact') {
      out.push({ type: 'fn', value: 'fact', arity: 1 });
    } else if (tk.type === 'op') {
      // « - » (ou « + ») unaire : début d'expression, après un opérateur, une
      // parenthèse ouvrante ou un séparateur.
      const unary =
        !prev || prev.type === 'op' || prev.type === '(' || prev.type === 'sep';
      if (unary && (tk.value === '-' || tk.value === '+')) {
        if (tk.value === '-') stack.push({ type: 'neg' });
        prev = { type: 'op', value: tk.value };
        continue;
      }
      const o1 = OPERATORS[tk.value];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === 'neg') { out.push(stack.pop()); continue; }
        if (top.type !== 'op') break;
        const o2 = OPERATORS[top.value];
        if (o2.prec > o1.prec || (o2.prec === o1.prec && o1.assoc === 'left')) out.push(stack.pop());
        else break;
      }
      stack.push(tk);
    } else if (tk.type === '(') stack.push(tk);
    else if (tk.type === ')') {
      while (stack.length && stack[stack.length - 1].type !== '(') out.push(stack.pop());
      if (!stack.length) return null;
      stack.pop(); // la '('
      if (stack.length && stack[stack.length - 1].type === 'fn') {
        const fn = stack.pop();
        out.push({ ...fn, arity: argc.pop() || 1 });
      }
      while (stack.length && stack[stack.length - 1].type === 'neg') out.push(stack.pop());
    }
    prev = tk;
  }

  while (stack.length) {
    const top = stack.pop();
    if (top.type === '(') return null;
    out.push(top);
  }
  return out;
}

function evalRpn(rpn) {
  const st = [];
  for (const tk of rpn) {
    if (tk.type === 'num') st.push(tk.value);
    else if (tk.type === 'neg') {
      if (!st.length) return NaN;
      st.push(-st.pop());
    } else if (tk.type === 'op') {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) return NaN;
      st.push(OPERATORS[tk.value].fn(a, b));
    } else if (tk.type === 'fn') {
      const n = tk.arity || 1;
      if (st.length < n) return NaN;
      const args = st.splice(st.length - n, n);
      st.push(FUNCTIONS[tk.value](...args));
    }
  }
  return st.length === 1 ? st[0] : NaN;
}

// Évalue une expression. Renvoie `null` si l'entrée n'est pas un calcul —
// jamais d'exception, jamais de faux positif sur du texte libre.
export function evaluate(input) {
  const src = normalizeExpression(input);
  if (!src) return null;
  // Un calcul doit contenir au moins un chiffre ET un opérateur/fonction,
  // sinon « gmail » ou « 42 » remonteraient comme des résultats de calcul.
  if (!/\d/.test(src)) return null;
  if (!/[+\-*/^!(]|\bmod\b|(?:^|[^a-z])(pi|tau|phi)\b|\b(sqrt|log|ln|sin|cos|tan|min|max|avg|sum|pow|abs|round|floor|ceil|hypot|root|exp)\b/i.test(src)) {
    return null;
  }
  const tokens = tokenize(src);
  if (!tokens || !tokens.length) return null;
  const rpn = toRpn(tokens);
  if (!rpn) return null;
  const value = evalRpn(rpn);
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value;
}

// Mise en forme lisible : sépare les milliers, coupe les artefacts de
// virgule flottante (0.1 + 0.2 → 0.3), passe en notation scientifique au-delà
// de 1e15.
export function formatNumber(value, locale = 'fr-FR') {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-7)) {
    return value.toExponential(6).replace(/\.?0+e/, 'e');
  }
  const rounded = Number(value.toPrecision(12));
  return rounded.toLocaleString(locale, { maximumFractionDigits: 10 });
}

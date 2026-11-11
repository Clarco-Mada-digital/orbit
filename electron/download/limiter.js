// ---------------------------------------------------------------------------
// Limiteur de débit — un seau à jetons partagé par les connexions d'un
// téléchargement, et un autre pour le plafond global.
//
// Transposition de crates/engine/src/limiter.rs (Mister Download Manager) :
// la limite s'applique à la lecture, donc à TCP, donc au serveur — et elle
// peut changer EN COURS de route : une attente déjà commencée se recale sur la
// nouvelle limite au lieu d'attendre l'échéance fixée par l'ancienne.
//
// Un « seau » : `tokens` peut passer négatif (c'est la dette à attendre), et
// `earned` est le budget gagné depuis la création. Une attente mémorise un
// point (`at`) qu'elle doit atteindre ; si la limite double, il reste deux fois
// moins de temps à attendre. Sans limite, la dette est effacée.
// ---------------------------------------------------------------------------

// Réserve : jusqu'à une seconde de budget s'accumule quand personne ne lit
// (entre deux requêtes), pour que de courts silences ne fassent pas tomber la
// moyenne sous la limite.
const BURST_SECONDS = 1;

function now() {
  return Date.now();
}

export class Limiter {
  // `rate` en octets par seconde ; 0 ou null = illimité.
  constructor(rate = 0) {
    this.rate = Math.max(0, Number(rate) || 0);
    this.tokens = 0;
    this.last = now();
    this.earned = 0;
    this.era = 0;
    this.counted = 0;
    this.waiters = new Set();
  }

  get() {
    return this.rate > 0 ? this.rate : null;
  }

  // Nouvelle limite, appliquée aussi aux attentes déjà commencées.
  set(rate) {
    const next = Math.max(0, Number(rate) || 0);
    if (next === this.rate) return;
    this.refill(this.rate, now());
    this.rate = next;
    if (next === 0) {
      // Plus de limite : la dette est effacée (une limite remise plus tard
      // repart de zéro).
      this.tokens = 0;
      this.era += 1;
    }
    // Réveille les attentes pour qu'elles recalculent leur reste.
    for (const wake of [...this.waiters]) wake();
    this.waiters.clear();
  }

  refill(rate, at) {
    const seconds = Math.max(0, (at - this.last) / 1000);
    this.last = at;
    if (rate > 0) {
      const earned = seconds * rate;
      this.earned += earned;
      this.tokens = Math.min(this.tokens + earned, rate * BURST_SECONDS);
    }
  }

  // Octets passés par ce limiteur (moins ceux rendus), limités ou non.
  taken() {
    return this.counted;
  }

  refund(n) {
    this.counted = Math.max(0, this.counted - Math.max(0, n | 0));
    if (this.rate > 0) this.tokens += Math.max(0, n | 0);
  }

  // Compte `n` octets reçus. Renvoie le point de fin d'attente, ou null si
  // rien ne doit attendre.
  _take(n) {
    this.counted += n;
    if (this.rate === 0) return null;
    this.refill(this.rate, now());
    this.tokens -= n;
    return this.tokens < 0 ? { at: this.earned - this.tokens, era: this.era } : null;
  }

  // Combien de millisecondes reste-t-il avant le point `mark` à la limite
  // actuelle ? null si c'est fini (ou si la limite a disparu).
  _left(mark) {
    if (this.rate === 0 || this.era !== mark.era) return null;
    this.refill(this.rate, now());
    const owed = mark.at - this.earned;
    if (owed < 1) return null;
    return (owed / this.rate) * 1000;
  }

  // Attendre que `n` octets de plus tiennent sous la limite.
  async acquire(n) {
    if (n <= 0) return;
    const mark = this._take(n);
    if (!mark) return;
    for (;;) {
      const left = this._left(mark);
      if (left === null) return;
      await this.wait(Math.min(left, 250));
      if (this._left(mark) === null) return;
    }
  }

  wait(ms) {
    const delay = Math.max(1, Math.min(ms, 1000));
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, delay);
      this.waiters.add(done);
    });
  }
}

export const unlimited = () => new Limiter(0);

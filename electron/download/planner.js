// ---------------------------------------------------------------------------
// Planificateur de segments — logique PURE, aucune entrée/sortie.
//
// Transposition du planificateur de Mister Download Manager
// (crates/engine/src/planner.rs, GPL) : on garde la règle, pas le code.
//
// Le téléchargement commence avec UN segment couvrant tout le fichier. Quand
// une connexion se libère elle :
//   1. reprend un segment non attribué et inachevé (reprise après reprise ou
//      après l'échec d'un worker) ;
//   2. sinon prend le segment qui suit celui qu'elle vient de finir, si sa
//      connexion n'a pas encore reçu un octet (elle ne fera donc pas doublon)
//      — c'est la règle de réaffectation d'IDM ;
//   3. sinon coupe en deux la plus grosse part restante, si chaque moitié vaut
//      au moins `minSplit`.
//
// Les workers doivent réserver (`claim`) les octets AVANT de les écrire et
// confirmer (`commit`) après. Les coupures se mesurent depuis la position
// réservée : elles ne peuvent pas trancher dans des octets en cours d'écriture.
// ---------------------------------------------------------------------------

// Une part de moins d'un demi-mégaoctet ne vaut pas une connexion : le temps
// d'ouverture et de poignée de main TLS dépasserait le gain.
const ALIGN = 4096;

function fresh(start, end, worker = null) {
  return {
    start,
    cursor: start,
    reserved: start,
    end,
    worker,
    receiving: false,
    givenAt: worker === null ? null : Date.now(),
  };
}

function unclaimed(segment) {
  return segment.end - segment.reserved;
}

export class Planner {
  constructor(size, minSplit = 512 * 1024) {
    this.size = size;
    this.minSplit = Math.max(1, Math.floor(minSplit));
    this.preemptAfter = 0;
    this.segs = size === 0 ? [] : [fresh(0, size)];
  }

  // Reprise : les segments sauvegardés doivent couvrir [0, size) exactement,
  // dans l'ordre et sans trou. Sinon l'état est invalide (retour null).
  static resume(size, minSplit, saved) {
    if (!Array.isArray(saved) || saved.length === 0) return null;
    let expected = 0;
    for (const s of saved) {
      if (!Number.isFinite(s?.start) || !Number.isFinite(s?.cursor) || !Number.isFinite(s?.end)) {
        return null;
      }
      if (s.start !== expected || s.cursor < s.start || s.cursor > s.end || s.end <= s.start) {
        return null;
      }
      expected = s.end;
    }
    if (expected !== size) return null;
    const planner = new Planner(0, minSplit);
    planner.size = size;
    planner.segs = saved.map((s) => ({
      start: s.start,
      cursor: s.cursor,
      reserved: s.cursor,
      end: s.end,
      worker: null,
      receiving: false,
      givenAt: null,
    }));
    return planner;
  }

  save() {
    return this.segs.map((s) => ({ start: s.start, cursor: s.cursor, end: s.end }));
  }

  downloaded() {
    return this.segs.reduce((total, s) => total + (s.cursor - s.start), 0);
  }

  isComplete() {
    return this.segs.every((s) => s.cursor === s.end);
  }

  activeWorkers() {
    return this.segs.filter((s) => s.worker !== null).length;
  }

  // Connexions qui ont reçu des octets (et non celles qui attendent encore la
  // réponse du serveur) — l'interface montre ce nombre-là.
  receivingWorkers() {
    return this.segs.filter((s) => s.worker !== null && s.receiving).length;
  }

  // Prochaine part pour le worker `w`. `after` : fin du segment qu'il vient de
  // terminer, pour enchaîner dessus. null = il n'y a plus rien à découper.
  assign(w, after = null) {
    this.release(w);

    // 1. Un segment libre et inachevé — de préférence celui qui commence où
    //    `w` vient de s'arrêter (la connexion est déjà ouverte).
    const open = (s) => s.worker === null && unclaimed(s) > 0;
    let index = -1;
    if (after !== null) index = this.segs.findIndex((s) => open(s) && s.start === after);
    if (index === -1) index = this.segs.findIndex(open);
    if (index !== -1) return this.give(index, w, null);

    // 2. Le segment suivant existe, mais sa connexion n'a encore rien reçu :
    //    on la remplace (rien n'est dupliqué sur le réseau).
    if (after !== null) {
      const next = this.segs.findIndex(
        (s) =>
          s.start === after &&
          s.worker !== null &&
          !s.receiving &&
          unclaimed(s) > 0 &&
          (s.givenAt === null || Date.now() - s.givenAt >= this.preemptAfter)
      );
      if (next !== -1) {
        const preempted = this.segs[next].worker;
        return this.give(next, w, preempted);
      }
    }

    // 3. Couper en deux la plus grosse part restante. À égalité, la plus à
    //    droite (elle finit plus tôt, ses octets sont contigus).
    let pick = -1;
    for (let i = 0; i < this.segs.length; i += 1) {
      if (pick === -1) {
        pick = i;
        continue;
      }
      const a = unclaimed(this.segs[i]);
      const b = unclaimed(this.segs[pick]);
      if (a >= b) pick = i;
    }
    if (pick === -1) return null;
    const segment = this.segs[pick];
    const half = Math.floor(unclaimed(segment) / 2);
    if (half < this.minSplit) return null;
    let mid = segment.reserved + half;
    const aligned = mid - (mid % ALIGN);
    if (aligned >= segment.reserved + this.minSplit) mid = aligned;
    const end = segment.end;
    this.segs[pick].end = mid;
    this.segs.splice(pick + 1, 0, fresh(mid, end, w));
    return { from: mid, to: end, written: 0, preempted: null };
  }

  // Combien d'octets le worker `w` peut encore prendre à partir de `at`.
  // null : il ne possède plus de segment.
  room(w, at) {
    const segment = this.segs.find((s) => s.worker === w);
    if (!segment) return null;
    return Math.max(0, segment.end - at);
  }

  // Réserve `len` octets à `pos`. granted peut être plus petit (segment coupé).
  claim(w, pos, len) {
    const segment = this.segs.find((s) => s.worker === w);
    if (!segment) return null;
    if (pos !== segment.reserved) return null;
    const granted = Math.min(len, unclaimed(segment));
    segment.reserved += granted;
    if (granted > 0) segment.receiving = true;
    return { granted };
  }

  // `w` a écrit jusqu'à `upto`. Renvoie la fin du segment s'il est terminé (le
  // worker est alors libéré et doit rappeler assign avec `after`).
  commit(w, upto) {
    const segment = this.segs.find((s) => s.worker === w);
    if (!segment) return null;
    segment.cursor = Math.min(Math.max(upto, segment.cursor), segment.reserved);
    if (segment.cursor === segment.end) {
      segment.worker = null;
      segment.receiving = false;
      return segment.end;
    }
    return null;
  }

  // Échec ou arrêt : le segment redevient libre et les octets réservés non
  // écrits seront redemandés.
  release(w) {
    const segment = this.segs.find((s) => s.worker === w);
    if (!segment) return;
    segment.worker = null;
    segment.reserved = segment.cursor;
    segment.receiving = false;
  }

  holds(w) {
    return this.segs.some((s) => s.worker === w);
  }

  // Le serveur a ignoré le Range : tout le fichier revient à la connexion qui
  // lit depuis l'octet 0, et on ne découpera plus.
  makeSingle(w) {
    const first = this.segs[0];
    if (!first) return false;
    if (first.worker !== w) return false;
    if (this.segs.slice(1).some((s) => s.cursor > s.start)) return false;
    this.segs = [{ ...first, end: this.size }];
    this.minSplit = Number.MAX_SAFE_INTEGER;
    return true;
  }

  give(index, w, preempted) {
    const segment = this.segs[index];
    segment.worker = w;
    segment.receiving = false;
    segment.givenAt = Date.now();
    segment.reserved = segment.cursor;
    return {
      from: segment.cursor,
      to: segment.end,
      written: segment.cursor - segment.start,
      preempted,
    };
  }
}

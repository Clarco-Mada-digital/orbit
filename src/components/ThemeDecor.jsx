// Décors animés des thèmes à signature : neige de Noël, ciel d'Aurore et
// réseau de points de Tech.
// Purement décoratifs : la neige et le ciel sont rendus par le CSS
// (`[data-skin='…']`, voir index.css) ; seul le réseau de Tech a besoin d'un
// canvas, car il réagit au curseur. Aucun de ces décors ne touche à l'état de
// l'application : ils ne peuvent pas provoquer de rendu React.
//
// Deux couches distinctes :
//   • `ThemeDecor`   — plein écran, montée à la racine. Sur l'accueil elle
//                      couvre toute la fenêtre ; quand une app est ouverte,
//                      une découpe CSS la limite aux barres du haut et du bas
//                      (la page reste nette).
//   • `ThemeSideDecor` — dans la barre latérale. Elle est peinte avec la
//                      sidebar, donc elle reste visible même quand celle-ci
//                      passe en surimpression (mode épuré, z-index élevé).
//
// `left`/`delay`/`duration` sont dispersés à la main plutôt que tirés au
// hasard : deux lancements doivent donner exactement le même décor.

import { useEffect, useRef } from 'react';

// --- Noël : flocons -------------------------------------------------------
// Deux familles : des flocons proches, plus gros et plus rapides, et des
// flocons lointains, petits et lents — c'est ce qui donne la profondeur.
const NOEL_FLAKES = [
  // Flocons proches
  { left: 2, delay: -0.4, duration: 12, size: 5, drift: 14, opacity: 0.85 },
  { left: 7, delay: -6.1, duration: 9, size: 4, drift: -10, opacity: 0.7 },
  { left: 12, delay: -2.7, duration: 14, size: 6, drift: 16, opacity: 0.8 },
  { left: 17, delay: -9.3, duration: 10, size: 4, drift: 8, opacity: 0.65 },
  { left: 23, delay: -4.8, duration: 13, size: 5, drift: -14, opacity: 0.85 },
  { left: 28, delay: -11.5, duration: 8, size: 4, drift: 10, opacity: 0.6 },
  { left: 34, delay: -1.6, duration: 15, size: 6, drift: -12, opacity: 0.75 },
  { left: 39, delay: -7.9, duration: 11, size: 5, drift: 14, opacity: 0.9 },
  { left: 45, delay: -3.3, duration: 9.5, size: 4, drift: -8, opacity: 0.65 },
  { left: 50, delay: -12.4, duration: 13, size: 5, drift: 10, opacity: 0.85 },
  { left: 56, delay: -5.5, duration: 10.5, size: 4, drift: -16, opacity: 0.7 },
  { left: 61, delay: -8.8, duration: 16, size: 6, drift: 12, opacity: 0.75 },
  { left: 67, delay: -2.1, duration: 11.5, size: 5, drift: -11, opacity: 0.9 },
  { left: 72, delay: -13.6, duration: 17, size: 4, drift: 15, opacity: 0.55 },
  { left: 78, delay: -15.2, duration: 12.5, size: 5, drift: -9, opacity: 0.6 },
  { left: 83, delay: -14.1, duration: 18, size: 4, drift: 13, opacity: 0.5 },
  { left: 88, delay: -16.8, duration: 14.5, size: 4, drift: -12, opacity: 0.55 },
  { left: 93, delay: -15.9, duration: 19, size: 6, drift: 9, opacity: 0.5 },
  { left: 97, delay: -17.4, duration: 16.5, size: 5, drift: -15, opacity: 0.45 },
  // Flocons lointains, plus petits et plus lents
  { left: 4, delay: -18.7, duration: 22, size: 3, drift: 10, opacity: 0.4 },
  { left: 9, delay: -19.3, duration: 25, size: 2, drift: -9, opacity: 0.35 },
  { left: 15, delay: -18.1, duration: 21, size: 3, drift: 13, opacity: 0.4 },
  { left: 20, delay: -20.4, duration: 24, size: 2, drift: -7, opacity: 0.3 },
  { left: 26, delay: -19.8, duration: 23, size: 3, drift: 9, opacity: 0.35 },
  { left: 31, delay: -21.2, duration: 26, size: 2, drift: -11, opacity: 0.3 },
  { left: 37, delay: -20.9, duration: 22.5, size: 3, drift: 8, opacity: 0.4 },
  { left: 42, delay: -22.6, duration: 27, size: 2, drift: -13, opacity: 0.25 },
  { left: 48, delay: -21.8, duration: 24.5, size: 3, drift: 11, opacity: 0.35 },
  { left: 53, delay: -23.4, duration: 25, size: 2, drift: -8, opacity: 0.3 },
  { left: 59, delay: -20.1, duration: 23.5, size: 3, drift: 12, opacity: 0.4 },
  { left: 64, delay: -22.9, duration: 28, size: 2, drift: -10, opacity: 0.25 },
  { left: 70, delay: -21.5, duration: 26.5, size: 3, drift: 9, opacity: 0.35 },
  { left: 75, delay: -24.1, duration: 24, size: 2, drift: -12, opacity: 0.3 },
  { left: 81, delay: -20.6, duration: 22, size: 3, drift: 7, opacity: 0.4 },
  { left: 86, delay: -23.7, duration: 27.5, size: 2, drift: -9, opacity: 0.25 },
  { left: 91, delay: -22.3, duration: 25.5, size: 3, drift: 11, opacity: 0.35 },
  { left: 96, delay: -24.8, duration: 29, size: 2, drift: -8, opacity: 0.25 },
];

// Dans la sidebar, la place manque : une neige plus rare, sur toute la
// hauteur, pour que la barre respire au lieu d'être un rideau blanc.
const NOEL_SIDE_FLAKES = [
  { left: 14, delay: -0.9, duration: 11, size: 4, drift: 8, opacity: 0.75 },
  { left: 48, delay: -4.2, duration: 14, size: 5, drift: -10, opacity: 0.8 },
  { left: 78, delay: -2.4, duration: 9, size: 3, drift: 6, opacity: 0.6 },
  { left: 30, delay: -7.1, duration: 16, size: 3, drift: -7, opacity: 0.5 },
  { left: 62, delay: -10.3, duration: 12.5, size: 4, drift: 9, opacity: 0.65 },
  { left: 88, delay: -6.5, duration: 18, size: 2, drift: -5, opacity: 0.4 },
  { left: 8, delay: -13.2, duration: 15, size: 2, drift: 7, opacity: 0.4 },
  { left: 40, delay: -16.8, duration: 20, size: 3, drift: -6, opacity: 0.45 },
  { left: 70, delay: -12.1, duration: 17, size: 2, drift: 5, opacity: 0.35 },
  { left: 24, delay: -19.4, duration: 22, size: 2, drift: -8, opacity: 0.3 },
];

// --- Aurore : ciel d'espace ----------------------------------------------
// Les étoiles sont réparties en spirale (angle d'or) : une distribution
// régulière sans grille visible, entièrement déterministe. Chaque étoile
// scintille à son propre rythme ; quelques-unes dérivent lentement.
const COSMOS_STARS = Array.from({ length: 54 }, (_, i) => {
  const angle = (i * 137.508 * Math.PI) / 180;
  const radius = Math.sqrt((i + 0.5) / 54);
  return {
    left: 50 + Math.cos(angle) * radius * 49,
    top: 50 + Math.sin(angle) * radius * 46,
    size: 1 + (i % 3) * 0.7,
    delay: -((i * 1.7) % 9),
    // Scintillement rapide (2,6 à 7 s) : c'est ce qui fait qu'on VOIT que le
    // ciel vit, même du coin de l'œil.
    duration: 2.6 + (i % 5) * 1.1,
    opacity: 0.35 + (i % 4) * 0.15,
    drift: i % 6 === 0 ? (i % 2 ? 6 : -6) : 0,
  };
});

const COSMOS_SIDE_STARS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i * 137.508 * Math.PI) / 180;
  const radius = Math.sqrt((i + 0.5) / 16);
  return {
    left: 50 + Math.cos(angle) * radius * 46,
    top: 50 + Math.sin(angle) * radius * 47,
    size: 1 + (i % 2) * 0.8,
    delay: -((i * 1.3) % 7),
    duration: 3 + (i % 4) * 1.3,
    opacity: 0.3 + (i % 3) * 0.18,
  };
});

const Flake = ({ flake }) => (
  <span
    style={{
      left: `${flake.left}%`,
      width: `${flake.size}px`,
      height: `${flake.size}px`,
      opacity: flake.opacity,
      animationDelay: `${flake.delay}s`,
      animationDuration: `${flake.duration}s`,
      '--flake-drift': `${flake.drift}px`,
    }}
  />
);

const Star = ({ star }) => (
  <span
    className="orbit-cosmos__star"
    style={{
      left: `${star.left}%`,
      top: `${star.top}%`,
      width: `${star.size}px`,
      height: `${star.size}px`,
      opacity: star.opacity,
      animationDelay: `${star.delay}s`,
      animationDuration: `${star.duration}s`,
      '--star-drift': `${star.drift || 0}px`,
    }}
  />
);

// Décor plein écran. Quand une app occupe la page, le CSS découpe la couche
// (voir `[data-decor='chrome']` dans index.css) pour ne garder que l'en-tête
// et le pied de fenêtre.
export default function ThemeDecor() {
  return (
    <>
      <div className="orbit-snow" aria-hidden="true">
        {NOEL_FLAKES.map((flake, index) => (
          <Flake key={index} flake={flake} />
        ))}
      </div>
      <div className="orbit-cosmos" aria-hidden="true">
        <span className="orbit-cosmos__ribbon" />
        <span className="orbit-cosmos__ribbon orbit-cosmos__ribbon--2" />
        {/* Le champ tourne très lentement sur lui-même : la voûte céleste. */}
        <div className="orbit-cosmos__stars">
          {COSMOS_STARS.map((star, index) => (
            <Star key={index} star={star} />
          ))}
        </div>
        <span className="orbit-cosmos__comet orbit-cosmos__comet--1" />
        <span className="orbit-cosmos__comet orbit-cosmos__comet--2" />
        <span className="orbit-cosmos__planet orbit-cosmos__planet--1" />
        <span className="orbit-cosmos__planet orbit-cosmos__planet--2" />
        <span className="orbit-cosmos__planet orbit-cosmos__planet--3" />
      </div>
      <TechNetwork />
    </>
  );
}

// --- Tech : réseau de points reliés --------------------------------------
// Décor propre au thème Tech : des points dérivent lentement, se relient
// entre eux quand ils se rapprochent, et le curseur attire les plus proches.
// C'est un canvas, donc le seul décor qui a besoin de JavaScript : le CSS ne
// sait pas suivre une souris. Il est masqué par la même découpe que les
// autres décors, donc il ne dessine jamais sur la page d'une app ouverte.
//
// Il ne tourne que pour Tech et se FIGE si les animations sont coupées — au
// lieu de disparaître : le réseau fait partie de l'identité du thème.
const NETWORK_DENSITY = 15000; // un point par ~15 000 px²
const NETWORK_MAX = 140;
const NETWORK_MIN = 30;
const NETWORK_LINK = 132; // distance où deux points se relient
const NETWORK_REACH = 190; // rayon d'influence du curseur

// Variante locale à la barre latérale : moins de points, liens plus courts,
// pas de curseur (la barre est trop étroite pour que ça veuille dire quelque
// chose). Le réseau y vit avec la barre, comme la neige et le ciel.
const SIDE_DENSITY = 6500;
const SIDE_MAX = 32;
const SIDE_MIN = 12;
const SIDE_LINK = 92;

function TechNetwork({ side = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const linkDistance = side ? SIDE_LINK : NETWORK_LINK;
    const reach = NETWORK_REACH;
    const state = {
      width: 1,
      height: 1,
      accent: '34 211 238',
      ink: '219 240 248',
      nodes: [],
      mouse: null,
      frame: 0,
      last: 0,
    };

    // Les couleurs viennent des variables du thème : un thème dérivé (ou
    // importé) garde donc un réseau cohérent sans rien savoir de Tech.
    const readColors = () => {
      const style = getComputedStyle(root);
      state.accent = style.getPropertyValue('--accent-primary').trim() || state.accent;
      state.ink = style.getPropertyValue('--text-primary').trim() || state.ink;
    };

    const tint = (triplet, alpha) => {
      const [r, g, b] = triplet.split(/\s+/).map(Number);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // Graine fixe : deux lancements donnent le même réseau. Le décor ne doit
    // pas changer d'une session à l'autre comme un fond aléatoire.
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const buildNodes = () => {
      const count = Math.max(
        side ? SIDE_MIN : NETWORK_MIN,
        Math.min(
          side ? SIDE_MAX : NETWORK_MAX,
          Math.round((state.width * state.height) / (side ? SIDE_DENSITY : NETWORK_DENSITY)),
        ),
      );
      seed = 0x9e3779b9;
      state.nodes = Array.from({ length: count }, () => ({
        x: random() * state.width,
        y: random() * state.height,
        // Vitesse de base : une dérive lente, jamais un essaim qui grouille.
        vx: (random() - 0.5) * 0.22,
        vy: (random() - 0.5) * 0.22,
        radius: 1.2 + random() * 1.4,
      }));
    };

    const draw = () => {
      const { width, height, nodes, mouse, accent, ink } = state;
      context.clearRect(0, 0, width, height);

      // Un halo très doux sous le curseur : on voit que le réseau le sent.
      if (mouse) {
        const glow = context.createRadialGradient(
          mouse.x, mouse.y, 0,
          mouse.x, mouse.y, NETWORK_REACH * 0.6,
        );
        glow.addColorStop(0, tint(accent, 0.14));
        glow.addColorStop(1, tint(accent, 0));
        context.fillStyle = glow;
        context.beginPath();
        context.arc(mouse.x, mouse.y, NETWORK_REACH * 0.6, 0, Math.PI * 2);
        context.fill();
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance = Math.hypot(dx, dy);
          if (distance > linkDistance) continue;
          const alpha = (1 - distance / linkDistance) * 0.26;
          context.strokeStyle = tint(accent, alpha);
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }

      // Le curseur devient un nœud : les points proches s'y accrochent.
      if (mouse && !side) {
        for (const node of nodes) {
          const distance = Math.hypot(node.x - mouse.x, node.y - mouse.y);
          if (distance > reach) continue;
          context.strokeStyle = tint(accent, (1 - distance / reach) * 0.55);
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(mouse.x, mouse.y);
          context.stroke();
        }
      }

      for (const node of nodes) {
        context.fillStyle = tint(ink, 0.55);
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = tint(accent, 0.85);
        context.beginPath();
        context.arc(node.x, node.y, node.radius * 0.45, 0, Math.PI * 2);
        context.fill();
      }
    };

    const step = (dt) => {
      const { width, height, nodes, mouse } = state;
      for (const node of nodes) {
        if (mouse && !side) {
          const dx = mouse.x - node.x;
          const dy = mouse.y - node.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < NETWORK_REACH) {
            const force = (1 - distance / reach) * 0.03;
            node.vx += (dx / distance) * force * dt;
            node.vy += (dy / distance) * force * dt;
          }
        }
        node.vx = Math.max(-0.65, Math.min(0.65, node.vx * 0.994));
        node.vy = Math.max(-0.65, Math.min(0.65, node.vy * 0.994));
        node.x += node.vx * dt;
        node.y += node.vy * dt;
        if (node.x < -24) node.x = width + 24;
        if (node.x > width + 24) node.x = -24;
        if (node.y < -24) node.y = height + 24;
        if (node.y > height + 24) node.y = -24;
      }
    };

    const active = () =>
      root.dataset.skin === 'tech'
      && !root.classList.contains('no-animations')
      && !reducedMotion.matches;

    const loop = (now) => {
      const dt = state.last ? Math.min(3, (now - state.last) / 16.667) : 1;
      state.last = now;
      step(dt);
      draw();
      state.frame = requestAnimationFrame(loop);
    };

    // Un seul point d'entrée : on arrête tout, puis on redémarre si le thème
    // et les réglages le permettent. Sans animation, on peint une image fixe.
    const sync = () => {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.last = 0;
      if (root.dataset.skin !== 'tech') return;
      draw();
      if (active()) state.frame = requestAnimationFrame(loop);
    };

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      state.width = Math.max(1, Math.round(rect.width));
      state.height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(state.width * dpr);
      canvas.height = Math.round(state.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
      sync();
    };

    const onPointerMove = (event) => {
      state.mouse = { x: event.clientX, y: event.clientY };
    };
    const onPointerLeave = () => {
      state.mouse = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(state.frame);
        state.frame = 0;
      } else {
        sync();
      }
    };

    const observer = new MutationObserver(() => {
      readColors();
      sync();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-skin', 'data-theme', 'class'] });

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    readColors();
    resize();
    if (!side) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerleave', onPointerLeave);
    }
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', sync);

    return () => {
      cancelAnimationFrame(state.frame);
      observer.disconnect();
      resizeObserver.disconnect();
      if (!side) {
        window.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerleave', onPointerLeave);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', sync);
    };
  }, [side]);

  return (
    <div className={side ? 'orbit-network-side' : 'orbit-network'} aria-hidden="true">
      <canvas ref={canvasRef} className="orbit-network__canvas" />
    </div>
  );
}

// Décor local à la barre latérale : il voyage avec elle (donc visible même
// quand la barre passe en surimpression) et comble le seul endroit que la
// découpe plein écran laisse volontairement vide.
export function ThemeSideDecor() {
  return (
    <>
      <div className="orbit-snow-side" aria-hidden="true">
        {NOEL_SIDE_FLAKES.map((flake, index) => (
          <Flake key={index} flake={flake} />
        ))}
      </div>
      <div className="orbit-cosmos-side" aria-hidden="true">
        {COSMOS_SIDE_STARS.map((star, index) => (
          <Star key={index} star={star} />
        ))}
      </div>
      <TechNetwork side />
    </>
  );
}

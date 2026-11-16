// AVANT-POSTE KILO — base avancée dans le désert, plein jour, poussière.
// Enceinte de gabions au centre (poste de commandement à toit-terrasse, baraquement, miradors),
// village en ruine au nord, parc de véhicules à l'ouest, héliport à l'est.

import { MapBuilder, DIR } from './builder.js';
import { MAT, BF } from '../constants.js';
import { makeRng } from '../mathx.js';

export function buildOutpost() {
  const B = 44;
  const m = new MapBuilder('outpost', 'Avant-poste Kilo', { minX: -B, minZ: -B, maxX: B, maxZ: B });
  m.env = {
    desc: 'Base avancée isolée, soleil de plomb.',
    sunAzimuth: 135, sunElevation: 52,
    sunColor: 0xfff1d6, sunIntensity: 3.6,
    skyTop: 0x3f78c2, skyHorizon: 0xd9c9a8, skyBottom: 0xb8a583,
    fogColor: 0xd6c4a0, fogDensity: 0.0068,
    hemiSky: 0xbfd4f0, hemiGround: 0x9a7f58, hemiIntensity: 1.0,
    exposure: 0.95, ground: MAT.SAND, cloud: 0.18, cloudColor: 0xffffff,
    ambientSound: 'desert',
  };
  const rng = makeRng(4242);

  // --- Sol et falaises d'enceinte ---------------------------------------------------------
  m.box(-120, -1, -120, 120, 0, 120, MAT.SAND);
  const rockCol = [0x9c8462, 0x8d7656, 0xa58d6a, 0x94805f];
  const cliff = (alongX, fixed, sign) => {
    let a = -B - 6;
    while (a < B + 6) {
      const len = 5 + rng() * 7;
      const h = 6.5 + rng() * 5;
      const depth = 5 + rng() * 5;
      const inset = rng() * 1.2;
      const col = rockCol[Math.floor(rng() * rockCol.length)];
      const p0 = fixed + sign * inset, p1 = fixed + sign * (inset + depth);
      if (alongX) m.box(a, 0, Math.min(p0, p1), a + len, h, Math.max(p0, p1), MAT.ROCK, { color: col });
      else m.box(Math.min(p0, p1), 0, a, Math.max(p0, p1), h, a + len, MAT.ROCK, { color: col });
      // gradin décoratif au pied
      if (rng() < 0.6) {
        const q0 = fixed - sign * (0.3 + rng() * 0.8), q1 = fixed + sign * 1;
        const sh = 0.8 + rng() * 1.6;
        if (alongX) m.box(a + 0.6, 0, Math.min(q0, q1), a + len - 0.6, sh, Math.max(q0, q1), MAT.ROCK, { color: col });
        else m.box(Math.min(q0, q1), 0, a + 0.6, Math.max(q0, q1), sh, a + len - 0.6, MAT.ROCK, { color: col });
      }
      a += len;
    }
  };
  cliff(true, -B, -1); cliff(true, B, 1); cliff(false, -B, -1); cliff(false, B, 1);
  m.clip(-B - 8, 0, -B - 0.3, B + 8, 60, -B);
  m.clip(-B - 8, 0, B, B + 8, 60, B + 0.3);
  m.clip(-B - 0.3, 0, -B, -B, 60, B);
  m.clip(B, 0, -B, B + 0.3, 60, B);
  // reliefs lointains
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rng() * 0.2;
    const r = 85 + rng() * 60;
    const w = 20 + rng() * 34, h = 12 + rng() * 26;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    m.deco(x - w / 2, 0, z - w / 2, x + w / 2, h, z + w / 2, MAT.ROCK, { color: rockCol[i % 4], flags: BF.NOSHADOW });
    m.deco(x - w / 3, h, z - w / 3, x + w / 3.4, h + 4 + rng() * 8, z + w / 3.2, MAT.ROCK, { color: rockCol[(i + 1) % 4], flags: BF.NOSHADOW });
  }

  // --- Enceinte de gabions (carré de 32 m, quatre portes) ----------------------------------
  const E = 16, G = 3;
  m.hesco(-E - 0.7, -E, -G, -E); m.hesco(G, -E, E + 0.7, -E);
  m.hesco(-E - 0.7, E, -G, E); m.hesco(G, E, E + 0.7, E);
  m.hesco(-E, -E + 0.7, -E, -G); m.hesco(-E, G, -E, E - 0.7);
  m.hesco(E, -E + 0.7, E, -G); m.hesco(E, G, E, E - 0.7);
  // chicanes devant les portes
  m.jersey(-1.6, -19.6, true); m.jersey(1.9, -22.4, true);
  m.jersey(1.6, 19.6, true); m.jersey(-1.9, 22.4, true);
  m.jersey(-19.6, 1.6, false); m.jersey(-22.4, -1.9, false);
  m.jersey(19.6, -1.6, false); m.jersey(22.4, 1.9, false);
  // sacs de sable de part et d'autre des portes (intérieur)
  m.sandbags(-6.4, -13.6, -3.4, -13.6); m.sandbags(3.4, -13.6, 6.4, -13.6);
  m.sandbags(-6.4, 13.6, -3.4, 13.6); m.sandbags(3.4, 13.6, 6.4, 13.6);
  m.sandbags(13.6, -6.4, 13.6, -3.4);

  // --- Poste de commandement (toit-terrasse accessible) ------------------------------------
  const cp = { color: 0xc2ad86 };
  m.room(-10, -12, 0, -5, 0, 3.0, 0.35, MAT.PLASTER, {
    s: [{ a: -8.6, b: -6.6, lo: 1.0, hi: 2.2 }, { a: -4.4, b: -2.6, lo: 0, hi: 2.3 }],
    e: [{ a: -9.4, b: -7.6, lo: 0, hi: 2.3 }],
    n: [{ a: -7, b: -5, lo: 1.0, hi: 2.2 }, { a: -3.4, b: -1.4, lo: 1.0, hi: 2.2 }],
    w: [{ a: -9.6, b: -7.8, lo: 1.0, hi: 2.2 }],
  }, cp);
  m.box(-10, 3.0, -12, 0, 3.25, -5, MAT.CONCRETE);
  // parapet de sacs de sable sur le toit (ouvert au débouché de l'escalier, à l'est)
  m.box(-10, 3.25, -12, 0, 4.2, -11.5, MAT.SANDBAG);
  m.box(-10, 3.25, -5.5, 0, 4.2, -5, MAT.SANDBAG);
  m.box(-10, 3.25, -11.5, -9.5, 4.2, -5.5, MAT.SANDBAG);
  m.box(-0.5, 3.25, -11.5, 0, 4.2, -7.4, MAT.SANDBAG);
  // escalier extérieur côté est, montant vers le nord le long du mur
  m.stairs(0.9, 0, -0.74, DIR.NZ, 13, 0.25, 0.32, 1.6, MAT.CONCRETE);
  m.box(0, 3.05, -7.4, 1.8, 3.25, -4.9, MAT.CONCRETE);
  m.box(0.1, 0, -7.4, 1.7, 3.05, -4.9, MAT.CONCRETE);
  m.box(1.7, 3.25, -7.4, 1.8, 4.2, -4.9, MAT.DARKMETAL);
  m.box(0, 3.25, -7.4, 1.8, 4.2, -7.3, MAT.DARKMETAL);
  m.box(0, 3.25, -5.5, 0.1, 4.2, -4.9, MAT.DARKMETAL);
  // intérieur : table de cartes, radios, casiers
  m.box(-7.4, 0, -9.6, -4.6, 0.82, -8.2, MAT.WOOD, { color: 0x6b4a2f });
  m.deco(-7, 0.82, -9.3, -5, 0.85, -8.5, MAT.PAINT, { color: 0xcdbf9a, flags: BF.NOSHADOW });
  m.box(-2.6, 0, -11.6, -0.5, 1.1, -10.9, MAT.METAL, { color: 0x4d5a3e });
  m.deco(-2.4, 1.1, -11.5, -1.7, 1.55, -11.1, MAT.LAMP, { color: 0x1d2a1d });
  m.box(-9.6, 0, -6.4, -9.0, 1.9, -5.4, MAT.METAL, { color: 0x4d5a3e });
  // mât d'antenne
  m.box(-9.3, 3.25, -11.3, -9.1, 13, -11.1, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(-9.8, 9, -11.24, -8.6, 9.08, -11.16, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(-9.6, 11, -11.24, -8.8, 11.08, -11.16, MAT.DARKMETAL, { flags: BF.NOSHADOW });

  // --- Baraquement -------------------------------------------------------------------------
  const br = { color: 0xb09a74 };
  m.room(-13, 3.4, -5.4, 12.6, 0, 2.9, 0.3, MAT.PLASTER, {
    n: [{ a: -10.4, b: -8.6, lo: 0, hi: 2.25 }],
    e: [{ a: 6.8, b: 8.6, lo: 0, hi: 2.25 }, { a: 10, b: 11.6, lo: 1.0, hi: 2.1 }],
    s: [{ a: -11.4, b: -9.6, lo: 1.0, hi: 2.1 }, { a: -8.4, b: -6.8, lo: 1.0, hi: 2.1 }],
    w: false,
  }, br);
  m.box(-13.3, 0, 3.4, -13, 2.9, 12.6, MAT.PLASTER, br);
  m.box(-13.3, 2.9, 3.1, -5.1, 3.1, 12.9, MAT.ROOF, { color: 0x8a7a5c });
  // lits de camp
  for (const z of [4.6, 9.9]) {
    m.box(-12.6, 0, z, -10.7, 0.5, z + 0.9, MAT.TARP, { color: 0x56603f });
    m.box(-12.6, 0.9, z, -10.7, 1.0, z + 0.9, MAT.TARP, { color: 0x56603f });
    for (const x of [-12.6, -10.76]) m.box(x, 0.5, z, x + 0.06, 0.9, z + 0.9, MAT.DARKMETAL, { flags: BF.NOCOLLIDE });
  }
  m.box(-6.4, 0, 11.3, -5.8, 1.8, 12.2, MAT.METAL, { color: 0x4d5a3e });

  // --- Abri-cantine (bâche sur poteaux) ----------------------------------------------------
  for (const x of [4.0, 10.2]) for (const z of [4.6, 7.9, 11.2]) m.box(x - 0.08, 0, z - 0.08, x + 0.08, 3.0, z + 0.08, MAT.DARKMETAL);
  m.box(3.6, 3.0, 4.2, 10.6, 3.1, 11.6, MAT.TARP, { color: 0x6b6a45 });
  m.box(5.2, 0, 6.0, 7.2, 0.8, 7.0, MAT.WOOD); m.box(7.4, 0, 9.0, 9.4, 0.8, 10.0, MAT.WOOD);
  m.box(5.2, 0, 7.3, 7.2, 0.45, 7.65, MAT.WOOD); m.box(7.4, 0, 8.35, 9.4, 0.45, 8.7, MAT.WOOD);
  m.crate(9.4, 5.2, 1.0); m.crate(4.9, 10.8, 1.0, 0, MAT.METAL, 0x4d5a3e); m.crate(4.9, 10.8, 0.7, 1.0);

  // --- Dépôt de munitions et carburant (nord-est de l'enceinte) ----------------------------
  m.sandbags(5.2, -4.6, 9.4, -4.6); m.sandbags(9.4, -4.6, 9.4, -7.4);
  m.crate(7.4, -10.4, 1.2, 0, MAT.METAL, 0x4d5a3e); m.crate(8.7, -10.6, 1.2, 0, MAT.METAL, 0x4d5a3e);
  m.crate(8.0, -10.5, 1.0, 1.2, MAT.METAL, 0x4d5a3e); m.crate(6.2, -11.6, 0.9);
  m.crate(4.6, -8.2, 1.0); m.crate(12.6, -3.2, 1.0);
  m.barrel(12.4, -12.6); m.barrel(13.3, -11.8); m.barrel(11.6, -11.9);
  // groupe électrogène
  m.box(11.0, 0, -8.6, 13.2, 1.3, -7.2, MAT.PAINT, { color: 0x6b6a45 });
  m.deco(11.5, 1.3, -8.2, 11.8, 1.9, -7.9, MAT.DARKMETAL);

  // --- Miradors aux angles intérieurs -----------------------------------------------------
  m.tower(-12.9, -13.0, 4.25, DIR.NZ);    // nord-ouest, escalier venant du sud
  m.tower(13.0, 13.0, 4.25, DIR.PZ);      // sud-est, escalier venant du nord

  return finish(m, rng, B);
}

function finish(m, rng, B) {
  // --- Village en ruine (nord) -------------------------------------------------------------
  const ruinCol = [0xb8a383, 0xa8946f, 0xc2ad8c];
  const ruin = (x0, z0, x1, z1, seed, doors) => {
    const r = makeRng(seed);
    const col = { color: ruinCol[seed % 3] };
    const t = 0.4;
    const seg = (alongX, a0, a1, c, ops) => {
      // mur de hauteur irrégulière, découpé en tronçons de 2 m
      let a = a0;
      const sorted = (ops || []).slice().sort((p, q) => p.a - q.a);
      while (a < a1 - 1e-6) {
        const b = Math.min(a1, a + 2);
        const mid = (a + b) / 2;
        const op = sorted.find((o) => mid > o.a && mid < o.b);
        if (!op) {
          const h = r() < 0.2 ? 0.8 + r() * 0.8 : 2.2 + r() * 1.4;
          if (alongX) m.box(a, 0, c - t / 2, b, h, c + t / 2, MAT.PLASTER, col);
          else m.box(c - t / 2, 0, a, c + t / 2, h, b, MAT.PLASTER, col);
        }
        a = b;
      }
    };
    seg(true, x0, x1, z0 + t / 2, doors.n);
    seg(true, x0, x1, z1 - t / 2, doors.s);
    seg(false, z0 + t, z1 - t, x0 + t / 2, doors.w);
    seg(false, z0 + t, z1 - t, x1 - t / 2, doors.e);
    // gravats
    for (let i = 0; i < 4; i++) {
      const gx = x0 + 1 + r() * (x1 - x0 - 2), gz = z0 + 1 + r() * (z1 - z0 - 2);
      const s = 0.3 + r() * 0.35;
      m.box(gx - s, 0, gz - s, gx + s, 0.2 + r() * 0.3, gz + s, MAT.PLASTER, col);
    }
  };
  ruin(-30, -38, -20, -30, 3, { s: [{ a: -26, b: -24 }], e: [{ a: -36, b: -34 }] });
  ruin(-8, -40, 4, -32, 4, { s: [{ a: -4, b: -2 }, { a: 0, b: 2 }], w: [{ a: -38, b: -36 }], e: [{ a: -36, b: -34 }] });
  ruin(16, -37, 28, -27, 5, { s: [{ a: 20, b: 22 }], w: [{ a: -33, b: -31 }], n: [{ a: 22, b: 24 }] });
  // murets et puits
  m.box(-17, 0, -27.2, -11, 1.1, -26.8, MAT.PLASTER, { color: ruinCol[0] });
  m.box(7, 0, -26.2, 12, 1.0, -25.8, MAT.PLASTER, { color: ruinCol[1] });
  m.box(-13.2, 0, -34.2, -11.2, 0.9, -32.2, MAT.ROCK, { color: 0x8d7656 });
  m.deco(-12.9, 0.9, -33.9, -11.5, 0.92, -32.5, MAT.DARKMETAL, { flags: BF.NOSHADOW });

  // --- Parc de véhicules (ouest) ----------------------------------------------------------
  m.truck(-30, -8, false, 0x7a6f50, 1);
  m.truck(-34.5, 4, false, 0x7a6f50, -1);
  m.car(-27, 9.5, true, 0x8a7b58, 1);
  m.container(-37, -18, false, 0x8a7b58);
  m.container(-27.5, 21, true, 0x4d5a3e, 0, true);
  m.box(-25.4, 0.6, -19.4, -21.4, 2.3, -17.2, MAT.PAINT, { color: 0xc9c2a8 });   // citerne
  for (const x of [-25.0, -21.8]) for (const z of [-19.1, -17.5]) m.box(x - 0.14, 0, z - 0.14, x + 0.14, 0.6, z + 0.14, MAT.DARKMETAL);
  m.barrel(-20.4, -18.6); m.barrel(-20.6, -17.4);
  m.sandbags(-24.4, -12.4, -20.4, -12.4); m.sandbags(-26, 15.2, -22, 15.2);
  m.crate(-22.4, 3.2, 1.2); m.crate(-21.2, 3.5, 1.0); m.crate(-33, 14, 1.3); m.crate(-31.7, 14.2, 1.0);

  // --- Héliport (est) ---------------------------------------------------------------------
  m.box(24, 0, -9, 38, 0.06, 5, MAT.CONCRETE, { flags: BF.NOSHADOW });
  const hp = (x0, z0, x1, z1) => m.deco(x0, 0.06, z0, x1, 0.07, z1, MAT.PAINT, { color: 0xe6e0c8, flags: BF.NOSHADOW });
  hp(28.6, -5.4, 29.3, 1.4); hp(32.7, -5.4, 33.4, 1.4); hp(29.3, -2.4, 32.7, -1.7);
  hp(24.3, -8.7, 37.7, -8.4); hp(24.3, 4.4, 37.7, 4.7); hp(24.3, -8.4, 24.6, 4.4); hp(37.4, -8.4, 37.7, 4.4);
  // hélicoptère (fuselage orienté nord-sud)
  const hc = 0x4a5238;
  m.box(29.9, 0.75, -5.6, 32.1, 2.75, -0.2, MAT.PAINT, { color: hc });           // cellule
  m.box(30.2, 1.1, -7.0, 31.8, 2.3, -5.6, MAT.PAINT, { color: hc });             // nez
  m.deco(30.3, 1.5, -7.06, 31.7, 2.25, -6.2, MAT.LAMP, { color: 0x121c24 });     // verrière
  m.box(30.6, 1.6, -0.2, 31.4, 2.3, 5.2, MAT.PAINT, { color: hc });              // poutre de queue
  m.box(30.85, 2.3, 4.2, 31.15, 3.9, 5.2, MAT.PAINT, { color: hc });             // dérive
  m.box(30.7, 2.75, -3.6, 31.3, 3.25, -2.2, MAT.DARKMETAL);                      // mât rotor
  m.deco(24.6, 3.25, -3.1, 37.4, 3.33, -2.7, MAT.DARKMETAL);                     // pales
  m.deco(30.8, 3.25, -9.3, 31.2, 3.33, 3.5, MAT.DARKMETAL);
  m.deco(30.9, 2.5, 5.2, 31.0, 4.3, 5.3, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  for (const x of [29.7, 32.3]) {
    m.box(x - 0.08, 0.06, -6, x + 0.08, 0.2, 0.4, MAT.DARKMETAL);                // patins
    m.box(x - 0.06, 0.2, -4.6, x + 0.06, 0.75, -4.45, MAT.DARKMETAL, { flags: BF.NOCOLLIDE });
    m.box(x - 0.06, 0.2, -1.2, x + 0.06, 0.75, -1.05, MAT.DARKMETAL, { flags: BF.NOCOLLIDE });
  }
  m.hesco(22.4, -12.6, 30, -12.6, 1.5, 1.2); m.hesco(22.4, 8.6, 30, 8.6, 1.5, 1.2);
  m.crate(26.2, 2.6, 1.2, 0.06, MAT.METAL, 0x4d5a3e); m.crate(35.8, -6.6, 1.0, 0.06);

  // --- Sud : épaves et positions de tir ---------------------------------------------------
  m.car(-8, 31, true, 0x4b3f33, 1);
  m.box(10.6, 0, 28.4, 15.4, 1.5, 30.6, MAT.RUST, { color: 0x6a4a36 });           // carcasse brûlée
  m.box(11.4, 1.5, 28.8, 13.6, 2.2, 30.2, MAT.RUST, { color: 0x5a3f30 });
  m.sandbags(-3, 27.4, 3, 27.4); m.sandbags(18.2, 22.4, 22.4, 22.4); m.sandbags(-20, 30.4, -16, 30.4);
  m.hesco(24, 33, 30, 33, 1.6, 1.3); m.hesco(-33, 34, -27, 34, 1.6, 1.3);
  m.container(22, 37, true, 0x9c5a34, 0, false, 6);
  // rochers épars (couverts pour l'approche ennemie)
  const rocks = [
    [-38, -28.5, 2.2, 1.8, 1.7], [-20, -22.5, 1.8, 2.4, 1.4], [14, -20.5, 2.4, 1.6, 1.5], [33, -20, 2.0, 2.6, 2.1],
    [38.5, 14, 2.4, 2.0, 1.9], [30.5, 22.5, 1.8, 1.8, 1.3], [-14.5, 24, 2.2, 1.6, 1.5], [-37.5, 27, 2.6, 2.2, 2.2],
    [3.5, 36.5, 2.4, 1.8, 1.6], [-22, 39, 2.0, 2.2, 1.8], [36, 36, 2.6, 2.4, 2.4], [-39, -38, 2.8, 2.4, 2.6],
    [38, -38, 2.4, 2.8, 2.3], [10.5, -42, 2.2, 1.6, 1.5], [-17.6, -41, 1.8, 2.0, 1.4],
  ];
  for (const [x, z, w, d, h] of rocks) {
    const col = [0x9c8462, 0x8d7656, 0xa58d6a][Math.floor(rng() * 3)];
    m.block(x, z, w, d, h, MAT.ROCK, 0, { color: col });
    m.block(x + (rng() - 0.5) * w * 0.5, z + (rng() - 0.5) * d * 0.5, w * 0.55, d * 0.55, h * 0.4, MAT.ROCK, h, { color: col });
  }

  // --- Éclairage --------------------------------------------------------------------------
  m.lights.push({ x: -5, y: 2.6, z: -8.5, color: 0xffe6c0, intensity: 1.2, range: 10 });
  m.lights.push({ x: -9, y: 2.5, z: 8, color: 0xffe6c0, intensity: 1.0, range: 10 });

  // --- Points d'apparition ----------------------------------------------------------------
  const P = Math.PI;
  for (const [x, z, yaw] of [
    [-27.5, -32.2, P], [-2, -36, P], [22, -32, P], [-40, -30, -P / 2], [40, -29, P / 2], [-40, 0, -P / 2],
    [40.5, 9.5, P / 2], [-38, 36, 0], [0, 40, 0], [36.5, 30, 0], [26, 39.6, 0], [-24, 36.5, 0],
    [3, -1, 0], [-2, 1.5, P], [9, 0.8, P / 2], [-9.5, -2.2, -P / 2], [-4, -8.8, P], [-9, 8, 0],
    [-21, -5, -P / 2], [20.5, 12.5, P / 2], [14, -24, P], [-12, 20, 0],
  ]) m.spawn('ffa', x, z, 0, yaw);
  for (const [x, z] of [[-27, -41.4], [-18, -39.5], [-10.5, -41.4], [1, -41.4], [9, -39.5], [17, -41.4], [26, -40.5], [-34, -40.5]]) m.spawn('alpha', x, z, 0, P);
  for (const [x, z] of [[-27, 41.3], [-17, 41], [-8, 41.3], [0, 41.4], [8, 41.3], [17, 41.3], [28, 41.3], [-34, 40.5]]) m.spawn('bravo', x, z, 0, 0);
  for (const [x, z] of [[4, -1], [6.4, 1.4], [4, 2.6], [6.6, -2.4], [8.8, 0.4], [9, 2.6], [8.6, -2.6], [11, 0]]) m.spawn('coop', x, z, 0, 0);
  for (const [x, z] of [
    [-40.5, -40.5], [0, -41.5], [40.5, -40.5], [41.5, 0], [40.5, 40.5], [0, 41.5], [-40.5, 40.5], [-41.5, 0],
    [-22, -41.5], [22, -41.5], [41.5, -22], [41.5, 22], [22, 41.5], [-22, 41.5], [-41.5, 22], [-41.5, -22],
  ]) m.spawn('enemy', x, z, 0, 0);

  // --- Objets à ramasser ------------------------------------------------------------------
  m.pickup('rpg', -5, -8.6, 3.25);
  m.pickup('armor', -8.6, -10.6); m.pickup('armor', 27, -2, 0.06);
  m.pickup('health', -9, 6); m.pickup('health', 8.6, 8.2); m.pickup('health', -27.5, -35.8); m.pickup('health', -27.5, 21, 0.14);
  m.pickup('health', 22, -32);
  m.pickup('ammo', 6.4, -8.6); m.pickup('ammo', -2, -36); m.pickup('ammo', 0, 30); m.pickup('ammo', -32, 0.6); m.pickup('ammo', 34, 9.6);
  m.pickup('grenade', 13, 13, 4.25); m.pickup('grenade', -12.9, -13, 4.25); m.pickup('grenade', 20, 24);

  void B;
  return m.build();
}

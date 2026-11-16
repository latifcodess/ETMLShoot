// DÉPÔT 17 — terminal à conteneurs au coucher du soleil.
// Entrepôt central à mezzanine, labyrinthe de conteneurs, deux miradors, un immeuble de bureaux.

import { MapBuilder, DIR } from './builder.js';
import { MAT, BF } from '../constants.js';
import { makeRng } from '../mathx.js';

const C = {
  red: 0xa5402f, blue: 0x2f5f8f, green: 0x3f7a4d, yellow: 0xc9a227, grey: 0x7c8187,
  orange: 0xc4622d, maroon: 0x7a2c3b, white: 0xd9d5cb, teal: 0x2d7f7a, navy: 0x27384f,
};
const PALETTE = Object.values(C);

export function buildDepot() {
  const m = new MapBuilder('depot', 'Dépôt 17', { minX: -36, minZ: -30, maxX: 36, maxZ: 30 });
  m.env = {
    desc: 'Terminal à conteneurs, fin de journée.',
    sunAzimuth: 238, sunElevation: 31,
    sunColor: 0xffb878, sunIntensity: 4.6,
    skyTop: 0x27406e, skyHorizon: 0xf0a060, skyBottom: 0x6a5a5a,
    fogColor: 0xb98f78, fogDensity: 0.0052,
    hemiSky: 0x9db0dc, hemiGround: 0x6a5240, hemiIntensity: 1.25,
    exposure: 1.12, ground: MAT.ASPHALT, cloud: 0.45, cloudColor: 0xffc7a0,
    ambientSound: 'port',
  };

  // --- Sol et enceinte ------------------------------------------------------------------
  m.box(-90, -1, -90, 90, 0, 90, MAT.ASPHALT);
  const WH = 4;
  m.wallX(-36.6, 36.6, -30.3, WH, 0.6, MAT.CONCRETE);
  m.wallX(-36.6, 36.6, 30.3, WH, 0.6, MAT.CONCRETE, [{ a: -4, b: 4, lo: 0, hi: WH }]);
  m.wallZ(-30, 30, -36.3, WH, 0.6, MAT.CONCRETE);
  m.wallZ(-30, 30, 36.3, WH, 0.6, MAT.CONCRETE);
  m.clip(-36.6, WH, -30.6, 36.6, 40, -30);
  m.clip(-36.6, WH, 30, 36.6, 40, 30.6);
  m.clip(-36.6, WH, -30, -36, 40, 30);
  m.clip(36, WH, -30, 36.6, 40, 30);
  // portail sud (fermé)
  m.box(-4, 0, 30.1, 4, 3.3, 30.3, MAT.RUST, { color: 0x596068 });
  m.box(-4.4, 0, 30, -4, 4.4, 30.6, MAT.CONCRETE);
  m.box(4, 0, 30, 4.4, 4.4, 30.6, MAT.CONCRETE);
  m.clip(-4, 3.3, 30, 4, 40, 30.6);
  // barbelés stylisés au sommet des murs
  m.deco(-36.6, WH, -30.4, 36.6, WH + 0.25, -30.2, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(-36.6, WH, 30.2, -4.4, WH + 0.25, 30.4, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(4.4, WH, 30.2, 36.6, WH + 0.25, 30.4, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(-36.4, WH, -30, -36.2, WH + 0.25, 30, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(36.2, WH, -30, 36.4, WH + 0.25, 30, MAT.DARKMETAL, { flags: BF.NOSHADOW });

  // marquages au sol
  const paint = (x0, z0, x1, z1, color = 0xd8d2b8) => m.deco(x0, 0, z0, x1, 0.012, z1, MAT.PAINT, { color, flags: BF.NOSHADOW });
  for (let x = -30; x <= 30; x += 6) paint(x - 1.2, 9.2, x + 1.2, 9.4, 0xc9a227);
  paint(-35, -9.6, -13, -9.45); paint(13, -9.6, 35, -9.45);
  for (let z = 11; z <= 21; z += 2.5) paint(-33.5, z - 0.07, -25, z + 0.07);

  // --- Entrepôt central ------------------------------------------------------------------
  const wallCol = { color: 0x8b98a3 };
  m.room(-12, -8, 12, 8, 0, 7, 0.4, MAT.ROOF, {
    w: [{ a: -2.6, b: 2.6, lo: 0, hi: 4.6 }],
    e: [{ a: -2.6, b: 2.6, lo: 0, hi: 4.6 }],
    n: [
      { a: -10, b: -8, lo: 4.3, hi: 5.7 }, { a: -5, b: -3, lo: 4.3, hi: 5.7 },
      { a: 0, b: 2, lo: 4.3, hi: 5.7 }, { a: 4.6, b: 6.6, lo: 0, hi: 2.5 },
      { a: 8, b: 10, lo: 4.3, hi: 5.7 },
    ],
    s: [
      { a: -6.6, b: -4.6, lo: 0, hi: 2.5 }, { a: -1.2, b: 1.2, lo: 1.0, hi: 2.4 },
      { a: 3.4, b: 5.4, lo: 1.0, hi: 2.4 }, { a: 8, b: 10, lo: 1.0, hi: 2.4 },
    ],
  }, wallCol);
  // soubassement béton (décor)
  m.deco(-12.06, 0, -8.06, 12.06, 0.9, -7.94, MAT.CONCRETE);
  m.deco(-12.06, 0, 7.94, -6.6, 0.9, 8.06, MAT.CONCRETE);
  m.deco(-4.6, 0, 7.94, 12.06, 0.9, 8.06, MAT.CONCRETE);
  // cadres des grandes portes
  for (const x of [-12, 12]) {
    m.deco(x - 0.26, 0, -2.85, x + 0.26, 4.85, -2.6, MAT.PAINT, { color: 0xc9a227 });
    m.deco(x - 0.26, 0, 2.6, x + 0.26, 4.85, 2.85, MAT.PAINT, { color: 0xc9a227 });
    m.deco(x - 0.26, 4.6, -2.6, x + 0.26, 4.85, 2.6, MAT.PAINT, { color: 0xc9a227 });
  }
  // dalle intérieure
  m.deco(-11.8, 0, -7.8, 11.8, 0.015, 7.8, MAT.CONCRETE, { flags: BF.NOSHADOW });
  // toit avec deux verrières ouvertes
  m.box(-12.4, 7, -8.4, 12.4, 7.3, -3, MAT.ROOF);
  m.box(-12.4, 7, -1.6, 12.4, 7.3, 1.6, MAT.ROOF);
  m.box(-12.4, 7, 3, 12.4, 7.3, 8.4, MAT.ROOF);
  for (const [z0, z1] of [[-3, -1.6], [1.6, 3]]) {
    m.box(-12.4, 7, z0, -9, 7.3, z1, MAT.ROOF);
    m.box(9, 7, z0, 12.4, 7.3, z1, MAT.ROOF);
  }
  for (const x of [-8, -4, 0, 4, 8]) m.deco(x - 0.1, 6.45, -7.6, x + 0.1, 7, 7.6, MAT.DARKMETAL);
  m.deco(-11.6, 6.3, -0.08, 11.6, 6.45, 0.08, MAT.DARKMETAL);

  // mezzanine nord (y = 3,25)
  const MZ = 3.25;
  m.box(-11.6, MZ - 0.2, -7.6, 11.6, MZ, -4.6, MAT.METAL);
  for (const x of [-10.5, -5, 0, 3.5, 10.5]) m.box(x - 0.1, 0, -4.8, x + 0.1, MZ - 0.2, -4.6, MAT.DARKMETAL);
  m.stairs(-7.5, 0, -0.44, DIR.NZ, 13, 0.25, 0.32, 1.4, MAT.METAL, true);
  m.stairs(8.5, 0, -0.44, DIR.NZ, 13, 0.25, 0.32, 1.4, MAT.METAL, true);
  // limons d'escalier (décor) et garde-corps
  for (const [a, b] of [[-11.6, -8.2], [-6.8, 7.8], [9.2, 11.6]]) {
    m.box(a, MZ, -4.68, b, MZ + 1.05, -4.6, MAT.DARKMETAL, { color: 0xc9a227 });
  }
  // caisses sur la mezzanine
  m.crate(-10.6, -6.9, 1.0, MZ); m.crate(4.2, -7.0, 0.9, MZ); m.crate(5.15, -6.95, 0.7, MZ);
  m.crate(-1.4, -7.1, 0.8, MZ, MAT.METAL, 0x4d5a3e);

  // rez-de-chaussée : caisses, rayonnages, bureau vitré, chariot élévateur
  m.crate(-3.2, 3.4, 1.3); m.crate(-1.8, 3.5, 1.3); m.crate(-2.5, 3.45, 1.0, 1.3); m.crate(-3.3, 4.9, 1.0);
  m.crate(2.8, -2.6, 1.3); m.crate(4.2, -2.7, 1.3, 0, MAT.METAL, 0x4d5a3e); m.crate(3.5, -2.6, 1.0, 1.3);
  m.crate(-9.6, 6.6, 1.2); m.crate(-10.9, 6.9, 0.8); m.crate(0.2, 6.9, 1.0); m.crate(-0.9, 7.0, 0.8);
  m.crate(-4.4, -6.2, 1.2, 0, MAT.METAL, 0x4a5a6a); m.crate(-3.2, -6.5, 0.9);
  m.crate(10.6, -1.2, 1.2); m.crate(10.8, -2.5, 0.9);
  // rayonnages (à l'ouest)
  const rack = (x0, z0, len) => {
    m.box(x0, 0, z0, x0 + len, 0.12, z0 + 1.0, MAT.DARKMETAL);
    m.box(x0, 1.3, z0, x0 + len, 1.4, z0 + 1.0, MAT.DARKMETAL);
    m.box(x0, 2.6, z0, x0 + len, 2.7, z0 + 1.0, MAT.DARKMETAL);
    for (const x of [x0, x0 + len - 0.08]) {
      m.box(x, 0, z0, x + 0.08, 3.4, z0 + 0.08, MAT.DARKMETAL, { color: 0x2f5f8f });
      m.box(x, 0, z0 + 0.92, x + 0.08, 3.4, z0 + 1.0, MAT.DARKMETAL, { color: 0x2f5f8f });
    }
    const rng = makeRng(Math.round(x0 * 31 + z0 * 17) + 99);
    for (const y of [0.12, 1.4, 2.7]) {
      for (let x = x0 + 0.2; x < x0 + len - 0.9; x += 0.95) {
        if (rng() < 0.25) continue;
        const s = 0.55 + rng() * 0.3;
        m.deco(x, y, z0 + 0.12, x + s, y + s * (0.8 + rng() * 0.3), z0 + 0.12 + Math.min(0.76, s),
          rng() < 0.6 ? MAT.WOOD : MAT.METAL, { color: rng() < 0.5 ? 0 : PALETTE[Math.floor(rng() * PALETTE.length)] });
      }
    }
  };
  rack(-11.5, 2.9, 4.2);
  rack(-11.5, -4.3, 2.6);
  // bureau du chef de quai (sud-est)
  m.room(6, 3.2, 11.6, 7.6, 0, 2.8, 0.2, MAT.PLASTER, {
    w: [{ a: 4.4, b: 6.0, lo: 0, hi: 2.2 }],
    n: [{ a: 7.4, b: 10.2, lo: 1.0, hi: 2.2 }],
    s: false, e: false,
  }, { color: 0xb9b3a2 });
  m.box(6, 2.8, 3.2, 11.6, 2.95, 7.6, MAT.PLASTER, { color: 0xb9b3a2 });
  m.box(9.2, 0, 6.2, 11.2, 0.78, 7.2, MAT.WOOD, { color: 0x6b4a2f });         // bureau
  m.deco(9.8, 0.78, 6.5, 10.5, 1.2, 6.62, MAT.LAMP, { color: 0x101418 });     // écran
  m.box(6.4, 0, 3.6, 7.0, 1.9, 4.2, MAT.METAL, { color: 0x56606a });          // armoire
  // chariot élévateur
  m.box(1.0, 0.25, 0.9, 2.3, 1.25, 3.0, MAT.PAINT, { color: 0xd2a112 });
  m.box(1.05, 1.25, 1.9, 2.25, 2.3, 2.95, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.box(1.25, 0.1, 0.55, 1.4, 2.6, 0.9, MAT.DARKMETAL);
  m.box(1.9, 0.1, 0.55, 2.05, 2.6, 0.9, MAT.DARKMETAL);
  m.deco(1.25, 0.12, -0.6, 1.4, 0.2, 0.55, MAT.DARKMETAL);
  m.deco(1.9, 0.12, -0.6, 2.05, 0.2, 0.55, MAT.DARKMETAL);
  for (const [x, z] of [[1.0, 1.1], [2.1, 1.1], [1.0, 2.6], [2.1, 2.6]]) m.deco(x - 0.02, 0, z - 0.25, x + 0.22, 0.5, z + 0.25, MAT.RUBBER);

  // --- Cour nord : rangées de conteneurs --------------------------------------------------
  m.container(-24, -13, true, C.red);
  m.container(-6, -13, true, C.blue, 0, true);
  m.container(9, -13, true, C.green);
  m.container(9, -13, true, C.yellow, 2.6);
  m.container(25, -13, true, C.grey);

  m.container(-16, -21, true, C.orange);
  m.container(1, -21, true, C.maroon);
  m.container(1, -21, true, C.white, 2.6);
  m.container(17, -21, true, C.navy, 0, true);

  m.container(-27, -28.75, true, C.grey);
  m.container(-8, -28.75, true, C.green);
  m.container(22, -28.75, true, C.yellow, 0, false, 6);
  m.container(22, -28.75, true, C.teal, 2.6, false, 6);
  // escalier de caisses vers le toit du conteneur vert (C2)
  for (let i = 0; i < 4; i++) m.box(-13.4 + i * 1.0, 0, -27.5, -12.4 + i * 1.0, 0.52 * (i + 1), -26.1, MAT.WOOD);
  m.box(-9.4, 0, -27.5, -8.2, 2.08, -26.1, MAT.WOOD);
  m.crate(-5.2, -28.6, 1.0, 2.6); m.box(-12.5, 2.6, -29.6, -9.5, 3.5, -29.3, MAT.SANDBAG);

  // portique de manutention au-dessus de la cour nord
  for (const x of [-33.2, 33.2]) for (const z of [-10.6, -25]) m.box(x - 0.4, 0, z - 0.4, x + 0.4, 12.6, z + 0.4, MAT.PAINT, { color: 0xc9a227 });
  for (const z of [-10.6, -25]) m.deco(-34.4, 12.6, z - 0.55, 34.4, 13.8, z + 0.55, MAT.PAINT, { color: 0xc9a227 });
  for (const x of [-33.2, 33.2]) m.deco(x - 0.45, 11.6, -25, x + 0.45, 12.6, -10.6, MAT.PAINT, { color: 0xc9a227 });
  m.deco(3.6, 12.2, -25.6, 6.4, 14.4, -10, MAT.DARKMETAL);
  m.deco(4.9, 10.2, -18.1, 5.1, 12.2, -17.9, MAT.DARKMETAL, { flags: BF.NOSHADOW });
  m.deco(-1, 7.6, -19.22, 11, 10.2, -16.78, MAT.CONTAINER, { color: C.teal });

  // --- Cour sud : quais de chargement -----------------------------------------------------
  m.truck(-9, 13.6, false, 0x4a5238, 1);
  m.truck(6, 20, true, 0x5d646b, -1);
  for (const x of [-12.5, -9.4, -6.3]) m.jersey(x, 24.2, true);
  for (const z of [11.5, 14.6]) m.jersey(14.2, z, false);
  m.crate(-2.2, 13.8, 1.3); m.crate(-0.9, 13.9, 1.0); m.crate(-1.9, 15.1, 1.0); m.crate(-2.1, 13.8, 0.9, 1.3);
  m.crate(0.8, 26.4, 1.3); m.crate(2.1, 26.6, 1.0); m.crate(-18.4, 21.6, 1.3); m.crate(-17.1, 21.9, 1.0);
  m.crate(-18.2, 20.3, 1.0, 0, MAT.METAL, 0x4d5a3e);
  m.container(18, 26, true, C.red);
  m.container(27, 16, false, C.orange, 0, true);
  m.container(-22, 27.5, true, C.blue, 0, false, 6);
  // palettes
  for (const [x, z] of [[11.5, 26.5], [-14.5, 12], [20.5, 11.5]]) {
    m.box(x - 0.6, 0, z - 0.5, x + 0.6, 0.15, z + 0.5, MAT.WOOD);
    m.box(x - 0.55, 0.15, z - 0.45, x + 0.55, 0.95, z + 0.45, MAT.TARP, { color: 0x6f7d86 });
  }
  // dépôt de carburant
  m.box(-31.4, 0.7, 22.6, -27.4, 2.5, 25.2, MAT.PAINT, { color: 0xcfd3d6 });
  for (const x of [-31.1, -27.9]) for (const z of [22.9, 24.9]) m.box(x - 0.15, 0, z - 0.15, x + 0.15, 0.7, z + 0.15, MAT.DARKMETAL);
  m.deco(-31.42, 1.3, 23.2, -27.38, 1.7, 24.6, MAT.PAINT, { color: 0xb3261e });
  m.barrel(-26.2, 22.4); m.barrel(-25.4, 23.3); m.barrel(-26.3, 24.5);
  // guérite du portail sud
  m.room(5.4, 26.4, 8.6, 29.6, 0, 2.6, 0.2, MAT.PLASTER, {
    w: [{ a: 27.2, b: 28.8, lo: 0, hi: 2.15 }],
    n: [{ a: 6.2, b: 7.8, lo: 1.0, hi: 2.0 }],
    e: [{ a: 27.2, b: 28.8, lo: 1.0, hi: 2.0 }],
  }, { color: 0xb5ad98 });
  m.box(5.2, 2.6, 26.2, 8.8, 2.8, 29.8, MAT.ROOF);
  // mirador sud-est
  m.tower(31.5, 25.5, 4.5, DIR.PZ);

  // --- Zone ouest : bureaux et parking ----------------------------------------------------
  const brick = { color: 0 };
  m.room(-33, -5, -24, 5, 0, 3.0, 0.3, MAT.BRICK, {
    e: [{ a: -3.6, b: -1.6, lo: 1.0, hi: 2.2 }, { a: 1.0, b: 2.8, lo: 0, hi: 2.3 }],
    n: [{ a: -30.2, b: -28.4, lo: 0, hi: 2.3 }],
    s: [{ a: -31.2, b: -29.2, lo: 1.0, hi: 2.2 }],
  }, brick);
  m.box(-33, 3.0, -5, -24, 3.25, 5, MAT.CONCRETE);
  m.room(-33, -5, -24, 5, 3.25, 2.8, 0.3, MAT.BRICK, {
    e: [{ a: -3.6, b: -1.6, lo: 0.9, hi: 2.1 }, { a: 1.4, b: 3.4, lo: 0.9, hi: 2.1 }],
    n: [{ a: -29.6, b: -27.6, lo: 0.9, hi: 2.1 }],
    s: [{ a: -31.5, b: -29.7, lo: 0, hi: 2.2 }],
  }, brick);
  m.box(-33.3, 6.05, -5.3, -23.7, 6.3, 5.3, MAT.CONCRETE);
  m.box(-33.3, 6.3, -5.3, -23.7, 6.7, -5.05, MAT.CONCRETE); m.box(-33.3, 6.3, 5.05, -23.7, 6.7, 5.3, MAT.CONCRETE);
  m.box(-33.3, 6.3, -5.05, -33.05, 6.7, 5.05, MAT.CONCRETE); m.box(-23.95, 6.3, -5.05, -23.7, 6.7, 5.05, MAT.CONCRETE);
  m.deco(-31, 6.3, -3, -29.4, 7.2, -1.4, MAT.METAL, { color: 0x8a9096 });     // climatiseur
  // balcon + escalier extérieur
  m.box(-33, 3.05, 5, -27.4, 3.25, 6.8, MAT.METAL);
  m.stairs(-23.24, 0, 5.9, DIR.NX, 13, 0.25, 0.32, 1.5, MAT.METAL, true);
  m.box(-33, 3.25, 6.72, -27.4, 4.3, 6.8, MAT.DARKMETAL);
  m.box(-33, 3.25, 5, -32.92, 4.3, 6.72, MAT.DARKMETAL);
  m.box(-32.95, 0, 6.6, -32.8, 3.05, 6.75, MAT.DARKMETAL); m.box(-27.6, 0, 6.6, -27.45, 3.05, 6.75, MAT.DARKMETAL);
  // mobilier
  m.box(-32.4, 0, -4.4, -30.8, 0.78, -3.5, MAT.WOOD, { color: 0x6b4a2f });
  m.box(-25.0, 0, -4.5, -24.4, 1.9, -3.2, MAT.METAL, { color: 0x56606a });
  m.box(-32.5, 0, 2.6, -31.9, 1.9, 4.5, MAT.METAL, { color: 0x4d5a3e });
  m.box(-28.6, 3.25, -4.2, -26.6, 4.03, -3.2, MAT.WOOD, { color: 0x6b4a2f });
  m.crate(-32.1, 3.6, 0.9, 3.25); m.crate(-25.0, 4.0, 0.8, 3.25, MAT.METAL, 0x4d5a3e);
  // parking
  m.car(-29.2, 12.2, true, 0x7b2f2a, 1);
  m.car(-29, 17.3, true, 0x2b3a4a, -1);
  // parvis entre bureaux et entrepôt
  m.jersey(-18.2, -3.2, false); m.jersey(-18.2, 0.2, false);
  m.crate(-16.8, 4.4, 1.3); m.crate(-15.5, 4.6, 1.0); m.crate(-16.6, 5.8, 1.0);
  m.crate(-20.4, -6.4, 1.2, 0, MAT.METAL, 0x4a5a6a);
  // mirador nord-ouest
  m.tower(-31.5, -22, 4.5, DIR.NZ);

  // --- Zone est : conteneurs en épi -------------------------------------------------------
  m.container(18, 0, false, C.grey);
  m.container(24, -1, false, C.orange, 0, true);
  m.container(30, 2, false, C.green);
  m.container(30, 2, false, C.yellow, 2.6);
  m.crate(21, 6.6, 1.3); m.crate(21.1, 5.3, 1.0); m.crate(14.6, 6.9, 1.2); m.crate(15.2, -6.6, 1.0);
  m.crate(33.6, -6.4, 1.3); m.crate(33.8, -5.1, 1.0); m.crate(33.6, -6.4, 0.9, 1.3);
  m.sandbags(13.6, -17.4, 17.0, -17.4);
  m.sandbags(-4.6, 18.2, -1.4, 18.2);
  m.sandbags(-22.5, 9.4, -19.2, 9.4);
  m.barrel(14.6, -9.6); m.barrel(-13.4, 9.6); m.barrel(-8.2, 7.1); m.barrel(33.4, 10.2); m.barrel(-3.4, -17.6);

  // --- Éclairage --------------------------------------------------------------------------
  m.lamp(-20, -17.2, 7); m.lamp(21.5, -17.2, 7); m.lamp(-21, 19, 7); m.lamp(20, 21.5, 7);
  m.lamp(0, 28.6, 6); m.lamp(-14.5, -1.5, 6.5); m.lamp(14.8, 9.4, 6.5);
  m.lights.push({ x: 0, y: 6.2, z: 0, color: 0xffe2b0, intensity: 1.3, range: 20 });
  m.lights.push({ x: -28.5, y: 2.7, z: 0, color: 0xfff0d0, intensity: 0.8, range: 9 });
  m.lights.push({ x: -28.5, y: 5.8, z: 0, color: 0xfff0d0, intensity: 0.8, range: 9 });
  m.deco(-0.6, 6.2, -0.12, 0.6, 6.3, 0.12, MAT.LAMP, { color: 0xffe2b0, flags: BF.EMISSIVE | BF.NOSHADOW });

  // --- Décor hors limites -----------------------------------------------------------------
  const rng = makeRng(1717);
  const stack = (cx, cz, alongX) => {
    const levels = 1 + Math.floor(rng() * 3);
    for (let l = 0; l < levels; l++) {
      const col = PALETTE[Math.floor(rng() * PALETTE.length)];
      const hx = alongX ? 6 : 1.22, hz = alongX ? 1.22 : 6;
      m.deco(cx - hx, l * 2.6, cz - hz, cx + hx, l * 2.6 + 2.6, cz + hz, MAT.CONTAINER, { color: col });
    }
  };
  for (let x = -54; x <= 54; x += 12.4) { stack(x, -33.2, true); if (rng() < 0.7) stack(x + 1, -36.2, true); }
  for (let z = -42; z <= 42; z += 12.4) { stack(39, z, false); stack(-39.2, z, false); if (rng() < 0.6) stack(42, z + 2, false); }
  for (let x = -54; x <= 54; x += 12.4) { if (Math.abs(x) > 9) stack(x, 36, true); }
  // hangars et grues lointains
  m.deco(-70, 0, -75, -30, 14, -52, MAT.ROOF, { color: 0x7d8790 });
  m.deco(10, 0, -78, 62, 11, -56, MAT.ROOF, { color: 0x8a7f73 });
  m.deco(58, 0, -30, 80, 16, 20, MAT.ROOF, { color: 0x77828a });
  m.deco(-84, 0, -20, -60, 12, 30, MAT.CONCRETE);
  m.deco(-40, 0, 52, 30, 9, 70, MAT.ROOF, { color: 0x8b8275 });
  const crane = (x, z) => {
    m.deco(x - 0.8, 0, z - 6, x + 0.8, 34, z - 4.4, MAT.PAINT, { color: 0xb3402a });
    m.deco(x - 0.8, 0, z + 4.4, x + 0.8, 34, z + 6, MAT.PAINT, { color: 0xb3402a });
    m.deco(x - 1, 30, z - 6, x + 1, 34, z + 6, MAT.PAINT, { color: 0xb3402a });
    m.deco(x - 1.2, 34, z - 2, x + 1.2, 37, z + 40, MAT.PAINT, { color: 0xb3402a });
    m.deco(x - 0.6, 37, z - 0.6, x + 0.6, 48, z + 0.6, MAT.PAINT, { color: 0xb3402a });
  };
  crane(-48, -95); crane(-12, -98); crane(30, -96);

  // --- Points d'apparition ----------------------------------------------------------------
  const P = Math.PI;
  for (const [x, z, yaw] of [
    [-34.5, -8, -P / 2], [-20, -25, P], [-2, -25.3, P], [14, -25, P], [33.6, -22, P / 2], [33.5, -8.5, P / 2],
    [34.6, 12, P / 2], [22, 9.4, 0], [10, 28, 0], [-13, 28, 0], [-34.5, 20, -P / 2], [-21, 14, -P / 2],
    [0, 4.5, 0], [-6, -17, P], [8, -17, P], [0, 10.5, P], [-16, -8.5, -P / 2], [15, 8.6, P / 2],
    [26.4, -24.5, P], [-28, -16.5, -P / 2],
  ]) m.spawn('ffa', x, z, 0, yaw);
  for (const [x, z] of [[-34.5, 8], [-34.5, 14.6], [-34.5, 20], [-33.5, 27.6], [-28, 28.2], [-21, 14], [-16, 27.8], [-34.6, -8]]) {
    m.spawn('alpha', x, z, 0, -P / 2);
  }
  for (const [x, z] of [[34.5, -8.5], [34.6, -2], [34.6, 6], [34.6, 12], [33.6, -27], [28, -26], [22, 9.4], [34.6, 16.5]]) {
    m.spawn('bravo', x, z, 0, P / 2);
  }
  for (const [x, z] of [[-3, 0.2], [3.4, 0.4], [0, 3.6], [0, -3.2], [-5.5, 1.2], [5.6, -1.4], [-2, 5.6], [-1.4, -4.2]]) m.spawn('coop', x, z, 0, 0);
  for (const [x, z] of [
    [-34.4, -28], [34.4, -28.4], [34.6, 28.4], [-34.6, 28.6], [-34.8, -16], [34.8, -17],
    [11, 28.6], [-13, 28.6], [15.5, -25.5], [-17.5, -25.4], [34.7, 10.4], [-34.7, 9],
  ]) m.spawn('enemy', x, z, 0, 0);

  // --- Objets à ramasser ------------------------------------------------------------------
  m.pickup('rpg', 0, -0.4);
  m.pickup('armor', 0.9, -6, MZ); m.pickup('armor', -28.4, 0.4, 3.25);
  m.pickup('health', -6, -13, 0.14); m.pickup('health', 24, -1, 0.14); m.pickup('health', 27, 16, 0.14);
  m.pickup('health', -28.6, -2, 0); m.pickup('health', 7, 28, 0);
  m.pickup('ammo', -20, 10.8); m.pickup('ammo', 20, -24.6); m.pickup('ammo', 0, 23); m.pickup('ammo', -2, -24.8);
  m.pickup('ammo', 9, 5.4);
  m.pickup('grenade', 31.5, 25.5, 4.5); m.pickup('grenade', -31.5, -22, 4.5); m.pickup('grenade', 17, -21, 0.14);

  return m.build();
}

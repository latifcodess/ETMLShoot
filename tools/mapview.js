// Outil de contrôle des cartes : valide les points d'apparition et produit une vue de dessus (SVG).
// Usage : node tools/mapview.js [idCarte] [fichier.svg] [--nav]

import fs from 'node:fs';
import { getMap, MAP_LIST } from '../public/shared/maps/index.js';
import { World } from '../public/shared/world.js';
import { HULL, BF, MAT } from '../public/shared/constants.js';
import { Nav } from '../server/nav.js';

const MAT_COL = {
  [MAT.CONCRETE]: '#8d8d88', [MAT.METAL]: '#6d7780', [MAT.WOOD]: '#a37a45', [MAT.SAND]: '#d2bb8a',
  [MAT.BRICK]: '#9a5540', [MAT.ASPHALT]: '#3a3b3d', [MAT.SANDBAG]: '#a89a6c', [MAT.CONTAINER]: '#b0523a',
  [MAT.HESCO]: '#9c8a5f', [MAT.PLASTER]: '#c7bda2', [MAT.RUST]: '#7b5236', [MAT.TARP]: '#5f6a45',
  [MAT.RUBBER]: '#1c1c1c', [MAT.LAMP]: '#ffe9a8', [MAT.PAINT]: '#c8b23a', [MAT.DARKMETAL]: '#33383d',
  [MAT.ROOF]: '#7f8a93', [MAT.CAMO]: '#4d5a3e', [MAT.ROCK]: '#8f7a5a', [MAT.TILE]: '#b8b3a8',
};

export function validateMap(id, opts = {}) {
  const map = getMap(id);
  const world = new World(map.boxes, map.bounds);
  const t0 = performance.now();
  const nav = new Nav(world, map);
  const navMs = performance.now() - t0;
  const problems = [];
  for (const [type, list] of Object.entries(map.spawns)) {
    list.forEach((p, i) => {
      if (!world.hullFree(p.x, p.y + 0.01, p.z, HULL.halfW + 0.05, HULL.height)) problems.push(`spawn ${type}#${i} (${p.x}, ${p.z}) : encombré`);
      const g = world.sweepDown(p.x, p.y + 0.01, p.z, HULL.halfW, 0.3);
      if (!(g > -Infinity)) problems.push(`spawn ${type}#${i} (${p.x}, ${p.z}) : pas de sol`);
      const n = nav.nodeAt(p.x, p.y, p.z);
      if (n < 0 || Math.hypot(nav.px[n] - p.x, nav.pz[n] - p.z) > 0.8) problems.push(`spawn ${type}#${i} (${p.x}, ${p.z}) : hors navigation`);
    });
  }
  map.pickups.forEach((p, i) => {
    const n = nav.nodeAt(p.x, p.y, p.z);
    if (n < 0 || Math.hypot(nav.px[n] - p.x, nav.pz[n] - p.z) > 0.8 || Math.abs(nav.py[n] - p.y) > 0.4) {
      problems.push(`pickup ${p.type}#${i} (${p.x}, ${p.y}, ${p.z}) : inaccessible à l'IA`);
    }
  });
  map.barrels.forEach((p, i) => {
    if (!world.hullFree(p.x, p.y + 0.01, p.z, 0.32, 1.0)) problems.push(`baril #${i} (${p.x}, ${p.z}) : encombré`);
  });
  // chemins entre points d'apparition
  const all = [...map.spawns.ffa, ...map.spawns.alpha, ...map.spawns.bravo, ...map.spawns.coop, ...map.spawns.enemy];
  let pathFail = 0, pathMs = 0, pathN = 0;
  for (let i = 0; i < all.length; i += 3) {
    for (let j = 1; j < all.length; j += 7) {
      const a = nav.nodeAt(all[i].x, all[i].y, all[i].z), b = nav.nodeAt(all[j].x, all[j].y, all[j].z);
      const t = performance.now();
      const path = nav.findPath(a, b);
      pathMs += performance.now() - t; pathN++;
      if (!path) pathFail++;
    }
  }
  const tf = performance.now();
  nav.distanceField(nav.nodeAt(0, 0, 0));
  const fieldMs = performance.now() - tf;
  if (!opts.quiet) {
    console.log(`[${id}] ${map.boxes.length} boîtes, ${nav.count} nœuds (${nav.reachable.length} accessibles), ${nav.eTo.length} arêtes, nav ${navMs.toFixed(0)} ms`);
    console.log(`[${id}] A* : ${pathN} chemins, ${pathFail} échecs, ${(pathMs / pathN).toFixed(2)} ms en moyenne ; champ de distance ${fieldMs.toFixed(1)} ms`);
    for (const p of problems) console.log('  ! ' + p);
    if (!problems.length) console.log(`[${id}] aucun problème détecté`);
  }
  return { map, world, nav, problems, pathFail };
}

export function renderSvg(id, withNav) {
  const { map, nav } = validateMap(id, { quiet: true });
  const b = map.bounds, pad = 6, S = 12;
  const W = (b.maxX - b.minX + pad * 2) * S, H = (b.maxZ - b.minZ + pad * 2) * S;
  const X = (x) => ((x - b.minX + pad) * S).toFixed(1), Z = (z) => ((z - b.minZ + pad) * S).toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="monospace" font-size="10">`;
  s += `<rect width="${W}" height="${H}" fill="#20242a"/>`;
  s += `<rect x="${X(b.minX)}" y="${Z(b.minZ)}" width="${(b.maxX - b.minX) * S}" height="${(b.maxZ - b.minZ) * S}" fill="${MAT_COL[map.env.ground] || '#444'}" opacity="0.55"/>`;
  const boxes = map.boxes.slice().filter((q) => !(q.flags & BF.INVISIBLE) && q.max[1] > 0.02)
    .filter((q) => q.max[0] > b.minX - pad && q.min[0] < b.maxX + pad && q.max[2] > b.minZ - pad && q.min[2] < b.maxZ + pad)
    .sort((p, q) => p.max[1] - q.max[1]);
  for (const q of boxes) {
    const col = q.color ? '#' + q.color.toString(16).padStart(6, '0') : (MAT_COL[q.mat] || '#888');
    const deco = q.flags & BF.NOCOLLIDE;
    const light = Math.min(1, 0.55 + q.max[1] / 9);
    s += `<rect x="${X(q.min[0])}" y="${Z(q.min[2])}" width="${((q.max[0] - q.min[0]) * S).toFixed(1)}" height="${((q.max[2] - q.min[2]) * S).toFixed(1)}" fill="${col}" fill-opacity="${deco ? 0.35 : light}" stroke="#000" stroke-opacity="0.5" stroke-width="0.6"/>`;
  }
  if (withNav) {
    for (let i = 0; i < nav.count; i++) {
      const y = nav.py[i];
      const col = !nav.reach[i] ? '#ff2a2a' : y < 0.3 ? '#35e06a' : y < 2 ? '#e8e03a' : y < 3.6 ? '#3ab8e8' : '#e83ad2';
      s += `<circle cx="${X(nav.px[i])}" cy="${Z(nav.pz[i])}" r="${nav.reach[i] ? 1.1 : 0.8}" fill="${col}" fill-opacity="0.8"/>`;
    }
  }
  const mark = (list, col, label) => list.forEach((p, i) => {
    s += `<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="5" fill="${col}" stroke="#000"/><text x="${(+X(p.x) + 6).toFixed(1)}" y="${(+Z(p.z) + 3).toFixed(1)}" fill="#fff">${label}${i}</text>`;
  });
  mark(map.spawns.ffa, '#ffffff', 'f'); mark(map.spawns.alpha, '#3a8bff', 'a'); mark(map.spawns.bravo, '#ff5a3a', 'b');
  mark(map.spawns.coop, '#3affc4', 'c'); mark(map.spawns.enemy, '#b000ff', 'e');
  for (const p of map.pickups) s += `<rect x="${(+X(p.x) - 4).toFixed(1)}" y="${(+Z(p.z) - 4).toFixed(1)}" width="8" height="8" fill="#ffd400" stroke="#000"/><text x="${(+X(p.x) + 6).toFixed(1)}" y="${(+Z(p.z) - 5).toFixed(1)}" fill="#ffd400">${p.type}</text>`;
  for (const p of map.barrels) s += `<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="4" fill="#e02020" stroke="#fff"/>`;
  // graduation tous les 10 m
  for (let x = Math.ceil(b.minX / 10) * 10; x <= b.maxX; x += 10) s += `<text x="${X(x)}" y="12" fill="#9ab">${x}</text><line x1="${X(x)}" y1="14" x2="${X(x)}" y2="${H}" stroke="#fff" stroke-opacity="0.07"/>`;
  for (let z = Math.ceil(b.minZ / 10) * 10; z <= b.maxZ; z += 10) s += `<text x="2" y="${Z(z)}" fill="#9ab">${z}</text><line x1="14" y1="${Z(z)}" x2="${W}" y2="${Z(z)}" stroke="#fff" stroke-opacity="0.07"/>`;
  s += '</svg>';
  return { svg: s, width: W, height: H };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const withNav = args.includes('--nav');
  const pos = args.filter((a) => !a.startsWith('--'));
  const ids = pos[0] ? [pos[0]] : MAP_LIST.map((m) => m.id);
  let bad = 0;
  for (const id of ids) {
    const r = validateMap(id);
    bad += r.problems.length + r.pathFail;
    if (pos[1]) {
      const out = ids.length > 1 ? pos[1].replace(/\.svg$/, `-${id}.svg`) : pos[1];
      fs.writeFileSync(out, renderSvg(id, withNav).svg);
      console.log('  →', out);
    }
  }
  process.exit(bad ? 1 : 0);
}

// Affichage tête haute : viseur, santé, munitions, journal des éliminations, radar, annonces,
// indicateurs de dégâts, tableau des scores, discussion.

import { WEAPONS, DAMAGE_NAMES, NUM_SLOTS } from '../../shared/weapons.js';
import { BF, TEAM_NAMES } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  constructor(settings) {
    this.settings = settings;
    this.root = $('hud');
    this.cross = $('crosshair'); this.hit = $('hitmarker'); this.scopeEl = $('scope');
    this.top = $('topbar'); this.feed = $('killfeed'); this.net = $('netinfo');
    this.ann = $('announce'); this.sub = $('subannounce'); this.promptEl = $('prompt'); this.pick = $('pickupmsg');
    this.hpbar = $('hpbar'); this.hpnum = $('hpnum'); this.arbar = $('arbar'); this.arnum = $('arnum'); this.money = $('money');
    this.ammo = $('ammo'); this.reserve = $('reserve'); this.wname = $('wname'); this.nades = $('nades'); this.slots = $('slots');
    this.reloadbar = $('reloadbar');
    this.chat = $('chat'); this.chatlog = $('chatlog'); this.chatinput = $('chatinput');
    this.sb = $('scoreboard'); this.death = $('deathscreen'); this.end = $('endscreen');
    this.lowhp = $('lowhp'); this.blood = $('bloodscreen');
    this.dmg = $('dmgdir'); this.dctx = this.dmg.getContext('2d');
    this.map = $('minimap'); this.mctx = this.map.getContext('2d');
    this.mapImg = null; this.mapScale = 3; this.mapBounds = null;
    this.hits = [];
    this.last = {};
    this.pickT = 0;
    this.gap = 8;
    this.cross.style.setProperty('--col', settings.get('crosshair'));
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dmg.width = Math.floor(window.innerWidth * dpr);
    this.dmg.height = Math.floor(window.innerHeight * dpr);
    this.dpr = dpr;
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  /** Met en cache une valeur pour ne toucher au DOM que si elle change. */
  _set(key, val, fn) { if (this.last[key] !== val) { this.last[key] = val; fn(val); } }

  // ------------------------------------------------------------------------------------- état du joueur
  setVitals(hp, armor, maxHp) {
    const h = Math.max(0, Math.ceil(hp));
    this._set('hp', h, (v) => {
      this.hpnum.textContent = v;
      this.hpbar.style.width = `${Math.min(100, v / maxHp * 100)}%`;
      this.hpbar.parentElement.classList.toggle('low', v <= 35);
    });
    this._set('ar', Math.ceil(armor), (v) => { this.arnum.textContent = v; this.arbar.style.width = `${Math.min(100, v)}%`; });
    this.lowhp.style.opacity = h > 0 && h < 45 ? String((45 - h) / 45 * 0.9) : '0';
  }

  setMoney(m) { this._set('money', m, (v) => { this.money.textContent = v === null ? '' : `${v} $`; }); }

  setWeapon(ws) {
    const s = ws.slots[ws.cur];
    const def = s.id >= 0 ? WEAPONS[s.id] : null;
    const melee = !def || def.melee;
    this._set('ammo', melee ? '—' : String(s.ammo), (v) => { this.ammo.textContent = v; });
    this.ammo.classList.toggle('low', !melee && s.ammo <= Math.max(1, def.mag * 0.25));
    this._set('res', melee ? '' : (s.reserve > 9000 ? '∞' : String(s.reserve)), (v) => { this.reserve.textContent = v; });
    this._set('wn', def ? def.name : '', (v) => { this.wname.textContent = v; });
    this._set('nades', ws.grenades, (v) => {
      this.nades.textContent = '';
      for (let i = 0; i < v; i++) this.nades.appendChild(el('span', 'n'));
    });
    let key = '';
    for (let i = 0; i < NUM_SLOTS; i++) key += ws.slots[i].id + (i === ws.cur ? '*' : '') + ',';
    this._set('slots', key, () => {
      this.slots.textContent = '';
      for (let i = 0; i < NUM_SLOTS; i++) {
        if (ws.slots[i].id < 0) continue;
        const d = el('div', 's' + (i === ws.cur ? ' cur' : ''));
        d.appendChild(el('b', '', String(i + 1)));
        d.appendChild(document.createTextNode(WEAPONS[ws.slots[i].id].short));
        this.slots.appendChild(d);
      }
    });
    const reloading = !!def && ws.reloadT > 0 && !def.shellReload;
    this.reloadbar.classList.toggle('on', reloading);
    if (reloading) this.reloadbar.firstElementChild.style.width = `${(1 - ws.reloadT / def.reload) * 100}%`;
  }

  /** spread : demi-angle du cône (rad) ; fov : champ vertical courant (rad). */
  setCrosshair(spread, fov, visible) {
    const target = 3 + Math.tan(spread) / Math.tan(fov / 2) * (window.innerHeight / 2);
    this.gap += (target - this.gap) * 0.35;
    this.cross.style.setProperty('--gap', `${this.gap.toFixed(1)}px`);
    this._set('cv', visible, (v) => { this.cross.style.opacity = v ? '1' : '0'; });
  }
  setScope(on) { this._set('scope', on, (v) => this.scopeEl.classList.toggle('on', v)); }

  hitmarker(kill) {
    this.hit.classList.remove('pop');
    this.hit.classList.toggle('kill', !!kill);
    void this.hit.offsetWidth;          // relance l'animation
    this.hit.classList.add('pop');
  }

  /** Indique d'où viennent les dégâts (ax, az : position de l'attaquant). */
  damageFrom(ax, az, amount) { this.hits.push({ x: ax, z: az, t: 0, a: Math.min(1, 0.5 + amount / 60) }); if (this.hits.length > 8) this.hits.shift(); }

  bloodSplat(count = 1) {
    for (let i = 0; i < count; i++) {
      const d = el('i');
      const size = 60 + Math.random() * 170;
      // sur les bords de l'écran uniquement : le centre reste lisible
      const edge = Math.random();
      const x = edge < 0.5 ? (Math.random() < 0.5 ? Math.random() * 22 : 78 + Math.random() * 22) : Math.random() * 100;
      const y = edge < 0.5 ? Math.random() * 100 : (Math.random() < 0.5 ? Math.random() * 20 : 80 + Math.random() * 20);
      d.style.cssText = `left:${x}%;top:${y}%;width:${size}px;height:${size * (0.7 + Math.random() * 0.6)}px;margin:-${size / 2}px 0 0 -${size / 2}px;transform:rotate(${Math.random() * 360}deg)`;
      this.blood.appendChild(d);
      setTimeout(() => d.remove(), 2700);
    }
  }

  // ------------------------------------------------------------------------------------- informations de partie
  killfeed(killer, kcls, victim, vcls, weaponId, head, mine) {
    const k = el('div', 'k' + (mine ? ' me' : ''));
    if (killer) k.appendChild(el('span', kcls, killer));
    k.appendChild(el('span', 'w', DAMAGE_NAMES[weaponId] || '—'));
    k.appendChild(el('span', vcls, victim));
    if (head) k.appendChild(el('span', 'hs', '⌖'));
    this.feed.appendChild(k);
    while (this.feed.children.length > 6) this.feed.firstElementChild.remove();
    setTimeout(() => { k.classList.add('out'); setTimeout(() => k.remove(), 520); }, 5200);
  }

  announce(text, sub = '', color = '') {
    for (const [node, t] of [[this.ann, text], [this.sub, sub]]) {
      node.classList.remove('show');
      node.textContent = t;
      void node.offsetWidth;
      if (t) node.classList.add('show');
    }
    this.ann.style.color = color || '';
  }

  prompt(html) { this._set('prompt', html, (v) => { this.promptEl.innerHTML = v; }); }

  pickup(text) {
    this.pick.textContent = text;
    this.pick.classList.add('show');
    clearTimeout(this.pickT);
    this.pickT = setTimeout(() => this.pick.classList.remove('show'), 1600);
  }

  /** Bandeau supérieur. cells : [{label, value, cls}] */
  setTop(cells) {
    const key = cells.map((c) => c.label + c.value + (c.cls || '')).join('|');
    this._set('top', key, () => {
      this.top.textContent = '';
      for (const c of cells) {
        const d = el('div', 'cell ' + (c.cls || ''));
        d.appendChild(el('small', '', c.label));
        d.appendChild(el('b', '', c.value));
        this.top.appendChild(d);
      }
    });
  }

  setNet(fps, ping, extra) {
    this._set('net', `${fps}|${ping}|${extra}`, () => {
      this.net.textContent = this.settings.get('showFps') ? `${fps} i/s · ${ping} ms${extra ? ' · ' + extra : ''}` : '';
    });
  }

  // ------------------------------------------------------------------------------------- discussion
  chatLine(name, cls, text, sys) {
    const m = el('div', 'm' + (sys ? ' sys' : ''));
    if (!sys) { m.appendChild(el('span', cls, name)); m.appendChild(document.createTextNode(' : ' + text)); } else m.textContent = text;
    this.chatlog.appendChild(m);
    while (this.chatlog.children.length > 9) this.chatlog.firstElementChild.remove();
    setTimeout(() => m.classList.add('old'), 9000);
  }
  openChat() { this.chat.classList.add('open'); this.chatinput.value = ''; this.chatinput.focus(); }
  closeChat() { this.chat.classList.remove('open'); this.chatinput.blur(); }
  get chatOpen() { return this.chat.classList.contains('open'); }

  // ------------------------------------------------------------------------------------- tableaux
  /**
   * @param info {title, sub, mode}
   * @param rows [{id,name,team,bot,kills,deaths,assists,score,ping,money,alive,me}]
   */
  _table(info, rows) {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h2', '', info.title));
    frag.appendChild(el('div', 'sub', info.sub));
    const t = el('table', 'sb');
    const coop = info.mode === 'coop';
    const head = el('tr');
    for (const h of coop ? ['Joueur', 'Élim.', 'Assist.', 'Morts', 'Argent', 'Ping'] : ['Joueur', 'Élim.', 'Morts', 'Assist.', 'Score', 'Ping']) head.appendChild(el('th', '', h));
    t.appendChild(head);
    const addRow = (r) => {
      const tr = el('tr', (r.me ? 'me ' : '') + (r.alive ? '' : 'dead'));
      const name = el('td', 't' + r.team, r.name);
      if (r.bot) name.appendChild(el('span', 'bot', 'BOT'));
      tr.appendChild(name);
      const vals = coop ? [r.kills, r.assists, r.deaths, `${r.money} $`, r.bot ? '—' : r.ping] : [r.kills, r.deaths, r.assists, r.score, r.bot ? '—' : r.ping];
      for (const v of vals) tr.appendChild(el('td', '', String(v)));
      t.appendChild(tr);
    };
    const sorted = rows.slice().sort((a, b) => (coop ? b.score - a.score : b.kills - a.kills || a.deaths - b.deaths));
    if (info.mode === 'tdm') {
      for (const team of [1, 2]) {
        const hr = el('tr', 'head');
        const td = el('td', 't' + team, `${TEAM_NAMES[team]} — ${info.ts ? info.ts[team - 1] : 0}`);
        td.colSpan = 6;
        hr.appendChild(td);
        t.appendChild(hr);
        for (const r of sorted) if (r.team === team) addRow(r);
      }
    } else for (const r of sorted) addRow(r);
    frag.appendChild(t);
    return frag;
  }
  scoreboard(show, info, rows) {
    this.sb.classList.toggle('hidden', !show);
    if (!show) return;
    this.sb.textContent = '';
    this.sb.appendChild(this._table(info, rows));
  }
  endScreen(show, big, color, info, rows) {
    this.end.classList.toggle('hidden', !show);
    if (!show) return;
    this.end.textContent = '';
    const b = el('div', 'big', big);
    b.style.color = color || '';
    this.end.appendChild(b);
    this.end.appendChild(this._table(info, rows));
  }
  deathScreen(show, who, cls, how, resp) {
    this.death.classList.toggle('hidden', !show);
    if (!show) { this.last.death = ''; return; }
    const key = who + how + resp;
    this._set('death', key, () => {
      this.death.textContent = '';
      this.death.appendChild(el('div', 'by', who ? 'Éliminé par' : 'Vous êtes mort'));
      if (who) this.death.appendChild(el('div', 'who ' + cls, who));
      this.death.appendChild(el('div', 'how', how));
      const r = el('div', 'resp');
      r.innerHTML = resp;
      this.death.appendChild(r);
    });
  }

  // ------------------------------------------------------------------------------------- radar
  /** Pré-rend le plan de la carte vue de dessus. */
  setMap(map) {
    const b = map.bounds, s = this.mapScale, pad = 4;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.maxX - b.minX + pad * 2) * s);
    c.height = Math.ceil((b.maxZ - b.minZ + pad * 2) * s);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(190, 200, 210, 0.07)';
    g.fillRect(pad * s, pad * s, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    const boxes = map.boxes.filter((q) => !(q.flags & (BF.INVISIBLE | BF.NOCOLLIDE)) && q.max[1] > 0.45 && q.min[1] < 2.2)
      .sort((p, q) => p.max[1] - q.max[1]);
    for (const q of boxes) {
      const h = Math.min(1, q.max[1] / 6);
      g.fillStyle = `rgba(${150 + h * 80}, ${160 + h * 80}, ${172 + h * 70}, ${0.42 + h * 0.4})`;
      g.fillRect((q.min[0] - b.minX + pad) * s, (q.min[2] - b.minZ + pad) * s, Math.max(1, (q.max[0] - q.min[0]) * s), Math.max(1, (q.max[2] - q.min[2]) * s));
    }
    this.mapImg = c; this.mapBounds = b; this.mapPad = pad;
  }

  /** dots : [{x, z, color, r}] ; px, pz, yaw : joueur */
  drawMap(px, pz, yaw, dots) {
    const g = this.mctx, W = this.map.width, R = W / 2;
    const range = 34, k = R / range;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    if (!this.mapImg) return;
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.translate(R, R);
    g.rotate(yaw);
    g.scale(k, k);
    const b = this.mapBounds, s = this.mapScale;
    g.drawImage(this.mapImg, b.minX - this.mapPad - px, b.minZ - this.mapPad - pz, this.mapImg.width / s, this.mapImg.height / s);
    for (const d of dots) {
      let dx = d.x - px, dz = d.z - pz;
      const dist = Math.hypot(dx, dz);
      // les points hors champ sont ramenés sur le bord du radar
      if (dist > range - 1.5) { dx *= (range - 1.5) / dist; dz *= (range - 1.5) / dist; }
      g.fillStyle = d.color;
      g.beginPath(); g.arc(dx, dz, (d.r || 3) / k, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // le joueur : flèche au centre
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(R, R - 7); g.lineTo(R + 5, R + 5); g.lineTo(R, R + 2); g.lineTo(R - 5, R + 5); g.closePath(); g.fill();
  }

  // ------------------------------------------------------------------------------------- mise à jour par image
  update(dt, px, pz, yaw) {
    const g = this.dctx, w = this.dmg.width, h = this.dmg.height;
    if (this.hits.length || this._dirty) {
      g.clearRect(0, 0, w, h);
      this._dirty = this.hits.length > 0;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const rad = Math.min(w, h) * 0.2;
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const hit = this.hits[i];
        hit.t += dt;
        if (hit.t > 1.5) { this.hits.splice(i, 1); continue; }
        const dx = hit.x - px, dz = hit.z - pz;
        const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) - Math.PI / 2;
        g.strokeStyle = `rgba(255, 40, 24, ${(1 - hit.t / 1.5) * hit.a})`;
        g.lineWidth = 9 * this.dpr;
        g.lineCap = 'round';
        g.beginPath(); g.arc(w / 2, h / 2, rad, ang - 0.28, ang + 0.28); g.stroke();
        g.lineWidth = 3 * this.dpr;
        g.beginPath(); g.arc(w / 2, h / 2, rad + 9 * this.dpr, ang - 0.36, ang + 0.36); g.stroke();
      }
    }
  }

  reset() {
    this.feed.textContent = ''; this.chatlog.textContent = ''; this.blood.textContent = '';
    this.hits.length = 0; this.last = {};
    this.scoreboard(false); this.endScreen(false); this.deathScreen(false);
    this.prompt(''); this.setScope(false);
    this.ann.classList.remove('show'); this.sub.classList.remove('show');
  }
}

export { fmtTime };

// Menus : accueil, liste des salons, création de salon, options, commandes, pause, arsenal, boutique.
// Tout le texte dynamique (noms de joueurs, de salons…) passe par textContent : jamais d'HTML injecté.

import { GAME_TITLE, MODES } from '../../shared/constants.js';
import { WEAPONS, PRIMARIES, W } from '../../shared/weapons.js';
import { keyLabel } from '../input.js';
import { QUALITIES } from '../gfx/renderer.js';

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return e;
}

const WEAPON_DESC = {
  [W.AR]: 'Polyvalent. Précis en rafales courtes, efficace à toutes les distances.',
  [W.SMG]: 'Cadence très élevée, mobile. Redoutable de près, faible de loin.',
  [W.SHOTGUN]: 'Neuf plombs par tir. Dévastateur à bout portant.',
  [W.SNIPER]: 'Lunette ×4,5, verrou. Un tir à la tête suffit.',
  [W.LMG]: 'Cent cartouches en bande. Lourde, lente, implacable.',
  [W.RPG]: 'Roquette explosive. Dégâts de zone.',
};
const QUALITY_NAMES = { low: 'Faible', medium: 'Moyenne', high: 'Élevée', ultra: 'Ultra' };

export class Menus {
  /**
   * @param cb {quick(mode), join(id), create(cfg), resume(), quit(), loadout(w), buy(key), refreshRooms(), sound(name)}
   */
  constructor(settings, cb) {
    this.settings = settings;
    this.cb = cb;
    this.root = document.getElementById('overlay');
    this.screen = null;
    this.info = { server: '', version: '', online: 0, rooms: [], maps: [], modes: [] };
    this.game = null;            // {mode, roomId, roomName, money, shop, ws} quand une partie est en cours
    this.roomTimer = 0;
    this.create = { mode: 'ffa', map: 'depot', bots: 8, difficulty: 1, maxPlayers: 12, private: false, rotate: true, name: '' };
  }

  get visible() { return this.screen !== null; }

  setInfo(info) {
    Object.assign(this.info, info);
    if (this.screen === 'rooms') this._renderRoomList();
    if (this.screen === 'main') this._footer();
  }

  hide() {
    this.screen = null;
    clearInterval(this.roomTimer);
    this.root.classList.remove('show', 'dim');
    this.root.textContent = '';
  }

  show(name) {
    clearInterval(this.roomTimer);
    this.screen = name;
    this.root.textContent = '';
    this.root.classList.add('show');
    this.root.classList.toggle('dim', ['pause', 'loadout', 'shop'].includes(name) || (this.game && name !== 'main'));
    const fn = this['_' + name];
    if (fn) this.root.appendChild(fn.call(this));
    if (name === 'rooms') {
      this.cb.refreshRooms();
      this.roomTimer = setInterval(() => this.cb.refreshRooms(), 3000);
    }
  }

  _btn(label, sub, onclick, cls = '') {
    const b = h('button', { class: 'btn ' + cls, onclick: () => { this.cb.sound('ui'); onclick(); } }, label);
    if (sub) b.appendChild(h('small', { text: sub }));
    return b;
  }
  _back() { return this._btn('← Retour', '', () => this.show(this.game ? 'pause' : 'main'), 'small'); }

  _nameField() {
    const input = h('input', { type: 'text', maxlength: '16', placeholder: 'Votre indicatif', value: this.settings.get('name'), spellcheck: 'false', autocomplete: 'off' });
    input.addEventListener('input', () => this.settings.set('name', input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.cb.sound('ui'); this.cb.quick(null); } });
    return h('div', { class: 'field' }, h('label', { text: 'Indicatif' }), input);
  }

  // ------------------------------------------------------------------------------------- accueil
  _main() {
    const s = h('div', { class: 'screen' });
    const split = GAME_TITLE.match(/^(.*?)([A-Z][a-z]+)$/);
    const logo = h('div', { class: 'logo' });
    if (split) { logo.appendChild(document.createTextNode(split[1].toUpperCase())); logo.appendChild(h('span', { text: split[2].toUpperCase() })); }
    else logo.textContent = GAME_TITLE.toUpperCase();
    s.append(
      logo,
      h('div', { class: 'tagline', text: 'FPS multijoueur · PvP & survie coop' }),
      this._nameField(),
      h('div', { class: 'col' },
        this._btn('Jouer', 'Partie rapide : rejoint le salon le plus animé', () => this.cb.quick(null), 'primary'),
        h('div', { class: 'rowb' },
          this._btn('Mêlée générale', '', () => this.cb.quick('ffa'), 'small'),
          this._btn('Équipes', '', () => this.cb.quick('tdm'), 'small'),
          this._btn('Survie coop', '', () => this.cb.quick('coop'), 'small')),
        this._btn('Salons', 'Parcourir les parties en cours ou entrer un code', () => this.show('rooms')),
        this._btn('Créer un salon', 'Choisir le mode, la carte, les bots — et inviter des amis', () => this.show('create')),
        this._btn('Options', 'Souris, image, son, niveau de violence', () => this.show('settings')),
        this._btn('Commandes', '', () => this.show('controls'))),
      this.footerEl = h('div', { class: 'footer' }));
    this._footer();
    return s;
  }
  _footer() {
    if (!this.footerEl) return;
    this.footerEl.textContent = '';
    this.footerEl.append(h('b', { text: this.info.server || '…' }), ` · ${this.info.online} joueur(s) en ligne · v${this.info.version || '?'}`);
  }

  // ------------------------------------------------------------------------------------- salons
  _rooms() {
    const s = h('div', { class: 'screen wide' });
    const code = h('input', { type: 'text', maxlength: '4', placeholder: 'CODE', style: 'width:130px;text-transform:uppercase', spellcheck: 'false', autocomplete: 'off' });
    const go = () => { const v = code.value.trim().toUpperCase(); if (v.length === 4) this.cb.join(v); };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    this.roomListEl = h('div', { class: 'rooms' });
    s.append(
      h('h2', { text: 'Salons' }),
      h('p', { class: 'hint', text: 'Cliquez sur un salon pour le rejoindre, ou entrez le code à quatre caractères d\'un salon privé.' }),
      this.roomListEl,
      h('div', { class: 'rowb' }, code, this._btn('Rejoindre', '', go, 'small'), h('div', { class: 'spacer' }), this._btn('Créer un salon', '', () => this.show('create'), 'small'), this._back()));
    this._renderRoomList();
    return s;
  }
  _renderRoomList() {
    const list = this.roomListEl;
    if (!list) return;
    list.textContent = '';
    if (!this.info.rooms.length) { list.appendChild(h('div', { class: 'empty', text: 'Aucun salon public pour le moment. Créez le vôtre !' })); return; }
    for (const r of this.info.rooms) {
      const name = h('div', { class: 'nm' }, r.name);
      name.appendChild(h('small', { text: `${r.mapName} · code ${r.id}${r.mode === 'coop' && r.wave ? ' · vague ' + r.wave : ''}` }));
      list.appendChild(h('div', { class: 'room', onclick: () => { this.cb.sound('ui'); this.cb.join(r.id); } },
        name,
        h('span', { class: 'tag ' + r.mode, text: (MODES[r.mode] || {}).name || r.mode }),
        h('span', { class: 'tag', text: r.bots ? `${r.bots} bots` : 'sans bots' }),
        h('span', { class: 'pl', text: `${r.players}/${r.max}` })));
    }
  }

  // ------------------------------------------------------------------------------------- création
  _create() {
    const c = this.create;
    const s = h('div', { class: 'screen wide' });
    const rerender = () => this.show('create');
    const name = h('input', { type: 'text', maxlength: '28', placeholder: 'Nom du salon (facultatif)', value: c.name, spellcheck: 'false', autocomplete: 'off' });
    name.addEventListener('input', () => { c.name = name.value; });
    const modes = h('div', { class: 'choices' });
    for (const m of (this.info.modes.length ? this.info.modes : Object.entries(MODES).map(([id, v]) => ({ id, ...v })))) {
      modes.appendChild(h('div', { class: 'choice' + (c.mode === m.id ? ' sel' : ''), onclick: () => { c.mode = m.id; if (m.id === 'coop' && c.maxPlayers > 8) c.maxPlayers = 6; rerender(); } },
        h('b', { text: m.name }), h('span', { text: m.desc })));
    }
    const maps = h('div', { class: 'choices' });
    for (const m of this.info.maps) {
      maps.appendChild(h('div', { class: 'choice' + (c.map === m.id ? ' sel' : ''), onclick: () => { c.map = m.id; rerender(); } }, h('b', { text: m.name }), h('span', { text: m.desc })));
    }
    const slider = (label, key, min, max, fmt) => {
      const out = h('span', { class: 'code', style: 'font-size:16px;min-width:54px;text-align:right', text: fmt(c[key]) });
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(c[key]) });
      inp.addEventListener('input', () => { c[key] = +inp.value; out.textContent = fmt(c[key]); });
      return h('div', { class: 'field inline' }, h('label', { text: label }), inp, out);
    };
    const check = (label, key) => {
      const inp = h('input', { type: 'checkbox' });
      inp.checked = c[key];
      inp.addEventListener('change', () => { c[key] = inp.checked; });
      return h('div', { class: 'field inline' }, h('label', { text: label }), inp);
    };
    const diff = h('select');
    ['Recrue', 'Vétéran', 'Élite'].forEach((n, i) => { const o = h('option', { value: String(i), text: n }); if (i === c.difficulty) o.selected = true; diff.appendChild(o); });
    diff.addEventListener('change', () => { c.difficulty = +diff.value; });
    s.append(
      h('h2', { text: 'Créer un salon' }),
      h('div', { class: 'field' }, h('label', { text: 'Nom' }), name),
      h('h3', { text: 'Mode de jeu' }), modes,
      h('h3', { text: 'Carte' }), maps,
      h('h3', { text: 'Réglages' }),
      slider('Joueurs maximum', 'maxPlayers', 1, c.mode === 'coop' ? 8 : 16, (v) => String(v)),
      c.mode !== 'coop' ? slider('Effectif visé (les bots complètent)', 'bots', 0, 14, (v) => (v === 0 ? 'aucun bot' : String(v))) : null,
      c.mode !== 'coop' ? h('div', { class: 'field inline' }, h('label', { text: 'Niveau des bots' }), diff) : null,
      c.mode !== 'coop' ? check('Changer de carte à chaque manche', 'rotate') : null,
      check('Salon privé (accessible uniquement par son code)', 'private'),
      h('div', { class: 'rowb' }, this._btn('Lancer la partie', '', () => this.cb.create({ ...c }), 'primary'), this._back()));
    return s;
  }

  // ------------------------------------------------------------------------------------- options
  _settings() {
    const st = this.settings;
    const s = h('div', { class: this.game ? 'screen center' : 'screen' });
    const slider = (label, key, min, max, step, fmt) => {
      const out = h('span', { class: 'code', style: 'font-size:16px;min-width:64px;text-align:right', text: fmt(st.get(key)) });
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(st.get(key)) });
      inp.addEventListener('input', () => { st.set(key, +inp.value); out.textContent = fmt(+inp.value); });
      return h('div', { class: 'field inline' }, h('label', { text: label }), inp, out);
    };
    const select = (label, key, opts) => {
      const sel = h('select');
      for (const [v, n] of opts) { const o = h('option', { value: String(v), text: n }); if (String(st.get(key)) === String(v)) o.selected = true; sel.appendChild(o); }
      sel.addEventListener('change', () => st.set(key, typeof st.get(key) === 'number' ? +sel.value : sel.value));
      return h('div', { class: 'field inline' }, h('label', { text: label }), sel);
    };
    const check = (label, key) => {
      const inp = h('input', { type: 'checkbox' });
      inp.checked = st.get(key);
      inp.addEventListener('change', () => st.set(key, inp.checked));
      return h('div', { class: 'field inline' }, h('label', { text: label }), inp);
    };
    s.append(
      h('h2', { text: 'Options' }),
      h('h3', { text: 'Souris' }),
      slider('Sensibilité', 'sensitivity', 0.1, 3, 0.05, (v) => v.toFixed(2)),
      slider('Sensibilité en visée', 'adsSensitivity', 0.3, 1.5, 0.05, (v) => '×' + v.toFixed(2)),
      check('Inverser l\'axe vertical', 'invertY'),
      h('h3', { text: 'Image' }),
      select('Qualité graphique', 'quality', QUALITIES.map((q) => [q, QUALITY_NAMES[q]])),
      slider('Champ de vision (vertical)', 'fov', 55, 90, 1, (v) => v + '°'),
      check('Afficher images/s et latence', 'showFps'),
      h('h3', { text: 'Violence' }),
      select('Niveau de violence', 'gore', [[0, 'Sans sang'], [1, 'Normal'], [2, 'Extrême (démembrement)']]),
      h('h3', { text: 'Son' }),
      slider('Volume général', 'volume', 0, 1, 0.05, (v) => Math.round(v * 100) + ' %'),
      h('p', { class: 'hint', text: 'La qualité graphique s\'applique immédiatement ; le détail des ombres du décor est recalculé à la prochaine carte.' }),
      h('div', { class: 'rowb' }, this._back()));
    return s;
  }

  _controls() {
    const s = h('div', { class: this.game ? 'screen center' : 'screen' });
    const keys = h('div', { class: 'keys' });
    const row = (k, text) => { keys.append(h('kbd', { text: k }), h('span', { text })); };
    row(`${keyLabel('forward')} ${keyLabel('left')} ${keyLabel('back')} ${keyLabel('right')}`, 'Se déplacer');
    row('Souris', 'Viser');
    row('Clic gauche', 'Tirer');
    row('Clic droit', 'Épauler / lunette');
    row(keyLabel('jump'), 'Sauter');
    row(`${keyLabel('crouch')} / Ctrl`, 'S\'accroupir (plus précis)');
    row(keyLabel('sprint'), 'Sprinter');
    row(keyLabel('reload'), 'Recharger');
    row(keyLabel('grenade'), 'Lancer une grenade');
    row(keyLabel('melee'), 'Coup de couteau rapide');
    row('1 2 3 4 / molette', 'Changer d\'arme');
    row(keyLabel('last'), 'Arme précédente');
    row(keyLabel('shop'), 'Boutique (survie coop)');
    row(keyLabel('loadout'), 'Arsenal (PvP)');
    row('Tab', 'Tableau des scores');
    row(`${keyLabel('chat')} / Entrée`, 'Discussion');
    row('Échap', 'Menu / libérer la souris');
    s.append(h('h2', { text: 'Commandes' }),
      h('p', { class: 'hint', text: 'Les touches suivent la position physique sur le clavier : ZQSD sur un AZERTY, WASD sur un QWERTY, sans réglage.' }),
      keys, h('div', { class: 'rowb' }, this._back()));
    return s;
  }

  // ------------------------------------------------------------------------------------- pause
  _pause() {
    const g = this.game || {};
    const s = h('div', { class: 'screen center' });
    s.append(
      h('h2', { text: 'Pause' }),
      h('p', { class: 'hint' }, `${g.roomName || ''} — code d'invitation : `, h('span', { class: 'code', text: g.roomId || '' })),
      this._btn('Copier le lien d\'invitation', 'À envoyer à vos amis : ils arrivent directement dans ce salon', () => {
        const link = `${location.origin}/?salon=${g.roomId}`;
        const done = () => this.cb.toast('Lien copié : ' + link, true);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => this.cb.toast(link, true));
        else this.cb.toast(link, true);
      }, 'small'),
      h('div', { class: 'col' },
        this._btn('Reprendre', '', () => this.cb.resume(), 'primary'),
        g.mode === 'coop' ? this._btn('Boutique', 'Armes, munitions, protection', () => this.show('shop')) : this._btn('Arsenal', 'Changer d\'arme principale (à la prochaine réapparition)', () => this.show('loadout')),
        this._btn('Options', '', () => this.show('settings')),
        this._btn('Commandes', '', () => this.show('controls')),
        this._btn('Quitter la partie', '', () => this.cb.quit(), 'danger')),
      h('p', { class: 'hint', text: 'La partie continue pendant la pause : vous restez vulnérable.' }));
    return s;
  }

  // ------------------------------------------------------------------------------------- arsenal
  _loadout() {
    const s = h('div', { class: 'screen center' });
    const grid = h('div', { class: 'choices' });
    const cur = this.settings.get('loadout');
    const bar = (label, v) => [h('span', { text: label }), h('i', null, h('b', { style: `width:${Math.round(Math.min(1, v) * 100)}%` }))];
    for (const id of PRIMARIES) {
      const d = WEAPONS[id];
      const dps = d.dmg * d.pellets * d.rpm / 60;
      grid.appendChild(h('div', { class: 'choice' + (cur === id ? ' sel' : ''), onclick: () => { this.cb.sound('ui'); this.settings.set('loadout', id); this.cb.loadout(id); } },
        h('b', { text: d.name }), h('span', { text: WEAPON_DESC[id] || '' }),
        h('div', { class: 'stats' },
          ...bar('Dégâts', d.dmg * d.pellets / 120), ...bar('Cadence', d.rpm / 1000), ...bar('Portée', d.falloff[1] / 120),
          ...bar('Puissance', dps / 320), ...bar('Mobilité', (d.moveMul - 0.75) / 0.3))));
    }
    s.append(h('h2', { text: 'Arsenal' }),
      h('p', { class: 'hint', text: 'Choisissez votre arme principale. Vous emportez aussi un pistolet P-9, un couteau et deux grenades.' }),
      grid, this.game && this.game.spawned ? h('div', { class: 'rowb' }, this._back()) : null);
    return s;
  }

  // ------------------------------------------------------------------------------------- boutique
  _shop() {
    const g = this.game || {};
    const s = h('div', { class: 'screen center' });
    const grid = h('div', { class: 'choices' });
    const money = g.money || 0;
    for (const [key, name, price, weapon] of (g.shop || [])) {
      const owned = weapon >= 0 && g.ws && g.ws.slots[WEAPONS[weapon].slot].id === weapon;
      const can = money >= price;
      grid.appendChild(h('div', { class: 'choice' + (can ? '' : ' off') + (owned ? ' sel' : ''), onclick: () => { if (can) this.cb.buy(key); else this.cb.sound('error'); } },
        h('b', null, name, h('span', { class: 'price', text: `${price} $` })),
        h('span', { text: weapon >= 0 ? (owned ? 'Possédée — racheter refait le plein de munitions.' : (WEAPON_DESC[weapon] || '')) : SHOP_DESC[key] || '' })));
    }
    s.append(h('h2', { text: 'Boutique' }),
      h('p', { class: 'hint' }, 'Fonds disponibles : ', h('span', { class: 'code', text: `${money} $` })),
      grid, h('div', { class: 'rowb' }, this._btn('Fermer', '', () => this.cb.resume(), 'small')));
    return s;
  }
}

const SHOP_DESC = {
  ammo: 'Refait le plein de toutes vos armes.',
  armor: 'Absorbe plus de la moitié des dégâts tant qu\'il tient.',
  grenades: 'Deux grenades à fragmentation (quatre au maximum).',
  medkit: 'Soigne entièrement, immédiatement.',
};

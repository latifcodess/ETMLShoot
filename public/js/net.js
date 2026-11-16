// Connexion WebSocket du navigateur : messages JSON (salon, scores, discussion…) et trames binaires
// (snapshots reçus, commandes envoyées). La logique de prédiction/interpolation est dans netcode.js.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.onBinary = null;
    this.onClose = null;
    this.rtt = 0;
    this.seq = 0;                 // numéro de la dernière commande émise (unique par connexion)
    this.pingTimer = 0;
    this.bytesIn = 0;
  }

  get open() { return !!this.ws && this.ws.readyState === 1; }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let settled = false;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        settled = true;
        this.pingTimer = setInterval(() => this.send({ t: 'pi', c: performance.now(), rtt: Math.round(this.rtt) }), 2000);
        resolve();
      };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Connexion au serveur impossible.')); } };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (!settled) { settled = true; reject(new Error('Connexion au serveur impossible.')); }
        if (this.onClose) this.onClose();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          this.bytesIn += ev.data.byteLength;
          if (this.onBinary) this.onBinary(ev.data);
          return;
        }
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'po') {
          const rtt = performance.now() - msg.c;
          this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
          return;
        }
        const fn = this.handlers.get(msg.t);
        if (fn) fn(msg);
      };
    });
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  send(obj) { if (this.open) this.ws.send(JSON.stringify(obj)); }
  sendBinary(u8) { if (this.open) this.ws.send(u8); }
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); clearInterval(this.pingTimer); } }
}

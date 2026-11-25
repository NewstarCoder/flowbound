// Players, XP, rank tiers and the leaderboard (local, plus optional Firestore over REST).
(function () {
  const USERS_KEY = 'flowbound.users';
  const CUR_KEY = 'flowbound.current';
  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

  // Small non-cryptographic hash (cyrb53) — enough to stop classmates overwriting each other.
  function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }
  const pinHash = (name, pin) => cyrb53(`flowbound:${name.toLowerCase()}:${pin}`) + cyrb53(`${pin}:${name.toLowerCase()}`, 7);

  function readUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeUsers(u) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (e) { /* storage unavailable */ }
  }

  // ───────── Firestore (REST, no SDK) ─────────
  const fb = (CB.Config && CB.Config.firebase) || {};
  const online = !!(fb.projectId && fb.apiKey);
  const base = online ? `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(fb.projectId)}/databases/(default)/documents` : '';
  const INT_FIELDS = ['xp', 'answered', 'correct', 'bosses', 'best', 'draws'];

  function toDoc(p) {
    const fields = { name: { stringValue: p.name }, pinHash: { stringValue: p.pinHash }, updated: { timestampValue: new Date().toISOString() } };
    for (const k of INT_FIELDS) fields[k] = { integerValue: String(Math.max(0, Math.round(p[k] || 0))) };
    return { fields };
  }
  function fromDoc(d) {
    const f = d.fields || {};
    const p = { name: f.name ? f.name.stringValue : '?', pinHash: f.pinHash ? f.pinHash.stringValue : '' };
    for (const k of INT_FIELDS) p[k] = f[k] ? Number(f[k].integerValue || 0) : 0;
    p.updated = f.updated ? f.updated.timestampValue : '';
    return p;
  }
  async function remoteGet(id) {
    const r = await fetch(`${base}/players/${encodeURIComponent(id)}?key=${encodeURIComponent(fb.apiKey)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Leaderboard server error ' + r.status);
    return fromDoc(await r.json());
  }
  async function remotePut(id, p) {
    const r = await fetch(`${base}/players/${encodeURIComponent(id)}?key=${encodeURIComponent(fb.apiKey)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toDoc(p)),
    });
    if (!r.ok) throw new Error('Leaderboard server error ' + r.status);
  }
  async function remoteTop(n) {
    const r = await fetch(`${base}:runQuery?key=${encodeURIComponent(fb.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'players' }], orderBy: [{ field: { fieldPath: 'xp' }, direction: 'DESCENDING' }], limit: n } }),
    });
    if (!r.ok) throw new Error('Leaderboard server error ' + r.status);
    return (await r.json()).filter((x) => x.document).map((x) => fromDoc(x.document));
  }

  // ───────── profile API ─────────
  const P = {
    online,
    current: null,
    syncError: null,

    validName(name) { return NAME_RE.test(name); },
    id(name) { return name.toLowerCase(); },

    restore() {
      let id = null;
      try { id = localStorage.getItem(CUR_KEY); } catch (e) { /* none */ }
      const u = readUsers();
      this.current = id && u[id] ? u[id] : null;
      if (this.current && this.current.dirty) this.sync();
      return this.current;
    },

    // Logs in, or creates the player if the name is new. Returns {ok, created, error}.
    async login(name, pin) {
      name = name.trim();
      if (!NAME_RE.test(name)) return { ok: false, error: 'Username: 3–16 letters, numbers or _' };
      if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN must be exactly 4 digits.' };
      const id = this.id(name), hash = pinHash(name, pin);
      const users = readUsers();
      let local = users[id] || null;
      let remote = null;
      if (online) {
        try { remote = await remoteGet(id); } catch (e) { this.syncError = e.message; }
      }
      const known = remote || local;
      if (known && known.pinHash !== hash) return { ok: false, error: 'Wrong PIN for that username (or the name is taken — pick another).' };
      const created = !known;
      const p = { name: (remote && remote.name) || (local && local.name) || name, pinHash: hash };
      for (const k of INT_FIELDS) p[k] = Math.max((local && local[k]) || 0, (remote && remote[k]) || 0);
      p.dirty = !remote || INT_FIELDS.some((k) => p[k] !== remote[k]);
      users[id] = p;
      writeUsers(users);
      try { localStorage.setItem(CUR_KEY, id); } catch (e) { /* not remembered */ }
      this.current = p;
      if (p.dirty) await this.sync();
      return { ok: true, created };
    },

    logout() {
      this.current = null;
      try { localStorage.removeItem(CUR_KEY); } catch (e) { /* none */ }
    },

    save() {
      if (!this.current) return;
      const users = readUsers();
      users[this.id(this.current.name)] = this.current;
      writeUsers(users);
    },

    async sync() {
      const p = this.current;
      if (!online || !p) return;
      try {
        await remotePut(this.id(p.name), p);
        p.dirty = false;
        this.syncError = null;
      } catch (e) {
        p.dirty = true;
        this.syncError = e.message;
      }
      this.save();
    },

    // Called after each answered question / won battle.
    record({ xp = 0, answered = 0, correct = 0, draws = 0 }) {
      const p = this.current;
      if (!p) return;
      p.xp += Math.round(xp); p.answered += answered; p.correct += correct; p.draws += draws;
      p.dirty = true;
      this.save();
      clearTimeout(this.t);
      this.t = setTimeout(() => this.sync(), 800);
    },
    bossDefeated(stage) {
      const p = this.current;
      if (!p) return;
      p.bosses += 1;
      p.best = Math.max(p.best, stage + 1);
      p.dirty = true;
      this.save();
      this.sync();
    },

    saveKey() { return this.current ? `flowbound.save.${this.id(this.current.name)}` : 'flowbound.save'; },

    // Returns { rows, online, error }
    async leaderboard() {
      let rows = null, error = null;
      if (online) {
        try { rows = await remoteTop(100); } catch (e) { error = e.message; }
      }
      if (!rows) rows = Object.values(readUsers());
      rows = rows.map((r) => ({ ...r })).sort((a, b) => b.xp - a.xp || b.correct - a.correct || a.name.localeCompare(b.name));
      // make sure the current player appears with their newest numbers
      if (this.current) {
        const me = rows.find((r) => r.name.toLowerCase() === this.current.name.toLowerCase());
        if (me) Object.assign(me, { xp: Math.max(me.xp, this.current.xp), answered: Math.max(me.answered, this.current.answered), correct: Math.max(me.correct, this.current.correct), bosses: Math.max(me.bosses, this.current.bosses), best: Math.max(me.best, this.current.best) });
        else rows.push({ ...this.current });
        rows.sort((a, b) => b.xp - a.xp || b.correct - a.correct || a.name.localeCompare(b.name));
      }
      return { rows, online: online && !error, error };
    },
  };

  CB.Profile = P;
})();

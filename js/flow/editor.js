// Interactive flowchart editor: add symbols, drag them, connect arrows, type text.
(function (root) {
  const CB = (root.CB = root.CB || {});
  const { size, routeFree, port } = CB.Layout;
  const R = CB.Render;
  const SNAP = 10, VW = 640;

  const TIPS = {
    terminal: 'START / STOP',
    io: 'e.g. INPUT X   or   OUTPUT Total',
    process: 'e.g. Total ← Total + X   (use ; for two lines)',
    decision: 'e.g. X > 10?',
  };

  class Editor {
    constructor(host, opts = {}) {
      this.host = host;
      this.onChange = opts.onChange || (() => {});
      this.nodes = [];
      this.edges = [];
      this.sel = null; // {kind:'node'|'edge', id}
      this.link = null; // pending connection {from, label, x, y}
      this.hl = {};
      this.undo = [];
      this.seq = 1;
      this.disabled = false;
      this.mk = 'edA' + Math.random().toString(36).slice(2, 7);
      this.build();
      this.load(opts.graph || { nodes: [{ id: 's', type: 'terminal', text: 'START', x: 320, y: 40 }], edges: [] });
    }

    build() {
      this.host.innerHTML = `
        <div class="ed-bar">
          <button class="btn tiny ed-add" data-type="terminal" title="Start / Stop">${R.icon('terminal')}<span>Start/Stop</span></button>
          <button class="btn tiny ed-add" data-type="io" title="Input / Output">${R.icon('io')}<span>Input/Output</span></button>
          <button class="btn tiny ed-add" data-type="process" title="Process">${R.icon('process')}<span>Process</span></button>
          <button class="btn tiny ed-add" data-type="decision" title="Decision">${R.icon('decision')}<span>Decision</span></button>
        </div>
        <div class="ed-bar ed-edit">
          <input class="ed-text" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Select a box to type in it" disabled>
          <button class="btn tiny" data-ins="←" title="Assignment arrow">←</button>
          <button class="btn tiny" data-ins="&quot;&quot;" title="Text in quotes">" "</button>
          <button class="btn tiny" data-act="swap" title="Swap the Yes and No arrows of a decision">Yes⇄No</button>
          <button class="btn tiny" data-act="side" title="Move the side arrow of a decision to the other side">◁▷</button>
          <button class="btn tiny" data-act="del" title="Delete the selected box or arrow (Del)">Delete</button>
          <button class="btn tiny" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
          <button class="btn tiny" data-act="clear" title="Start again">Clear</button>
        </div>
        <div class="ed-help">Click a symbol to add it (it links below the selected box). Drag boxes to move. Drag from a <b>●</b> handle onto a box to draw an arrow. Click an arrow, then Delete to remove it.</div>
        <div class="ed-canvas"><svg class="fc-svg ed-svg" xmlns="http://www.w3.org/2000/svg"></svg></div>`;
      this.svg = this.host.querySelector('svg.ed-svg');
      this.text = this.host.querySelector('.ed-text');
      this.host.querySelectorAll('.ed-add').forEach((b) => { b.onclick = () => this.add(b.dataset.type); });
      this.host.querySelectorAll('[data-ins]').forEach((b) => { b.onclick = () => this.insert(b.dataset.ins); });
      this.host.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => this.act(b.dataset.act); });
      this.text.addEventListener('input', () => {
        const n = this.selNode();
        if (!n) return;
        if (!this.typing) { this.snapshot(); this.typing = true; }
        n.text = this.text.value;
        this.render();
        this.changed();
      });
      this.text.addEventListener('blur', () => { this.typing = false; });
      this.text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.text.blur(); }
        if (e.key === 'Escape') this.text.blur();
      });
      this.svg.addEventListener('pointerdown', (e) => this.down(e));
      this.svg.addEventListener('pointermove', (e) => this.move(e));
      this.svg.addEventListener('pointerup', (e) => this.up(e));
      this.svg.addEventListener('dblclick', (e) => { const g = e.target.closest('[data-node]'); if (g) this.focusText(); });
      this.keyHandler = (e) => {
        if (this.disabled || !this.host.isConnected || this.host.offsetParent === null) return;
        if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.act('del'); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.act('undo'); }
        else if (e.key === 'Escape') { this.link = null; this.select(null); }
        else if (e.key === 'Enter' && this.selNode()) { e.preventDefault(); this.focusText(); }
      };
      document.addEventListener('keydown', this.keyHandler);
    }

    destroy() { document.removeEventListener('keydown', this.keyHandler); }

    load(g) {
      this.nodes = g.nodes.map((n) => ({ ...n }));
      this.edges = g.edges.map((e) => ({ from: e.from, to: e.to, label: e.label || null }));
      this.seq = this.nodes.length + 1;
      this.sel = null;
      this.undo = [];
      this.render();
    }
    getGraph() {
      return { nodes: this.nodes.map((n) => ({ id: n.id, type: n.type, text: n.text || '' })), edges: this.edges.map((e) => ({ ...e })) };
    }
    setDisabled(v) {
      this.disabled = v;
      this.host.classList.toggle('disabled', v);
      this.host.querySelectorAll('button').forEach((b) => { b.disabled = v; });
      this.text.disabled = v || !this.selNode();
      if (v) { this.link = null; this.select(null); }
    }
    setHighlights(ids) { this.hl = {}; for (const id of ids || []) this.hl[id] = 'err'; this.render(); }

    snapshot() {
      this.undo.push(JSON.stringify({ n: this.nodes, e: this.edges }));
      if (this.undo.length > 60) this.undo.shift();
    }
    changed() { this.onChange(); }

    selNode() { return this.sel && this.sel.kind === 'node' ? this.nodes.find((n) => n.id === this.sel.id) : null; }
    select(sel) {
      this.sel = sel;
      const n = this.selNode();
      this.text.disabled = !n || this.disabled;
      this.text.value = n ? n.text || '' : '';
      this.text.placeholder = n ? TIPS[n.type] : 'Select a box to type in it';
      this.render();
    }
    focusText() { if (this.selNode() && !this.disabled) { this.text.focus(); this.text.select(); } }
    insert(s) {
      const n = this.selNode();
      if (!n || this.disabled) return;
      const t = this.text;
      t.focus();
      const a = t.selectionStart, b = t.selectionEnd;
      t.setRangeText(s, a, b, 'end');
      if (s === '""') t.setSelectionRange(a + 1, a + 1);
      t.dispatchEvent(new Event('input'));
    }

    // ───────── geometry ─────────
    pt(e) {
      const p = this.svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      const m = this.svg.getScreenCTM();
      return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    }
    box(n) { const s = size(n.type, n.text); return { l: n.x - s.w / 2, r: n.x + s.w / 2, t: n.y - s.h / 2, b: n.y + s.h / 2, w: s.w, h: s.h }; }
    nodeAt(x, y) {
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const b = this.box(this.nodes[i]);
        if (x >= b.l - 4 && x <= b.r + 4 && y >= b.t - 4 && y <= b.b + 4) return this.nodes[i];
      }
      return null;
    }
    isStop(n) { return n.type === 'terminal' && CB.Runner.isEndText(n.text); }
    ports(n) {
      if (this.isStop(n)) return [];
      if (n.type === 'decision') return ['yes', 'no'];
      return [null];
    }
    free(n, label) { return !this.edges.some((e) => e.from === n.id && e.label === label); }
    overlaps(x, y, w, h, skip) {
      return this.nodes.some((n) => {
        if (n === skip) return false;
        const b = this.box(n);
        return x - w / 2 < b.r + 12 && x + w / 2 > b.l - 12 && y - h / 2 < b.b + 14 && y + h / 2 > b.t - 14;
      });
    }

    // ───────── editing ─────────
    add(type) {
      if (this.disabled) return;
      this.snapshot();
      const hasStart = this.nodes.some((n) => n.type === 'terminal' && CB.Runner.isStartText(n.text));
      const text = type === 'terminal' ? (hasStart ? 'STOP' : 'START') : '';
      const n = { id: 'u' + this.seq++, type, text, x: VW / 2, y: 40 };
      const s = size(type, text);
      const from = this.selNode();
      let label = null;
      if (from && this.ports(from).some((l) => this.free(from, l))) {
        label = this.ports(from).find((l) => this.free(from, l));
        const fb = this.box(from);
        const pp = port(from, label);
        if (pp.dir === 'down') { n.x = from.x; n.y = fb.b + 44 + s.h / 2; }
        else { n.x = pp.x + (pp.dir === 'right' ? 50 : -50) + (pp.dir === 'right' ? s.w / 2 : -s.w / 2); n.y = fb.b + 44 + s.h / 2; }
      } else {
        const bottom = this.nodes.reduce((m, k) => Math.max(m, this.box(k).b), 0);
        n.y = bottom + 44 + s.h / 2;
      }
      n.x = Math.max(s.w / 2 + 10, Math.round(n.x / SNAP) * SNAP);
      n.y = Math.round(n.y / SNAP) * SNAP;
      let guard = 0;
      while (this.overlaps(n.x, n.y, s.w, s.h) && guard++ < 40) n.y += 20;
      this.nodes.push(n);
      if (from && label !== undefined && this.ports(from).includes(label) && this.free(from, label) && from !== n) this.edges.push({ from: from.id, to: n.id, label });
      this.select({ kind: 'node', id: n.id });
      this.changed();
      if (type !== 'terminal') this.focusText();
    }

    act(a) {
      if (this.disabled) return;
      if (a === 'undo') {
        const s = this.undo.pop();
        if (!s) return;
        const d = JSON.parse(s);
        this.nodes = d.n; this.edges = d.e;
        this.select(null);
        this.changed();
        return;
      }
      if (a === 'clear') {
        if (this.nodes.length <= 1 && !this.edges.length) return;
        this.snapshot();
        this.nodes = [{ id: 'u' + this.seq++, type: 'terminal', text: 'START', x: 320, y: 40 }];
        this.edges = [];
        this.select(null);
        this.changed();
        return;
      }
      const n = this.selNode();
      if (a === 'del') {
        if (!this.sel) return;
        this.snapshot();
        if (this.sel.kind === 'node') {
          this.nodes = this.nodes.filter((k) => k.id !== this.sel.id);
          this.edges = this.edges.filter((e) => e.from !== this.sel.id && e.to !== this.sel.id);
        } else {
          this.edges = this.edges.filter((e) => this.ekey(e) !== this.sel.id);
        }
        this.select(null);
        this.changed();
        return;
      }
      if (!n || n.type !== 'decision') return;
      this.snapshot();
      if (a === 'swap') {
        for (const e of this.edges) if (e.from === n.id && e.label) e.label = e.label === 'yes' ? 'no' : 'yes';
      } else if (a === 'side') {
        const key = (n.yesSide || 'bottom') === 'bottom' ? 'noSide' : 'yesSide';
        n[key] = (n[key] || 'right') === 'right' ? 'left' : 'right';
      }
      this.render();
      this.changed();
    }
    ekey(e) { return `${e.from}>${e.to}>${e.label || ''}`; }

    // ───────── pointer ─────────
    down(e) {
      if (this.disabled || e.button > 0) return;
      const p = this.pt(e);
      const h = e.target.closest('[data-handle]');
      if (h) {
        e.preventDefault();
        const [id, label] = h.dataset.handle.split('|');
        const n = this.nodes.find((k) => k.id === id);
        const pp = port(n, label || null);
        this.link = { from: id, label: label || null, x: pp.x, y: pp.y, mx: p.x, my: p.y, sx: e.clientX, sy: e.clientY, dragging: true };
        this.svg.setPointerCapture(e.pointerId);
        this.render();
        return;
      }
      const g = e.target.closest('[data-node]');
      const n = g ? this.nodes.find((k) => k.id === g.dataset.node) : this.nodeAt(p.x, p.y);
      if (this.link && !this.link.dragging) {
        if (n && n.id !== this.link.from) this.connect(this.link.from, this.link.label, n.id);
        this.link = null;
        this.render();
        if (n) return;
      }
      if (n) {
        e.preventDefault();
        if (!(this.sel && this.sel.id === n.id)) this.select({ kind: 'node', id: n.id });
        this.drag = { n, dx: n.x - p.x, dy: n.y - p.y, sx: e.clientX, sy: e.clientY, moved: false };
        this.svg.setPointerCapture(e.pointerId);
        return;
      }
      const eg = e.target.closest('[data-edge]');
      if (eg) { this.select({ kind: 'edge', id: eg.dataset.edge }); return; }
      this.select(null);
    }
    move(e) {
      if (this.link && this.link.dragging) {
        const p = this.pt(e);
        this.link.mx = p.x; this.link.my = p.y;
        this.drawLink();
        return;
      }
      if (!this.drag) return;
      const d = this.drag;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      if (!d.moved) { this.snapshot(); d.moved = true; }
      const p = this.pt(e);
      const s = size(d.n.type, d.n.text);
      d.n.x = Math.max(s.w / 2 + 6, Math.round((p.x + d.dx) / SNAP) * SNAP);
      d.n.y = Math.max(s.h / 2 + 6, Math.round((p.y + d.dy) / SNAP) * SNAP);
      this.render();
    }
    up(e) {
      if (this.link && this.link.dragging) {
        const L = this.link;
        const moved = Math.hypot(e.clientX - L.sx, e.clientY - L.sy) >= 6;
        if (!moved) { L.dragging = false; this.render(); return; } // click-to-connect: next click picks the target
        const p = this.pt(e);
        const n = this.nodeAt(p.x, p.y);
        if (n && n.id !== L.from) this.connect(L.from, L.label, n.id);
        this.link = null;
        this.render();
        return;
      }
      if (this.drag) {
        if (this.drag.moved) this.changed();
        this.drag = null;
      }
    }
    connect(from, label, to) {
      const src = this.nodes.find((k) => k.id === from), dst = this.nodes.find((k) => k.id === to);
      if (!src || !dst) return;
      if (dst.type === 'terminal' && CB.Runner.isStartText(dst.text)) return;
      this.snapshot();
      this.edges = this.edges.filter((e) => !(e.from === from && e.label === label));
      this.edges.push({ from, to, label });
      this.select({ kind: 'node', id: to });
      this.changed();
    }

    // ───────── drawing ─────────
    render() {
      const nodes = this.nodes;
      let W = VW, H = 520;
      for (const n of nodes) { const b = this.box(n); W = Math.max(W, b.r + 60); H = Math.max(H, b.b + 120); }
      const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
      let out = R.defs(this.mk);
      for (const e of this.edges) {
        const a = byId[e.from], b = byId[e.to];
        if (!a || !b) continue;
        const k = this.ekey(e);
        out += R.edgeMarkup({ pts: routeFree(a, e.label, b), label: e.label }, this.mk, { editor: true, key: k, selected: this.sel && this.sel.kind === 'edge' && this.sel.id === k });
      }
      for (const n of nodes) out += R.nodeMarkup(n, { editor: true, selected: this.sel && this.sel.kind === 'node' && this.sel.id === n.id, hl: this.hl[n.id] });
      if (!this.disabled) {
        for (const n of nodes) {
          const selected = this.sel && this.sel.id === n.id;
          for (const l of this.ports(n)) {
            const isFree = this.free(n, l);
            if (!isFree && !selected) continue;
            const p = port(n, l);
            const lx = p.dir === 'down' ? p.x + 9 : p.x + (p.dir === 'right' ? 4 : -4);
            const ly = p.dir === 'down' ? p.y + 14 : p.y - 9;
            out += `<g class="ed-handle${isFree ? ' free' : ''}" data-handle="${n.id}|${l || ''}"><circle cx="${p.x}" cy="${p.y}" r="11" class="ed-hit"/><circle cx="${p.x}" cy="${p.y}" r="5.5"/>${l && isFree ? `<text x="${lx}" y="${ly}" text-anchor="${p.dir === 'left' ? 'end' : 'start'}">${l === 'yes' ? 'Yes' : 'No'}</text>` : ''}</g>`;
          }
        }
      }
      out += '<g class="ed-link"></g>';
      this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      this.svg.innerHTML = out;
      this.drawLink();
    }
    drawLink() {
      const g = this.svg.querySelector('.ed-link');
      if (!g) return;
      const L = this.link;
      if (!L) { g.innerHTML = ''; return; }
      g.innerHTML = L.dragging
        ? `<line x1="${L.x}" y1="${L.y}" x2="${L.mx}" y2="${L.my}" marker-end="url(#${this.mk})"/>`
        : `<circle cx="${L.x}" cy="${L.y}" r="9"/><text x="${L.x + 12}" y="${L.y + 22}">now click the box this arrow goes to</text>`;
    }
  }

  CB.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);

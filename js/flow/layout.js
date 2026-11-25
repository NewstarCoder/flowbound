// Shape metrics, structured-flowchart layout (for questions) and free arrow routing (for the editor).
(function (root) {
  const CB = (root.CB = root.CB || {});
  const CW = 7.3; // approx width of one monospace character at 12.5px
  const GAPY = 30, LANE = 26;

  function size(type, text) {
    const lines = String(text || '').split('\n');
    const L = Math.max(4, ...lines.map((l) => l.length));
    const n = lines.length;
    switch (type) {
      case 'terminal': return { w: Math.max(96, L * CW + 40), h: 36 };
      case 'io': return { w: Math.max(132, L * CW + 50), h: 40 + (n - 1) * 15 };
      case 'decision': return { w: Math.max(136, L * CW * 1.4 + 48), h: Math.max(66, 50 + n * 15) };
      case 'join': return { w: 2, h: 2 };
      default: return { w: Math.max(120, L * CW + 30), h: 40 + (n - 1) * 15 };
    }
  }

  // ───────── authoring DSL → graph ─────────
  // Items: 'START' | 'STOP' | 'INPUT X' | 'OUTPUT X' | 'X ← 1' | {p|io|t: text}
  //        {if, yes:[], no:[]} | {while, do:[], exit:'no'|'yes'} | {repeat:[], until}
  // Any text written as '[[answer]]' becomes a blank the player fills in.
  function itemNode(it) {
    let type, text;
    if (typeof it === 'string') text = it;
    else if (it.p !== undefined) { type = 'process'; text = it.p; }
    else if (it.io !== undefined) { type = 'io'; text = it.io; }
    else if (it.t !== undefined) { type = 'terminal'; text = it.t; }
    else return null;
    let blank = false;
    const m = text.match(/^\[\[([\s\S]*)\]\]$/);
    if (m) { blank = true; text = m[1]; }
    if (!type) {
      if (/^(START|STOP|BEGIN|END)$/i.test(text)) type = 'terminal';
      else if (CB.Expr.IN_RE.test(text) || CB.Expr.OUT_RE.test(text)) type = 'io';
      else type = 'process';
    }
    return { type, text, blank };
  }
  function condNode(text) {
    const m = String(text).match(/^\[\[([\s\S]*)\]\]$/);
    return { type: 'decision', text: m ? m[1] : text, blank: !!m };
  }
  const blankSize = (nd) => size(nd.type, nd.blank ? nd.text.padEnd(14, ' ') : nd.text);

  function measureSeq(items) {
    let L = 0, R = 0, H = 0;
    items.forEach((it, i) => {
      const m = measure(it);
      L = Math.max(L, m.L); R = Math.max(R, m.R);
      H += m.H + (i ? GAPY : 0);
    });
    return { L, R, H };
  }
  function measure(it) {
    const nd = itemNode(it);
    if (nd) { const s = blankSize(nd); return { L: s.w / 2, R: s.w / 2, H: s.h }; }
    if (it.if !== undefined) {
      const d = blankSize(condNode(it.if));
      const Y = measureSeq(it.yes || []), N = measureSeq(it.no || []);
      const noX = Math.max(d.w / 2 + 24, Y.R + 30) + N.L;
      return { L: Math.max(d.w / 2, Y.L), R: noX + N.R + 6, H: d.h + GAPY + Math.max(Y.H, N.H), noX };
    }
    if (it.while !== undefined) {
      const d = blankSize(condNode(it.while));
      const B = measureSeq(it.do);
      const loopX = Math.max(d.w / 2, B.L) + LANE, exitX = Math.max(d.w / 2, B.R) + LANE;
      return { L: loopX + 6, R: exitX + 6, H: d.h + GAPY + B.H + 18, loopX, exitX };
    }
    if (it.repeat !== undefined) {
      const d = blankSize(condNode(it.until));
      const B = measureSeq(it.repeat);
      const loopX = Math.max(d.w / 2, B.L) + LANE;
      return { L: loopX + 6, R: Math.max(d.w / 2, B.R), H: B.H + GAPY + d.h, loopX };
    }
    throw new Error('Bad flowchart item: ' + JSON.stringify(it));
  }

  function build(items) {
    const nodes = [], edges = [];
    let uid = 0;
    const add = (nd, cx, top) => {
      const s = blankSize(nd);
      const n = { id: 'n' + uid++, type: nd.type, text: nd.blank ? '' : nd.text, x: cx, y: top + s.h / 2, w: s.w, h: s.h };
      if (nd.blank) { n.blank = true; n.answer = nd.text; }
      nodes.push(n);
      return n;
    };
    const connect = (pend, n) => {
      for (const ex of pend) edges.push({ from: ex.from, to: n.id, label: ex.label || null, pts: routeExit(ex, n) });
    };

    // returns { first: node, pend: [...] }
    function seq(list, cx, y, pend) {
      let first = null;
      list.forEach((it, i) => {
        const r = place(it, cx, y, pend);
        if (!first) first = r.first;
        pend = r.pend;
        y += measure(it).H + GAPY;
      });
      return { first, pend };
    }
    function place(it, cx, y, pend) {
      const nd = itemNode(it);
      if (nd) {
        const n = add(nd, cx, y);
        connect(pend, n);
        const stop = nd.type === 'terminal' && /^(STOP|END)$/i.test(nd.text);
        return { first: n, pend: stop ? [] : [{ from: n.id, x: cx, y: y + n.h, dir: 'down' }] };
      }
      const m = measure(it);
      if (it.if !== undefined) {
        const d = add(condNode(it.if), cx, y);
        connect(pend, d);
        const by = y + d.h + GAPY;
        let py = [{ from: d.id, label: 'yes', x: cx, y: y + d.h, dir: 'down' }];
        if ((it.yes || []).length) py = seq(it.yes, cx, by, py).pend;
        let pn = [{ from: d.id, label: 'no', x: cx + d.w / 2, y: y + d.h / 2, dir: 'right', lane: cx + m.noX }];
        if ((it.no || []).length) pn = seq(it.no, cx + m.noX, by, pn).pend;
        return { first: d, pend: py.concat(pn) };
      }
      if (it.while !== undefined) {
        const exitOn = it.exit || 'no', bodyOn = exitOn === 'no' ? 'yes' : 'no';
        const d = add(condNode(it.while), cx, y);
        connect(pend, d);
        const r = seq(it.do, cx, y + d.h + GAPY, [{ from: d.id, label: bodyOn, x: cx, y: y + d.h, dir: 'down' }]);
        const bottom = y + m.H - 18 + 12;
        for (const ex of r.pend) {
          const pts = [[ex.x, ex.y]];
          if (ex.dir === 'right') pts.push([ex.lane, ex.y]);
          const cx0 = pts[pts.length - 1][0];
          pts.push([cx0, bottom], [cx - m.loopX, bottom], [cx - m.loopX, d.y], [cx - d.w / 2, d.y]);
          edges.push({ from: ex.from, to: d.id, label: ex.label || null, pts: simplify(pts) });
        }
        return { first: d, pend: [{ from: d.id, label: exitOn, x: cx + d.w / 2, y: d.y, dir: 'right', lane: cx + m.exitX }] };
      }
      if (it.repeat !== undefined) {
        const r = seq(it.repeat, cx, y, pend);
        const dy = y + measureSeq(it.repeat).H + GAPY;
        const d = add(condNode(it.until), cx, dy);
        connect(r.pend, d);
        const top = y - GAPY / 2;
        edges.push({ from: d.id, to: r.first.id, label: 'no', pts: [[cx - d.w / 2, d.y], [cx - m.loopX, d.y], [cx - m.loopX, top], [cx, top], [cx, y]] });
        return { first: r.first, pend: [{ from: d.id, label: 'yes', x: cx, y: dy + d.h, dir: 'down' }] };
      }
      throw new Error('bad item');
    }

    seq(items, 0, 0, []);
    // shift so everything is positive
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    for (const n of nodes) { minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2); maxY = Math.max(maxY, n.y + n.h / 2); }
    for (const e of edges) for (const [x, y] of e.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const PAD = 16, dx = PAD - minX, dy = PAD;
    for (const n of nodes) { n.x += dx; n.y += dy; }
    for (const e of edges) e.pts = e.pts.map(([x, y]) => [x + dx, y + dy]);
    return { nodes, edges, width: maxX - minX + PAD * 2 + 20, height: maxY + PAD * 2 };
  }

  // route from a pending exit point down into the top of node n
  function routeExit(ex, n) {
    const tx = n.x, ty = n.y - n.h / 2;
    const pts = [[ex.x, ex.y]];
    let cx = ex.x;
    if (ex.dir === 'right' || ex.dir === 'left') {
      cx = ex.lane !== undefined ? ex.lane : tx;
      pts.push([cx, ex.y]);
    }
    if (Math.abs(cx - tx) < 0.5) pts.push([tx, ty]);
    else pts.push([cx, ty - 12], [tx, ty - 12], [tx, ty]);
    return simplify(pts);
  }

  function simplify(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5) continue;
      out.push(p);
      if (out.length >= 3) {
        const [a, b, c] = out.slice(-3);
        if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5)) out.splice(out.length - 2, 1);
      }
    }
    return out;
  }

  // ───────── free routing for the editor ─────────
  // Out-port of node n for a given label: returns {x, y, dir}.
  function port(n, lbl) {
    const s = size(n.type, n.text);
    const w = s.w, h = s.h;
    let side = 'bottom';
    if (n.type === 'decision') side = lbl === 'no' ? (n.noSide || 'right') : (n.yesSide || 'bottom');
    if (side === 'right') return { x: n.x + w / 2, y: n.y, dir: 'right' };
    if (side === 'left') return { x: n.x - w / 2, y: n.y, dir: 'left' };
    return { x: n.x, y: n.y + h / 2, dir: 'down' };
  }
  function routeFree(src, lbl, dst) {
    const p = port(src, lbl);
    const ss = size(src.type, src.text), ds = size(dst.type, dst.text);
    const top = dst.y - ds.h / 2;
    const pts = [[p.x, p.y]];
    if (top >= p.y + 18 || (p.dir !== 'down' && top >= src.y + ss.h / 2 + 4)) {
      // target is below: come in from the top
      if (p.dir === 'down') {
        if (Math.abs(p.x - dst.x) > 0.5) { const my = Math.round((p.y + top) / 2); pts.push([p.x, my], [dst.x, my]); }
      } else {
        const ahead = p.dir === 'right' ? dst.x > p.x + 10 : dst.x < p.x - 10;
        if (ahead) pts.push([dst.x, p.y]);
        else {
          const lx = p.x + (p.dir === 'right' ? 20 : -20), my = Math.round((src.y + ss.h / 2 + top) / 2);
          pts.push([lx, p.y], [lx, my], [dst.x, my]);
        }
      }
      pts.push([dst.x, top]);
    } else {
      // target is above or level (a loop back): come in from the side
      const leftSide = p.dir !== 'right';
      const lane = leftSide
        ? Math.min(src.x - ss.w / 2, dst.x - ds.w / 2) - 24
        : Math.max(src.x + ss.w / 2, dst.x + ds.w / 2) + 24;
      if (p.dir === 'down') pts.push([p.x, p.y + 16], [lane, p.y + 16]);
      else pts.push([lane, p.y]);
      pts.push([lane, dst.y], [leftSide ? dst.x - ds.w / 2 : dst.x + ds.w / 2, dst.y]);
    }
    return simplify(pts);
  }

  CB.Layout = { size, build, routeFree, port, simplify };
})(typeof window !== 'undefined' ? window : globalThis);

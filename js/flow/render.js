// SVG rendering of flowchart graphs.
(function (root) {
  const CB = (root.CB = root.CB || {});
  const { size } = CB.Layout;
  let uid = 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pretty = (t) => String(t).replace(/<-/g, '←');

  function shapePath(type, x, y, w, h) {
    const l = x - w / 2, t = y - h / 2;
    switch (type) {
      case 'terminal': return `<rect x="${l}" y="${t}" width="${w}" height="${h}" rx="${h / 2}"/>`;
      case 'io': { const k = 12; return `<polygon points="${l + k},${t} ${l + w},${t} ${l + w - k},${t + h} ${l},${t + h}"/>`; }
      case 'decision': return `<polygon points="${x},${t} ${l + w},${y} ${x},${t + h} ${l},${y}"/>`;
      case 'join': return `<circle cx="${x}" cy="${y}" r="2"/>`;
      default: return `<rect x="${l}" y="${t}" width="${w}" height="${h}"/>`;
    }
  }

  function textLines(text, x, y) {
    const lines = pretty(text).split('\n');
    const lh = 15, y0 = y - ((lines.length - 1) * lh) / 2;
    return `<text x="${x}" y="${y0}" text-anchor="middle" dominant-baseline="central">${lines.map((ln, i) => `<tspan x="${x}" y="${y0 + i * lh}">${esc(ln)}</tspan>`).join('')}</text>`;
  }

  function nodeMarkup(n, o = {}) {
    const s = n.w ? { w: n.w, h: n.h } : size(n.type, n.text);
    const cls = ['fc-node', 'fc-' + n.type];
    if (n.blank) cls.push('blank');
    if (o.selected) cls.push('sel');
    if (o.hl) cls.push('hl-' + o.hl);
    if (!n.blank && !String(n.text || '').trim()) cls.push('empty');
    let inner = shapePath(n.type, n.x, n.y, s.w, s.h);
    if (n.blank) inner += o.blankNo ? `<text class="fc-blank-no" x="${n.x - s.w / 2 + 6}" y="${n.y - s.h / 2 - 5}">${o.blankNo}</text>` : '';
    else if (String(n.text || '').trim()) inner += textLines(n.text, n.x, n.y);
    else if (o.editor) inner += `<text class="fc-ph" x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central">${n.type === 'decision' ? 'condition?' : 'type…'}</text>`;
    return `<g class="${cls.join(' ')}" data-node="${esc(n.id)}">${inner}</g>`;
  }

  function edgeMarkup(e, mk, o = {}) {
    const pts = e.pts;
    if (!pts || pts.length < 2) return '';
    const d = pts.map((p) => p.join(',')).join(' ');
    let lab = '';
    if (e.label) {
      const [x0, y0] = pts[0], [x1, y1] = pts[1];
      const horiz = Math.abs(y1 - y0) < 0.5;
      const lx = horiz ? x0 + (x1 > x0 ? 6 : -6) : x0 + 5;
      const ly = horiz ? y0 - 6 : y0 + 13;
      const anchor = horiz && x1 < x0 ? 'end' : 'start';
      lab = `<text class="fc-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${e.label === 'yes' ? 'Yes' : 'No'}</text>`;
    }
    const hit = o.editor ? `<polyline class="fc-hit" points="${d}"/>` : '';
    return `<g class="fc-edge${o.selected ? ' sel' : ''}"${o.editor ? ` data-edge="${esc(o.key)}"` : ''}>${hit}<polyline points="${d}" marker-end="url(#${mk})"/>${lab}</g>`;
  }

  function defs(mk) {
    return `<defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" class="fc-arrow"/></marker></defs>`;
  }

  // Static rendering of a laid-out graph (from CB.Layout.build).
  function svg(graph, o = {}) {
    const mk = 'fcA' + uid++;
    let blankNo = 0;
    const body = graph.edges.map((e) => edgeMarkup(e, mk)).join('') +
      graph.nodes.map((n) => nodeMarkup(n, { blankNo: n.blank ? ++blankNo : 0, hl: o.hl && o.hl[n.id] })).join('');
    const w = Math.ceil(graph.width), h = Math.ceil(graph.height);
    return `<svg class="fc-svg" viewBox="0 0 ${w} ${h}" style="max-width:${Math.round(w * 1.15)}px" xmlns="http://www.w3.org/2000/svg">${defs(mk)}${body}</svg>`;
  }

  // A small icon of one symbol (used in multiple-choice options).
  function icon(type) {
    const mk = 'fcI' + uid++;
    const w = type === 'decision' ? 70 : 76, h = type === 'decision' ? 44 : 30;
    return `<svg class="fc-icon" viewBox="0 0 ${w + 8} ${h + 8}" width="${w + 8}" height="${h + 8}">${defs(mk)}<g class="fc-node fc-${type}">${shapePath(type, (w + 8) / 2, (h + 8) / 2, w, h)}</g></svg>`;
  }

  CB.Render = { svg, icon, nodeMarkup, edgeMarkup, defs, esc, pretty };
})(typeof window !== 'undefined' ? window : globalThis);

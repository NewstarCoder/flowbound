(function (root) {
  const CB = (root.CB = root.CB || {});

  CB.util = {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    hash(x, y, s = 0) {
      let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    },
    $(id) {
      return document.getElementById(id);
    },
    el(tag, cls, html) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    },
    deepCopy: (o) => JSON.parse(JSON.stringify(o)),
  };

  // Promise-based tweens driven by the game loop.
  const tweens = [];
  const ease = {
    linear: (t) => t,
    out: (t) => 1 - (1 - t) * (1 - t),
    in: (t) => t * t,
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    back: (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
  };
  CB.tween = function (obj, props, ms, easing = 'out') {
    return new Promise((resolve) => {
      const from = {};
      for (const k in props) from[k] = obj[k];
      tweens.push({ obj, props, from, ms: Math.max(1, ms), t: 0, ease: ease[easing] || ease.out, resolve });
    });
  };
  CB.updateTweens = function (dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt * 1000;
      const p = Math.min(1, tw.t / tw.ms);
      const e = tw.ease(p);
      for (const k in tw.props) tw.obj[k] = tw.from[k] + (tw.props[k] - tw.from[k]) * e;
      if (p >= 1) {
        tweens.splice(i, 1);
        tw.resolve();
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

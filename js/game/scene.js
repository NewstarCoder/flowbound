(function () {
  const W = 320, H = 150, GROUND = 118;
  const sleep = CB.util.sleep;
  const PAL = { R: '#0e5e55', r: '#22b8a6', p: '#5ff0dc', k: '#0a0a0c', w: '#e8e6df', s: '#4f5059', l: '#a7a9b1', i: '#cfc4a3' };

  const HERO = [
    '....RRRR....',
    '...RrrrrR...',
    '..RrrpprrR..',
    '..RrkkkkrR..',
    '..RkkkwkwR..',
    '..RkkkkkkR..',
    '...RrrrrR...',
    '..RrrrrrrR..',
    '.RrrRrrRrrR.',
    '.RrrRrrRrrR.',
    '.RrrrrrrrrR.',
    '..RrrrrrrR..',
    '..RrrRRrrR..',
    '..RrR..RrR..',
    '..kkk..kkk..',
  ];

  function spriteCanvas(rows, extra) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(x + 1, y + 1, 1, 1); }
    }));
    if (extra) extra(g);
    return c;
  }
  const WEAPONS = {
    vanguard: (g) => { g.fillStyle = PAL.s; g.fillRect(10, 7, 5, 7); g.fillStyle = PAL.l; g.fillRect(11, 8, 3, 5); g.fillStyle = PAL.r; g.fillRect(12, 10, 1, 1); },
    duelist: (g) => { g.fillStyle = PAL.l; g.fillRect(11, 3, 1, 10); g.fillStyle = PAL.i; g.fillRect(10, 11, 3, 1); },
    arcanist: (g) => { g.fillStyle = PAL.i; g.fillRect(11, 8, 4, 5); g.fillStyle = PAL.R; g.fillRect(12, 9, 2, 3); g.fillStyle = PAL.p; g.fillRect(13, 6, 1, 1); },
    ranger: (g) => { g.fillStyle = PAL.l; for (let y = 3; y < 14; y++) g.fillRect(13 - Math.round(Math.sin(((y - 3) / 10) * Math.PI) * 2), y, 1, 1); g.fillStyle = PAL.w; g.fillRect(13, 3, 1, 11); },
  };
  const heroSprites = {};
  function heroSprite(cls) {
    if (!heroSprites[cls]) heroSprites[cls] = spriteCanvas(HERO, WEAPONS[cls]);
    return heroSprites[cls];
  }

  const S = {
    canvas: null, ctx: null, t: 0, stage: 0, cls: 'vanguard',
    hero: { x: 70, y: GROUND, ox: 0, oy: 0, flash: 0, alpha: 1, dead: 0 },
    boss: { x: 238, y: GROUND, ox: 0, oy: 0, flash: 0, scale: 1, alpha: 1, phase2: false, id: 'gatekeeper' },
    parts: [], floats: [], rings: [], streaks: [], bolts: [], ambient: [],
    shake: 0, flash: 0, flashColor: '#fff', dim: 0, banner: null,
  };

  S.init = function (canvas) {
    S.canvas = canvas;
    S.ctx = canvas.getContext('2d');
    S.ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < 40; i++) S.ambient.push({ x: Math.random() * W, y: Math.random() * H, v: 4 + Math.random() * 8, d: Math.random() * 6 });
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      S.update(dt);
      S.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  S.reset = function (stage, cls, bossId) {
    S.stage = stage; S.cls = cls;
    Object.assign(S.hero, { ox: 0, oy: 0, flash: 0, alpha: 1, dead: 0 });
    Object.assign(S.boss, { ox: 0, oy: 0, flash: 0, scale: 1, alpha: 1, phase2: false, id: bossId });
    S.parts.length = S.floats.length = S.rings.length = S.streaks.length = S.bolts.length = 0;
    S.dim = 0; S.banner = null;
  };

  // ── effect primitives ──
  S.burst = (x, y, n, colors, speed = 60, life = 0.6, grav = 80, size = 2) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life, max: life, color: colors[i % colors.length], g: grav, size });
    }
  };
  S.float = (x, y, text, color = '#fff', size = 16) => S.floats.push({ x, y, text, color, size, life: 1.1, max: 1.1 });
  S.ring = (x, y, color, r1 = 40, life = 0.4, w = 2) => S.rings.push({ x, y, r: 2, r1, life, max: life, color, w });
  S.streak = (x1, y1, x2, y2, color, life = 0.25, w = 2) => S.streaks.push({ x1, y1, x2, y2, color, life, max: life, w });
  S.doShake = (m) => { S.shake = Math.max(S.shake, m); };
  S.doFlash = (c = '#fff', a = 0.6) => { S.flash = a; S.flashColor = c; };
  S.bolt = (x1, y1, x2, y2, ms, color, size = 3) => {
    const b = { x: x1, y: y1, color, size };
    S.bolts.push(b);
    return CB.tween(b, { x: x2, y: y2 }, ms, 'in').then(() => { S.bolts.splice(S.bolts.indexOf(b), 1); });
  };
  S.showBanner = (text, color = '#fff', ms = 1000) => { S.banner = { text, color, life: ms / 1000, max: ms / 1000 }; };

  const bossCenter = () => ({ x: S.boss.x + S.boss.ox, y: S.boss.y - 36 + S.boss.oy });
  const heroCenter = () => ({ x: S.hero.x + S.hero.ox, y: S.hero.y - 22 + S.hero.oy });

  // ── player attacks ──
  async function hitBoss(dmg, tag, big) {
    const c = bossCenter();
    S.boss.flash = 1;
    S.doShake(big ? 6 : 3);
    S.burst(c.x, c.y, big ? 30 : 16, ['#22b8a6', '#5ff0dc', '#e8e6df'], big ? 110 : 70);
    S.ring(c.x, c.y, '#22b8a6', big ? 50 : 30);
    S.boss.ox = 10;
    CB.tween(S.boss, { ox: 0 }, 300);
    S.float(c.x, c.y - 30, '-' + dmg, '#ffffff', big ? 24 : 18);
    if (tag) S.float(c.x, c.y - 48, tag, '#5ff0dc', 14);
    CB.Sound.play(big ? 'crit' : 'hit');
    await sleep(350);
  }
  S.playerAttack = async function (dmg, opts = {}) {
    const h = S.hero, b = bossCenter();
    const special = opts.special;
    // wind-up
    CB.Sound.play('charge');
    await CB.tween(h, { ox: -6 }, 160);
    for (let i = 0; i < (special ? 14 : 6); i++) S.parts.push({ x: h.x + (Math.random() - 0.5) * 30, y: h.y - 20 + (Math.random() - 0.5) * 30, vx: 0, vy: -20, life: 0.4, max: 0.4, color: '#22b8a6', g: 0, size: 2 });
    if (special) { S.showBanner(special.toUpperCase(), '#5ff0dc', 900); S.dim = 0.4; }
    await sleep(special ? 350 : 120);
    switch (S.cls) {
      case 'vanguard': {
        await CB.tween(h, { ox: b.x - h.x - 46 }, 160, 'in');
        CB.Sound.play('shield');
        S.ring(b.x - 14, b.y, '#22b8a6', special ? 70 : 45, 0.5, 3);
        if (special) S.ring(b.x - 14, b.y, '#e8e6df', 90, 0.7, 2);
        await hitBoss(dmg, opts.tag, special || opts.big);
        await CB.tween(h, { ox: 0 }, 260);
        break;
      }
      case 'duelist': {
        await CB.tween(h, { ox: b.x - h.x - 40 }, 140, 'in');
        const n = special ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const y = b.y - 12 + i * (24 / n);
          S.streak(h.x + h.ox + 10, y + 4, b.x + 24, y - 4, '#5ff0dc', 0.2, 2);
          S.burst(b.x, y, 6, ['#e8e6df', '#22b8a6'], 50, 0.3);
          CB.Sound.play('slash');
          S.boss.flash = 0.6;
          await sleep(90);
        }
        await hitBoss(dmg, opts.tag, special || opts.big);
        await CB.tween(h, { ox: 0 }, 240);
        break;
      }
      case 'arcanist': {
        const hc = heroCenter();
        S.ring(hc.x, hc.y, '#22b8a6', 26, 0.5, 1);
        CB.Sound.play('magic');
        await sleep(250);
        const n = special ? 4 : 1;
        for (let i = 0; i < n; i++) {
          S.bolt(hc.x + 8, hc.y - 6 * i, b.x, b.y + (i - 1.5) * 6, 260, '#5ff0dc', special ? 4 : 3);
          await sleep(special ? 90 : 0);
        }
        await sleep(260);
        S.burst(b.x, b.y, 24, ['#22b8a6', '#0e5e55', '#5ff0dc'], 120, 0.8, 0);
        await hitBoss(dmg, opts.tag, special || opts.big);
        break;
      }
      case 'ranger': {
        await CB.tween(h, { ox: -10 }, 150);
        const n = special ? 7 : 3;
        const hc = heroCenter();
        for (let i = 0; i < n; i++) {
          CB.Sound.play('arrow');
          S.bolt(hc.x + 10, hc.y - 2, b.x + (Math.random() - 0.5) * 20, b.y + (Math.random() - 0.5) * 24, 200, '#e8e6df', 2);
          await sleep(special ? 70 : 110);
        }
        await sleep(160);
        await hitBoss(dmg, opts.tag, special || opts.big);
        await CB.tween(h, { ox: 0 }, 200);
        break;
      }
    }
    S.dim = 0;
  };

  // ── boss attacks ──
  S.bossAttack = async function (dmg, opts = {}) {
    const bs = S.boss, h = heroCenter();
    // telegraph
    if (opts.crit) {
      S.dim = 0.55;
      S.showBanner('CRITICAL STRIKE', '#5ff0dc', 1100);
      CB.Sound.play('warn');
      await CB.tween(bs, { scale: 1.18 }, 450);
    } else {
      S.float(bs.x, bs.y - 90, '!', '#e8e6df', 22);
      await CB.tween(bs, { scale: 1.06 }, 250);
    }
    if (bs.id === 'gatekeeper') {
      await CB.tween(bs, { oy: -16 }, 180);
      await CB.tween(bs, { oy: 0, scale: 1 }, 110, 'in');
      CB.Sound.play('slam');
      for (let i = 0; i < 4; i++) S.ring(bs.x - 30 - i * 30, GROUND, '#a7a9b1', 18, 0.35, 2);
      S.burst(bs.x - 20, GROUND, 14, ['#4f5059', '#a7a9b1'], 70);
      await sleep(150);
    } else if (bs.id === 'hydra') {
      bs.scale = 1;
      CB.Sound.play('slash');
      for (let i = 0; i < 3; i++) {
        const hx = bs.x - 22 + i * 22, hy = bs.y - 84 + Math.abs(i - 1) * 10;
        S.streak(hx, hy, h.x + 10, h.y - 6 + i * 6, '#a7a9b1', 0.3, 2);
        S.bolt(hx, hy, h.x, h.y - 6 + i * 6, 200, '#e8e6df', 3);
        CB.Sound.play('arrow');
        await sleep(90);
      }
      await sleep(160);
    } else {
      bs.scale = 1;
      CB.Sound.play('glitch');
      S.doFlash('#e8e6df', 0.25);
      for (let i = 0; i < 3; i++) { S.bolt(bs.x - 20, bs.y - 40 + i * 8, h.x, h.y, 220, '#e8e6df', 3); await sleep(60); }
      await sleep(200);
    }
    if (opts.deflect) {
      CB.Sound.play('shield');
      CB.Sound.play('slash');
      S.streak(h.x + 6, h.y - 20, h.x + 26, h.y + 16, '#5ff0dc', 0.35, 3);
      S.ring(h.x + 14, h.y, '#5ff0dc', 36, 0.45, 3);
      S.burst(h.x + 16, h.y, 20, ['#5ff0dc', '#e8e6df'], 110, 0.5);
      S.float(h.x, h.y - 34, 'DEFLECTED', '#5ff0dc', 18);
      S.doShake(3);
      await sleep(450);
    } else if (opts.evade) {
      CB.Sound.play('evade');
      await CB.tween(S.hero, { oy: -18, alpha: 0.4 }, 120);
      S.float(h.x, h.y - 34, 'DODGED', '#e8e6df', 16);
      await CB.tween(S.hero, { oy: 0, alpha: 1 }, 220);
    } else if (opts.block) {
      CB.Sound.play('shield');
      S.ring(h.x + 12, h.y, '#22b8a6', 30, 0.4, 3);
      S.burst(h.x + 12, h.y, 12, ['#a7a9b1', '#e8e6df'], 60);
      S.float(h.x, h.y - 34, 'BLOCKED', '#e8e6df', 16);
      await sleep(400);
    } else {
      if (opts.guard) {
        CB.Sound.play('shield');
        S.ring(h.x + 14, h.y, '#22b8a6', 26, 0.4, 3);
        S.streak(h.x + 16, h.y - 18, h.x + 16, h.y + 18, '#e8e6df', 0.4, 2);
      }
      S.hero.flash = opts.guard ? 0.4 : 1;
      S.doShake(opts.crit ? 9 : opts.guard ? 1 : 4);
      if (opts.crit) S.doFlash('#ffffff', 0.7);
      S.burst(h.x, h.y, opts.crit ? 34 : 16, ['#e8e6df', '#a7a9b1', '#4f5059'], opts.crit ? 120 : 70);
      if (opts.crit) for (let i = 0; i < 5; i++) S.streak(h.x, h.y, h.x + (Math.random() - 0.5) * 60, h.y + (Math.random() - 0.5) * 60, '#ffffff', 0.4, 1);
      S.hero.ox = -10;
      CB.tween(S.hero, { ox: 0 }, 300);
      S.float(h.x, h.y - 30, '-' + dmg, opts.crit ? '#5ff0dc' : '#e8e6df', opts.crit ? 26 : 18);
      if (opts.tag) S.float(h.x, h.y - 48, opts.tag, '#a7a9b1', 13);
      CB.Sound.play(opts.crit ? 'crit' : 'hurt');
      await sleep(450);
    }
    if (opts.drain) {
      S.float(bs.x, bs.y - 80, '+' + opts.drain, '#e8e6df', 16);
      S.burst(bs.x, bs.y - 36, 10, ['#e8e6df'], 40, 0.6, -20);
    }
    S.dim = 0;
    bs.scale = 1;
  };

  S.bossAbility = async function (name, heal) {
    S.dim = 0.5;
    S.showBanner(name.toUpperCase(), '#e8e6df', 1400);
    CB.Sound.play('ability');
    S.boss.phase2 = true;
    const c = bossCenter();
    for (let i = 0; i < 3; i++) { S.ring(c.x, c.y, '#e8e6df', 60 + i * 20, 0.8, 1); S.burst(c.x, c.y, 18, ['#e8e6df', '#a7a9b1'], 90, 0.9, -30); await sleep(250); }
    if (heal) S.float(c.x, c.y - 40, '+' + heal, '#e8e6df', 20);
    S.doShake(5);
    await sleep(600);
    S.dim = 0;
  };

  S.bossDeath = async function () {
    CB.Sound.play('death');
    const c = bossCenter();
    for (let i = 0; i < 6; i++) { S.burst(c.x + (Math.random() - 0.5) * 40, c.y + (Math.random() - 0.5) * 50, 14, ['#e8e6df', '#a7a9b1', '#22b8a6'], 90); S.doShake(4); await sleep(160); }
    await CB.tween(S.boss, { alpha: 0 }, 600);
  };
  S.heroDeath = async function () {
    CB.Sound.play('death');
    await CB.tween(S.hero, { dead: 1, alpha: 0.35 }, 700);
  };

  // ── update/draw ──
  S.update = function (dt) {
    S.t += dt;
    CB.updateTweens(dt);
    const decay = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if ((arr[i].life -= dt) <= 0) arr.splice(i, 1); };
    for (const p of S.parts) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    for (const f of S.floats) f.y -= 22 * dt;
    for (const r of S.rings) r.r += (r.r1 - r.r) * Math.min(1, dt * 10);
    for (const b of S.bolts) S.parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.18, max: 0.18, color: b.color, g: 0, size: 2 });
    decay(S.parts); decay(S.floats); decay(S.rings); decay(S.streaks);
    if (S.banner && (S.banner.life -= dt) <= 0) S.banner = null;
    S.hero.flash = Math.max(0, S.hero.flash - dt * 4);
    S.boss.flash = Math.max(0, S.boss.flash - dt * 4);
    S.shake = Math.max(0, S.shake - dt * 20);
    S.flash = Math.max(0, S.flash - dt * 2.5);
    for (const a of S.ambient) {
      a.y += a.v * dt * (S.stage === 2 ? -0.6 : S.stage ? 0.3 : 1);
      a.x += Math.sin(S.t + a.d) * 6 * dt;
      if (a.y > H) a.y = 0;
      if (a.y < 0) a.y = H;
    }
  };

  function drawBackground(g) {
    if (S.stage === 0) {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#1b1b20'); grd.addColorStop(1, '#0e0e11');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      for (let layer = 0; layer < 2; layer++) {
        g.fillStyle = layer ? '#141417' : '#202026';
        for (let i = 0; i < 12; i++) {
          const x = ((i * 37 + layer * 19) % 340) - 10, w = 10 + ((i * 7) % 8), top = 20 + ((i * 23 + layer * 11) % 40);
          g.fillRect(x, top, w, GROUND - top);
          g.beginPath(); g.moveTo(x - 12, top + 18); g.lineTo(x + w / 2, top - 22); g.lineTo(x + w + 12, top + 18); g.fill();
        }
      }
      g.fillStyle = '#18181c'; g.fillRect(0, GROUND, W, H - GROUND);
      g.fillStyle = '#2a2a30'; g.fillRect(0, GROUND, W, 2);
    } else if (S.stage === 1) {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#141a1a'); grd.addColorStop(1, '#0b0e0e');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#1d2626'; g.lineWidth = 2;
      // dead trees — every trunk forks like a decision
      for (let i = 0; i < 7; i++) {
        const x = 14 + i * 48, top = 30 + ((i * 17) % 30);
        g.beginPath(); g.moveTo(x, GROUND); g.lineTo(x, top + 20); g.lineTo(x - 12, top); g.moveTo(x, top + 20); g.lineTo(x + 12, top - 4); g.moveTo(x - 12, top); g.lineTo(x - 18, top - 10); g.moveTo(x - 12, top); g.lineTo(x - 6, top - 14); g.stroke();
      }
      g.fillStyle = '#121717'; g.fillRect(0, GROUND, W, H - GROUND);
      g.fillStyle = 'rgba(34,184,166,0.07)';
      for (let i = 0; i < 6; i++) g.fillRect(((i * 61 + Math.floor(S.t * 6)) % 360) - 20, GROUND + 6 + (i % 3) * 8, 34, 2);
      g.fillStyle = '#1f2828'; g.fillRect(0, GROUND, W, 1);
    } else {
      g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(34,184,166,0.10)'; g.lineWidth = 1;
      const cx = W / 2 + 60, cy = 60;
      g.beginPath();
      for (let a = 0; a < Math.PI * 10; a += 0.1) { const r = 2 + a * 4.2, ang = a - S.t * 0.4; const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r * 0.6; if (a) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
      g.fillStyle = '#121418'; g.fillRect(0, GROUND, W, H - GROUND);
      g.fillStyle = '#1e2228';
      for (let x = 0; x < W; x += 16) g.fillRect(x, GROUND, 1, H - GROUND);
      g.fillRect(0, GROUND, W, 1);
    }
    g.fillStyle = S.stage === 2 ? 'rgba(95,240,220,0.25)' : S.stage ? 'rgba(232,230,223,0.2)' : 'rgba(167,169,177,0.35)';
    for (const a of S.ambient) g.fillRect(a.x | 0, a.y | 0, 1, 1);
  }

  function drawHero(g) {
    const h = S.hero;
    const spr = heroSprite(S.cls);
    const bob = Math.round(Math.sin(S.t * 3) * 1);
    const x = Math.round(h.x + h.ox - 24), y = Math.round(h.y + h.oy - 48 + bob);
    g.globalAlpha = h.alpha;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(h.x + h.ox - 14, GROUND - 2, 28, 3);
    // crimson aura keeps the hero the focal point
    g.fillStyle = 'rgba(34,184,166,0.08)'; g.beginPath(); g.arc(h.x + h.ox, h.y - 24, 26, 0, Math.PI * 2); g.fill();
    if (h.dead) {
      g.save(); g.translate(x + 24, y + 48); g.rotate(-h.dead * Math.PI / 2); g.drawImage(spr, -24, -48, 48, 48); g.restore();
    } else g.drawImage(spr, x, y, 48, 48);
    if (h.flash > 0) { g.globalAlpha = h.flash * 0.8; g.globalCompositeOperation = 'lighter'; g.drawImage(spr, x, y, 48, 48); g.globalCompositeOperation = 'source-over'; }
    g.globalAlpha = 1;
  }

  // The Gatekeeper: a terminal-shaped stone golem guarding the START of the path.
  function drawGatekeeper(g, bx, by, t, p2) {
    g.fillStyle = '#26262b';
    g.beginPath(); g.arc(bx, by - 78, 14, Math.PI, 0); g.lineTo(bx + 14, by - 64); g.lineTo(bx - 14, by - 64); g.closePath(); g.fill(); // head
    g.fillStyle = '#34353c'; g.fillRect(bx - 24, by - 62, 48, 50); // torso
    g.fillStyle = '#26262b'; g.fillRect(bx - 24, by - 62, 48, 4);
    g.fillStyle = '#4f5059'; g.fillRect(bx - 30, by - 58, 6, 44); g.fillRect(bx + 24, by - 58, 6, 44); // arms
    g.fillRect(bx - 34, by - 18, 12, 10); g.fillRect(bx + 22, by - 18, 12, 10); // fists
    g.fillStyle = '#1c1c21'; g.fillRect(bx - 18, by - 12, 12, 12); g.fillRect(bx + 6, by - 12, 12, 12); // legs
    // a terminal plate on its chest
    g.strokeStyle = p2 ? '#5ff0dc' : '#a7a9b1'; g.lineWidth = 1;
    g.beginPath(); g.arc(bx - 12, by - 37, 6, Math.PI / 2, Math.PI * 1.5); g.lineTo(bx + 12, by - 43); g.arc(bx + 12, by - 37, 6, -Math.PI / 2, Math.PI / 2); g.closePath(); g.stroke();
    g.fillStyle = p2 ? '#5ff0dc' : '#a7a9b1';
    g.font = '9px VT323, monospace'; g.textAlign = 'center'; g.fillText(p2 ? 'LOCK' : 'START', bx, by - 34);
    g.fillStyle = p2 ? '#ffffff' : '#e8e6df';
    const blink = Math.sin(t * 0.9) > 0.97 ? 1 : 3;
    g.fillRect(bx - 4, by - 82, 8, blink);
    if (p2) { const k = Math.sin(t * 3) * 2; g.strokeStyle = 'rgba(95,240,220,0.6)'; g.strokeRect(bx - 30 - k, by - 66 - k, 60 + k * 2, 60 + k * 2); }
  }

  // The Forking Hydra: three diamond heads on swaying necks — every head is a decision.
  function drawHydra(g, bx, by, t, p2) {
    g.fillStyle = '#26282b'; g.fillRect(bx - 26, by - 34, 52, 30); // body
    g.fillStyle = '#34363c'; g.fillRect(bx - 22, by - 30, 44, 22);
    g.fillStyle = '#1c1d21'; g.fillRect(bx - 22, by - 6, 8, 6); g.fillRect(bx + 14, by - 6, 8, 6);
    g.fillStyle = '#26282b'; g.fillRect(bx + 24, by - 22, 14, 5); g.fillRect(bx + 34, by - 18, 6, 5); // tail
    for (let i = 0; i < 3; i++) {
      const sway = Math.sin(t * 2 + i * 1.7) * 4;
      const nx = bx - 22 + i * 22 + sway, ny = by - 84 + Math.abs(i - 1) * 10;
      g.strokeStyle = '#3c3e45'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(bx - 12 + i * 12, by - 32); g.quadraticCurveTo(bx - 16 + i * 16, ny + 24, nx, ny + 8); g.stroke();
      g.fillStyle = '#4f5159';
      g.beginPath(); g.moveTo(nx, ny - 10); g.lineTo(nx + 11, ny); g.lineTo(nx, ny + 10); g.lineTo(nx - 11, ny); g.fill();
      g.fillStyle = p2 ? '#5ff0dc' : '#e8e6df';
      g.fillRect(nx - 4, ny - 2, 2, 2); g.fillRect(nx + 2, ny - 2, 2, 2);
      g.fillStyle = '#a7a9b1'; g.font = '8px VT323, monospace'; g.textAlign = 'center'; g.fillText('?', nx, ny + 8);
    }
    g.lineWidth = 1;
    if (p2) { g.fillStyle = 'rgba(95,240,220,0.6)'; for (let i = 0; i < 6; i++) { const a = t * 2 + i; g.fillRect(bx + Math.cos(a) * 40, by - 50 + Math.sin(a * 1.3) * 34, 2, 2); } }
  }

  // The Endless Loop: a ring of arrows chasing its own tail.
  function drawLoop(g, bx, by, t, p2) {
    const cy = by - 52 + Math.sin(t * 2) * 4, r = 30;
    g.fillStyle = 'rgba(95,240,220,0.06)'; g.beginPath(); g.arc(bx, cy, r + 12, 0, Math.PI * 2); g.fill();
    const speed = p2 ? 3.2 : 1.4;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + t * speed;
      g.fillStyle = i % 2 ? '#a7a9b1' : '#e8e6df';
      g.fillRect(Math.round(bx + Math.cos(a) * r) - 3, Math.round(cy + Math.sin(a) * r) - 3, 6, 6);
    }
    const a0 = t * speed + Math.PI * 2 * (15.5 / 16), hx = bx + Math.cos(a0) * r, hy = cy + Math.sin(a0) * r;
    g.fillStyle = '#ffffff';
    g.save(); g.translate(hx, hy); g.rotate(a0 + Math.PI); g.beginPath(); g.moveTo(-8, 0); g.lineTo(4, -7); g.lineTo(4, 7); g.fill(); g.restore();
    g.fillStyle = '#16181c'; g.fillRect(bx - 10, cy - 7, 20, 14);
    g.fillStyle = p2 && Math.sin(t * 20) > 0.6 ? '#0a0a0c' : '#5ff0dc';
    g.fillRect(bx - 3 + Math.round(Math.sin(t) * 4), cy - 3, 6, 6);
    g.fillStyle = 'rgba(232,230,223,0.6)';
    for (let i = 0; i < (p2 ? 12 : 5); i++) {
      const gx = bx - 44 + ((i * 29 + Math.floor(t * 7) * 13) % 88), gy = cy - 40 + ((i * 17 + Math.floor(t * 5) * 7) % 80);
      g.fillRect(gx, gy, 2 + (i % 3) * 2, 1);
    }
  }

  function drawBoss(g) {
    const b = S.boss;
    g.save();
    g.globalAlpha = b.alpha;
    g.translate(Math.round(b.x + b.ox), Math.round(b.y + b.oy));
    g.scale(b.scale, b.scale);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(-30, -2, 60, 4);
    ({ gatekeeper: drawGatekeeper, hydra: drawHydra, loop: drawLoop }[b.id] || drawLoop)(g, 0, 0, S.t, b.phase2);
    if (b.flash > 0) { g.globalAlpha = b.flash * 0.6; g.fillStyle = '#fff'; g.fillRect(-40, -110, 80, 112); }
    g.restore();
  }

  S.draw = function () {
    const g = S.ctx;
    if (!g) return;
    g.save();
    if (S.shake > 0) g.translate(Math.round((Math.random() - 0.5) * S.shake), Math.round((Math.random() - 0.5) * S.shake));
    drawBackground(g);
    if (S.dim > 0) { g.fillStyle = `rgba(0,0,0,${S.dim})`; g.fillRect(0, 0, W, H); }
    drawBoss(g);
    drawHero(g);
    for (const r of S.rings) { g.globalAlpha = r.life / r.max; g.strokeStyle = r.color; g.lineWidth = r.w; g.beginPath(); g.arc(r.x, r.y, r.r, 0, Math.PI * 2); g.stroke(); }
    for (const s of S.streaks) { g.globalAlpha = s.life / s.max; g.strokeStyle = s.color; g.lineWidth = s.w; g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); }
    for (const p of S.parts) { g.globalAlpha = Math.max(0, p.life / p.max); g.fillStyle = p.color; g.fillRect(p.x | 0, p.y | 0, p.size, p.size); }
    for (const b of S.bolts) { g.globalAlpha = 1; g.fillStyle = b.color; g.fillRect((b.x - b.size / 2) | 0, (b.y - b.size / 2) | 0, b.size, b.size); }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    for (const f of S.floats) {
      g.globalAlpha = Math.min(1, f.life / f.max * 2);
      g.font = `${f.size}px VT323, monospace`;
      g.fillStyle = '#000'; g.fillText(f.text, f.x + 1, f.y + 1);
      g.fillStyle = f.color; g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    if (S.banner) {
      const a = Math.min(1, S.banner.life / S.banner.max * 3);
      g.globalAlpha = a;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 54, W, 26);
      g.font = '24px VT323, monospace'; g.fillStyle = S.banner.color; g.fillText(S.banner.text, W / 2, 74);
      g.globalAlpha = 1;
    }
    g.restore();
    if (S.flash > 0) { g.globalAlpha = S.flash; g.fillStyle = S.flashColor; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  };

  S.heroSprite = heroSprite;
  CB.Scene = S;

  // ── tiny synth for sound effects ──
  let ac = null;
  function tone(freq, dur, type = 'square', vol = 0.08, slide = 0) {
    const t = ac.currentTime;
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol = 0.1, freq = 1200) {
    const t = ac.currentTime, n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
    f.type = 'lowpass'; f.frequency.value = freq; gn.gain.value = vol;
    src.buffer = buf; src.connect(f).connect(gn).connect(ac.destination); src.start(t);
  }
  const SFX = {
    click: () => tone(660, 0.05, 'square', 0.04),
    correct: () => { tone(523, 0.1, 'triangle', 0.1); setTimeout(() => tone(784, 0.16, 'triangle', 0.1), 90); },
    wrong: () => tone(180, 0.25, 'sawtooth', 0.06, -80),
    charge: () => tone(220, 0.2, 'triangle', 0.05, 300),
    hit: () => { noise(0.15, 0.15, 1800); tone(120, 0.12, 'square', 0.06, -60); },
    crit: () => { noise(0.35, 0.25, 900); tone(90, 0.35, 'sawtooth', 0.1, -50); },
    slash: () => noise(0.06, 0.1, 4000),
    shield: () => { tone(140, 0.2, 'square', 0.08, -40); noise(0.12, 0.12, 2500); },
    magic: () => tone(440, 0.4, 'sine', 0.08, 660),
    arrow: () => tone(1200, 0.06, 'triangle', 0.04, -600),
    hurt: () => { noise(0.15, 0.15, 1200); tone(200, 0.15, 'square', 0.05, -100); },
    slam: () => { noise(0.3, 0.25, 500); tone(60, 0.3, 'sine', 0.2, -30); },
    glitch: () => { for (let i = 0; i < 4; i++) setTimeout(() => tone(200 + Math.random() * 800, 0.04, 'square', 0.05), i * 40); },
    warn: () => { tone(110, 0.5, 'sawtooth', 0.08); tone(116, 0.5, 'sawtooth', 0.08); },
    evade: () => tone(900, 0.1, 'sine', 0.05, 400),
    ability: () => { tone(110, 0.9, 'sine', 0.12, 220); noise(0.6, 0.08, 600); },
    death: () => { tone(300, 0.9, 'triangle', 0.1, -260); noise(0.8, 0.1, 700); },
    special: () => { tone(330, 0.12, 'square', 0.06); setTimeout(() => tone(660, 0.2, 'square', 0.06), 100); },
    potion: () => { tone(500, 0.08, 'sine', 0.07, 200); setTimeout(() => tone(800, 0.12, 'sine', 0.07, 300), 70); },
  };
  CB.Sound = {
    unlock() {
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { ac = null; }
      if (ac && CB.Music) CB.Music.init(ac);
    },
    play(name) { if (ac && SFX[name]) try { SFX[name](); } catch (e) { /* audio is optional */ } },
  };
})();

(function () {
  const { $, esc, sleep, shuffle } = CB.util;
  const SPECIAL_MULT = { vanguard: 1.5, duelist: 2, arcanist: 2.5, ranger: 1.5 };
  const TYPE_LABEL = { mc: 'Multiple choice', trace: 'Trace the flowchart', fill: 'Fill the boxes', draw: 'Draw the flowchart' };
  const LAST = CB.Bosses.length; // stage === LAST means the game is complete
  const byId = Object.fromEntries(CB.ChallengeList.map((c) => [c.id, c]));
  const P = CB.Profile;

  let save = null;
  let B = null;
  let picked = null;
  let mcChoice = null;
  let continueFn = null;
  let editor = null;
  let qStart = 0;

  // ───────── save (one per player) ─────────
  function blankSave(cls) {
    return { v: 1, cls, stage: 0, seen: [], items: { ...CB.StartItems }, stats: { a: 0, c: 0, topics: {} }, runXp: 0 };
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(P.saveKey());
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1 || !CB.Classes[d.cls] || !(Number.isInteger(d.stage) && d.stage >= 0 && d.stage <= LAST)) throw new Error('invalid');
      d.seen = Array.isArray(d.seen) ? d.seen.filter((id) => byId[id]) : [];
      d.stats = d.stats && typeof d.stats === 'object' ? d.stats : { a: 0, c: 0, topics: {} };
      d.stats.topics = d.stats.topics || {};
      d.runXp = d.runXp || 0;
      const items = {};
      for (const k in CB.Potions) items[k] = Number.isInteger(d.items && d.items[k]) && d.items[k] >= 0 ? d.items[k] : CB.StartItems[k];
      d.items = items;
      return d;
    } catch (e) {
      console.warn('Discarding unreadable save', e);
      try { localStorage.removeItem(P.saveKey()); } catch (_) { /* storage unavailable */ }
      return null;
    }
  }
  function writeSave() {
    try { localStorage.setItem(P.saveKey(), JSON.stringify(save)); } catch (e) { /* storage unavailable: play continues unsaved */ }
  }

  // ───────── screens ─────────
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }
  function confirmBox(text) {
    return new Promise((res) => {
      $('modalText').textContent = text;
      $('modal').hidden = false;
      const done = (v) => { $('modal').hidden = true; $('modalYes').onclick = $('modalNo').onclick = null; res(v); };
      $('modalYes').onclick = () => done(true);
      $('modalNo').onclick = () => done(false);
      $('modalYes').focus();
    });
  }
  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }

  function tierHtml(xp) {
    const t = CB.tierOf(xp);
    const pct = t.next ? Math.round(((xp - t.from) / (t.next - t.from)) * 100) : 100;
    return `<div><span class="tier t${t.i}">${esc(t.name)}</span> <span class="xp">${xp} XP</span></div>
      <div class="xpbar" title="${t.next ? `${t.next - xp} XP to the next rank` : 'Top rank'}"><div style="width:${pct}%"></div></div>
      <small>${t.next ? `${t.next - xp} XP to ${esc(CB.Tiers[t.i + 1].name)}` : 'Highest rank reached'}</small>`;
  }

  function refreshTitle() {
    stopTimer();
    const me = P.current;
    $('loginForm').hidden = !!me;
    $('playerBox').hidden = !me;
    if (me) {
      save = loadSave();
      $('whoName').textContent = me.name;
      $('whoTier').innerHTML = tierHtml(me.xp);
      $('btnContinue').hidden = !(save && save.stage < LAST);
      if (save && save.stage < LAST) $('btnContinue').textContent = `Continue — ${CB.Bosses[save.stage].name}`;
      $('btnNew').focus();
    } else {
      $('loginErr').textContent = '';
      setTimeout(() => $('inName').focus(), 50);
    }
    $('onlineNote').textContent = P.online ? 'Leaderboard: shared online' : 'Leaderboard: this device only';
    CB.Music.play('title');
    show('title');
  }

  async function doLogin(e) {
    if (e) e.preventDefault();
    const btn = $('btnLogin');
    btn.disabled = true;
    $('loginErr').textContent = P.online ? 'Connecting…' : '';
    try {
      const r = await P.login($('inName').value, $('inPin').value);
      if (!r.ok) { $('loginErr').textContent = r.error; return; }
      $('inPin').value = '';
      refreshTitle();
      if (r.created) $('whoTier').insertAdjacentHTML('beforeend', '<div class="small">Welcome! Your account was created.</div>');
    } finally { btn.disabled = false; }
  }

  async function showBoard() {
    show('board');
    $('boardNote').textContent = 'Loading…';
    $('boardBody').innerHTML = '';
    const { rows, online, error } = await P.leaderboard();
    $('boardNote').textContent = online ? 'Shared leaderboard — everyone who plays this game online.'
      : (P.online ? `Could not reach the online leaderboard (${error}). Showing players on this device.` : 'Players on this device. (Set up config.js to share one leaderboard online.)');
    const me = P.current ? P.current.name.toLowerCase() : '';
    $('boardBody').innerHTML = rows.length ? rows.map((r, i) => {
      const acc = r.answered ? Math.round((r.correct / r.answered) * 100) + '%' : '—';
      const t = CB.tierOf(r.xp);
      const medal = ['🥇', '🥈', '🥉'][i] || i + 1;
      return `<tr class="${r.name.toLowerCase() === me ? 'me' : ''}"><td>${medal}</td><td>${esc(r.name)}</td><td><span class="tier t${t.i}">${esc(t.name)}</span></td><td>${r.xp}</td><td>${acc}</td><td>${r.correct || 0}</td><td>${r.best >= LAST ? '★ all' : `${r.best || 0}/${LAST}`}</td></tr>`;
    }).join('') : '<tr><td colspan="7">No players yet.</td></tr>';
    const myRank = rows.findIndex((r) => r.name.toLowerCase() === me);
    $('boardMe').textContent = myRank >= 0 ? `You are #${myRank + 1} of ${rows.length}.` : '';
  }

  function buildClassSelect() {
    const grid = $('classGrid');
    grid.innerHTML = '';
    picked = null;
    $('btnBegin').disabled = true;
    for (const id of CB.ClassOrder) {
      const c = CB.Classes[id];
      const card = CB.util.el('button', 'class-card');
      const cv = document.createElement('canvas');
      cv.width = 16; cv.height = 16;
      cv.getContext('2d').drawImage(CB.Scene.heroSprite(id), 0, 0);
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend', `
        <h3>${c.name}</h3><div class="t">${c.title}</div>
        <div class="st">HP ${c.stats.maxHp} · ATK ${c.stats.atk} · DEF ${c.stats.def}</div>
        <p><b>Passive:</b> ${esc(c.passive)}</p>
        <p><b>Special — ${c.special.name}</b> (${c.special.charge} correct answers): ${esc(c.special.desc)}</p>
        ${c.deflect ? `<p><b>Deflect — ${c.deflect.name}:</b> ${esc(c.deflect.desc)} Fail it and you take a critical hit.</p>` : ''}`);
      card.onclick = () => {
        CB.Sound.play('click');
        picked = id;
        grid.querySelectorAll('.class-card').forEach((x) => x.classList.toggle('sel', x === card));
        $('btnBegin').disabled = false;
        $('btnBegin').textContent = `Begin as ${c.name}`;
      };
      grid.appendChild(card);
    }
    show('select');
  }

  // ───────── battle setup ─────────
  function playerStats() {
    const base = CB.Classes[save.cls].stats;
    const s = save.stage;
    return { maxHp: base.maxHp + 20 * s, atk: base.atk + 3 * s, def: base.def + s };
  }

  function buildQueue(pools) {
    const ids = CB.ChallengeList.filter((c) => pools.includes(c.pool)).map((c) => c.id);
    const unseen = shuffle(ids.filter((id) => !save.seen.includes(id)));
    const seen = shuffle(ids.filter((id) => save.seen.includes(id)));
    // keep the slow "draw" challenges spread out: never two in a row
    const q = unseen.concat(seen);
    for (let i = 1; i < q.length; i++) {
      if (byId[q[i]].type === 'draw' && byId[q[i - 1]].type === 'draw') {
        const j = q.findIndex((id, k) => k > i && byId[id].type !== 'draw');
        if (j > 0) [q[i], q[j]] = [q[j], q[i]];
      }
    }
    return q;
  }

  function startBattle(stage) {
    const boss = CB.Bosses[stage];
    const st = playerStats();
    B = {
      boss, stage, bossHp: boss.hp, bossMax: boss.hp, phase2: false,
      hp: st.maxHp, maxHp: st.maxHp, atk: st.atk, def: st.def,
      queue: buildQueue(boss.pools), hardQueue: buildQueue(boss.advPools),
      fail: 0, lastFail: false, charge: 0, ready: false,
      freeDodgeUsed: false, evadeNext: false, blockNext: false, opening: false,
      items: { ...save.items }, itemUsed: false, regen: 0, powerHits: 0, deflectCd: 0,
      busy: false, ch: null, qMode: null, xp: 0,
    };
    CB.Scene.reset(stage, save.cls, boss.id);
    CB.Music.play(boss.id);
    $('pName').textContent = `${P.current.name} · ${CB.Classes[save.cls].name}`;
    $('bName').textContent = boss.name;
    show('battle');
    updateHud();
    CB.Scene.showBanner(boss.name.toUpperCase(), '#e8e6df', 1600);
    log(`<i>${esc(boss.arena)}.</i> ${esc(boss.name)}: “${esc(boss.intro)}”`);
    $('log').dataset.keep = '1';
    nextTurn();
  }

  function log(html) { $('log').innerHTML = html; }

  function updateHud() {
    $('pHp').style.width = `${Math.max(0, (B.hp / B.maxHp) * 100)}%`;
    $('pHpText').textContent = `${Math.max(0, B.hp)} / ${B.maxHp}`;
    $('bHp').style.width = `${Math.max(0, (B.bossHp / B.bossMax) * 100)}%`;
    $('bHpText').textContent = `${Math.max(0, B.bossHp)} / ${B.bossMax}`;
    const pips = $('pips');
    pips.innerHTML = '<span>Fails</span>';
    for (let i = 0; i < 3; i++) pips.appendChild(CB.util.el('span', 'pip' + (i < B.fail ? ' on' : '') + (B.fail === 2 && i === 2 ? ' warn' : '')));
    const cls = CB.Classes[save.cls];
    const el = $('special');
    el.className = 'special' + (B.ready ? ' ready' : '');
    el.innerHTML = `<span>${cls.special.name}${B.ready ? ' READY' : ''}</span>`;
    for (let i = 0; i < cls.special.charge; i++) el.appendChild(CB.util.el('span', 'seg' + (B.ready || i < B.charge ? ' on' : '')));
    const dh = $('deflectHud');
    dh.hidden = !cls.deflect;
    if (cls.deflect) {
      dh.className = 'special' + (B.deflectCd === 0 ? ' ready' : '');
      dh.textContent = `${cls.deflect.name}: ${B.deflectCd === 0 ? 'ready' : B.deflectCd + ' turn' + (B.deflectCd > 1 ? 's' : '')}`;
    }
    const buffs = [];
    if (B.regen) buffs.push(`Regen: ${B.regen} turn${B.regen > 1 ? 's' : ''} left`);
    if (B.powerHits) buffs.push(`Power: next ${B.powerHits} attack${B.powerHits > 1 ? 's' : ''} +50%`);
    $('buffs').textContent = buffs.join(' · ');
    $('xpHud').textContent = `+${B.xp} XP`;
  }

  // ───────── turn menu ─────────
  function nextTurn() {
    B.busy = false;
    B.itemUsed = false;
    B.qMode = null;
    continueFn = null;
    stopTimer();
    if (!B.queue.length) B.queue = buildQueue(B.phase2 ? B.boss.advPools.concat(B.boss.pools) : B.boss.pools);
    B.ch = byId[B.queue.shift()];
    renderQuestion(B.ch);
    lockInputs(true);
    $('btnSubmit').disabled = true;
    $('deflectBanner').hidden = true;
    showTime(CB.TimeLimits[B.ch.type], CB.TimeLimits[B.ch.type]);
    $('qArea').hidden = false;
    $('turnMenu').hidden = false;
    const pct = Math.round((CB.Classes[save.cls].blockPct || 0.25) * 100);
    $('blockInfo').textContent = `skip it and take only ${pct}% of the boss's damage`;
    $('attackInfo').textContent = `answer it (starts the timer) — ${B.ch.type === 'draw' ? 'drawing hits ×2.5!' : B.ch.type === 'fill' ? 'filling hits ×1.5' : 'correct: you strike, wrong: you are struck'}`;
    renderItems();
    updateHud();
    const intent = B.fail === 2
      ? `<span style="color:var(--accent)">${esc(B.boss.name)} is poised for a CRITICAL strike — answer correctly, or block!</span>`
      : `Attack to answer the question, or Block to play it safe.`;
    if (!$('log').dataset.keep) log(intent);
    $('log').dataset.keep = '';
    $('btnAttack').focus();
  }

  function renderItems() {
    const list = $('itemList');
    list.innerHTML = '';
    for (const [id, p] of Object.entries(CB.Potions)) {
      const n = B.items[id] || 0;
      const row = CB.util.el('div', 'item');
      row.innerHTML = `<span>${esc(p.name)} ×${n}<br><small>${esc(p.desc)}</small></span>`;
      const b = CB.util.el('button', 'btn tiny', 'Use');
      b.disabled = !n || B.itemUsed || (id === 'health' && B.hp >= B.maxHp);
      b.onclick = () => useItem(id);
      row.appendChild(b);
      list.appendChild(row);
    }
  }

  function useItem(id) {
    if (B.busy || B.itemUsed || !B.items[id]) return;
    B.items[id]--;
    B.itemUsed = true;
    const S = CB.Scene;
    const hx = S.hero.x, hy = S.hero.y - 30;
    CB.Sound.play('potion');
    if (id === 'health') {
      const heal = Math.min(40, B.maxHp - B.hp);
      B.hp += heal;
      S.float(hx, hy - 10, '+' + heal, '#e8e6df', 18);
      log(`You drink a Health Potion (+${heal} HP).`);
    } else if (id === 'regen') {
      B.regen = 4;
      log('You drink a Regen Potion. You will recover 10 HP at the end of each of your next 4 turns.');
    } else {
      B.powerHits = 3;
      log('You drink a Power Potion. Your next 3 attacks deal +50% damage.');
    }
    S.burst(hx, hy, 14, id === 'power' ? ['#22b8a6', '#5ff0dc'] : ['#e8e6df', '#a7a9b1'], 50, 0.7, -40);
    renderItems();
    updateHud();
  }

  function chooseAttack() {
    if (B.busy || B.qMode) return;
    B.qMode = 'attack';
    $('turnMenu').hidden = true;
    lockInputs(false);
    $('btnSubmit').disabled = false;
    focusAnswer();
    startTimer(CB.TimeLimits[B.ch.type]);
  }

  async function chooseBlock() {
    if (B.busy || B.qMode) return;
    B.busy = true;
    B.queue.push(B.ch.id);
    $('turnMenu').hidden = true;
    $('qArea').hidden = true;
    setWide(false);
    log('You raise your guard.');
    await bossTurn({ guard: true });
    await endTurn();
  }

  function nextHard() {
    if (!B.hardQueue.length) B.hardQueue = buildQueue(B.boss.advPools);
    return byId[B.hardQueue.shift()];
  }

  // ───────── challenge panel ─────────
  const formatPrompt = (s) => esc(s).replace(/`([^`]+)`/g, (_, c) => `<code>${c.replace(/&lt;-/g, '←')}</code>`);
  function setWide(v) { $('battle').classList.toggle('wide', v); }

  function askQuestion(ch, mode) {
    B.ch = ch;
    B.qMode = mode;
    B.busy = false;
    $('turnMenu').hidden = true;
    $('qArea').hidden = false;
    const db = $('deflectBanner');
    db.hidden = mode !== 'deflect';
    if (mode === 'deflect') db.innerHTML = `<b>${esc(CB.Classes[save.cls].deflect.name)}!</b> Answer this harder question to deflect the blow. Fail, and it is a <b>critical hit</b>.`;
    renderQuestion(ch);
    lockInputs(false);
    focusAnswer();
    startTimer(CB.TimeLimits[ch.type]);
  }

  function chartHtml(graph, withBlanks) {
    let html = `<div class="fc-inner" style="max-width:${Math.round(graph.width * 1.15)}px">` + CB.Render.svg(graph);
    if (withBlanks) {
      let k = 0;
      for (const n of graph.nodes) {
        if (!n.blank) continue;
        k++;
        const inset = n.type === 'decision' ? n.w * 0.22 : n.type === 'io' ? 14 : 6;
        const left = ((n.x - n.w / 2 + inset) / graph.width) * 100, width = ((n.w - inset * 2) / graph.width) * 100;
        const top = (n.y / graph.height) * 100;
        html += `<input class="blank" data-blank="${k}" style="left:${left}%;width:${width}%;top:${top}%" placeholder="${n.type === 'decision' ? 'condition' : n.type === 'io' ? 'input / output' : 'process'}" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Blank ${k}">`;
      }
    }
    return html + '</div>';
  }

  function renderQuestion(ch) {
    mcChoice = null;
    continueFn = null;
    if (editor) { editor.destroy(); editor = null; }
    setWide(ch.type === 'draw');
    $('qTopic').textContent = ch.topic;
    $('qType').textContent = TYPE_LABEL[ch.type];
    $('qPrompt').innerHTML = formatPrompt(ch.prompt);
    $('feedback').hidden = true;
    $('hint').hidden = true;
    $('qModel').hidden = true;
    $('qModel').innerHTML = '';
    $('btnRun').hidden = !(ch.type === 'draw' || ch.type === 'fill');
    $('btnSubmit').innerHTML = 'Submit <kbd>Ctrl+Enter</kbd>';
    $('btnSubmit').disabled = false;
    const chart = $('qChart'), opts = $('qOptions'), ans = $('qAnswer'), ed = $('qEditor');
    opts.innerHTML = '';
    chart.innerHTML = '';
    chart.hidden = true;
    ans.hidden = true;
    ans.value = '';
    ed.hidden = true;
    ed.innerHTML = '';
    $('qExamples').innerHTML = '';
    $('qShape').innerHTML = ch.shape ? CB.Render.icon(ch.shape) : '';

    if (ch.graph) {
      chart.hidden = false;
      chart.innerHTML = chartHtml(ch.graph, ch.type === 'fill');
      chart.querySelectorAll('input.blank').forEach((inp) => {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const all = [...chart.querySelectorAll('input.blank')];
            const nx = all[all.indexOf(inp) + 1];
            if (nx) nx.focus(); else submit(false);
          }
        });
      });
    }
    if (ch.type === 'mc') {
      ch.options.forEach((o, i) => {
        const label = o.startsWith('@') ? `${CB.Render.icon(o.slice(1))}` : formatPrompt(o);
        const b = CB.util.el('button', 'btn opt' + (o.startsWith('@') ? ' shape' : ''), `<span class="n">${i + 1}.</span> ${label}`);
        b.onclick = () => { mcChoice = i; opts.querySelectorAll('.opt').forEach((x, j) => x.classList.toggle('sel', j === i)); CB.Sound.play('click'); };
        opts.appendChild(b);
      });
      opts.classList.toggle('grid', ch.options.every((o) => o.startsWith('@')));
    } else if (ch.type === 'trace') {
      ans.hidden = false;
      ans.placeholder = 'Type the output — one value per line';
    } else if (ch.type === 'draw') {
      ed.hidden = false;
      editor = new CB.Editor(ed, { onChange: () => { if (editor) editor.setHighlights([]); } });
    }
    if (ch.tests && ch.type !== 'mc') {
      const want = CB.Runner.expected(ch);
      const vis = ch.tests.map((t, i) => ({ t, i })).filter((x) => !x.t.hidden);
      const hidden = ch.tests.length - vis.length;
      $('qExamples').innerHTML = 'Examples: ' + vis.map(({ t, i }) =>
        `<span class="ex">[${t.in.length ? 'input ' + esc(t.in.join(', ')) : 'no input'} → output ${esc(want[i].join(', ') || '(nothing)')}]</span>`).join(' ') +
        (hidden ? ` + ${hidden} hidden test${hidden > 1 ? 's' : ''}` : '');
    }
  }

  function focusAnswer() {
    setTimeout(() => {
      const ch = B.ch;
      if (ch.type === 'trace') $('qAnswer').focus();
      else if (ch.type === 'fill') { const f = $('qChart').querySelector('input.blank'); if (f) f.focus(); }
    }, 50);
  }

  function collectAnswer(ch) {
    if (ch.type === 'mc') return mcChoice;
    if (ch.type === 'fill') return [...$('qChart').querySelectorAll('input.blank')].map((i) => i.value);
    if (ch.type === 'draw') return editor.getGraph();
    return $('qAnswer').value;
  }

  function showFeedback(r, practice) {
    const f = $('feedback');
    f.hidden = false;
    f.className = 'feedback ' + r.status;
    const lines = r.lines ? '<ul>' + r.lines.map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>' : '';
    f.innerHTML = `<b>${esc(practice ? 'Practice run — ' + r.title : r.title)}</b>${esc(r.message || '')}${lines}`;
    if (editor) editor.setHighlights(r.errorNodes || []);
  }

  function showModel(ch) {
    if (!ch.solutionGraph || !(ch.type === 'draw' || ch.type === 'fill')) return;
    const g = ch.type === 'draw' ? ch.solutionGraph : { ...ch.graph, nodes: ch.graph.nodes.map((n) => (n.blank ? { ...n, text: n.answer, blank: false, model: true } : n)) };
    $('qModel').hidden = false;
    $('qModel').innerHTML = `<details${ch.type === 'draw' ? '' : ' open'}><summary>Show a model answer</summary>${CB.Render.svg(g)}</details>`;
  }

  function lockInputs(locked) {
    document.querySelectorAll('#qChart input, #qAnswer, #qOptions button, #btnHint, #btnRun').forEach((e) => { e.disabled = locked; });
    if (editor) editor.setDisabled(locked);
  }

  function waitContinue(label = 'Continue') {
    return new Promise((res) => {
      $('btnSubmit').innerHTML = `${label} <kbd>Enter</kbd>`;
      $('btnSubmit').disabled = false;
      $('btnSubmit').focus();
      continueFn = () => { continueFn = null; $('btnSubmit').disabled = true; res(); };
    });
  }

  function askDeflect() {
    const d = CB.Classes[save.cls].deflect;
    return new Promise((res) => {
      const db = $('deflectBanner');
      db.hidden = false;
      db.innerHTML = `<b>${esc(d.name)} is ready.</b> Try a harder question to deflect this blow? Fail it and the boss lands a <b>critical hit</b>.<div class="actions"><button class="btn" id="dfNo">Take the hit</button><button class="btn primary" id="dfYes">Attempt ${esc(d.name)}</button></div>`;
      $('btnSubmit').disabled = true;
      $('dfYes').focus();
      $('dfYes').onclick = () => { db.hidden = true; res(true); };
      $('dfNo').onclick = () => { db.hidden = true; res(false); };
    });
  }

  // ───────── timer ─────────
  let timerId = null, timeLeft = 0, timeTotal = 1;
  function startTimer(sec) {
    stopTimer();
    qStart = performance.now();
    const end = qStart + sec * 1000;
    timeTotal = sec;
    const tick = () => {
      const left = Math.max(0, (end - performance.now()) / 1000);
      timeLeft = left;
      showTime(left, sec);
      if (left <= 0) { stopTimer(); submit(true); }
    };
    tick();
    timerId = setInterval(tick, 200);
  }
  function showTime(left, total) {
    const s = Math.ceil(left);
    $('timerText').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('timerText').classList.toggle('low', left <= 10);
    $('timerBar').style.width = `${(left / total) * 100}%`;
    $('timerBar').classList.toggle('low', left <= 10);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function record(ch, status) {
    const ok = status === 'correct';
    const s = save.stats;
    s.a++; if (ok) s.c++;
    const t = (s.topics[ch.topic] = s.topics[ch.topic] || { a: 0, c: 0 });
    t.a++; if (ok) t.c++;
    if (!save.seen.includes(ch.id)) save.seen.push(ch.id);
    const base = CB.TypeXp[ch.type];
    const xp = ok ? Math.round(base * (1 + 0.5 * Math.min(1, timeLeft / timeTotal))) : status === 'partial' ? Math.round(base * 0.3) : 0;
    B.xp += xp;
    save.runXp += xp;
    writeSave();
    P.record({ xp, answered: 1, correct: ok ? 1 : 0, draws: ok && ch.type === 'draw' ? 1 : 0 });
    if (xp) CB.Scene.float(CB.Scene.hero.x, CB.Scene.hero.y - 70, `+${xp} XP`, '#5ff0dc', 14);
    updateHud();
  }

  // ───────── resolving answers ─────────
  async function submit(timedOut) {
    if (continueFn) return continueFn();
    if (!B || B.busy || !B.qMode) return;
    const ch = B.ch;
    let r;
    if (timedOut) r = { status: 'wrong', title: "Time's up", message: 'You ran out of time — that counts as a wrong answer.' };
    else {
      try { r = CB.Runner.evaluate(ch, collectAnswer(ch)); } catch (e) {
        console.error(e);
        r = { status: 'wrong', title: 'Could not run that', message: 'Something went wrong checking your answer.' };
      }
      if (r.status === 'incomplete') { showFeedback(r); CB.Sound.play('click'); return; }
    }
    stopTimer();
    B.busy = true;
    lockInputs(true);
    $('btnSubmit').disabled = true;
    const ok = r.status === 'correct';
    record(ch, r.status);
    const mode = B.qMode;
    B.qMode = null;
    if (!ok && r.status === 'partial' && mode === 'attack') r.message += ' A near miss — the blow will be weakened.';
    showFeedback(r);
    if (!ok) showModel(ch);
    CB.Sound.play(ok ? 'correct' : 'wrong');

    if (mode === 'deflect') {
      if (ok) {
        await sleep(600);
        await deflectSuccess();
      } else {
        await waitContinue();
        log(`<span style="color:var(--accent)">The ${esc(CB.Classes[save.cls].deflect.name)} fails — a CRITICAL strike!</span>`);
        await bossTurn({ forceCrit: true });
      }
      return endTurn();
    }

    if (ok) {
      await sleep(650);
      await playerTurn(ch);
      return endTurn();
    }
    const cls = CB.Classes[save.cls];
    if (cls.deflect && B.deflectCd === 0 && !(await checkEnd(true))) {
      if (await askDeflect()) {
        B.deflectCd = cls.deflect.cooldown + 1;
        return askQuestion(nextHard(), 'deflect');
      }
    } else {
      await waitContinue();
    }
    await bossTurn({ partial: r.status === 'partial' });
    return endTurn();
  }

  async function endTurn() {
    if (await checkEnd()) return;
    if (B.regen > 0) {
      const heal = Math.min(10, B.maxHp - B.hp);
      B.regen--;
      if (heal > 0) {
        B.hp += heal;
        CB.Scene.float(CB.Scene.hero.x, CB.Scene.hero.y - 60, '+' + heal, '#e8e6df', 16);
        await sleep(300);
      }
    }
    if (B.deflectCd > 0) B.deflectCd--;
    nextTurn();
  }

  function damageMult(ch) {
    const cls = save.cls;
    const tags = [];
    let mult = 1;
    if (ch && CB.TypeDamage[ch.type] > 1) { mult *= CB.TypeDamage[ch.type]; if (ch.type === 'draw') tags.push('BLUEPRINT'); }
    if (cls === 'duelist' && B.lastFail) { mult *= 1.6; tags.push('RIPOSTE'); }
    if (cls === 'arcanist' && ch && (ch.type === 'fill' || ch.type === 'draw')) { mult *= 1.5; tags.push('ARCHITECT'); }
    if (B.opening) { mult *= 1.25; tags.push('OPENING'); B.opening = false; }
    if (B.powerHits > 0) { mult *= 1.5; tags.push('POWER'); B.powerHits--; }
    return { mult, tags };
  }

  async function playerTurn(ch) {
    const cls = save.cls;
    let { mult, tags } = damageMult(ch);
    let special = null;
    if (B.ready) {
      special = CB.Classes[cls].special.name;
      mult *= SPECIAL_MULT[cls];
      B.ready = false;
      B.charge = 0;
      if (cls === 'vanguard') B.blockNext = true;
      if (cls === 'ranger') B.evadeNext = true;
      CB.Sound.play('special');
    } else if (++B.charge >= CB.Classes[cls].special.charge) B.ready = true;
    B.fail = 0;
    B.lastFail = false;
    await strike(Math.round(B.atk * mult), special ? `You unleash <b>${special}</b>!` : `Correct — you strike ${esc(B.boss.name)}.`, { special, tag: tags.join(' + '), big: mult >= 1.5 });
  }

  async function strike(dmg, msg, opts) {
    log(msg);
    updateHud();
    await CB.Scene.playerAttack(dmg, opts);
    B.bossHp = Math.max(0, B.bossHp - dmg);
    updateHud();
    if (!B.phase2 && B.bossHp > 0 && B.bossHp <= B.bossMax / 2) await bossAbility();
  }

  async function deflectSuccess() {
    const name = CB.Classes[save.cls].deflect.name;
    log(`<b>${esc(name)}!</b> You deflect the blow.`);
    await CB.Scene.bossAttack(0, { deflect: true });
    if (save.cls === 'duelist') {
      const { mult, tags } = damageMult(null);
      await strike(Math.round(B.atk * 0.5 * mult), 'You counter through the opening!', { tag: ['COUNTER', ...tags].join(' + ') });
    }
  }

  async function bossAbility() {
    B.phase2 = true;
    CB.Music.setIntensity(1);
    const ab = B.boss.ability;
    const heal = ab.heal || 0;
    log(`<b>${esc(ab.name)}</b> — ${esc(ab.desc)}`);
    $('log').dataset.keep = '1';
    await CB.Scene.bossAbility(ab.name, heal);
    if (heal) B.bossHp = Math.min(B.bossMax, B.bossHp + heal);
    B.queue = buildQueue(B.boss.advPools).concat(B.queue);
    updateHud();
  }

  async function bossTurn({ partial = false, guard = false, forceCrit = false } = {}) {
    const cls = save.cls;
    const ab = B.boss.ability;
    if (!guard) { B.fail++; B.lastFail = true; }
    const crit = forceCrit || (!guard && B.fail >= 3);
    const pierce = B.phase2 && ab.pierce;
    let dmg = Math.max(1, B.boss.atk * (B.phase2 && ab.atkMult ? ab.atkMult : 1) - (pierce ? 0 : B.def));
    if (crit) dmg *= 1 + 1.2 * (cls === 'vanguard' ? 0.5 : 1);
    if (partial) dmg *= 0.5;
    if (guard) dmg *= CB.Classes[cls].blockPct || 0.25;
    dmg = Math.max(guard ? 1 : 0, Math.round(dmg));
    let evade = false, block = false;
    if (!guard && !forceCrit) {
      if (cls === 'ranger' && !B.freeDodgeUsed) { evade = true; B.freeDodgeUsed = true; }
      else if (B.evadeNext) { evade = true; B.evadeNext = false; }
      else if (B.blockNext) { block = true; B.blockNext = false; }
    }
    if (evade && cls === 'ranger') B.opening = true;
    if (evade || block) dmg = 0;
    const drain = pierce && dmg > 0 ? Math.round(dmg / 2) : 0;
    if (!forceCrit) log(evade ? 'You slip aside — the blow misses!' : block ? 'Your Bulwark holds — blocked!' : guard ? `You guard. The blow is softened.` :
      crit ? `<span style="color:var(--accent)">Three failures in a row — ${esc(B.boss.name)} lands a CRITICAL strike!</span>` :
      `${esc(B.boss.name)} strikes you.`);
    updateHud();
    const tag = guard ? 'GUARDED' : partial && dmg ? 'GLANCING' : pierce && dmg ? 'RECURSION' : '';
    await CB.Scene.bossAttack(dmg, { crit, evade, block, guard, drain, tag });
    B.hp = Math.max(0, B.hp - dmg);
    if (drain) B.bossHp = Math.min(B.bossMax, B.bossHp + drain);
    if (crit) B.fail = 0;
    updateHud();
  }

  async function checkEnd(peek) {
    if (B.bossHp <= 0) {
      if (peek) return true;
      stopTimer();
      await CB.Scene.bossDeath();
      victory();
      return true;
    }
    if (B.hp <= 0) {
      if (peek) return true;
      stopTimer();
      await CB.Scene.heroDeath();
      defeat();
      return true;
    }
    return false;
  }

  // ───────── results ─────────
  function statsHtml() {
    const s = save.stats;
    const pct = s.a ? Math.round((s.c / s.a) * 100) : 0;
    const rows = Object.entries(s.topics).sort((a, b) => b[1].a - a[1].a)
      .map(([t, v]) => `<div class="row"><span>${esc(t)}</span><span>${v.c}/${v.a}</span></div>`).join('');
    return `<div class="row"><span>XP this battle</span><span>+${B.xp}</span></div><div class="row"><span>Overall accuracy</span><span>${s.c}/${s.a} (${pct}%)</span></div>${rows}`;
  }

  function result(title, text, btnLabel, action) {
    CB.Music.play('title');
    setWide(false);
    if (editor) { editor.destroy(); editor = null; }
    $('resTitle').textContent = title;
    $('resText').innerHTML = text;
    $('resStats').innerHTML = statsHtml();
    $('resTier').innerHTML = tierHtml(P.current.xp);
    $('resBtn').textContent = btnLabel;
    $('resBtn').onclick = action;
    show('result');
    $('resBtn').focus();
  }

  function victory() {
    const boss = B.boss;
    const bonus = CB.BossXp[B.stage] || 100;
    B.xp += bonus;
    P.record({ xp: bonus });
    P.bossDefeated(B.stage);
    save.items = { ...B.items };
    save.stage = B.stage + 1;
    const bonusTxt = `<br><br><b>+${bonus} XP</b> for defeating ${esc(boss.name)}.`;
    if (save.stage < LAST) {
      for (const k in CB.BossLoot) save.items[k] = (save.items[k] || 0) + CB.BossLoot[k];
      writeSave();
      const next = CB.Bosses[save.stage];
      result(`${boss.name} falls`, `“${esc(boss.outro)}”${bonusTxt}<br>You grow stronger: <b>+20 max HP, +3 ATK, +1 DEF</b>, and you find a Health, a Regen and a Power potion.`,
        `Onward to ${next.arena}`, () => startBattle(save.stage));
    } else {
      writeSave();
      result('The loop is broken', `“${esc(boss.outro)}”${bonusTxt}<br>Every path is mapped, every branch decided, every loop ended. <b>You have mastered Flowbound.</b> Play again to climb the leaderboard.`,
        'Play again', buildClassSelect);
    }
  }

  function defeat() {
    result('Lost in the flow', `${esc(B.boss.name)} stands over you. But every flowchart can be run again — your potions are restored to what you had when the fight began.`, 'Try again', () => startBattle(B.stage));
  }

  // ───────── wiring ─────────
  function syncMusicBtn() { $('btnMusic').textContent = CB.Music.enabled ? '♪ on' : '♪ off'; }

  function init() {
    CB.Scene.init($('scene'));
    const unlock = () => { CB.Sound.unlock(); syncMusicBtn(); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    $('loginForm').onsubmit = doLogin;
    $('btnLogout').onclick = () => { P.logout(); refreshTitle(); };
    $('btnBoard').onclick = showBoard;
    $('btnBoard2').onclick = showBoard;
    $('boardBack').onclick = refreshTitle;
    $('btnNew').onclick = async () => {
      const existing = loadSave();
      if (existing && existing.stage > 0 && existing.stage < LAST && !(await confirmBox('Start a new game? Your current progress will be overwritten (your XP and rank are kept).'))) return;
      buildClassSelect();
    };
    $('btnContinue').onclick = () => { save = loadSave(); if (save) { goFullscreen(); startBattle(save.stage); } };
    $('btnFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : goFullscreen());
    $('btnBack').onclick = refreshTitle;
    $('btnBegin').onclick = async () => {
      if (!picked) return;
      if (!(await confirmBox(`Begin as the ${CB.Classes[picked].name}? Your class can't be changed for this run.`))) return;
      save = blankSave(picked);
      writeSave();
      goFullscreen();
      startBattle(0);
    };
    $('resMenu').onclick = refreshTitle;
    $('btnMusic').onclick = () => { CB.Music.toggle(); syncMusicBtn(); };
    $('btnQuit').onclick = async () => {
      if (B && B.busy) return;
      if (await confirmBox('Leave this battle? You will restart this boss next time (XP you earned is kept).')) { if (editor) { editor.destroy(); editor = null; } setWide(false); refreshTitle(); }
    };

    $('btnAttack').onclick = chooseAttack;
    $('btnBlock').onclick = chooseBlock;
    $('btnSubmit').onclick = () => submit(false);
    $('btnHint').onclick = () => { const h = $('hint'); h.hidden = false; h.textContent = 'Hint: ' + B.ch.hint; };
    $('btnRun').onclick = () => {
      if (!B || B.busy || !B.qMode) return;
      try { showFeedback(CB.Runner.practice(B.ch, collectAnswer(B.ch)), true); } catch (e) { console.error(e); }
    };

    document.addEventListener('keydown', (e) => {
      if (!$('modal').hidden) { if (e.key === 'Escape') $('modalNo').click(); return; }
      if (!$('battle').classList.contains('active')) return;
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(false); return; }
      if (e.key === 'Enter' && continueFn && document.activeElement !== $('btnSubmit')) { e.preventDefault(); submit(false); return; }
      if (!typing && B && B.qMode && B.ch && B.ch.type === 'mc' && /^[1-4]$/.test(e.key)) {
        const b = $('qOptions').children[+e.key - 1];
        if (b && !b.disabled) b.click();
      }
    });

    P.restore();
    refreshTitle();
  }

  // used by tools/smoke.mjs
  CB.debug = { get editor() { return editor; }, get battle() { return B; }, ask: (id) => askQuestion(byId[id], 'attack') };

  init();
})();

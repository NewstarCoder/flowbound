(function (root) {
  const CB = (root.CB = root.CB || {});

  // Special charges with correct answers; once full, the next correct answer unleashes it.
  CB.Classes = {
    vanguard: {
      id: 'vanguard', name: 'Vanguard', title: 'The Unbroken',
      stats: { maxHp: 130, atk: 10, def: 4 },
      passive: 'Unbroken — critical strikes against you deal half their bonus damage. Blocking takes only 15% damage (others take 25%).',
      blockPct: 0.15,
      special: { name: 'Bulwark', charge: 3, desc: 'Shield bash for 1.5× damage, then completely block the next enemy hit.' },
    },
    duelist: {
      id: 'duelist', name: 'Duelist', title: 'The Counterstrike',
      stats: { maxHp: 90, atk: 14, def: 2 },
      passive: 'Riposte — a correct answer right after a wrong one deals +60% damage.',
      deflect: { name: 'Parry', cooldown: 3, desc: 'After a wrong answer, answer a HARDER question to deflect the blow and counter for half damage.' },
      special: { name: 'Flurry', charge: 3, desc: 'Five rapid thrusts for 2× damage.' },
    },
    arcanist: {
      id: 'arcanist', name: 'Architect', title: 'The Blueprint Mage',
      stats: { maxHp: 95, atk: 11, def: 2 },
      passive: 'Blueprint — fill-in and draw-the-flowchart challenges deal +50% damage.',
      special: { name: 'Overload', charge: 4, desc: 'A storm of glowing arrows for 2.5× damage.' },
    },
    ranger: {
      id: 'ranger', name: 'Ranger', title: 'The Unseen Path',
      stats: { maxHp: 105, atk: 12, def: 3 },
      passive: 'Unseen Path — dodges the first enemy attack of each fight; the attack after a dodge deals +25%.',
      deflect: { name: 'Sidestep', cooldown: 3, desc: 'After a wrong answer, answer a HARDER question to avoid the blow completely.' },
      special: { name: 'Arrow Rain', charge: 3, desc: '1.5× damage, and you dodge the next enemy attack.' },
    },
  };
  CB.ClassOrder = ['vanguard', 'duelist', 'arcanist', 'ranger'];

  CB.Potions = {
    health: { name: 'Health Potion', desc: 'Restore 40 HP now.' },
    regen: { name: 'Regen Potion', desc: 'Restore 10 HP at the end of each of your next 4 turns.' },
    power: { name: 'Power Potion', desc: 'Your next 3 attacks deal +50% damage.' },
  };
  CB.StartItems = { health: 1, regen: 1, power: 1 };
  CB.BossLoot = { health: 1, regen: 1, power: 1 };

  // Seconds allowed per question type; running out counts as a wrong answer.
  CB.TimeLimits = { mc: 90, trace: 180, fill: 300, draw: 600 };
  // Harder question types hit harder.
  CB.TypeDamage = { mc: 1, trace: 1.2, fill: 1.5, draw: 2.5 };
  // XP for a correct answer (up to +50% for answering quickly).
  CB.TypeXp = { mc: 10, trace: 15, fill: 25, draw: 50 };
  CB.BossXp = [150, 250, 400];

  CB.Tiers = [
    { xp: 0, name: 'Novice' },
    { xp: 150, name: 'Apprentice' },
    { xp: 400, name: 'Pathfinder' },
    { xp: 800, name: 'Navigator' },
    { xp: 1500, name: 'Architect' },
    { xp: 2500, name: 'Master' },
    { xp: 4000, name: 'Grandmaster' },
  ];
  CB.tierOf = (xp) => {
    let i = 0;
    while (i + 1 < CB.Tiers.length && xp >= CB.Tiers[i + 1].xp) i++;
    const next = CB.Tiers[i + 1];
    return { i, name: CB.Tiers[i].name, next: next ? next.xp : null, from: CB.Tiers[i].xp };
  };

  CB.Bosses = [
    {
      id: 'gatekeeper', name: 'The Gatekeeper', arena: 'The Threshold', hp: 100, atk: 14,
      pools: ['sym', 'seq'], advPools: ['seq_adv'],
      ability: { name: 'Lockdown', desc: 'At half health it heals 25 HP and its questions grow harder.', heal: 25 },
      intro: 'HALT. Every path begins with START. Name my shapes, follow my steps — or turn back.',
      outro: '…the gate… opens. Beyond lies the marsh where every road splits in two.',
    },
    {
      id: 'hydra', name: 'The Forking Hydra', arena: 'The Branching Marsh', hp: 130, atk: 16,
      pools: ['sel'], advPools: ['sel_adv'],
      ability: { name: 'Fork', desc: 'At half health it grows fiercer: its strikes deal +30% damage, and its questions grow harder.', atkMult: 1.3 },
      intro: 'Yesss… or nooo? Every head asks a question. Choose the wrong path and you are lost.',
      outro: 'Yes… no… yes… the heads fall silent. Deeper down, something circles forever.',
    },
    {
      id: 'loop', name: 'The Endless Loop', arena: 'The Spiral Core', hp: 160, atk: 18,
      pools: ['loop'], advPools: ['loop_adv'],
      ability: { name: 'Infinite Recursion', desc: 'At half health its strikes ignore armour and heal it for half the damage. Questions grow harder.', pierce: true },
      intro: 'again… again… again… I have no exit condition. You will circle with me… forever.',
      outro: '…condition… met… the loop… ends…',
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);

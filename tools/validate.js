// node tools/validate.js — checks every challenge compiles and every model answer passes its tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['js/flow/expr.js', 'js/flow/layout.js', 'js/flow/render.js', 'js/flow/runner.js', 'js/data/questions.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
const { ChallengeList: Q, Runner } = ctx.CB;
let bad = 0;
const fail = (q, m) => { bad++; console.log(`✗ ${q.id}: ${m}`); };
const counts = {};
for (const q of Q) {
  counts[q.pool] = counts[q.pool] || {};
  counts[q.pool][q.type] = (counts[q.pool][q.type] || 0) + 1;
  try {
    if (!q.prompt || !q.hint) fail(q, 'missing prompt/hint');
    if (q.type === 'mc') {
      if (!(q.answer >= 0 && q.answer < q.options.length)) fail(q, 'bad answer index');
      if (Runner.evaluate(q, q.answer).status !== 'correct') fail(q, 'mc self-check');
    } else if (q.type === 'trace') {
      const out = Runner.traceExpected(q);
      if (!out.length) fail(q, 'trace outputs nothing');
      if (Runner.evaluate(q, out.join('\n')).status !== 'correct') fail(q, 'trace self-check');
      console.log(`  ${q.id} trace → ${out.join(', ')}`);
    } else {
      const exp = Runner.expected(q);
      if (q.type === 'fill') {
        const answers = q.graph.nodes.filter((n) => n.blank).map((n) => n.answer);
        const r = Runner.evaluate(q, answers);
        if (r.status !== 'correct') fail(q, 'fill self-check: ' + r.message);
        const r2 = Runner.evaluate(q, answers.map(() => 'X ← 1'));
        if (r2.status === 'correct') fail(q, 'junk answer passes');
      } else {
        const r = Runner.evaluate(q, q.solutionGraph);
        if (r.status !== 'correct') fail(q, 'draw self-check: ' + r.message);
      }
      if (exp.every((o) => o.join() === exp[0].join()) && exp.length > 1) fail(q, 'all tests give the same output');
      console.log(`  ${q.id} ${q.type} tests → ${exp.map((o) => '[' + o.join(',') + ']').join(' ')}`);
    }
  } catch (e) { fail(q, e.stack); }
}

// a few direct interpreter checks
const g = { nodes: [{ id: 'a', type: 'terminal', text: 'START' }, { id: 'b', type: 'io', text: 'INPUT X' }, { id: 'c', type: 'process', text: 'OUTPUT X' }, { id: 'd', type: 'terminal', text: 'STOP' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }] };
const c = Runner.compile(g);
if (c.symbolIssues.length !== 1) { bad++; console.log('✗ symbol issue not detected'); }
const inf = Runner.run({ nodes: [{ id: 'a', type: 'terminal', text: 'START' }, { id: 'b', type: 'process', text: 'X <- 1' }, { id: 'e', type: 'decision', text: 'X = 1?' }, { id: 'd', type: 'terminal', text: 'STOP' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'e' }, { from: 'e', to: 'b', label: 'yes' }, { from: 'e', to: 'd', label: 'no' }] }, []);
if (!/infinite/.test(inf.error || '')) { bad++; console.log('✗ infinite loop not detected', inf); }
const q1 = Runner.run({ nodes: [{ id: 'a', type: 'terminal', text: 'START' }, { id: 'b', type: 'io', text: 'OUTPUT PASS' }, { id: 'd', type: 'terminal', text: 'STOP' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'd' }] }, []);
if (!/quotes/.test(q1.error || '')) { bad++; console.log('✗ unquoted text hint missing', q1); }

console.log(JSON.stringify(counts));
console.log(`${Q.length} challenges, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);

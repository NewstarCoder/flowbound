// Validates and executes a flowchart graph, and marks answers.
// graph = { nodes: [{id, type: terminal|process|io|decision, text}], edges: [{from, to, label: 'yes'|'no'|null}] }
(function (root) {
  const CB = (root.CB = root.CB || {});
  const X = CB.Expr;

  const isStartText = (t) => /^\s*(start|begin)\b/i.test(t || '');
  const isEndText = (t) => /^\s*(stop|end|finish)\b/i.test(t || '');
  const TYPE_NAME = { terminal: 'terminal (start/stop)', process: 'process box', io: 'input/output box', decision: 'decision' };

  function short(t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 22 ? t.slice(0, 20) + '…' : t; }
  function label(n) { return n.text && n.text.trim() ? `"${short(n.text)}"` : `the empty ${TYPE_NAME[n.type] || 'box'}`; }

  // Returns { errors: [{node, msg}], warnings: [...], symbolIssues: [...], start, prog }.
  function compile(graph) {
    const errors = [], warnings = [], symbolIssues = [];
    const nodes = graph.nodes || [], edges = graph.edges || [];
    const byId = {};
    for (const n of nodes) byId[n.id] = n;
    const out = {}, inc = {};
    for (const n of nodes) { out[n.id] = []; inc[n.id] = 0; }
    for (const e of edges) {
      if (!byId[e.from] || !byId[e.to]) continue;
      out[e.from].push(e);
      inc[e.to]++;
    }

    const prog = {};
    const starts = [], ends = [];
    for (const n of nodes) {
      const p = (prog[n.id] = { id: n.id, type: n.type, next: null, yes: null, no: null });
      const outs = out[n.id];
      try {
        if (n.type === 'terminal') {
          if (isStartText(n.text)) { starts.push(n); p.start = true; }
          else if (isEndText(n.text)) { ends.push(n); p.end = true; }
          else throw new X.FlowError('A terminal must say START or STOP.');
        } else if (n.type === 'decision') {
          p.cond = X.parseCondition(n.text);
        } else if (n.type === 'process' || n.type === 'io') {
          p.stmts = X.parseStatements(n.text);
          if (n.type === 'io' && p.stmts.some((s) => s.k === 'set')) throw new X.FlowError('Calculations and assignments go in a process box (rectangle), not an input/output box.');
          if (n.type === 'process' && p.stmts.some((s) => s.k !== 'set')) symbolIssues.push({ node: n.id, msg: `${label(n)} uses INPUT/OUTPUT inside a rectangle — inputs and outputs belong in a parallelogram.` });
        } else if (n.type === 'join') {
          // pass-through point
        } else throw new X.FlowError('Unknown box type.');
      } catch (err) {
        if (!err.flow) throw err;
        errors.push({ node: n.id, msg: `${label(n)}: ${err.message}` });
      }

      if (n.type === 'decision') {
        const y = outs.filter((e) => e.label === 'yes'), no = outs.filter((e) => e.label === 'no');
        if (y.length !== 1 || no.length !== 1) errors.push({ node: n.id, msg: `Decision ${label(n)} needs exactly one Yes arrow and one No arrow.` });
        p.yes = y[0] ? y[0].to : null;
        p.no = no[0] ? no[0].to : null;
      } else if (p.end) {
        if (outs.length) errors.push({ node: n.id, msg: 'STOP must not have an arrow leaving it.' });
      } else {
        if (outs.length === 0) errors.push({ node: n.id, msg: `${label(n)} has no arrow leaving it.` });
        else if (outs.length > 1) errors.push({ node: n.id, msg: `${label(n)} has ${outs.length} arrows leaving it — only a decision can branch.` });
        p.next = outs[0] ? outs[0].to : null;
      }
    }

    if (!nodes.length) errors.push({ msg: 'The flowchart is empty.' });
    else if (starts.length === 0) errors.push({ msg: 'Add a START terminal (rounded box) where the flowchart begins.' });
    else if (starts.length > 1) errors.push({ node: starts[1].id, msg: 'There is more than one START.' });
    if (nodes.length && ends.length === 0) errors.push({ msg: 'Add a STOP terminal where the flowchart ends.' });
    for (const s of starts) if (inc[s.id]) errors.push({ node: s.id, msg: 'No arrow should point into START.' });

    // reachability
    if (starts.length === 1) {
      const seen = new Set();
      const stack = [starts[0].id];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id) || !prog[id]) continue;
        seen.add(id);
        for (const e of out[id]) stack.push(e.to);
      }
      for (const n of nodes) if (!seen.has(n.id) && n.type !== 'join') warnings.push({ node: n.id, msg: `${label(n)} can never be reached from START.` });
    }
    return { errors, warnings, symbolIssues, start: starts[0] ? starts[0].id : null, prog };
  }

  function toValue(v) {
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    return s !== '' && !Number.isNaN(Number(s)) ? Number(s) : s;
  }

  // Executes a compiled program. Returns { outputs, error, steps, visits }.
  function execute(c, inputs, maxSteps = 5000) {
    const env = { vars: {} };
    const outputs = [];
    const visits = {};
    const queue = (inputs || []).slice();
    let id = c.start, steps = 0;
    try {
      while (true) {
        if (++steps > maxSteps) throw new X.FlowError(`Your flowchart ran for more than ${maxSteps} steps — it is probably stuck in an infinite loop.`);
        const p = c.prog[id];
        if (!p) throw new X.FlowError('An arrow leads nowhere.');
        visits[id] = (visits[id] || 0) + 1;
        if (p.end) break;
        if (p.type === 'decision') {
          id = X.truth(X.evalExpr(p.cond, env)) ? p.yes : p.no;
          continue;
        }
        if (p.stmts) {
          for (const s of p.stmts) {
            if (s.k === 'set') env.vars[s.name.toLowerCase()] = X.evalExpr(s.e, env);
            else if (s.k === 'in') {
              for (const v of s.vars) {
                if (!queue.length) throw new X.FlowError('Your flowchart asked for more INPUT than the test gives — check your inputs and loop condition.');
                env.vars[v.toLowerCase()] = toValue(queue.shift());
              }
            } else {
              outputs.push(s.exprs.map((e) => X.fmt(X.evalExpr(e, env))).join(' '));
              if (outputs.length > 500) throw new X.FlowError('Your flowchart produced hundreds of outputs — is a loop running forever?');
            }
          }
        }
        id = p.next;
      }
    } catch (err) {
      if (!err.flow) throw err;
      return { outputs, error: err.message, steps, visits, unused: queue.length };
    }
    return { outputs, error: null, steps, visits, unused: queue.length };
  }

  function run(graph, inputs) {
    const c = compile(graph);
    if (c.errors.length) return { outputs: [], error: c.errors[0].msg, compileErrors: c.errors };
    return execute(c, inputs);
  }

  // ───────── comparing output ─────────
  const norm = (s) => String(s).toLowerCase().replace(/["'“”‘’]/g, '').replace(/\s+/g, '');
  function sameLine(a, b) {
    const x = norm(a), y = norm(b);
    if (x === y) return true;
    if (x !== '' && y !== '' && !Number.isNaN(Number(x)) && !Number.isNaN(Number(y))) return Math.abs(Number(x) - Number(y)) < 1e-6;
    return false;
  }
  function sameOutput(got, want) {
    const g = got.filter((l) => norm(l) !== ''), w = want.filter((l) => norm(l) !== '');
    return g.length === w.length && g.every((l, i) => sameLine(l, w[i]));
  }
  const show = (arr) => (arr.length ? arr.join(', ') : '(nothing)');
  const showIn = (arr) => (arr.length ? 'input ' + arr.join(', ') : 'no input');

  // ───────── questions ─────────
  function expected(q) {
    if (!q._expected) {
      const ref = q.solutionGraph || q.graph;
      q._expected = q.tests.map((t) => {
        const r = run(ref, t.in);
        if (r.error) throw new Error(`Reference flowchart for ${q.id} failed: ${r.error}`);
        return r.outputs;
      });
    }
    return q._expected;
  }

  function traceExpected(q) {
    if (!q._trace) {
      const r = run(q.graph, q.inputs || []);
      if (r.error) throw new Error(`Trace chart for ${q.id} failed: ${r.error}`);
      q._trace = r.outputs;
    }
    return q._trace;
  }

  function fillGraph(q, texts) {
    const g = { nodes: q.graph.nodes.map((n) => ({ ...n })), edges: q.graph.edges };
    let i = 0;
    for (const n of g.nodes) if (n.blank) n.text = (texts[i++] || '').trim();
    return g;
  }

  function testGraph(q, graph, onlyVisible) {
    const c = compile(graph);
    if (c.errors.length) return { compileErrors: c.errors, warnings: c.warnings };
    const want = expected(q);
    const results = q.tests.map((t, i) => {
      if (onlyVisible && t.hidden) return null;
      const r = execute(c, t.in);
      return { i, hidden: !!t.hidden, inputs: t.in, ok: !r.error && sameOutput(r.outputs, want[i]), got: r.outputs, want: want[i], error: r.error };
    }).filter(Boolean);
    return { results, symbolIssues: c.symbolIssues, warnings: c.warnings };
  }

  function evaluate(q, answer) {
    if (q.type === 'mc') {
      if (answer === null || answer === undefined) return { status: 'incomplete', title: 'Pick an answer', message: 'Choose one of the options first.' };
      return answer === q.answer
        ? { status: 'correct', title: 'Correct!', message: q.explain || '' }
        : { status: 'wrong', title: 'Not quite', message: `The answer was: ${String(q.options[q.answer]).replace(/^@/, '')}. ${q.explain || ''}` };
    }
    if (q.type === 'trace') {
      const want = traceExpected(q);
      const tokens = (s) => String(s).replace(/["'“”]/g, '').split(/[\s,]+/).filter(Boolean);
      const got = tokens(answer || '');
      if (!got.length) return { status: 'incomplete', title: 'Nothing typed', message: 'Type what the flowchart outputs, one value per line.' };
      return sameOutput(got, tokens(want.join(' ')))
        ? { status: 'correct', title: 'Correct!', message: `It outputs ${show(want)}.` }
        : { status: 'wrong', title: 'Not quite', message: `The flowchart outputs ${show(want)}.` };
    }

    let graph;
    if (q.type === 'fill') {
      if (answer.some((t) => !String(t).trim())) return { status: 'incomplete', title: 'Fill every blank', message: 'Every dashed box needs something in it.' };
      graph = fillGraph(q, answer);
    } else graph = answer;

    const t = testGraph(q, graph, false);
    if (t.compileErrors) {
      return { status: 'incomplete', title: 'Fix your flowchart first', message: t.compileErrors.slice(0, 3).map((e) => e.msg).join(' '), errorNodes: t.compileErrors.map((e) => e.node).filter(Boolean) };
    }
    const passed = t.results.filter((r) => r.ok).length;
    const total = t.results.length;
    const firstBad = t.results.find((r) => !r.ok);
    const why = (r) => r.error
      ? `With ${showIn(r.inputs)}: ${r.error}`
      : r.hidden ? `A hidden test failed (${passed}/${total} passed).`
        : `With ${showIn(r.inputs)} your chart output ${show(r.got)} — expected ${show(r.want)}.`;
    if (passed === total) {
      if (t.symbolIssues.length) return { status: 'partial', title: 'Works — wrong symbol', message: t.symbolIssues[0].msg, errorNodes: t.symbolIssues.map((s) => s.node) };
      return { status: 'correct', title: 'Correct!', message: `Your flowchart passed all ${total} tests.` };
    }
    if (passed > 0) return { status: 'partial', title: `${passed} of ${total} tests passed`, message: why(firstBad) };
    return { status: 'wrong', title: 'Tests failed', message: why(firstBad) };
  }

  // Runs only the visible examples, reporting each one.
  function practice(q, answer) {
    let graph;
    if (q.type === 'fill') graph = fillGraph(q, answer);
    else graph = answer;
    const t = testGraph(q, graph, true);
    if (t.compileErrors) return { status: 'syntax', title: 'Fix your flowchart first', message: t.compileErrors.slice(0, 3).map((e) => e.msg).join(' '), errorNodes: t.compileErrors.map((e) => e.node).filter(Boolean) };
    const lines = t.results.map((r, k) => `Example ${k + 1} (${showIn(r.inputs)}): ${r.ok ? 'PASS' : 'FAIL'} — ${r.error ? r.error : 'output ' + show(r.got)}${r.ok ? '' : ' (expected ' + show(r.want) + ')'}`);
    const all = t.results.every((r) => r.ok);
    return { status: all ? 'correct' : 'wrong', title: all ? 'Examples pass' : 'Some examples fail', message: '', lines };
  }

  CB.Runner = { compile, execute, run, evaluate, practice, expected, traceExpected, fillGraph, sameOutput, isStartText, isEndText };
})(typeof window !== 'undefined' ? window : globalThis);

// Expression + statement language used inside flowchart boxes.
// Accepts IGCSE-style text: Total ← Total + X, INPUT X, OUTPUT "Sum", S, X MOD 2 = 0 ...
(function (root) {
  const CB = (root.CB = root.CB || {});

  class FlowError extends Error {
    constructor(msg) { super(msg); this.flow = true; }
  }

  const KW = new Set(['AND', 'OR', 'NOT', 'MOD', 'DIV', 'TRUE', 'FALSE']);
  const FUNCS = {
    ROUND: (x, d = 0) => { const p = Math.pow(10, num(d)); return Math.round(num(x) * p) / p; },
    INT: (x) => Math.trunc(num(x)),
    ABS: (x) => Math.abs(num(x)),
    SQRT: (x) => Math.sqrt(num(x)),
    MAX: (...a) => Math.max(...a.map(num)),
    MIN: (...a) => Math.min(...a.map(num)),
    LENGTH: (s) => String(s).length,
    UCASE: (s) => String(s).toUpperCase(),
    LCASE: (s) => String(s).toLowerCase(),
    SUBSTRING: (s, a, n) => String(s).substr(num(a) - 1, num(n)),
    MOD: (a, b) => mod(a, b),
    DIV: (a, b) => div(a, b),
  };

  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') throw new FlowError('Expected a number but got TRUE/FALSE.');
    const n = Number(v);
    if (v === '' || Number.isNaN(n)) throw new FlowError(`Expected a number but got "${v}".`);
    return n;
  }
  function mod(a, b) { a = num(a); b = num(b); if (b === 0) throw new FlowError('Division by zero (MOD 0).'); return a - b * Math.floor(a / b); }
  function div(a, b) { a = num(a); b = num(b); if (b === 0) throw new FlowError('Division by zero (DIV 0).'); return Math.floor(a / b); }

  // ───────── tokenizer ─────────
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        const m = s.slice(i).match(/^[0-9]*\.?[0-9]+/);
        toks.push({ t: 'num', v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        const up = m[0].toUpperCase();
        toks.push(KW.has(up) ? { t: 'kw', v: up } : { t: 'id', v: m[0] });
        i += m[0].length;
        continue;
      }
      if (c === '"' || c === "'" || c === '“' || c === '”' || c === '‘' || c === '’') {
        const close = c === '“' ? '”' : c === '‘' ? '’' : c;
        let j = i + 1;
        while (j < s.length && s[j] !== close && !(close === '”' && s[j] === '"')) j++;
        if (j >= s.length) throw new FlowError('A piece of text is missing its closing quote.');
        toks.push({ t: 'str', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      const two = s.slice(i, i + 2);
      const ops2 = { '<-': '←', ':=': '←', '<=': '<=', '>=': '>=', '<>': '<>', '!=': '<>', '==': '=' };
      if (ops2[two]) { toks.push({ t: 'op', v: ops2[two] }); i += 2; continue; }
      const ops1 = { '←': '←', '=': '=', '<': '<', '>': '>', '≤': '<=', '≥': '>=', '≠': '<>', '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '^': '^', '(': '(', ')': ')', ',': ',', '&': '&' };
      if (ops1[c]) { toks.push({ t: 'op', v: ops1[c] }); i++; continue; }
      if (c === '?') { i++; continue; } // "X > 5?" — question marks are decoration
      throw new FlowError(`I don't understand the symbol "${c}".`);
    }
    return toks;
  }

  // ───────── parser (precedence climbing) ─────────
  function parseExpr(src) {
    const toks = typeof src === 'string' ? tokenize(src) : src;
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => peek() && (peek().t === 'op' || peek().t === 'kw') && peek().v === v;
    const eat = (v) => { if (!isOp(v)) throw new FlowError(`Expected "${v}".`); p++; };

    function orExpr() { let l = andExpr(); while (isOp('OR')) { p++; l = { k: 'bin', op: 'OR', l, r: andExpr() }; } return l; }
    function andExpr() { let l = notExpr(); while (isOp('AND')) { p++; l = { k: 'bin', op: 'AND', l, r: notExpr() }; } return l; }
    function notExpr() { if (isOp('NOT')) { p++; return { k: 'not', e: notExpr() }; } return cmp(); }
    function cmp() {
      let l = add();
      while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: add() };
      }
      return l;
    }
    function add() {
      let l = mul();
      while (peek() && peek().t === 'op' && ['+', '-', '&'].includes(peek().v)) { const op = toks[p++].v; l = { k: 'bin', op, l, r: mul() }; }
      return l;
    }
    function mul() {
      let l = unary();
      while (peek() && ((peek().t === 'op' && ['*', '/'].includes(peek().v)) || (peek().t === 'kw' && ['MOD', 'DIV'].includes(peek().v)))) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: unary() };
      }
      return l;
    }
    function unary() { if (isOp('-')) { p++; return { k: 'neg', e: unary() }; } if (isOp('+')) { p++; return unary(); } return pow(); }
    function pow() { const b = atom(); if (isOp('^')) { p++; return { k: 'bin', op: '^', l: b, r: unary() }; } return b; }
    function atom() {
      const t = peek();
      if (!t) throw new FlowError('The expression ends too early.');
      p++;
      if (t.t === 'num') return { k: 'lit', v: t.v };
      if (t.t === 'str') return { k: 'lit', v: t.v };
      if (t.t === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) return { k: 'lit', v: t.v === 'TRUE' };
      if (t.t === 'kw' && (t.v === 'MOD' || t.v === 'DIV') && isOp('(')) return call(t.v);
      if (t.t === 'id') {
        if (isOp('(')) return call(t.v.toUpperCase());
        return { k: 'var', name: t.v };
      }
      if (t.t === 'op' && t.v === '(') { const e = orExpr(); eat(')'); return e; }
      throw new FlowError(`Unexpected "${t.v}".`);
    }
    function call(name) {
      if (!FUNCS[name]) throw new FlowError(`Unknown function ${name}().`);
      eat('(');
      const args = [];
      if (!isOp(')')) { args.push(orExpr()); while (isOp(',')) { p++; args.push(orExpr()); } }
      eat(')');
      return { k: 'call', name, args };
    }
    const e = orExpr();
    if (p < toks.length) throw new FlowError(`Unexpected "${toks[p].v}" — check the expression.`);
    return e;
  }

  // ───────── evaluation ─────────
  function evalExpr(e, env) {
    switch (e.k) {
      case 'lit': return e.v;
      case 'var': {
        const key = e.name.toLowerCase();
        if (!(key in env.vars)) {
          throw new FlowError(`${e.name} has no value yet.` + (/^[A-Z]{2,}$/.test(e.name) ? ` If you meant the text "${e.name}", put it in quotes.` : ''));
        }
        return env.vars[key];
      }
      case 'neg': return -num(evalExpr(e.e, env));
      case 'not': return !truth(evalExpr(e.e, env));
      case 'call': return FUNCS[e.name](...e.args.map((a) => evalExpr(a, env)));
      case 'bin': {
        if (e.op === 'AND') return truth(evalExpr(e.l, env)) && truth(evalExpr(e.r, env));
        if (e.op === 'OR') return truth(evalExpr(e.l, env)) || truth(evalExpr(e.r, env));
        const a = evalExpr(e.l, env), b = evalExpr(e.r, env);
        switch (e.op) {
          case '+': return typeof a === 'number' && typeof b === 'number' ? a + b : fmt(a) + fmt(b);
          case '&': return fmt(a) + fmt(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': if (num(b) === 0) throw new FlowError('Division by zero.'); return num(a) / num(b);
          case '^': return Math.pow(num(a), num(b));
          case 'MOD': return mod(a, b);
          case 'DIV': return div(a, b);
          default: return compare(e.op, a, b);
        }
      }
    }
    throw new FlowError('Bad expression.');
  }
  function compare(op, a, b) {
    let x = a, y = b;
    const na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean' && typeof b !== 'boolean') { x = na; y = nb; }
    else { x = typeof a === 'string' ? a : fmt(a); y = typeof b === 'string' ? b : fmt(b); }
    switch (op) {
      case '=': return x === y;
      case '<>': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      case '>=': return x >= y;
    }
    return false;
  }
  function truth(v) {
    if (typeof v === 'boolean') return v;
    throw new FlowError(`A decision needs a TRUE/FALSE question (like X > 5), not the value "${fmt(v)}".`);
  }
  function fmt(v) {
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
    return String(v);
  }

  // Split on top-level commas (outside quotes/parentheses).
  function splitTop(s, sep = ',') {
    const out = [];
    let depth = 0, q = null, cur = '';
    for (const c of s) {
      if (q) { cur += c; if (c === q || (q === '“' && c === '”')) q = null; continue; }
      if (c === '"' || c === "'" || c === '“') { q = c; cur += c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }

  // ───────── statements ─────────
  const IN_RE = /^(INPUT|READ|GET|ENTER)\b\s*(.*)$/i;
  const OUT_RE = /^(OUTPUT|PRINT|DISPLAY|WRITE|SHOW)\b\s*(.*)$/i;
  const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(←|<-|:=|=)\s*([\s\S]+)$/;

  // Parses the text of one box into a list of statements: {k:'in', vars}, {k:'out', exprs}, {k:'set', name, e}.
  function parseStatements(text) {
    const parts = String(text).split(/[\n;]/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) throw new FlowError('This box is empty.');
    return parts.map((line) => {
      let m = line.match(IN_RE);
      if (m) {
        const vars = m[2].split(',').map((v) => v.trim()).filter(Boolean);
        if (!vars.length) throw new FlowError('INPUT needs a variable name, e.g. INPUT X');
        for (const v of vars) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new FlowError(`"${v}" is not a valid variable name.`);
        return { k: 'in', vars };
      }
      m = line.match(OUT_RE);
      if (m) {
        if (!m[2].trim()) throw new FlowError('OUTPUT needs something to output.');
        return { k: 'out', exprs: splitTop(m[2]).map((x) => parseExpr(x)) };
      }
      m = line.match(ASSIGN_RE);
      if (m) return { k: 'set', name: m[1], e: parseExpr(m[3]) };
      throw new FlowError(`"${line}" is not an instruction. Use a form like Total ← Total + X`);
    });
  }

  function parseCondition(text) {
    let t = String(text).trim().replace(/\?+\s*$/, '');
    t = t.replace(/^(IS|IF|WHILE|UNTIL)\s+/i, '');
    if (!t) throw new FlowError('This decision is empty — write a question like X > 5?');
    // a lone "=" between operands means "equals" in a decision
    return parseExpr(t);
  }

  CB.Expr = { FlowError, tokenize, parseExpr, evalExpr, parseStatements, parseCondition, truth, fmt, num, IN_RE, OUT_RE, ASSIGN_RE };
})(typeof window !== 'undefined' ? window : globalThis);

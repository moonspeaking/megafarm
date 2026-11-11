// Parser for the Farm Craft script DSL.
//
// The format looks like:
//
//   <<                       <- script body marker
//   @level 1
//   {
//       #string level_name "Обучение";
//       #point level_size 24, 16;
//       @scenario
//       {
//           @action { #string type "show message"; @condition { c1; } }
//       }
//   }
//   >>
//
// Comments start with // and run to the end of the line.

export function parseScript(text) {
  const tokens = tokenize(text);
  let pos = 0;
  const roots = [];

  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }
  function expect(t) {
    const tok = next();
    if (!tok || tok.type !== t) throw new Error(`expected ${t}, got ${tok && tok.text}`);
    return tok;
  }

  function parseValue() {
    // gather tokens until ';' and interpret
    const parts = [];
    // a value ends at ';', '}' or (when the ';' is missing) at the next '@node' / '#prop'
    while (peek() && !['semi', 'brace_close', 'at', 'hash'].includes(peek().type)) {
      parts.push(next());
    }
    if (peek() && peek().type === 'semi') next();
    if (parts.length === 0) return '';
    if (parts.length === 1) {
      const p = parts[0];
      if (p.type === 'str') return p.text;
      if (p.type === 'num') return p.num;
      if (p.type === 'id') {
        if (p.text === 'true') return true;
        if (p.text === 'false') return false;
        return p.text;
      }
      return p.text;
    }
    // point / rect / color: numbers separated by commas
    if (parts.every((p) => p.type === 'num' || p.type === 'comma')) {
      return parts.filter((p) => p.type === 'num').map((p) => p.num);
    }
    return parts.map((p) => p.text).join(' ');
  }

  function parseNode() {
    const at = expect('at');
    const node = {
      type: at.text,
      id: undefined,
      props: {},
      children: [],
      refs: [],
      exprs: [],
    };
    // optional id
    const t = peek();
    if (t && (t.type === 'num' || t.type === 'str' || t.type === 'id')) {
      node.id = t.type === 'num' ? t.num : t.text;
      next();
    }
    const t2 = peek();
    if (t2 && t2.type === 'brace_open') {
      next();
      parseBody(node);
    } else if (t2 && t2.type === 'semi') {
      next();
    }
    return node;
  }

  function parseBody(node) {
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.type === 'brace_close') { next(); return; }
      if (t.type === 'at') { node.children.push(parseNode()); continue; }
      if (t.type === 'hash') {
        next();
        const nameTok = next(); // property name
        const value = parseValue();
        if (nameTok) node.props[nameTok.text] = value;
        continue;
      }
      if (t.type === 'ref') {
        next();
        node.refs.push(t.text);
        continue;
      }
      if (t.type === 'semi') { next(); continue; }
      // bare expression (conditions, item lists)
      // ends like a property value: at ';', '}' or (without ';') at the next '@'/'#'
      const parts = [];
      while (peek() && !['semi', 'brace_close', 'at', 'hash'].includes(peek().type)) {
        parts.push(next().text);
      }
      if (peek() && peek().type === 'semi') next();
      if (parts.length) node.exprs.push(parts.join(' '));
    }
  }

  while (pos < tokens.length) {
    const t = peek();
    if (t.type === 'at') roots.push(parseNode());
    else next();
  }
  return roots;
}

function tokenize(text) {
  // strip // comments (not inside strings)
  let src = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // a quote inside a string is escaped (\"), count backslashes before it
      let bs = 0;
      while (text[i - 1 - bs] === '\\') bs++;
      if (bs % 2 === 0) inStr = !inStr;
    }
    if (!inStr && c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      src += '\n';
      continue;
    }
    src += c;
  }

  const re = /("(?:[^"\\]|\\.)*")|(@\w+)|(#\w+)|(\[([^\]]+)\])|([{};,])|(-?\d+\.\d+|-?\d+)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|>|<)|(\S)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) tokens.push({ type: 'str', text: unquote(m[1]) });
    else if (m[2]) tokens.push({ type: 'at', text: m[2].slice(1) });
    else if (m[3]) tokens.push({ type: 'hash', text: m[3].slice(1) });
    else if (m[4]) tokens.push({ type: 'ref', text: m[5] });
    else if (m[6]) tokens.push({ type: braceName(m[6]), text: m[6] });
    else if (m[7]) tokens.push({ type: 'num', text: m[7], num: parseFloat(m[7]) });
    else if (m[8]) tokens.push({ type: 'id', text: m[8] });
    else if (m[9]) tokens.push({ type: 'op', text: m[9] });
    else tokens.push({ type: 'other', text: m[10] });
  }
  return tokens;
}

function braceName(c) {
  return { '{': 'brace_open', '}': 'brace_close', ';': 'semi', ',': 'comma' }[c];
}

function unquote(s) {
  return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

/**
 * Recursive-descent parser for PICO-8 Lua (Lua 5.2 + PICO-8 extensions).
 *
 * Extensions handled here: compound assignment (`a.b[c] += 1`), `!=`,
 * short `if (c) stmt [else stmt]` and `while (c) stmt`, `?expr` print,
 * `if c do`, integer division `\`, bitwise `& | ^^ ~ << >> >>> <<> >><`,
 * and peek operators `@ % $`.
 *
 * Statement boundaries come from the grammar, never from line breaks, so
 * `b.x+=b.dx b.y+=b.dy` parses as two statements. Only the short forms
 * look at lines, like PICO-8 does: their body ends at the end of the line.
 */
import { lex, type Token } from '../../cart/lexer';
import type { BinaryOp, Block, Expr, FuncBody, Stmt, TableField, UnaryOp } from './ast';
import { StringLiteralError, decodeStringLiteral, fixToNumber, parseNumberLiteral } from './literals';

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

const BINARY_PREC: Record<string, number> = {
  or: 1, and: 2,
  '<': 3, '>': 3, '<=': 3, '>=': 3, '==': 3, '~=': 3, '!=': 3,
  '|': 4, '^^': 5, '~': 5, '&': 6,
  '<<': 7, '>>': 7, '>>>': 7, '<<>': 7, '>><': 7,
  '..': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '\\': 10, '%': 10,
  '^': 12,
};
const RIGHT_ASSOC = new Set(['^', '..']);
const UNARY_PREC = 11;
const UNARY_OPS = new Set(['-', 'not', '#', '~', '@', '%', '$']);
const BLOCK_ENDS = new Set(['end', 'else', 'elseif', 'until']);

/** `op=` tokens that are compound assignments, mapped to their binary operator. */
const COMPOUND_OPS: Record<string, BinaryOp> = {
  '+=': '+', '-=': '-', '*=': '*', '/=': '/', '\\=': '\\', '%=': '%', '^=': '^',
  '..=': '..', '|=': '|', '&=': '&', '^^=': '^^', '<<=': '<<', '>>=': '>>',
  '>>>=': '>>>', '<<>=': '<<>', '>><=': '>><',
};

function normalizeBinary(op: string): BinaryOp {
  if (op === '!=') return '~=';
  if (op === '~') return '^^';
  return op as BinaryOp;
}

export function parse(p8src: string): Block {
  const { tokens, errors } = lex(p8src);
  if (errors.length > 0) throw new ParseError(errors[0]!.message, errors[0]!.line);
  return new Parser(tokens).parseChunk();
}

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  // --- token helpers ---------------------------------------------------------

  private peek(off = 0): Token | undefined {
    return this.tokens[this.i + off];
  }

  private get lastLine(): number {
    return this.tokens[this.tokens.length - 1]?.line ?? 1;
  }

  private line(): number {
    return this.peek()?.line ?? this.lastLine;
  }

  private check(value: string): boolean {
    const t = this.peek();
    return t !== undefined && t.value === value && (t.type === 'punct' || t.type === 'keyword');
  }

  private accept(value: string): Token | null {
    if (this.check(value)) return this.tokens[this.i++]!;
    return null;
  }

  private expect(value: string, context?: string): Token {
    const t = this.accept(value);
    if (t) return t;
    const got = this.peek();
    const where = context ? ` ${context}` : '';
    throw new ParseError(`'${value}' expected${where} near ${got ? `'${got.value}'` : '<eof>'}`, this.line());
  }

  private name(): string {
    const t = this.peek();
    if (!t || t.type !== 'ident') {
      throw new ParseError(`<name> expected near ${t ? `'${t.value}'` : '<eof>'}`, this.line());
    }
    this.i++;
    return t.value;
  }

  private error(message: string): never {
    throw new ParseError(message, this.line());
  }

  // --- blocks ----------------------------------------------------------------

  parseChunk(): Block {
    const block = this.parseBlock();
    if (this.peek()) this.error(`'<eof>' expected near '${this.peek()!.value}'`);
    return block;
  }

  /** Parses statements until a block end; with `shortLine`, also stops at the end of that line. */
  private parseBlock(shortLine?: number): Block {
    const stmts: Stmt[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (shortLine !== undefined && t.line > shortLine) break;
      if (t.type === 'keyword' && BLOCK_ENDS.has(t.value)) break;
      if (this.accept(';')) continue;
      const stmt = this.parseStatement(shortLine);
      stmts.push(stmt);
      if (stmt.kind === 'return') {
        this.accept(';');
        break;
      }
    }
    return { stmts };
  }

  // --- statements --------------------------------------------------------------

  private parseStatement(shortLine: number | undefined): Stmt {
    const t = this.peek()!;
    const line = t.line;
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'do': {
          this.i++;
          const body = this.parseBlock();
          const end = this.expect('end', `(to close 'do' at line ${line})`);
          return { kind: 'do', body, line, endLine: end.line };
        }
        case 'if':
          this.i++;
          return this.parseIf(line);
        case 'while':
          this.i++;
          return this.parseWhile(line);
        case 'repeat': {
          this.i++;
          const body = this.parseBlock();
          const until = this.expect('until', `(to close 'repeat' at line ${line})`);
          const cond = this.parseExpr();
          return { kind: 'repeat', body, cond, line, untilLine: until.line };
        }
        case 'for':
          this.i++;
          return this.parseFor(line);
        case 'function': {
          this.i++;
          const path = [this.name()];
          let method: string | null = null;
          while (this.accept('.')) path.push(this.name());
          if (this.accept(':')) method = this.name();
          const func = this.parseFuncBody(line, method !== null);
          return { kind: 'function', path, method, func, line };
        }
        case 'local': {
          this.i++;
          if (this.accept('function')) {
            const name = this.name();
            return { kind: 'localfunction', name, func: this.parseFuncBody(line, false), line };
          }
          const names = [this.name()];
          while (this.accept(',')) names.push(this.name());
          const values = this.accept('=') ? this.parseExprList() : [];
          return { kind: 'local', names, values, line };
        }
        case 'return': {
          this.i++;
          const next = this.peek();
          const empty =
            !next ||
            (next.type === 'keyword' && BLOCK_ENDS.has(next.value)) ||
            (next.type === 'punct' && next.value === ';') ||
            (shortLine !== undefined && next.line > shortLine);
          return { kind: 'return', values: empty ? [] : this.parseExprList(), line };
        }
        case 'break':
          this.i++;
          return { kind: 'break', line };
        case 'goto':
          this.i++;
          return { kind: 'goto', label: this.name(), line };
      }
    }
    if (t.type === 'punct' && t.value === '::') {
      this.i++;
      const label = this.name();
      this.expect('::');
      return { kind: 'label', label, line };
    }
    if (t.type === 'punct' && t.value === '#' && this.peek(1)?.value === 'include') {
      throw new ParseError('#include is not supported (paste the included code into the cart)', line);
    }
    if (t.type === 'punct' && t.value === '?') {
      this.i++;
      const args = this.parseExprList();
      return { kind: 'callstmt', call: { kind: 'call', fn: { kind: 'name', name: 'print', line }, args, line }, line };
    }
    return this.parseExprStatement(line);
  }

  private parseExprStatement(line: number): Stmt {
    const first = this.parseSuffixedExpr();
    const next = this.peek();

    if (next && next.type === 'punct' && (next.value === '=' || next.value === ',')) {
      const targets = [first];
      while (this.accept(',')) targets.push(this.parseSuffixedExpr());
      for (const target of targets) this.checkAssignable(target);
      this.expect('=');
      return { kind: 'assign', targets, values: this.parseExprList(), line };
    }

    if (next && next.type === 'punct' && next.value in COMPOUND_OPS) {
      this.i++;
      this.checkAssignable(first);
      const rhs = this.parseExpr();
      const op = COMPOUND_OPS[next.value]!;
      return {
        kind: 'assign',
        targets: [first],
        values: [{ kind: 'binary', op, left: first, right: { kind: 'paren', expr: rhs, line: rhs.line }, line }],
        line,
      };
    }

    if (first.kind === 'call' || first.kind === 'method') return { kind: 'callstmt', call: first, line };
    return this.error(next ? `syntax error near '${next.value}'` : 'syntax error near <eof>');
  }

  private checkAssignable(e: Expr) {
    if (e.kind !== 'name' && e.kind !== 'index' && e.kind !== 'member') {
      throw new ParseError('cannot assign to this expression', e.line);
    }
  }

  private parseIf(line: number): Stmt {
    const cond = this.parseExpr();
    if (this.accept('then') || this.accept('do')) {
      const clauses = [{ cond, body: this.parseBlock(), line }];
      let orelse: Block | null = null;
      let elseLine = 0;
      for (;;) {
        const elif = this.accept('elseif');
        if (elif) {
          const c = this.parseExpr();
          this.expect('then');
          clauses.push({ cond: c, body: this.parseBlock(), line: elif.line });
          continue;
        }
        const els = this.accept('else');
        if (els) {
          elseLine = els.line;
          orelse = this.parseBlock();
        }
        break;
      }
      const end = this.expect('end', `(to close 'if' at line ${line})`);
      return { kind: 'if', clauses, orelse, elseLine, endLine: end.line, line };
    }

    // Short form: `if (cond) stmt [else stmt]`, body limited to the current line.
    const prev = this.tokens[this.i - 1]!;
    if (prev.type !== 'punct' || prev.value !== ')') this.error(`'then' expected near '${this.peek()?.value ?? '<eof>'}'`);
    const shortLine = prev.line;
    const body = this.parseBlock(shortLine);
    let orelse: Block | null = null;
    let elseLine = 0;
    const next = this.peek();
    if (next && next.line === shortLine && next.type === 'keyword' && next.value === 'else') {
      this.i++;
      elseLine = next.line;
      orelse = this.parseBlock(shortLine);
    }
    return { kind: 'if', clauses: [{ cond, body, line }], orelse, elseLine, endLine: shortLine, line };
  }

  private parseWhile(line: number): Stmt {
    const cond = this.parseExpr();
    if (this.accept('do')) {
      const body = this.parseBlock();
      const end = this.expect('end', `(to close 'while' at line ${line})`);
      return { kind: 'while', cond, body, line, endLine: end.line };
    }
    const prev = this.tokens[this.i - 1]!;
    if (prev.type !== 'punct' || prev.value !== ')') this.error(`'do' expected near '${this.peek()?.value ?? '<eof>'}'`);
    const body = this.parseBlock(prev.line);
    return { kind: 'while', cond, body, line, endLine: prev.line };
  }

  private parseFor(line: number): Stmt {
    const first = this.name();
    if (this.accept('=')) {
      const start = this.parseExpr();
      this.expect(',');
      const limit = this.parseExpr();
      const step = this.accept(',') ? this.parseExpr() : null;
      this.expect('do');
      const body = this.parseBlock();
      const end = this.expect('end', `(to close 'for' at line ${line})`);
      return { kind: 'fornum', var: first, start, limit, step, body, line, endLine: end.line };
    }
    const names = [first];
    while (this.accept(',')) names.push(this.name());
    this.expect('in');
    const exprs = this.parseExprList();
    this.expect('do');
    const body = this.parseBlock();
    const end = this.expect('end', `(to close 'for' at line ${line})`);
    return { kind: 'forin', names, exprs, body, line, endLine: end.line };
  }

  private parseFuncBody(line: number, isMethod: boolean): FuncBody {
    this.expect('(');
    const params: string[] = isMethod ? ['self'] : [];
    let vararg = false;
    if (!this.check(')')) {
      for (;;) {
        if (this.accept('...')) {
          vararg = true;
          break;
        }
        params.push(this.name());
        if (!this.accept(',')) break;
      }
    }
    this.expect(')');
    const body = this.parseBlock();
    const end = this.expect('end', `(to close 'function' at line ${line})`);
    return { params, vararg, body, line, endLine: end.line };
  }

  // --- expressions ---------------------------------------------------------------

  private parseExprList(): Expr[] {
    const list = [this.parseExpr()];
    while (this.accept(',')) list.push(this.parseExpr());
    return list;
  }

  parseExpr(limit = 0): Expr {
    let left: Expr;
    const t = this.peek();
    if (t && (t.type === 'punct' || t.type === 'keyword') && UNARY_OPS.has(t.value)) {
      this.i++;
      const operand = this.parseExpr(UNARY_PREC);
      left = { kind: 'unary', op: t.value as UnaryOp, expr: operand, line: t.line };
    } else {
      left = this.parseSimpleExpr();
    }

    for (;;) {
      const op = this.peek();
      if (!op || (op.type !== 'punct' && op.type !== 'keyword')) break;
      const prec = BINARY_PREC[op.value];
      if (prec === undefined) break;
      // Left-assoc ops bind only if stronger than the limit; right-assoc if at least as strong.
      if (RIGHT_ASSOC.has(op.value) ? prec < limit : prec <= limit) break;
      this.i++;
      const right = this.parseExpr(prec);
      left = { kind: 'binary', op: normalizeBinary(op.value), left, right, line: left.line };
    }
    return left;
  }

  private parseSimpleExpr(): Expr {
    const t = this.peek();
    if (!t) return this.error('unexpected end of input');
    const line = t.line;
    switch (t.type) {
      case 'number': {
        this.i++;
        const raw = parseNumberLiteral(t.value);
        if (raw === null) throw new ParseError(`malformed number near '${t.value}'`, line);
        return { kind: 'number', value: fixToNumber(raw), line };
      }
      case 'string':
        this.i++;
        return { kind: 'string', value: this.decodeString(t), line };
      case 'keyword':
        switch (t.value) {
          case 'nil':
          case 'true':
          case 'false':
            this.i++;
            return { kind: t.value, line };
          case 'function':
            this.i++;
            return { kind: 'function', func: this.parseFuncBody(line, false), line };
        }
        break;
      case 'punct':
        if (t.value === '...') {
          this.i++;
          return { kind: 'vararg', line };
        }
        if (t.value === '{') return this.parseTable();
        if (t.value === '?') {
          this.i++;
          return { kind: 'call', fn: { kind: 'name', name: 'print', line }, args: this.parseExprList(), line };
        }
        if (t.value === '#' && this.peek(1)?.value === 'include') {
          throw new ParseError('#include is not supported (paste the included code into the cart)', line);
        }
        break;
    }
    return this.parseSuffixedExpr();
  }

  private decodeString(t: Token): string {
    try {
      return decodeStringLiteral(t.value);
    } catch (e) {
      if (e instanceof StringLiteralError) throw new ParseError(e.message, t.line);
      throw e;
    }
  }

  private parsePrimaryExpr(): Expr {
    const t = this.peek();
    if (!t) return this.error('unexpected end of input');
    if (t.type === 'ident') {
      this.i++;
      return { kind: 'name', name: t.value, line: t.line };
    }
    if (t.type === 'punct' && t.value === '(') {
      this.i++;
      const expr = this.parseExpr();
      this.expect(')');
      return { kind: 'paren', expr, line: t.line };
    }
    return this.error(`unexpected symbol near '${t.value}'`);
  }

  private parseSuffixedExpr(): Expr {
    let expr = this.parsePrimaryExpr();
    for (;;) {
      const t = this.peek();
      if (!t) return expr;
      if (t.type === 'punct') {
        switch (t.value) {
          case '.':
            this.i++;
            expr = { kind: 'member', obj: expr, name: this.name(), line: expr.line };
            continue;
          case '[': {
            this.i++;
            const key = this.parseExpr();
            this.expect(']');
            expr = { kind: 'index', obj: expr, key, line: expr.line };
            continue;
          }
          case ':': {
            this.i++;
            const name = this.name();
            expr = { kind: 'method', obj: expr, name, args: this.parseCallArgs(), line: expr.line };
            continue;
          }
          case '(':
          case '{':
            expr = { kind: 'call', fn: expr, args: this.parseCallArgs(), line: expr.line };
            continue;
        }
      } else if (t.type === 'string') {
        expr = { kind: 'call', fn: expr, args: this.parseCallArgs(), line: expr.line };
        continue;
      }
      return expr;
    }
  }

  private parseCallArgs(): Expr[] {
    const t = this.peek();
    if (t?.type === 'string') {
      this.i++;
      return [{ kind: 'string', value: this.decodeString(t), line: t.line }];
    }
    if (t?.type === 'punct' && t.value === '{') return [this.parseTable()];
    this.expect('(', 'for function arguments');
    if (this.accept(')')) return [];
    const args = this.parseExprList();
    this.expect(')');
    return args;
  }

  private parseTable(): Expr {
    const open = this.expect('{');
    const fields: TableField[] = [];
    while (!this.check('}')) {
      const t = this.peek();
      if (!t) break;
      if (t.type === 'punct' && t.value === '[') {
        this.i++;
        const key = this.parseExpr();
        this.expect(']');
        this.expect('=');
        fields.push({ kind: 'keyed', key, value: this.parseExpr(), line: t.line });
      } else if (t.type === 'ident' && this.peek(1)?.type === 'punct' && this.peek(1)?.value === '=') {
        this.i += 2;
        fields.push({ kind: 'named', name: t.value, value: this.parseExpr(), line: t.line });
      } else {
        fields.push({ kind: 'pos', value: this.parseExpr() });
      }
      if (!this.accept(',') && !this.accept(';')) break;
    }
    const close = this.expect('}', `(to close '{' at line ${open.line})`);
    return { kind: 'table', fields, line: open.line, endLine: close.line };
  }
}

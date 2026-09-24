/**
 * AST -> Lua 5.4 code generation.
 *
 * - Every construct is emitted on the same line as in the source whenever
 *   possible, so runtime error line numbers map back 1:1 (the line map
 *   covers the remaining cases).
 * - Numbers are emitted as float literals holding their exact 16.16 value.
 * - Strings are re-encoded as ASCII-only Lua literals (P8SCII bytes as `\ddd`).
 * - PICO-8-only operators become calls to helper functions (see HELPERS).
 */
import type { BinaryOp, Block, Expr, FuncBody, Stmt } from './ast';
import { encodeLuaString, formatLuaNumber } from './literals';

/** Helper functions the generated code expects to find in its environment. */
export const HELPERS = {
  cat: '__p8_cat',
  band: '__p8_band',
  bor: '__p8_bor',
  bxor: '__p8_bxor',
  bnot: '__p8_bnot',
  shl: '__p8_shl',
  shr: '__p8_shr',
  lshr: '__p8_lshr',
  rotl: '__p8_rotl',
  rotr: '__p8_rotr',
  peek: '__p8_peek',
  peek2: '__p8_peek2',
  peek4: '__p8_peek4',
} as const;

const HELPER_NAMES = Object.values(HELPERS);

const BINARY_HELPER: Partial<Record<BinaryOp, string>> = {
  '..': HELPERS.cat,
  '&': HELPERS.band,
  '|': HELPERS.bor,
  '^^': HELPERS.bxor,
  '<<': HELPERS.shl,
  '>>': HELPERS.shr,
  '>>>': HELPERS.lshr,
  '<<>': HELPERS.rotl,
  '>><': HELPERS.rotr,
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Identifiers with P8SCII glyphs are legal in PICO-8 but not in Lua: mangle them. */
export function luaIdent(name: string): string {
  if (IDENT_RE.test(name)) return name;
  let out = '__p8i';
  for (const ch of name) {
    out += /[A-Za-z0-9]/.test(ch) ? ch : `_${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
  }
  return out;
}

export interface GeneratedLua {
  code: string;
  /** lineMap[generatedLine - 1] = source line. */
  lineMap: number[];
}

export function generate(block: Block): GeneratedLua {
  const g = new Generator();
  // Cache helpers as locals (fast upvalue access), on line 1 so nothing shifts.
  g.emit(`local ${HELPER_NAMES.join(',')}=${HELPER_NAMES.join(',')};`);
  g.block(block);
  return g.finish();
}

class Generator {
  private out: string[] = [];
  private curLine = 1;
  private lineMap: number[] = [1];
  /** Whether the last emitted char is a word char (a following word needs a space). */
  private needSpace = false;

  finish(): GeneratedLua {
    return { code: this.out.join(''), lineMap: this.lineMap };
  }

  /** Moves the output to `line` (never backwards). Output line N holds source line N. */
  private at(line: number) {
    while (this.curLine < line) {
      this.out.push('\n');
      this.curLine++;
      this.lineMap.push(this.curLine);
      this.needSpace = false;
    }
  }

  emit(s: string) {
    if (!s) return;
    const first = s.charCodeAt(0);
    const startsWord = /[A-Za-z0-9_]/.test(String.fromCharCode(first));
    if (this.needSpace && startsWord) this.out.push(' ');
    this.out.push(s);
    this.needSpace = /[A-Za-z0-9_]$/.test(s);
  }

  // --- statements --------------------------------------------------------------

  /**
   * Label scopes: PICO-8 (Lua 5.2) lets a nested block reuse a label name that
   * Lua 5.4 rejects as "already defined", so every label gets a unique name.
   * `null` entries mark function boundaries (gotos cannot cross them).
   */
  private labelScopes: (Map<string, string> | null)[] = [];
  private labelCounter = 0;

  block(b: Block) {
    const labels = new Map<string, string>();
    for (const s of b.stmts) {
      if (s.kind === 'label' && !labels.has(s.label)) labels.set(s.label, `${luaIdent(s.label)}_${++this.labelCounter}`);
    }
    this.labelScopes.push(labels);
    for (const s of b.stmts) this.stmt(s);
    this.labelScopes.pop();
  }

  private resolveLabel(name: string): string {
    for (let i = this.labelScopes.length - 1; i >= 0; i--) {
      const scope = this.labelScopes[i];
      if (!scope) break;
      const found = scope.get(name);
      if (found) return found;
    }
    return luaIdent(name); // unknown: let Lua report the error
  }

  private stmt(s: Stmt) {
    this.at(s.line);
    switch (s.kind) {
      case 'local':
        this.emit('local');
        this.emit(s.names.map(luaIdent).join(','));
        if (s.values.length) {
          this.emit('=');
          this.exprList(s.values);
        }
        this.emit(';');
        break;
      case 'assign':
        if (startsWithParen(s.targets[0]!)) this.emit(';');
        s.targets.forEach((t, i) => {
          if (i) this.emit(',');
          this.expr(t);
        });
        this.emit('=');
        this.exprList(s.values);
        this.emit(';');
        break;
      case 'callstmt':
        if (startsWithParen(s.call)) this.emit(';');
        this.expr(s.call);
        this.emit(';');
        break;
      case 'do':
        this.emit('do');
        this.block(s.body);
        this.end(s.endLine);
        break;
      case 'while':
        this.emit('while');
        this.expr(s.cond);
        this.emit('do');
        this.block(s.body);
        this.end(s.endLine);
        break;
      case 'repeat':
        this.emit('repeat');
        this.block(s.body);
        this.at(s.untilLine);
        this.emit('until');
        this.expr(s.cond);
        this.emit(';');
        break;
      case 'if':
        s.clauses.forEach((c, i) => {
          this.at(c.line);
          this.emit(i === 0 ? 'if' : 'elseif');
          this.expr(c.cond);
          this.emit('then');
          this.block(c.body);
        });
        if (s.orelse) {
          this.at(s.elseLine);
          this.emit('else');
          this.block(s.orelse);
        }
        this.end(s.endLine);
        break;
      case 'fornum':
        this.emit('for');
        this.emit(luaIdent(s.var));
        this.emit('=');
        this.expr(s.start);
        this.emit(',');
        this.expr(s.limit);
        if (s.step) {
          this.emit(',');
          this.expr(s.step);
        }
        this.emit('do');
        this.block(s.body);
        this.end(s.endLine);
        break;
      case 'forin':
        this.emit('for');
        this.emit(s.names.map(luaIdent).join(','));
        this.emit('in');
        this.exprList(s.exprs);
        this.emit('do');
        this.block(s.body);
        this.end(s.endLine);
        break;
      case 'function': {
        this.emit('function');
        let name = s.path.map(luaIdent).join('.');
        if (s.method) name += ':' + luaIdent(s.method);
        this.emit(name);
        this.funcBody(s.func, s.method !== null);
        break;
      }
      case 'localfunction':
        this.emit('local function');
        this.emit(luaIdent(s.name));
        this.funcBody(s.func, false);
        break;
      case 'return':
        // The parser guarantees `return` ends its block, as Lua requires.
        this.emit('return');
        this.exprList(s.values);
        this.emit(';');
        break;
      case 'break':
        this.emit('break;');
        break;
      case 'goto':
        this.emit('goto');
        this.emit(this.resolveLabel(s.label));
        this.emit(';');
        break;
      case 'label':
        this.emit(`::${this.labelScopes.at(-1)?.get(s.label) ?? luaIdent(s.label)}::`);
        break;
    }
  }

  private end(line: number) {
    this.at(line);
    this.emit('end;');
  }

  private funcBody(f: FuncBody, isMethod: boolean) {
    const params = (isMethod ? f.params.slice(1) : f.params).map(luaIdent);
    if (f.vararg) params.push('...');
    this.emit(`(${params.join(',')})`);
    this.labelScopes.push(null);
    this.block(f.body);
    this.labelScopes.pop();
    this.at(f.endLine);
    this.emit('end');
  }

  // --- expressions -------------------------------------------------------------------

  private exprList(list: Expr[]) {
    list.forEach((e, i) => {
      if (i) this.emit(',');
      this.expr(e);
    });
  }

  private expr(e: Expr) {
    this.at(e.line);
    switch (e.kind) {
      case 'nil':
      case 'true':
      case 'false':
        this.emit(e.kind);
        break;
      case 'vararg':
        this.emit('...');
        break;
      case 'number':
        this.emit(e.value < 0 || Object.is(e.value, -0) ? `(${formatLuaNumber(e.value)})` : formatLuaNumber(e.value));
        break;
      case 'string':
        this.emit(encodeLuaString(e.value));
        break;
      case 'name':
        this.emit(luaIdent(e.name));
        break;
      case 'member':
        this.prefix(e.obj);
        this.emit('.');
        this.emit(luaIdent(e.name));
        break;
      case 'index':
        this.prefix(e.obj);
        this.emit('[');
        this.expr(e.key);
        this.emit(']');
        break;
      case 'call':
        this.prefix(e.fn);
        this.args(e.args);
        break;
      case 'method':
        this.prefix(e.obj);
        this.emit(':');
        this.emit(luaIdent(e.name));
        this.args(e.args);
        break;
      case 'function':
        this.emit('function');
        this.funcBody(e.func, false);
        break;
      case 'table':
        this.emit('{');
        for (const f of e.fields) {
          if (f.kind === 'pos') {
            this.expr(f.value);
          } else if (f.kind === 'named') {
            this.at(f.line);
            this.emit(luaIdent(f.name));
            this.emit('=');
            this.expr(f.value);
          } else {
            this.at(f.line);
            this.emit('[');
            this.expr(f.key);
            this.emit(']=');
            this.expr(f.value);
          }
          this.emit(',');
        }
        this.at(e.endLine);
        this.emit('}');
        break;
      case 'paren':
        this.emit('(');
        this.expr(e.expr);
        this.emit(')');
        break;
      case 'unary':
        this.unary(e);
        break;
      case 'binary':
        this.binary(e);
        break;
    }
  }

  /** Emits a prefix expression (call target / indexed object). Literals need parens in Lua. */
  private prefix(e: Expr) {
    if (e.kind === 'name' || e.kind === 'member' || e.kind === 'index' || e.kind === 'call' || e.kind === 'method' || e.kind === 'paren') {
      this.expr(e);
    } else {
      this.emit('(');
      this.expr(e);
      this.emit(')');
    }
  }

  private args(args: Expr[]) {
    this.emit('(');
    this.exprList(args);
    this.emit(')');
  }

  private helperCall(name: string, args: Expr[]) {
    this.emit(name);
    this.args(args);
  }

  private unary(e: Extract<Expr, { kind: 'unary' }>) {
    switch (e.op) {
      case '-':
        // Fold `-<number>` so that e.g. -32768 stays in range, like PICO-8.
        if (e.expr.kind === 'number') {
          this.expr({ kind: 'number', value: negateFix(e.expr.value), line: e.line });
          return;
        }
        this.emit('(-');
        this.expr(e.expr);
        this.emit(')');
        return;
      case 'not':
        this.emit('(not');
        this.expr(e.expr);
        this.emit(')');
        return;
      case '#':
        // Lua's # yields an integer subtype; keep all numbers floats.
        this.emit('(#');
        this.expr(e.expr);
        this.emit('+0.0)');
        return;
      case '~':
        return this.helperCall(HELPERS.bnot, [e.expr]);
      case '@':
        return this.helperCall(HELPERS.peek, [e.expr]);
      case '%':
        return this.helperCall(HELPERS.peek2, [e.expr]);
      case '$':
        return this.helperCall(HELPERS.peek4, [e.expr]);
    }
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>) {
    const helper = BINARY_HELPER[e.op];
    if (helper) return this.helperCall(helper, [e.left, e.right]);
    const op = e.op === '\\' ? '//' : e.op;
    this.emit('(');
    this.expr(e.left);
    this.emit(op === 'and' || op === 'or' ? ` ${op} ` : op);
    this.needSpace = false;
    this.expr(e.right);
    this.emit(')');
  }
}

function startsWithParen(e: Expr): boolean {
  switch (e.kind) {
    case 'paren':
      return true;
    case 'call':
      return startsWithParen(e.fn);
    case 'method':
    case 'member':
    case 'index':
      return startsWithParen(e.obj);
    default:
      return false;
  }
}

/** Negates a 16.16 value with wrap-around (-(-32768) == -32768). */
function negateFix(v: number): number {
  const raw = Math.round(v * 65536);
  const neg = (-raw) | 0;
  return neg / 65536;
}

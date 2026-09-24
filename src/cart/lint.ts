/**
 * Basic lint for PICO-8 code: globals that are read but never assigned
 * anywhere (and aren't API), and locals that are never used.
 */
import { BUILTIN_GLOBALS } from '../runtime/api/docs';
import type { Block, Expr, FuncBody, Stmt } from '../runtime/preprocess/ast';
import { ParseError, parse } from '../runtime/preprocess/parser';
import { toP8String, fromP8String } from './p8scii';

export interface LintIssue {
  line: number;
  kind: 'undefined-global' | 'unused-local' | 'syntax';
  name: string;
  message: string;
}

interface LocalVar {
  name: string;
  line: number;
  used: boolean;
  /** Parameters and loop variables are reported less aggressively. */
  kind: 'local' | 'param' | 'loop' | 'function';
}

class Scope {
  vars = new Map<string, LocalVar>();
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): LocalVar | undefined {
    return this.vars.get(name) ?? this.parent?.lookup(name);
  }
}

export function lint(code: string): LintIssue[] {
  let ast: Block;
  try {
    ast = parse(toP8String(code));
  } catch (e) {
    if (e instanceof ParseError) return [{ line: e.line, kind: 'syntax', name: '', message: e.message }];
    throw e;
  }

  const assignedGlobals = new Set<string>();
  const globalReads: { name: string; line: number }[] = [];
  const locals: LocalVar[] = [];

  const declare = (scope: Scope, name: string, line: number, kind: LocalVar['kind']) => {
    const v: LocalVar = { name, line, used: false, kind };
    scope.vars.set(name, v);
    locals.push(v);
  };

  const readName = (scope: Scope, name: string, line: number) => {
    const v = scope.lookup(name);
    if (v) v.used = true;
    else globalReads.push({ name, line });
  };

  const assignName = (scope: Scope, name: string) => {
    if (!scope.lookup(name)) assignedGlobals.add(name);
  };

  const expr = (scope: Scope, e: Expr): void => {
    switch (e.kind) {
      case 'name':
        readName(scope, e.name, e.line);
        break;
      case 'index':
        expr(scope, e.obj);
        expr(scope, e.key);
        break;
      case 'member':
        expr(scope, e.obj);
        break;
      case 'call':
        expr(scope, e.fn);
        e.args.forEach((a) => expr(scope, a));
        break;
      case 'method':
        expr(scope, e.obj);
        e.args.forEach((a) => expr(scope, a));
        break;
      case 'function':
        func(scope, e.func);
        break;
      case 'table':
        for (const f of e.fields) {
          if (f.kind === 'keyed') expr(scope, f.key);
          expr(scope, f.value);
        }
        break;
      case 'binary':
        expr(scope, e.left);
        expr(scope, e.right);
        break;
      case 'unary':
      case 'paren':
        expr(scope, e.expr);
        break;
      default:
        break;
    }
  };

  const target = (scope: Scope, t: Expr) => {
    if (t.kind === 'name') assignName(scope, t.name);
    else expr(scope, t);
  };

  const func = (scope: Scope, f: FuncBody) => {
    const inner = new Scope(scope);
    f.params.forEach((p) => declare(inner, p, f.line, 'param'));
    block(inner, f.body);
  };

  const block = (parent: Scope, b: Block) => {
    const scope = new Scope(parent);
    for (const s of b.stmts) stmt(scope, s);
  };

  const stmt = (scope: Scope, s: Stmt): void => {
    switch (s.kind) {
      case 'local':
        s.values.forEach((v) => expr(scope, v));
        s.names.forEach((n) => declare(scope, n, s.line, 'local'));
        break;
      case 'assign':
        s.values.forEach((v) => expr(scope, v));
        s.targets.forEach((t) => {
          // compound assignment reads its target too
          if (t.kind === 'name' && s.values.some((v) => v.kind === 'binary' && v.left === t)) readName(scope, t.name, t.line);
          target(scope, t);
        });
        break;
      case 'callstmt':
        expr(scope, s.call);
        break;
      case 'do':
        block(scope, s.body);
        break;
      case 'while':
        expr(scope, s.cond);
        block(scope, s.body);
        break;
      case 'repeat': {
        // `until` sees the body's locals
        const inner = new Scope(scope);
        for (const st of s.body.stmts) stmt(inner, st);
        expr(inner, s.cond);
        break;
      }
      case 'if':
        for (const c of s.clauses) {
          expr(scope, c.cond);
          block(scope, c.body);
        }
        if (s.orelse) block(scope, s.orelse);
        break;
      case 'fornum': {
        expr(scope, s.start);
        expr(scope, s.limit);
        if (s.step) expr(scope, s.step);
        const inner = new Scope(scope);
        declare(inner, s.var, s.line, 'loop');
        block(inner, s.body);
        break;
      }
      case 'forin': {
        s.exprs.forEach((e) => expr(scope, e));
        const inner = new Scope(scope);
        s.names.forEach((n) => declare(inner, n, s.line, 'loop'));
        block(inner, s.body);
        break;
      }
      case 'function':
        if (s.path.length === 1 && !s.method) assignName(scope, s.path[0]!);
        else readName(scope, s.path[0]!, s.line);
        func(scope, s.func);
        break;
      case 'localfunction':
        declare(scope, s.name, s.line, 'function');
        func(scope, s.func);
        break;
      case 'return':
        s.values.forEach((v) => expr(scope, v));
        break;
      default:
        break;
    }
  };

  block(new Scope(null), ast);

  const issues: LintIssue[] = [];
  const reported = new Set<string>();
  for (const r of globalReads) {
    if (assignedGlobals.has(r.name) || BUILTIN_GLOBALS.has(r.name)) continue;
    const key = `${r.name}:${r.line}`;
    if (reported.has(key)) continue;
    reported.add(key);
    const name = fromP8String(r.name);
    issues.push({ line: r.line, kind: 'undefined-global', name, message: `'${name}' is never assigned (typo or missing definition?)` });
  }
  for (const v of locals) {
    if (v.used || v.kind === 'param' || v.kind === 'loop' || v.name === '_' || v.name.startsWith('_')) continue;
    const name = fromP8String(v.name);
    issues.push({ line: v.line, kind: 'unused-local', name, message: `local '${name}' is never used` });
  }
  return issues.sort((a, b) => a.line - b.line);
}

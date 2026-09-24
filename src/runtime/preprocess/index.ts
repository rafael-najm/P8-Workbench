/**
 * PICO-8 Lua -> Lua 5.4 preprocessor.
 *
 * Pipeline: unicode source -> P8SCII string -> lexer -> parser (AST) -> codegen.
 */
import { toP8String } from '../../cart/p8scii';
import { generate } from './codegen';
import type { Stmt } from './ast';
import { ParseError, parse } from './parser';

export { HELPERS, luaIdent } from './codegen';
export { ParseError } from './parser';

export interface PreprocessResult {
  lua: string;
  /** lineMap[generatedLine - 1] = original source line. */
  lineMap: number[];
}

export interface PreprocessError {
  message: string;
  /** 1-based line in the original PICO-8 source. */
  line: number;
}

export type PreprocessOutcome = ({ ok: true } & PreprocessResult) | { ok: false; error: PreprocessError };

export interface PreprocessOptions {
  /**
   * Keep only top-level definitions (functions, locals, and assignments of
   * function values), for hot reload: redefines code without re-running
   * top-level statements that would reset game state.
   */
  definitionsOnly?: boolean;
}

function isDefinition(s: Stmt): boolean {
  switch (s.kind) {
    case 'function':
    case 'localfunction':
    case 'local':
      return true;
    case 'assign':
      return s.values.length > 0 && s.values.every((v) => v.kind === 'function');
    default:
      return false;
  }
}

export function preprocess(code: string, options: PreprocessOptions = {}): PreprocessOutcome {
  try {
    const ast = parse(toP8String(code));
    if (options.definitionsOnly) ast.stmts = ast.stmts.filter(isDefinition);
    const { code: lua, lineMap } = generate(ast);
    return { ok: true, lua, lineMap };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: { message: e.message, line: e.line } };
    throw e;
  }
}

/** Maps a line of generated Lua back to the PICO-8 source line. */
export function mapLine(lineMap: readonly number[], generatedLine: number): number {
  return lineMap[generatedLine - 1] ?? generatedLine;
}

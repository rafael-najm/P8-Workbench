/**
 * PICO-8 Lua -> Lua 5.4 preprocessor.
 *
 * Pipeline: unicode source -> P8SCII string -> lexer -> parser (AST) -> codegen.
 */
import { toP8String } from '../../cart/p8scii';
import { generate } from './codegen';
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

export function preprocess(code: string): PreprocessOutcome {
  try {
    const ast = parse(toP8String(code));
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

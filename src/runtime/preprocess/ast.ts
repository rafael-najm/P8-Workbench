/** AST for PICO-8 Lua. Every node carries the 1-based source line it starts on. */

export type BinaryOp =
  | 'or' | 'and'
  | '<' | '>' | '<=' | '>=' | '==' | '~='
  | '|' | '^^' | '&'
  | '<<' | '>>' | '>>>' | '<<>' | '>><'
  | '..'
  | '+' | '-'
  | '*' | '/' | '\\' | '%'
  | '^';

export type UnaryOp = '-' | 'not' | '#' | '~' | '@' | '%' | '$';

interface NodeBase {
  line: number;
}

export type Expr =
  | (NodeBase & { kind: 'nil' | 'true' | 'false' | 'vararg' })
  | (NodeBase & { kind: 'number'; value: number })
  /** `value` is a p8 string (each char code is a P8SCII byte). */
  | (NodeBase & { kind: 'string'; value: string })
  | (NodeBase & { kind: 'name'; name: string })
  | (NodeBase & { kind: 'index'; obj: Expr; key: Expr })
  | (NodeBase & { kind: 'member'; obj: Expr; name: string })
  | (NodeBase & { kind: 'call'; fn: Expr; args: Expr[] })
  | (NodeBase & { kind: 'method'; obj: Expr; name: string; args: Expr[] })
  | (NodeBase & { kind: 'function'; func: FuncBody })
  | (NodeBase & { kind: 'table'; fields: TableField[]; endLine: number })
  | (NodeBase & { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr })
  | (NodeBase & { kind: 'unary'; op: UnaryOp; expr: Expr })
  | (NodeBase & { kind: 'paren'; expr: Expr });

export type ExprOf<K extends Expr['kind']> = Extract<Expr, { kind: K }>;

export type TableField =
  | { kind: 'pos'; value: Expr }
  | { kind: 'named'; name: string; value: Expr; line: number }
  | { kind: 'keyed'; key: Expr; value: Expr; line: number };

export interface FuncBody {
  params: string[];
  vararg: boolean;
  body: Block;
  line: number;
  endLine: number;
}

export interface Block {
  stmts: Stmt[];
}

export type Stmt =
  | (NodeBase & { kind: 'local'; names: string[]; values: Expr[] })
  | (NodeBase & { kind: 'assign'; targets: Expr[]; values: Expr[] })
  | (NodeBase & { kind: 'callstmt'; call: Expr })
  | (NodeBase & { kind: 'do'; body: Block; endLine: number })
  | (NodeBase & { kind: 'while'; cond: Expr; body: Block; endLine: number })
  | (NodeBase & { kind: 'repeat'; body: Block; cond: Expr; untilLine: number })
  | (NodeBase & {
      kind: 'if';
      clauses: { cond: Expr; body: Block; line: number }[];
      orelse: Block | null;
      elseLine: number;
      endLine: number;
    })
  | (NodeBase & { kind: 'fornum'; var: string; start: Expr; limit: Expr; step: Expr | null; body: Block; endLine: number })
  | (NodeBase & { kind: 'forin'; names: string[]; exprs: Expr[]; body: Block; endLine: number })
  | (NodeBase & { kind: 'function'; path: string[]; method: string | null; func: FuncBody })
  | (NodeBase & { kind: 'localfunction'; name: string; func: FuncBody })
  | (NodeBase & { kind: 'return'; values: Expr[] })
  | (NodeBase & { kind: 'break' })
  | (NodeBase & { kind: 'goto'; label: string })
  | (NodeBase & { kind: 'label'; label: string });

export type StmtOf<K extends Stmt['kind']> = Extract<Stmt, { kind: K }>;

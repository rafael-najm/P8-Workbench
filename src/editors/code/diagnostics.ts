/** Editor markers: syntax errors, lint and runtime errors (source-mapped lines). */
import { lint } from '../../cart/lint';
import type { RuntimeError } from '../../runtime/machine';
import { monaco } from './monaco';

const OWNER_STATIC = 'pico8-static';
const OWNER_RUNTIME = 'pico8-runtime';

function lineRange(model: monaco.editor.ITextModel, line: number) {
  const l = Math.max(1, Math.min(model.getLineCount(), line));
  const content = model.getLineContent(l);
  const first = content.search(/\S/);
  return { startLineNumber: l, endLineNumber: l, startColumn: first >= 0 ? first + 1 : 1, endColumn: content.length + 1 };
}

/** Syntax errors (from the parser) and lint warnings. */
export function updateStaticDiagnostics(model: monaco.editor.ITextModel): void {
  const markers: monaco.editor.IMarkerData[] = lint(model.getValue()).map((issue) => ({
    ...lineRange(model, issue.line),
    severity: issue.kind === 'syntax' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: issue.message,
    source: issue.kind === 'syntax' ? 'syntax' : 'lint',
    tags: issue.kind === 'unused-local' ? [monaco.MarkerTag.Unnecessary] : undefined,
  }));
  monaco.editor.setModelMarkers(model, OWNER_STATIC, markers);
}

let errorDecorations: monaco.editor.IEditorDecorationsCollection | null = null;

/** Runtime error marker + line highlight; pass null to clear. */
export function showRuntimeError(editor: monaco.editor.IStandaloneCodeEditor, err: RuntimeError | null, reveal = true): void {
  const model = editor.getModel();
  if (!model) return;
  errorDecorations?.clear();
  if (!err || err.line === null) {
    monaco.editor.setModelMarkers(model, OWNER_RUNTIME, []);
    return;
  }
  const range = lineRange(model, err.line);
  monaco.editor.setModelMarkers(model, OWNER_RUNTIME, [
    { ...range, severity: monaco.MarkerSeverity.Error, message: `${err.kind === 'compile' ? 'syntax error' : 'runtime error'}: ${err.message}`, source: 'runtime' },
  ]);
  errorDecorations = editor.createDecorationsCollection([
    { range: new monaco.Range(range.startLineNumber, 1, range.startLineNumber, 1), options: { isWholeLine: true, className: 'p8-error-line', glyphMarginClassName: 'p8-error-glyph' } },
  ]);
  if (reveal) editor.revealLineInCenterIfOutsideViewport(range.startLineNumber);
}

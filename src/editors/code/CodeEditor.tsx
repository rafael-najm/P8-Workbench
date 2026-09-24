import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { useProject } from '../../store/project';
import { useRuntime } from '../../store/runtime';
import { showRuntimeError, updateStaticDiagnostics } from './diagnostics';
import { LANGUAGE_ID, monaco, setupMonaco, THEME_ID } from './monaco';

setupMonaco();

/** Shared handle so commands (go to line, insert text) can reach the editor. */
export const editorRef: { current: monaco.editor.IStandaloneCodeEditor | null } = { current: null };

export function revealLine(line: number): void {
  const ed = editorRef.current;
  if (!ed) return;
  ed.revealLineInCenter(line);
  ed.setPosition({ lineNumber: line, column: 1 });
  ed.focus();
}

export function CodeEditor() {
  const projectId = useProject((s) => s.id);
  const codeRev = useProject((s) => s.revisions.code);
  const error = useRuntime((s) => s.error);
  const lintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingExternal = useRef(false);

  // External code changes (agent, undo, version restore) -> editor model.
  useEffect(() => {
    const ed = editorRef.current;
    const code = useProject.getState().cart?.code ?? '';
    if (!ed) return;
    const model = ed.getModel();
    if (model && model.getValue() !== code) {
      applyingExternal.current = true;
      // pushEditOperations keeps the editor's own undo stack usable
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
      applyingExternal.current = false;
      updateStaticDiagnostics(model);
    }
  }, [codeRev, projectId]);

  useEffect(() => {
    if (editorRef.current) showRuntimeError(editorRef.current, error);
  }, [error]);

  const onMount: OnMount = (ed) => {
    editorRef.current = ed;
    const model = ed.getModel();
    if (model) updateStaticDiagnostics(model);
    ed.onDidChangeModelContent(() => {
      if (applyingExternal.current) return;
      useProject.getState().setCode(ed.getValue());
      if (lintTimer.current) clearTimeout(lintTimer.current);
      lintTimer.current = setTimeout(() => {
        const m = ed.getModel();
        if (m) updateStaticDiagnostics(m);
      }, 300);
    });
  };

  return (
    <div className="h-full w-full" data-testid="code-editor">
      <Editor
        key={projectId ?? 'none'}
        defaultValue={useProject.getState().cart?.code ?? ''}
        language={LANGUAGE_ID}
        theme={THEME_ID}
        onMount={onMount}
        loading={<div className="p-6 text-sm text-muted">loading editor…</div>}
        options={{
          fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
          fontSize: 14,
          lineHeight: 21,
          fontLigatures: false,
          minimap: { enabled: true, renderCharacters: false, scale: 1 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          tabSize: 1,
          insertSpaces: true,
          detectIndentation: true,
          renderWhitespace: 'none',
          glyphMargin: true,
          codeLens: true,
          padding: { top: 12, bottom: 12 },
          automaticLayout: true,
          unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
        }}
      />
    </div>
  );
}

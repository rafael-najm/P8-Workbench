/** Command registry: every action with its shortcut, used by the palette and the keyboard. */
import { editorRef } from '../editors/code/CodeEditor';
import { saveSettings, loadSettings } from '../persistence/settings';
import { useProject } from '../store/project';
import { useRuntime } from '../store/runtime';
import { PANEL_IDS, useUi } from '../store/ui';
import { exportCart, newProject, pickAndImport, restartGame, runGame, saveProject } from './actions';
import { game } from './game/controller';
import { PANELS } from './panels/registry';

export interface Command {
  id: string;
  title: string;
  group: string;
  /** Display form, e.g. "Ctrl+R". */
  shortcut?: string;
  run(): void | Promise<void>;
}

export function getCommands(): Command[] {
  const ui = useUi.getState();
  const cmds: Command[] = [
    { id: 'run', title: 'Run / reload game', group: 'Game', shortcut: 'Ctrl+R', run: runGame },
    { id: 'restart', title: 'Run from start (full restart)', group: 'Game', shortcut: 'Ctrl+Enter', run: restartGame },
    { id: 'pause', title: 'Play / pause', group: 'Game', shortcut: 'F5', run: () => (useRuntime.getState().status === 'idle' || useRuntime.getState().status === 'stopped' ? runGame() : game.togglePause()) },
    { id: 'step', title: 'Step one frame', group: 'Game', shortcut: 'F6', run: () => game.step(1) },
    { id: 'step10', title: 'Step 10 frames', group: 'Game', run: () => game.step(10) },
    { id: 'stop', title: 'Stop game', group: 'Game', run: () => game.stop() },
    { id: 'speed-half', title: 'Speed 0.5x', group: 'Game', run: () => game.setSpeed(0.5) },
    { id: 'speed-1', title: 'Speed 1x', group: 'Game', run: () => game.setSpeed(1) },
    { id: 'speed-2', title: 'Speed 2x', group: 'Game', run: () => game.setSpeed(2) },
    { id: 'crt', title: 'Toggle CRT effect', group: 'Game', run: () => saveSettings({ crt: !loadSettings().crt }) && window.dispatchEvent(new Event('p8-settings')) },
    { id: 'save', title: 'Save (and hot reload)', group: 'Project', shortcut: 'Ctrl+S', run: saveProject },
    { id: 'new', title: 'New cart', group: 'Project', run: newProject },
    { id: 'import', title: 'Import .p8…', group: 'Project', run: pickAndImport },
    { id: 'export', title: 'Export .p8', group: 'Project', shortcut: 'Ctrl+Shift+E', run: exportCart },
    { id: 'projects', title: 'Open projects', group: 'Project', shortcut: 'Ctrl+O', run: () => ui.toggle('projects') },
    { id: 'home', title: 'Home screen', group: 'Workspace', run: () => { window.dispatchEvent(new Event('p8-home')); } },
    { id: 'palette', title: 'Command palette', group: 'Workspace', shortcut: 'Ctrl+K', run: () => ui.setPalette(true) },
    { id: 'settings', title: 'Settings', group: 'Workspace', shortcut: 'Ctrl+,', run: () => ui.setSettings(true) },
    { id: 'layout-reset', title: 'Reset panel layout', group: 'Workspace', run: () => ui.resetLayout() },
    { id: 'focus-editor', title: 'Focus code editor', group: 'Workspace', shortcut: 'Ctrl+E', run: () => editorRef.current?.focus() },
    { id: 'format-find', title: 'Find in code', group: 'Code', shortcut: 'Ctrl+F', run: () => editorRef.current?.getAction('actions.find')?.run() },
    { id: 'goto-line', title: 'Go to line…', group: 'Code', shortcut: 'Ctrl+G', run: () => editorRef.current?.getAction('editor.action.gotoLine')?.run() },
    { id: 'goto-symbol', title: 'Go to function…', group: 'Code', shortcut: 'Ctrl+Shift+O', run: () => editorRef.current?.getAction('editor.action.quickOutline')?.run() },
  ];
  for (const id of PANEL_IDS) {
    const def = PANELS.get(id);
    if (!def) continue;
    cmds.push({ id: `panel-${id}`, title: `Toggle ${def.title} panel`, group: 'Panels', shortcut: def.shortcut, run: () => ui.toggle(id) });
  }
  if (useProject.getState().cart) {
    cmds.push({ id: 'rename', title: 'Rename cart…', group: 'Project', run: () => {
      const name = prompt('Cart name', useProject.getState().name);
      if (name) useProject.getState().rename(name.trim());
    } });
  }
  return cmds;
}

function shortcutOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  if (e.code === 'Backquote') key = '`';
  if (e.code.startsWith('Digit')) key = e.code.slice(5);
  parts.push(key);
  return parts.join('+');
}

/** Global shortcut handler (capture phase, so it also works inside Monaco). */
export function handleShortcut(e: KeyboardEvent): boolean {
  const combo = shortcutOf(e);
  if (combo === 'Escape') {
    const ui = useUi.getState();
    if (ui.paletteOpen) ui.setPalette(false);
    else if (ui.settingsOpen) ui.setSettings(false);
    else if (!ui.closeTop()) return false;
    e.preventDefault();
    return true;
  }
  const cmd = getCommands().find((c) => c.shortcut === combo);
  if (!cmd) return false;
  e.preventDefault();
  e.stopPropagation();
  void cmd.run();
  return true;
}

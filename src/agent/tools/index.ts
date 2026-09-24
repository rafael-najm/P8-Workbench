import type { ToolDef } from '../types';
import { cartStats, editCode, readCode, searchCode, writeCode } from './code';
import { evalLua, playtestTool, readGlobals, runGame, screenshot, screenshots } from './exec';
import { getMap, getSprite, getSpritesheetImage, setFlags, setMap, setSprite } from './gfx';
import { getSfx, playSfx, setMusic, setSfx } from './sound';

export const TOOLS = [readCode, searchCode, editCode, writeCode, cartStats, getSprite, setSprite, getSpritesheetImage, setFlags, getMap, setMap,
  getSfx, setSfx, setMusic, playSfx, runGame, screenshot, screenshots, readGlobals, evalLua, playtestTool] as unknown as ToolDef[];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolSchemas() {
  return TOOLS.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

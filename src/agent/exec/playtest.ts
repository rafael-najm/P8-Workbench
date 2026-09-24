/**
 * Automated playtests: run bots headless and collect metrics (time to game
 * over, errors, time per screen, table peaks, recorded variables).
 */
import type { Cart } from '../../cart/types';
import { createHeadless } from '../../runtime/headless';
import type { Machine, RuntimeError } from '../../runtime/machine';

export interface PlaytestArgs {
  strategy: 'random' | 'hold_fire_track' | 'custom';
  frames: number;
  seeds?: number[];
  /** hold_fire_track: global holding the enemy list (auto-detected if omitted). */
  enemies?: string;
  /** hold_fire_track: global holding the player (needs .x, .y). */
  player?: string;
  /** custom: PICO-8 Lua source defining `function bot(state)` returning a list of button names or a bitmask. */
  bot?: string;
  /** Global tables whose size to monitor (auto-detected if omitted). */
  track?: string[];
  /** Expressions to sample over time (e.g. "score", "p.hp", "#enemies"). */
  record?: string[];
  /** Frames between samples of `record` (default 30). */
  sample_every?: number;
  /** Lua expression that is true when the game is over (default: screen name contains over/dead/lose). */
  game_over?: string;
}

export interface SeedReport {
  seed: number;
  frames_run: number;
  error: { message: string; line: number | null; frame: number } | null;
  game_over_frame: number | null;
  screens: { screen: string; frames: number }[];
  transitions: { frame: number; to: string }[];
  table_peaks: Record<string, { max: number; avg: number }>;
  series: Record<string, { first: unknown; last: unknown; min?: number; max?: number; samples: unknown[] }>;
  printh_lines: number;
  max_cpu: number;
}

export interface PlaytestReport {
  strategy: string;
  seeds: SeedReport[];
  summary: {
    runs: number;
    errors: number;
    avg_frames_to_game_over: number | null;
    game_overs: number;
    max_cpu: number;
  };
}

/** Helpers installed into the cart env (PICO-8 Lua). */
const PROBE = `
__pt_btn={left=0,right=1,up=2,down=3,o=4,x=5,z=4,c=4,n=4,v=5,m=5,fire=5,fire2=4,["⬅️"]=0,["➡️"]=1,["⬆️"]=2,["⬇️"]=3,["🅾️"]=4,["❎"]=5}
__pt_skip={}
for k,v in pairs(_G) do __pt_skip[k]=true end
__pt_rev,__pt_revt={},-999
function __pt_screen(f)
 if f-__pt_revt>=30 then
  __pt_rev={} __pt_revt=f
  for k,v in pairs(_G) do
   if type(v)=="function" and type(k)=="string" and k~="_update" and k~="_update60" and k~="_draw" and sub(k,1,4)~="__pt" then __pt_rev[v]=k end
  end
 end
 local s=""
 for name in all(__pt_vars) do
  local v=_G[name]
  if v~=nil then
   local d=type(v)=="function" and (__pt_rev[v] or "?") or tostr(v)
   s=s..(s=="" and "" or ",")..name.."="..d
  end
 end
 return s
end
function __pt_counts()
 local s=""
 for name in all(__pt_tables) do
  local t=_G[name]
  s=s..(type(t)=="table" and #t or -1)..","
 end
 return s
end
function __pt_mask(r)
 if type(r)=="number" then return r end
 local m=0
 if type(r)=="table" then for b in all(r) do local i=__pt_btn[b] if i then m=m|(1<<i) end end end
 return m
end
function __pt_find(names,need)
 for n in all(names) do local v=_G[n] if type(v)=="table" and need(v) then return n end end
end
function __pt_track(f,alt)
 local p=__pt_player and _G[__pt_player]
 local es=__pt_enemies and _G[__pt_enemies]
 local m=0
 if f%16<6 then m=32 elseif alt and f%16>=8 and f%16<14 then m=16 end
 if type(p)=="table" and p.x and type(es)=="table" then
  local best,bd=nil,32767
  for e in all(es) do
   if type(e)=="table" and e.x then
    local d=abs(e.x-p.x)+abs((e.y or 0)-(p.y or 0))/4
    if d<bd then best,bd=e,d end
   end
  end
  if best then
   if best.x<p.x-2 then m=m|1 elseif best.x>p.x+2 then m=m|2 end
  end
 end
 return m
end
`;

const SCREEN_VAR_RE = /^(upd|update|drw|draw|state|scene|mode|screen|gamestate|game_state|gs|st|stage|phase|_update|_update60)$/;
const GAME_OVER_RE = /over|dead|death|lose|lost|fail|gameover/i;

function rng(seed: number) {
  let s = seed * 2654435761 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function luaStringList(names: string[]): string {
  return `{${names.map((n) => JSON.stringify(n)).join(',')}}`;
}

function evalOrThrow(m: Machine, code: string): string {
  const r = m.eval(code);
  if (!r.ok) throw new Error(`${r.error.message}${r.error.line ? ` (line ${r.error.line})` : ''}`);
  return r.json;
}

async function runSeed(cart: Cart, args: PlaytestArgs, seed: number): Promise<SeedReport> {
  const printh: string[] = [];
  const m = await createHeadless(cart, { seed, printh, timeoutSeconds: 2 });
  const report: SeedReport = {
    seed,
    frames_run: 0,
    error: null,
    game_over_frame: null,
    screens: [],
    transitions: [],
    table_peaks: {},
    series: {},
    printh_lines: 0,
    max_cpu: 0,
  };
  try {
    // boot + one frame so globals exist
    m.step(1);
    if (m.status !== 'running') {
      if (m.error) report.error = { message: m.error.message, line: m.error.line, frame: m.frame };
      return report;
    }
    evalOrThrow(m, PROBE.replace(/\n/g, '\n'));
    const globals = m.globals(undefined, 1, 4);
    const names = Object.keys(globals);
    const fnNames = m.functionNames();
    const screenVars = [...names, ...fnNames, '_update', '_update60'].filter((n) => SCREEN_VAR_RE.test(n));
    // de-duplicate, keep order
    evalOrThrow(m, `__pt_vars=${luaStringList([...new Set(screenVars)])}`);

    let tracked = args.track;
    if (!tracked) {
      tracked = names.filter((n) => Array.isArray(globals[n]) || (typeof globals[n] === 'string' && /^\[table: \d+ items\]$/.test(globals[n] as string)));
    }
    evalOrThrow(m, `__pt_tables=${luaStringList(tracked)}`);

    if (args.strategy === 'hold_fire_track') {
      const player = args.player ?? JSON.parse(evalOrThrow(m, `__pt_find(${luaStringList(['p', 'pl', 'plr', 'player', 'ship', 'hero', 'me'])},function(v) return v.x~=nil end)`));
      const enemies = args.enemies ?? JSON.parse(evalOrThrow(m, `__pt_find(${luaStringList(['enemies', 'enms', 'enemy', 'es', 'foes', 'ens', 'mobs', 'baddies', 'aliens', 'en'])},function(v) return type(v[1])=="table" or #v==0 end)`));
      evalOrThrow(m, `__pt_player=${player ? JSON.stringify(player) : 'nil'} __pt_enemies=${enemies ? JSON.stringify(enemies) : 'nil'}`);
    }
    if (args.strategy === 'custom') {
      if (!args.bot) throw new Error('custom strategy needs `bot` (PICO-8 Lua defining function bot(state))');
      evalOrThrow(m, args.bot.includes('function bot') ? args.bot : `function bot(state) ${args.bot} end`);
      evalOrThrow(m, '__pt_state={}');
    }
    const records = args.record ?? [];
    const recordFns = records.map((expr, i) => {
      evalOrThrow(m, `function __pt_rec${i}() return ${expr} end`);
      return `__pt_rec${i}`;
    });
    if (args.game_over) evalOrThrow(m, `function __pt_over() return ${args.game_over} end`);

    const rand = rng(seed);
    let mask = 0;
    let nextChange = 0;
    let screen = '';
    let screenStart = 0;
    const screenTime = new Map<string, number>();
    const peak: number[] = tracked.map(() => 0);
    const sum: number[] = tracked.map(() => 0);
    const sampleEvery = Math.max(1, args.sample_every ?? 30);
    const samples: unknown[][] = records.map(() => []);

    const probeScreen = () => {
      const r = m.callFunction('__pt_screen', m.frame);
      return r.ok && typeof r.values[0] === 'string' ? r.values[0] : '';
    };

    for (let i = 0; i < args.frames && m.status === 'running'; i++) {
      const f = m.frame;
      if (args.strategy === 'random') {
        if (f >= nextChange) {
          mask = Math.floor(rand() * 64);
          nextChange = f + 1 + Math.floor(rand() * 20);
        }
      } else if (args.strategy === 'hold_fire_track') {
        // stuck on one screen for 5s (e.g. a title that wants 🅾️): also pulse 🅾️
        const r = m.callFunction('__pt_track', f, m.frame - screenStart > 300);
        mask = r.ok && typeof r.values[0] === 'number' ? r.values[0] : 0;
      } else {
        evalOrThrow(m, `__pt_state.frame=${f}`);
        const r = m.eval('__pt_mask(bot(__pt_state))');
        if (!r.ok) {
          report.error = { message: `bot error: ${r.error.message}`, line: null, frame: f };
          break;
        }
        mask = Number(JSON.parse(r.json)) || 0;
      }
      m.input.setMask(0, mask);
      m.step(1);
      report.frames_run++;
      report.max_cpu = Math.max(report.max_cpu, m.cpu);
      if (m.status !== 'running') break;

      const sc = probeScreen();
      if (sc !== screen) {
        if (screen) screenTime.set(screen, (screenTime.get(screen) ?? 0) + (m.frame - screenStart));
        if (report.transitions.length < 30) report.transitions.push({ frame: m.frame, to: sc });
        screen = sc;
        screenStart = m.frame;
        if (report.game_over_frame === null && !args.game_over && GAME_OVER_RE.test(sc)) report.game_over_frame = m.frame;
      }
      if (args.game_over && report.game_over_frame === null) {
        const r = m.callFunction('__pt_over');
        if (r.ok && r.values[0]) report.game_over_frame = m.frame;
      }
      if (tracked.length) {
        const r = m.callFunction('__pt_counts');
        if (r.ok && typeof r.values[0] === 'string') {
          r.values[0].split(',').forEach((v, k) => {
            if (k >= tracked!.length) return;
            const n = Number(v);
            peak[k] = Math.max(peak[k]!, n);
            sum[k]! += Math.max(0, n);
          });
        }
      }
      if (recordFns.length && report.frames_run % sampleEvery === 0) {
        recordFns.forEach((fn, k) => {
          const r = m.eval(`${fn}()`);
          samples[k]!.push(r.ok ? JSON.parse(r.json) : null);
        });
      }
    }
    if (screen) screenTime.set(screen, (screenTime.get(screen) ?? 0) + (m.frame - screenStart));
    report.screens = [...screenTime].map(([s, frames]) => ({ screen: s, frames })).sort((a, b) => b.frames - a.frames);
    tracked.forEach((name, k) => {
      if (peak[k]! >= 0) report.table_peaks[name] = { max: peak[k]!, avg: Math.round((sum[k]! / Math.max(1, report.frames_run)) * 10) / 10 };
    });
    records.forEach((expr, k) => {
      const all = samples[k]!;
      const nums = all.filter((v): v is number => typeof v === 'number');
      // keep at most 20 evenly spaced samples
      const step = Math.max(1, Math.ceil(all.length / 20));
      report.series[expr] = {
        first: all[0],
        last: all.at(-1),
        min: nums.length ? Math.min(...nums) : undefined,
        max: nums.length ? Math.max(...nums) : undefined,
        samples: all.filter((_, i) => i % step === 0),
      };
    });
    if ((m.status as string) === 'error' && m.error) report.error = errorAt(m.error, m.frame);
  } catch (e) {
    report.error = { message: e instanceof Error ? e.message : String(e), line: null, frame: m.frame };
  } finally {
    report.printh_lines = printh.length;
    m.dispose();
  }
  return report;
}

function errorAt(err: RuntimeError, frame: number) {
  return { message: err.message, line: err.line, frame };
}

export async function playtest(cart: Cart, args: PlaytestArgs): Promise<PlaytestReport> {
  const seeds = args.seeds?.length ? args.seeds.slice(0, 8) : [1, 2, 3];
  const reports: SeedReport[] = [];
  for (const seed of seeds) reports.push(await runSeed(cart, args, seed));
  const overs = reports.filter((r) => r.game_over_frame !== null);
  return {
    strategy: args.strategy,
    seeds: reports,
    summary: {
      runs: reports.length,
      errors: reports.filter((r) => r.error).length,
      game_overs: overs.length,
      avg_frames_to_game_over: overs.length ? Math.round(overs.reduce((s, r) => s + r.game_over_frame!, 0) / overs.length) : null,
      max_cpu: Math.round(Math.max(...reports.map((r) => r.max_cpu)) * 100) / 100,
    },
  };
}

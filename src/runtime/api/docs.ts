/**
 * PICO-8 API reference: one source of truth for autocomplete, hover, lint
 * (known globals) and the agent's system prompt.
 */
export interface ApiDoc {
  name: string;
  /** Signature, PICO-8 style: optional params in brackets. */
  sig: string;
  desc: string;
  category: 'graphics' | 'map' | 'text' | 'input' | 'sound' | 'math' | 'tables' | 'strings' | 'memory' | 'system' | 'callbacks' | 'lua';
  /** Parameter names whose value is a palette color (for color hovers). */
  colorParams?: number[];
}

export const API_DOCS: ApiDoc[] = [
  // graphics
  { name: 'cls', sig: 'cls([col])', desc: 'Clear the screen to col (default 0) and reset the cursor and clip rect.', category: 'graphics', colorParams: [0] },
  { name: 'pset', sig: 'pset(x, y, [col])', desc: 'Set a pixel.', category: 'graphics', colorParams: [2] },
  { name: 'pget', sig: 'pget(x, y)', desc: 'Color of a screen pixel.', category: 'graphics' },
  { name: 'line', sig: 'line(x0, y0, [x1, y1], [col])', desc: 'Draw a line. line(x1,y1) continues from the last endpoint; line() resets it.', category: 'graphics', colorParams: [4] },
  { name: 'rect', sig: 'rect(x0, y0, x1, y1, [col])', desc: 'Rectangle outline (inclusive corners).', category: 'graphics', colorParams: [4] },
  { name: 'rectfill', sig: 'rectfill(x0, y0, x1, y1, [col])', desc: 'Filled rectangle.', category: 'graphics', colorParams: [4] },
  { name: 'circ', sig: 'circ(x, y, [r], [col])', desc: 'Circle outline (r default 4).', category: 'graphics', colorParams: [3] },
  { name: 'circfill', sig: 'circfill(x, y, [r], [col])', desc: 'Filled circle.', category: 'graphics', colorParams: [3] },
  { name: 'oval', sig: 'oval(x0, y0, x1, y1, [col])', desc: 'Ellipse outline inside a bounding box.', category: 'graphics', colorParams: [4] },
  { name: 'ovalfill', sig: 'ovalfill(x0, y0, x1, y1, [col])', desc: 'Filled ellipse.', category: 'graphics', colorParams: [4] },
  { name: 'spr', sig: 'spr(n, x, y, [w, h], [flip_x], [flip_y])', desc: 'Draw sprite n (w*h sprites, may be fractional). Color 0 is transparent by default.', category: 'graphics' },
  { name: 'sspr', sig: 'sspr(sx, sy, sw, sh, dx, dy, [dw, dh], [flip_x], [flip_y])', desc: 'Draw a spritesheet rectangle, stretched to dw*dh.', category: 'graphics' },
  { name: 'fillp', sig: 'fillp([p])', desc: '4x4 fill pattern (16 bits; 1 bits use the high nibble color). p+0.5 (0x0.8) makes 1 bits transparent. Returns the previous pattern.', category: 'graphics' },
  { name: 'pal', sig: 'pal([c0, c1], [p])', desc: 'Remap color c0 to c1. p=0 draw palette, p=1 screen palette (can use 128-143). pal() resets. pal(table, p) sets many.', category: 'graphics', colorParams: [0, 1] },
  { name: 'palt', sig: 'palt([c, t])', desc: 'Set transparency of color c for sprites. palt() resets (only 0 transparent). palt(bitfield) sets all 16.', category: 'graphics', colorParams: [0] },
  { name: 'camera', sig: 'camera([x, y])', desc: 'Offset all drawing by -x,-y. Returns the previous offset.', category: 'graphics' },
  { name: 'clip', sig: 'clip([x, y, w, h], [clip_previous])', desc: 'Restrict drawing to a rectangle. clip() resets.', category: 'graphics' },
  { name: 'color', sig: 'color([col])', desc: 'Set the default draw color (default 6).', category: 'graphics', colorParams: [0] },
  { name: 'sget', sig: 'sget(x, y)', desc: 'Spritesheet pixel color.', category: 'graphics' },
  { name: 'sset', sig: 'sset(x, y, [col])', desc: 'Set a spritesheet pixel.', category: 'graphics', colorParams: [2] },
  { name: 'fget', sig: 'fget(n, [f])', desc: 'Sprite flags byte, or flag bit f (0-7) as boolean.', category: 'graphics' },
  { name: 'fset', sig: 'fset(n, [f], v)', desc: 'Set sprite flags byte, or flag bit f.', category: 'graphics' },
  { name: 'tline', sig: 'tline(x0, y0, x1, y1, mx, my, [mdx, mdy], [layers])', desc: 'Textured line sampling the map at (mx,my) in tiles, stepping (mdx,mdy) per pixel (default 1/8, 0).', category: 'graphics' },
  // map
  { name: 'map', sig: 'map([celx, cely], [sx, sy], [celw, celh], [layer])', desc: 'Draw map cells as sprites; tile 0 is skipped. layer filters by sprite flags.', category: 'map' },
  { name: 'mget', sig: 'mget(x, y)', desc: 'Map tile at cell x,y (0-127, 0-63).', category: 'map' },
  { name: 'mset', sig: 'mset(x, y, v)', desc: 'Set map tile. Rows 32-63 share memory with sprites 128-255.', category: 'map' },
  // text
  { name: 'print', sig: 'print(str, [x, y], [col])', desc: 'Print text. Returns the x after the text. Supports P8SCII control codes (\\^w wide, \\^t tall, \\fc color, \\#c background...).', category: 'text', colorParams: [3] },
  { name: 'cursor', sig: 'cursor([x, y], [col])', desc: 'Set the print cursor.', category: 'text', colorParams: [2] },
  // input
  { name: 'btn', sig: 'btn([i], [p])', desc: 'Is button i held? 0 left, 1 right, 2 up, 3 down, 4 🅾️ (z/c/n), 5 ❎ (x/v/m). No args: bitfield.', category: 'input' },
  { name: 'btnp', sig: 'btnp([i], [p])', desc: 'Was button i pressed this frame? Repeats after 15 frames, then every 4.', category: 'input' },
  // sound
  { name: 'sfx', sig: 'sfx(n, [channel], [offset], [length])', desc: 'Play sfx n (0-63). n=-1 stops, n=-2 releases a loop. channel -1 picks a free one.', category: 'sound' },
  { name: 'music', sig: 'music([n], [fade_ms], [channel_mask])', desc: 'Play music from pattern n; -1 stops. channel_mask reserves channels for music.', category: 'sound' },
  // math
  { name: 'flr', sig: 'flr(x)', desc: 'Round down.', category: 'math' },
  { name: 'ceil', sig: 'ceil(x)', desc: 'Round up.', category: 'math' },
  { name: 'abs', sig: 'abs(x)', desc: 'Absolute value.', category: 'math' },
  { name: 'min', sig: 'min(x, [y])', desc: 'Smaller value (missing args count as 0).', category: 'math' },
  { name: 'max', sig: 'max(x, [y])', desc: 'Larger value (missing args count as 0).', category: 'math' },
  { name: 'mid', sig: 'mid(x, y, z)', desc: 'Middle value; mid(lo, x, hi) clamps.', category: 'math' },
  { name: 'sgn', sig: 'sgn(x)', desc: '1 for x>=0, -1 otherwise.', category: 'math' },
  { name: 'sqrt', sig: 'sqrt(x)', desc: 'Square root (0 for negatives).', category: 'math' },
  { name: 'sin', sig: 'sin(t)', desc: 'Sine of t turns (0..1). Inverted: sin(0.25) = -1 (screen y points down).', category: 'math' },
  { name: 'cos', sig: 'cos(t)', desc: 'Cosine of t turns (0..1).', category: 'math' },
  { name: 'atan2', sig: 'atan2(dx, dy)', desc: 'Angle in turns (0..1) such that cos(a)~dx and sin(a)~dy.', category: 'math' },
  { name: 'rnd', sig: 'rnd([x])', desc: 'Random number in [0, x) (default 1). rnd(table) returns a random element.', category: 'math' },
  { name: 'srand', sig: 'srand(x)', desc: 'Seed the random generator.', category: 'math' },
  { name: 'band', sig: 'band(x, y)', desc: 'Bitwise and (same as x & y).', category: 'math' },
  { name: 'bor', sig: 'bor(x, y)', desc: 'Bitwise or (x | y).', category: 'math' },
  { name: 'bxor', sig: 'bxor(x, y)', desc: 'Bitwise xor (x ^^ y).', category: 'math' },
  { name: 'bnot', sig: 'bnot(x)', desc: 'Bitwise not (~x).', category: 'math' },
  { name: 'shl', sig: 'shl(x, n)', desc: 'Shift left (x << n).', category: 'math' },
  { name: 'shr', sig: 'shr(x, n)', desc: 'Arithmetic shift right (x >> n).', category: 'math' },
  { name: 'lshr', sig: 'lshr(x, n)', desc: 'Logical shift right (x >>> n).', category: 'math' },
  { name: 'rotl', sig: 'rotl(x, n)', desc: 'Rotate left (x <<> n).', category: 'math' },
  { name: 'rotr', sig: 'rotr(x, n)', desc: 'Rotate right (x >>< n).', category: 'math' },
  // tables
  { name: 'add', sig: 'add(t, v, [i])', desc: 'Append v (or insert at i). Returns v.', category: 'tables' },
  { name: 'del', sig: 'del(t, v)', desc: 'Remove the first v from t. Returns it.', category: 'tables' },
  { name: 'deli', sig: 'deli(t, [i])', desc: 'Remove the item at index i (default last). Returns it.', category: 'tables' },
  { name: 'count', sig: 'count(t, [v])', desc: 'Length of t, or number of occurrences of v.', category: 'tables' },
  { name: 'all', sig: 'all(t)', desc: 'Iterator over the values of t: for v in all(t) do ... end. Safe to del() the current item.', category: 'tables' },
  { name: 'foreach', sig: 'foreach(t, f)', desc: 'Call f(v) for every value.', category: 'tables' },
  { name: 'pairs', sig: 'pairs(t)', desc: 'Iterator over key, value pairs.', category: 'tables' },
  { name: 'ipairs', sig: 'ipairs(t)', desc: 'Iterator over index, value pairs.', category: 'tables' },
  { name: 'unpack', sig: 'unpack(t, [i], [j])', desc: 'Return the items of t as multiple values.', category: 'tables' },
  { name: 'pack', sig: 'pack(...)', desc: 'Table of the arguments, with n = count.', category: 'tables' },
  // strings
  { name: 'sub', sig: 'sub(s, i, [j])', desc: 'Substring from i to j (inclusive, negative counts from the end).', category: 'strings' },
  { name: 'tostr', sig: 'tostr(v, [flags])', desc: 'Convert to string. flags 0x1: hex, 0x2: show the raw 32-bit integer (e.g. score>>16).', category: 'strings' },
  { name: 'tonum', sig: 'tonum(s, [flags])', desc: 'Convert a string to a number (supports 0x, 0b). flags 0x1: hex, 0x2: raw integer, 0x4: 0 on failure.', category: 'strings' },
  { name: 'chr', sig: 'chr(n, ...)', desc: 'Characters from P8SCII codes.', category: 'strings' },
  { name: 'ord', sig: 'ord(s, [i], [n])', desc: 'P8SCII codes of characters.', category: 'strings' },
  { name: 'split', sig: 'split(s, [sep], [convert])', desc: 'Split a string (default ","). Numbers are converted unless convert is false. sep can be a chunk size.', category: 'strings' },
  // memory
  { name: 'peek', sig: 'peek(addr, [n])', desc: 'Read n bytes (default 1). Also @addr.', category: 'memory' },
  { name: 'poke', sig: 'poke(addr, v, ...)', desc: 'Write bytes.', category: 'memory' },
  { name: 'peek2', sig: 'peek2(addr)', desc: 'Read a signed 16-bit value. Also %addr.', category: 'memory' },
  { name: 'poke2', sig: 'poke2(addr, v, ...)', desc: 'Write 16-bit values.', category: 'memory' },
  { name: 'peek4', sig: 'peek4(addr)', desc: 'Read a 16.16 number. Also $addr.', category: 'memory' },
  { name: 'poke4', sig: 'poke4(addr, v, ...)', desc: 'Write 16.16 numbers.', category: 'memory' },
  { name: 'memcpy', sig: 'memcpy(dest, src, len)', desc: 'Copy memory.', category: 'memory' },
  { name: 'memset', sig: 'memset(dest, val, len)', desc: 'Fill memory.', category: 'memory' },
  { name: 'reload', sig: 'reload([dest, src, len])', desc: 'Copy from the cart ROM to memory.', category: 'memory' },
  { name: 'cstore', sig: 'cstore([dest, src, len])', desc: 'Copy memory to the cart ROM.', category: 'memory' },
  // system
  { name: 'time', sig: 'time()', desc: 'Seconds since the cart started (also t()).', category: 'system' },
  { name: 't', sig: 't()', desc: 'Alias of time().', category: 'system' },
  { name: 'stat', sig: 'stat(n)', desc: 'System info: 0 memory, 1 cpu, 7 fps, 46-49 sfx per channel, 54 music pattern, 80-95 date/time.', category: 'system' },
  { name: 'cartdata', sig: 'cartdata(id)', desc: 'Open persistent storage (64 numbers) for this id.', category: 'system' },
  { name: 'dget', sig: 'dget(i)', desc: 'Read persistent number i (0-63).', category: 'system' },
  { name: 'dset', sig: 'dset(i, v)', desc: 'Write persistent number i.', category: 'system' },
  { name: 'menuitem', sig: 'menuitem(i, [label], [fn])', desc: 'Add pause menu item i (1-5).', category: 'system' },
  { name: 'printh', sig: 'printh(s)', desc: 'Print to the console (debug output).', category: 'system' },
  { name: 'extcmd', sig: 'extcmd(cmd)', desc: 'System command ("reset" is supported).', category: 'system' },
  { name: 'stop', sig: 'stop([msg])', desc: 'Stop the cart.', category: 'system' },
  { name: 'run', sig: 'run()', desc: 'Restart the cart.', category: 'system' },
  { name: 'reset', sig: 'reset()', desc: 'Reset the draw state (palette, camera, clip, pen, fill pattern).', category: 'system' },
  { name: 'flip', sig: 'flip()', desc: 'Show the frame and wait for the next one (for carts with their own main loop).', category: 'system' },
  { name: 'cocreate', sig: 'cocreate(f)', desc: 'Create a coroutine.', category: 'lua' },
  { name: 'coresume', sig: 'coresume(co, ...)', desc: 'Resume a coroutine.', category: 'lua' },
  { name: 'costatus', sig: 'costatus(co)', desc: 'Coroutine status: "suspended", "running" or "dead".', category: 'lua' },
  { name: 'yield', sig: 'yield(...)', desc: 'Yield from a coroutine.', category: 'lua' },
  { name: 'type', sig: 'type(v)', desc: 'Type name of v.', category: 'lua' },
  { name: 'select', sig: 'select(i, ...)', desc: 'Arguments from i on, or select("#", ...) for the count.', category: 'lua' },
  { name: 'next', sig: 'next(t, [k])', desc: 'Next key/value of a table.', category: 'lua' },
  { name: 'setmetatable', sig: 'setmetatable(t, mt)', desc: 'Set the metatable of t.', category: 'lua' },
  { name: 'getmetatable', sig: 'getmetatable(t)', desc: 'Metatable of t.', category: 'lua' },
  { name: 'rawget', sig: 'rawget(t, k)', desc: 'Get without metamethods.', category: 'lua' },
  { name: 'rawset', sig: 'rawset(t, k, v)', desc: 'Set without metamethods.', category: 'lua' },
  { name: 'rawequal', sig: 'rawequal(a, b)', desc: 'Equality without metamethods.', category: 'lua' },
  { name: 'rawlen', sig: 'rawlen(t)', desc: 'Length without metamethods.', category: 'lua' },
  { name: 'assert', sig: 'assert(v, [msg])', desc: 'Error if v is false/nil.', category: 'lua' },
  { name: 'error', sig: 'error(msg)', desc: 'Raise an error.', category: 'lua' },
  { name: 'tostring', sig: 'tostring(v)', desc: 'Lua tostring (prefer tostr).', category: 'lua' },
  { name: 'pcall', sig: 'pcall(f, ...)', desc: 'Protected call.', category: 'lua' },
  // callbacks
  { name: '_init', sig: 'function _init() ... end', desc: 'Called once at startup.', category: 'callbacks' },
  { name: '_update', sig: 'function _update() ... end', desc: 'Called 30 times per second.', category: 'callbacks' },
  { name: '_update60', sig: 'function _update60() ... end', desc: 'Called 60 times per second (instead of _update).', category: 'callbacks' },
  { name: '_draw', sig: 'function _draw() ... end', desc: 'Called once per visible frame.', category: 'callbacks' },
];

export const API_BY_NAME: ReadonlyMap<string, ApiDoc> = new Map(API_DOCS.map((d) => [d.name, d]));

/**
 * Glyph constants predefined by PICO-8: button glyphs are button indices,
 * the others are fill patterns (with the 0x0.8 transparency bit).
 * Keys are P8SCII bytes.
 */
export const GLYPH_CONSTANTS: ReadonlyMap<number, number> = new Map([
  [0x80, 0x0000 + 0.5], [0x81, 0x5a5a + 0.5], [0x82, 0x511f + 0.5], [0x83, 3], [0x84, 0x7d7d + 0.5],
  [0x85, 0xb81d + 0.5], [0x86, 0xf99f + 0.5], [0x87, 0x51bf + 0.5], [0x88, 0xb5bf + 0.5], [0x89, 0x999f + 0.5],
  [0x8a, 0xb11f + 0.5], [0x8b, 0], [0x8c, 0xa0e0 + 0.5], [0x8d, 0x9b3f + 0.5], [0x8e, 4], [0x8f, 0xb1bf + 0.5],
  [0x90, 0xf5ff + 0.5], [0x91, 1], [0x92, 0xb15f + 0.5], [0x93, 0x1b1f + 0.5], [0x94, 2], [0x95, 0xf5bf + 0.5],
  [0x96, 0x7adf + 0.5], [0x97, 5], [0x98, 0x0f0f + 0.5], [0x99, 0x5555 + 0.5],
]);

/** Every global name provided by the runtime (for lint; glyph names as P8SCII chars). */
export const BUILTIN_GLOBALS: ReadonlySet<string> = new Set([
  ...API_DOCS.filter((d) => d.category !== 'callbacks').map((d) => d.name),
  ...[...GLYPH_CONSTANTS.keys()].map((b) => String.fromCharCode(b)),
  'mapdraw', 'self', '_ENV', '_G',
]);

export const GLYPHS: { glyph: string; name: string }[] = [
  { glyph: '⬅️', name: 'left' }, { glyph: '➡️', name: 'right' }, { glyph: '⬆️', name: 'up' }, { glyph: '⬇️', name: 'down' },
  { glyph: '🅾️', name: 'o button' }, { glyph: '❎', name: 'x button' }, { glyph: '♥', name: 'heart' }, { glyph: '★', name: 'star' },
  { glyph: '●', name: 'dot' }, { glyph: '◆', name: 'diamond' }, { glyph: '♪', name: 'note' }, { glyph: '…', name: 'ellipsis' },
  { glyph: '█', name: 'block' }, { glyph: '▒', name: 'checker' }, { glyph: '░', name: 'light shade' }, { glyph: '🐱', name: 'cat' },
  { glyph: '웃', name: 'person' }, { glyph: '⌂', name: 'house' }, { glyph: '😐', name: 'face' }, { glyph: '☉', name: 'sun' },
  { glyph: '✽', name: 'flower' }, { glyph: '⧗', name: 'hourglass' }, { glyph: 'ˇ', name: 'caron' }, { glyph: '∧', name: 'wedge' },
  { glyph: '▤', name: 'horizontal lines' }, { glyph: '▥', name: 'vertical lines' },
];

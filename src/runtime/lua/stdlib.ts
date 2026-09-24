/**
 * Lua-side PICO-8 API (math, tables, strings, rng, time) and the frame driver
 * (boot coroutine for flip(), update/draw dispatch, watchdog, error capture).
 *
 * Runs in _G after PRELUDE_LUA. The cart runs in its own environment table
 * (__p8_env) populated from the names in CART_GLOBALS.
 */
export const STDLIB_LUA = String.raw`
local floor, msqrt, msin, mcos, matan, pi, huge = math.floor, math.sqrt, math.sin, math.cos, math.atan, math.pi, math.huge
local type, select, pairs, error, tostring, rawlen = type, select, pairs, error, tostring, rawlen
local sbyte, schar, ssub, sfind = string.byte, string.char, string.sub, string.find
local tinsert, tremove = table.insert, table.remove
local cocreate_raw, coresume, costatus, coyield, corunning = coroutine.create, coroutine.resume, coroutine.status, coroutine.yield, coroutine.running
local sethook, traceback = debug.sethook, debug.traceback
local clock = os.clock
local toraw, fromraw = __p8_toraw, __p8_fromraw
local tostr = tostr

-- math ----------------------------------------------------------------------

local function num(x)
  if type(x) == "number" then return x end
  if type(x) == "string" then return tonum(x) or 0 end
  return 0
end

function flr(x) return floor(num(x)) + 0.0 end
function ceil(x) return -floor(-num(x)) + 0.0 end
function abs(x) x = num(x) if x < 0 then return -x end return x end
function min(a, b) a, b = num(a), num(b) if b < a then return b end return a end
function max(a, b) a, b = num(a), num(b) if b > a then return b end return a end
function mid(a, b, c)
  a, b, c = num(a), num(b), num(c)
  if a > b then a, b = b, a end
  if c < a then return a end
  if c > b then return b end
  return c
end
function sgn(x) if num(x) < 0 then return -1.0 end return 1.0 end
function sqrt(x) x = num(x) if x <= 0 then return 0.0 end return msqrt(x) end
local tau = pi * 2
function sin(x) return -msin(num(x) * tau) end
function cos(x) return mcos(num(x) * tau) end
function atan2(dx, dy)
  dx, dy = num(dx), num(dy)
  if dx == 0 and dy == 0 then return 0.25 end
  local a = matan(-dy, dx) / tau
  if a < 0 then a = a + 1 end
  return a
end

-- 16.16 bitwise functions (the operators compile to the same helpers)
band, bor, bxor, bnot = __p8_band, __p8_bor, __p8_bxor, __p8_bnot
shl, shr, lshr, rotl, rotr = __p8_shl, __p8_shr, __p8_lshr, __p8_rotl, __p8_rotr

-- rng: xorshift64*, deterministic per seed ------------------------------------------

local rng = 0x2545F4914F6CDD1D
local function nextrand()
  local x = rng
  x = x ~ (x >> 12)
  x = x ~ (x << 25)
  x = x ~ (x >> 27)
  rng = x
  return ((x * 0x2545F4914F6CDD1D) >> 32) & 0xffffffff
end

function srand(seed)
  local s = toraw(num(seed))
  rng = (s * 0x9E3779B97F4A7C15) ~ 0x2545F4914F6CDD1D
  if rng == 0 then rng = 1 end
  for _ = 1, 4 do nextrand() end
end

function rnd(x)
  if type(x) == "table" then
    local n = rawlen(x)
    if n == 0 then return nil end
    return x[(nextrand() % n) + 1]
  end
  if x == nil then x = 1 end
  x = num(x)
  -- 16.16 result in [0, x)
  local r = (nextrand() >> 16) / 65536.0
  return floor(r * x * 65536.0) / 65536.0
end

-- tables ---------------------------------------------------------------------------

function add(t, v, i)
  if t == nil then return nil end
  if i ~= nil then
    local n = #t
    i = floor(num(i))
    if i < 1 then i = 1 elseif i > n + 1 then i = n + 1 end
    tinsert(t, i, v)
  else
    t[#t + 1] = v
  end
  return v
end

function del(t, v)
  if t == nil then return nil end
  for i = 1, #t do
    if t[i] == v then return tremove(t, i) end
  end
  return nil
end

function deli(t, i)
  if t == nil then return nil end
  local n = #t
  if i == nil then i = n else i = floor(num(i)) end
  if i < 1 or i > n then return nil end
  return tremove(t, i)
end

function count(t, v)
  if t == nil then return 0.0 end
  if v == nil then return #t + 0.0 end
  local c = 0
  for i = 1, #t do if t[i] == v then c = c + 1 end end
  return c + 0.0
end

-- Same semantics as PICO-8's all(): tolerates deleting the current element.
function all(a)
  if a == nil or #a == 0 then return function() end end
  local i, li = 1, nil
  return function()
    if a[i] == li then i = i + 1 end
    while a[i] == nil and i <= #a do i = i + 1 end
    li = a[i]
    return a[i]
  end
end

function foreach(t, f)
  for v in all(t) do f(v) end
end

-- strings --------------------------------------------------------------------------

local function str(s)
  if type(s) == "string" then return s end
  if type(s) == "number" then return tostr(s) end
  return nil
end

function sub(s, i, j)
  s = str(s)
  if s == nil then return nil end
  i = i and floor(num(i)) or 1
  if j == nil or type(j) ~= "number" then j = -1 else j = floor(j) end
  return ssub(s, i, j)
end

function chr(...)
  local n = select("#", ...)
  local out = {}
  for k = 1, n do
    out[k] = schar(floor(num((select(k, ...)))) & 255)
  end
  return table.concat(out)
end

function ord(s, i, n)
  s = str(s)
  if s == nil then return nil end
  i = i and floor(num(i)) or 1
  n = n and floor(num(n)) or 1
  local res = { sbyte(s, i, i + n - 1) }
  for k = 1, #res do res[k] = res[k] + 0.0 end
  return table.unpack(res)
end

local function parse_number(s, hexmode)
  s = s:match("^%s*(.-)%s*$")
  local neg = false
  if ssub(s, 1, 1) == "-" then neg = true s = ssub(s, 2) end
  local base = 10
  if hexmode then base = 16 end
  local lower = s:lower()
  if ssub(lower, 1, 2) == "0x" then base = 16 s = ssub(s, 3)
  elseif ssub(lower, 1, 2) == "0b" then base = 2 s = ssub(s, 3) end
  if s == "" then return nil end
  local int, frac = s:match("^([%w]*)%.?([%w]*)$")
  if int == nil or (int == "" and frac == "") then return nil end
  local v = 0
  for k = 1, #int do
    local d = tonumber(ssub(int, k, k), 36)
    if d == nil or d >= base then return nil end
    v = v * base + d
  end
  local scale = 1
  for k = 1, #frac do
    local d = tonumber(ssub(frac, k, k), 36)
    if d == nil or d >= base then return nil end
    scale = scale / base
    v = v + d * scale
  end
  if neg then v = -v end
  return v
end

function tonum(v, flags)
  if type(v) == "number" then return v end
  if type(v) == "boolean" then return v and 1.0 or 0.0 end
  flags = type(flags) == "number" and floor(flags) or 0
  if type(v) == "string" then
    local n = parse_number(v, flags & 1 == 1)
    if n ~= nil then
      if flags & 2 == 2 then return fromraw(floor(n) & 0xffffffff) end
      -- wrap to 16.16 like PICO-8
      local raw = n * 65536.0
      if raw >= 0 then raw = floor(raw) else raw = -floor(-raw) end
      return fromraw(raw & 0xffffffff)
    end
  end
  if flags & 4 == 4 then return 0.0 end
  return nil
end

function split(s, sep, convert)
  s = str(s) or ""
  if sep == nil then sep = "," end
  if convert == nil then convert = true end
  local out = {}
  local function push(part)
    if convert then
      local n = tonum(part)
      if n ~= nil and part ~= "" then out[#out + 1] = n return end
    end
    out[#out + 1] = part
  end
  if type(sep) == "number" then
    local size = floor(sep)
    if size < 1 then size = 1 end
    for k = 1, #s, size do push(ssub(s, k, k + size - 1)) end
    return out
  end
  sep = str(sep) or ","
  if sep == "" then
    for k = 1, #s do push(ssub(s, k, k)) end
    return out
  end
  local start = 1
  while true do
    local a, b = sfind(s, sep, start, true)
    if not a then push(ssub(s, start)) break end
    push(ssub(s, start, a - 1))
    start = b + 1
  end
  return out
end

-- misc ------------------------------------------------------------------------------

function print(s, ...)
  return __p8_print(tostr(s), ...)
end
function printh(s, ...)
  return __p8_printh(tostr(s), ...)
end

function pal(c0, c1, p)
  if type(c0) == "table" then
    for k, v in pairs(c0) do __p8_pal(k, v, c1) end
    return
  end
  return __p8_pal(c0, c1, p)
end

__p8_t = 0.0
function time() return __p8_t end
t = time

-- coroutines and watchdog ----------------------------------------------------------------

local deadline = huge
__p8_timeout = 2.0
local function hook()
  if clock() > deadline then
    deadline = huge
    error("cpu timeout: a frame ran for more than " .. __p8_timeout .. "s (infinite loop?)", 2)
  end
end
local HOOK_COUNT = 10000

function cocreate(f)
  local co = cocreate_raw(f)
  sethook(co, hook, "", HOOK_COUNT)
  return co
end
coresume, costatus, yield = coresume, costatus, coyield
unpack, pack = table.unpack, table.pack

-- control flow markers ---------------------------------------------------------------------

local STOP, RUN = {}, {}
function stop(msg) error({ [STOP] = true, msg = msg }, 0) end
function run() error({ [RUN] = true }, 0) end
function reset() __p8_reset() end

-- frame driver --------------------------------------------------------------------------------

local main_co = nil
local function describe(err)
  if type(err) == "table" then
    if err[STOP] then return "stop", err.msg and tostr(err.msg) or "" end
    if err[RUN] then return "run", "" end
  end
  return "error", tostring(err)
end

-- Prepares the boot coroutine: top-level code, then _init().
function __p8_boot(chunk)
  local env = __p8_env
  main_co = cocreate_raw(function()
    chunk()
    if env._init then env._init() end
  end)
  sethook(main_co, hook, "", HOOK_COUNT)
end

function flip()
  local co = corunning()
  if co ~= nil and co == main_co then coyield() end
end

-- One game frame. Returns: status ("ok" | "boot" | "flip" | "error" | "stop" | "run"), message, traceback.
function __p8_tick(dt)
  deadline = clock() + __p8_timeout
  if main_co then
    local ok, err = coresume(main_co)
    if not ok then
      local kind, msg = describe(err)
      local tb = traceback(main_co, nil, 0)
      main_co = nil
      deadline = huge
      return kind, msg, tb
    end
    deadline = huge
    if costatus(main_co) == "dead" then
      main_co = nil
      return "boot"
    end
    return "flip"
  end
  __p8_t = __p8_t + dt
  local env = __p8_env
  local ok, err = xpcall(function()
    local u = env._update60 or env._update
    if u then u() end
    if env._draw then env._draw() end
  end, function(err)
    local k, m = describe(err)
    return { k, m, traceback(nil, 2) }
  end)
  deadline = huge
  if ok then return "ok" end
  return err[1], err[2], err[3]
end

-- Runs a function from the host (menu item callback, eval) with the watchdog.
function __p8_invoke(fn, ...)
  deadline = clock() + __p8_timeout
  local res = table.pack(xpcall(fn, function(err)
    local k, m = describe(err)
    return { k, m, traceback(nil, 2) }
  end, ...))
  deadline = huge
  if res[1] then return "ok", table.unpack(res, 2, res.n) end
  return res[2][1], res[2][2], res[2][3]
end

function __p8_fps()
  local env = __p8_env
  if env._update60 then return 60 end
  return 30
end

function __p8_sethook()
  sethook(hook, "", HOOK_COUNT)
end
`;

/** Names copied from _G into the cart environment. */
export const CART_GLOBALS = [
  // Lua builtins available in PICO-8
  'assert', 'error', 'getmetatable', 'setmetatable', 'ipairs', 'pairs', 'next', 'rawequal', 'rawget',
  'rawlen', 'rawset', 'select', 'type', 'tostring', 'pcall', 'unpack', 'pack',
  // PICO-8 API implemented in Lua
  'tostr', 'tonum', 'flr', 'ceil', 'abs', 'min', 'max', 'mid', 'sgn', 'sqrt', 'sin', 'cos', 'atan2',
  'band', 'bor', 'bxor', 'bnot', 'shl', 'shr', 'lshr', 'rotl', 'rotr', 'srand', 'rnd',
  'add', 'del', 'deli', 'count', 'all', 'foreach', 'sub', 'chr', 'ord', 'split', 'print', 'printh',
  'pal', 'time', 't', 'cocreate', 'coresume', 'costatus', 'yield', 'stop', 'run', 'reset', 'flip',
  // operator helpers
  '__p8_cat', '__p8_band', '__p8_bor', '__p8_bxor', '__p8_bnot', '__p8_shl', '__p8_shr', '__p8_lshr',
  '__p8_rotl', '__p8_rotr', '__p8_peek', '__p8_peek2', '__p8_peek4',
] as const;

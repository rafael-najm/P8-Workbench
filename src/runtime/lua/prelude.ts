/**
 * Lua-side helpers used by preprocessed code and by the pure-Lua parts of the
 * API. Implemented in Lua (not JS) because they are called in hot loops and
 * Lua->Lua calls are an order of magnitude cheaper than Lua->JS calls.
 *
 * Numbers are Lua floats; 16.16 fixed point is emulated where it matters
 * (bitwise ops, shifts, tostr).
 */
export const PRELUDE_LUA = String.raw`
local floor, type, tostring, error, getmetatable, select = math.floor, type, tostring, error, getmetatable, select
local sfmt, ssub = string.format, string.sub
local MASK = 0xffffffff

-- number -> unsigned 32-bit raw 16.16 value
local function toraw(x)
  if type(x) ~= "number" then x = 0 end
  x = x * 65536.0
  if x ~= x or x >= 9.2e18 or x <= -9.2e18 then return 0 end
  return floor(x) & MASK
end

-- unsigned 32-bit raw -> number
local function fromraw(u)
  u = u & MASK
  if u >= 0x80000000 then u = u - 0x100000000 end
  return u / 65536.0
end
__p8_toraw, __p8_fromraw = toraw, fromraw

local function band(a, b) return fromraw(toraw(a) & toraw(b)) end
local function bor(a, b) return fromraw(toraw(a) | toraw(b)) end
local function bxor(a, b) return fromraw(toraw(a) ~ toraw(b)) end
local function bnot(a) return fromraw(~toraw(a)) end

local function shamt(n)
  if type(n) ~= "number" then return 0 end
  return floor(n)
end

local shr
local function shl(a, n)
  n = shamt(n)
  if n < 0 then return shr(a, -n) end
  if n >= 32 then return 0.0 end
  return fromraw(toraw(a) << n)
end

shr = function(a, n)
  n = shamt(n)
  if n < 0 then return shl(a, -n) end
  if n > 31 then n = 31 end
  local s = toraw(a)
  if s >= 0x80000000 then s = s - 0x100000000 end
  return fromraw(s // (1 << n))
end

local function lshr(a, n)
  n = shamt(n)
  if n < 0 then return shl(a, -n) end
  if n >= 32 then return 0.0 end
  return fromraw(toraw(a) >> n)
end

local function rotl(a, n)
  n = shamt(n) & 31
  local u = toraw(a)
  return fromraw((u << n) | (u >> (32 - n)))
end

local function rotr(a, n)
  return rotl(a, 32 - (shamt(n) & 31))
end

__p8_band, __p8_bor, __p8_bxor, __p8_bnot = band, bor, bxor, bnot
__p8_shl, __p8_shr, __p8_lshr, __p8_rotl, __p8_rotr = shl, shr, lshr, rotl, rotr

-- PICO-8 style number formatting: the 16.16 value with 4 rounded decimals,
-- trailing zeros removed (same rule as zepto8).
local function fmtnum(n)
  local s = sfmt("%.4f", fromraw(toraw(n)))
  local i = #s
  while ssub(s, i, i) == "0" do i = i - 1 end
  if ssub(s, i, i) == "." then i = i - 1 end
  return ssub(s, 1, i)
end

local function hex(raw, frac)
  if frac then
    return sfmt("0x%04x.%04x", (raw >> 16) & 0xffff, raw & 0xffff)
  end
  return sfmt("0x%08x", raw)
end

function tostr(...)
  if select("#", ...) == 0 then return "" end
  local v, flags = ...
  local t = type(v)
  if t == "number" then
    flags = type(flags) == "number" and floor(flags) or (flags and 1 or 0)
    local raw = toraw(v)
    if flags & 3 == 3 then return hex(raw, false) end
    if flags & 1 == 1 then return hex(raw, true) end
    if flags & 2 == 2 then
      if raw >= 0x80000000 then raw = raw - 0x100000000 end
      return tostring(raw)
    end
    return fmtnum(v)
  elseif t == "string" then
    return v
  elseif t == "nil" then
    return "[nil]"
  elseif t == "boolean" then
    return v and "true" or "false"
  elseif t == "table" then
    local mt = getmetatable(v)
    if mt and mt.__tostring then return mt.__tostring(v) end
    return "[table]"
  else
    return "[" .. t .. "]"
  end
end
__p8_fmtnum = fmtnum

-- '..' with PICO-8 number formatting
function __p8_cat(a, b)
  local ta, tb = type(a), type(b)
  if ta == "string" then
    if tb == "string" then return a .. b end
    if tb == "number" then return a .. fmtnum(b) end
  elseif ta == "number" then
    if tb == "string" then return fmtnum(a) .. b end
    if tb == "number" then return fmtnum(a) .. fmtnum(b) end
  end
  local mt = getmetatable(ta == "table" and a or b)
  if mt and mt.__concat then return mt.__concat(a, b) end
  error("attempt to concatenate a " .. ((ta ~= "string" and ta ~= "number") and ta or tb) .. " value", 2)
end
`;

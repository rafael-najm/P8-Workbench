/** Lua-side JSON serializer used by the variable inspector and the agent tools. */
export const INSPECT_LUA = String.raw`
local type, pairs, tostring, floor, sfmt, sbyte, sgsub = type, pairs, tostring, math.floor, string.format, string.byte, string.gsub
local tconcat, tsort = table.concat, table.sort
local fmtnum = __p8_fmtnum

local function jstr(s)
  s = sgsub(s, '[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return sfmt("\\u%04x", sbyte(c))
  end)
  return '"' .. s .. '"'
end

local function keystr(k)
  if type(k) == "string" then return k end
  if type(k) == "number" then return fmtnum(k) end
  return "[" .. type(k) .. "]"
end

local function ser(v, depth, maxitems, seen, out)
  local t = type(v)
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then out[#out + 1] = jstr(tostring(v)) return end
    out[#out + 1] = fmtnum(v)
  elseif t == "string" then
    out[#out + 1] = jstr(v)
  elseif t == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif t == "nil" then
    out[#out + 1] = "null"
  elseif t == "table" then
    if seen[v] then out[#out + 1] = '"[cycle]"' return end
    if depth <= 0 then
      local n = 0
      for _ in pairs(v) do n = n + 1 end
      out[#out + 1] = jstr("[table: " .. n .. " items]")
      return
    end
    seen[v] = true
    local n = #v
    local keys, count = {}, 0
    for k in pairs(v) do
      count = count + 1
      if not (type(k) == "number" and k >= 1 and k <= n and floor(k) == k) then keys[#keys + 1] = k end
    end
    if #keys == 0 then
      out[#out + 1] = "["
      for i = 1, n do
        if i > maxitems then out[#out + 1] = jstr("... " .. (n - maxitems) .. " more") break end
        if i > 1 then out[#out + 1] = "," end
        ser(v[i], depth - 1, maxitems, seen, out)
      end
      out[#out + 1] = "]"
    else
      for i = 1, n do keys[#keys + 1] = i end
      tsort(keys, function(a, b)
        local ta, tb = type(a), type(b)
        if ta ~= tb then return ta < tb end
        if ta == "number" or ta == "string" then return a < b end
        return tostring(a) < tostring(b)
      end)
      out[#out + 1] = "{"
      for i, k in ipairs(keys) do
        if i > maxitems then out[#out + 1] = ',' .. jstr("...") .. ':' .. jstr((#keys - maxitems) .. " more") break end
        if i > 1 then out[#out + 1] = "," end
        out[#out + 1] = jstr(keystr(k)) .. ":"
        ser(v[k], depth - 1, maxitems, seen, out)
      end
      out[#out + 1] = "}"
    end
    seen[v] = nil
  else
    out[#out + 1] = jstr("[" .. t .. "]")
  end
end

function __p8_json(v, depth, maxitems)
  local out = {}
  ser(v, depth or 2, maxitems or 32, {}, out)
  return tconcat(out)
end

-- Serializes cart globals. names: comma-separated list, or nil for all
-- non-function user globals (API names excluded).
function __p8_globals(names, depth, maxitems)
  local env = __p8_env
  local builtin = __p8_builtin
  if names and names ~= "" then
    local keys = {}
    for name in names:gmatch("[^,%s]+") do keys[#keys + 1] = name end
    local out = {"{"}
    for i, k in ipairs(keys) do
      if i > 1 then out[#out + 1] = "," end
      out[#out + 1] = jstr(k) .. ":"
      local parts = {}
      ser(env[k], depth or 2, maxitems or 32, {}, parts)
      out[#out + 1] = tconcat(parts)
    end
    out[#out + 1] = "}"
    return tconcat(out)
  end
  local keys = {}
  for k, v in pairs(env) do
    if type(k) == "string" and not builtin[k] and type(v) ~= "function" then keys[#keys + 1] = k end
  end
  tsort(keys)
  local out = {"{"}
  for i, k in ipairs(keys) do
    if i > 1 then out[#out + 1] = "," end
    out[#out + 1] = jstr(k) .. ":"
    local parts = {}
    ser(env[k], depth or 1, maxitems or 16, {}, parts)
    out[#out + 1] = tconcat(parts)
  end
  out[#out + 1] = "}"
  return tconcat(out)
end

-- Names of user-defined global functions (for the agent's context).
function __p8_functions()
  local env, builtin = __p8_env, __p8_builtin
  local keys = {}
  for k, v in pairs(env) do
    if type(k) == "string" and not builtin[k] and type(v) == "function" then keys[#keys + 1] = k end
  end
  tsort(keys)
  return tconcat(keys, ",")
end
`;

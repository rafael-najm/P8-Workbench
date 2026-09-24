/** Minimal JSON-schema validation for tool arguments (the subset the tools use). */
import type { JsonSchema } from './types';

export function validate(schema: JsonSchema, value: unknown, path = 'args'): string[] {
  const errors: string[] = [];
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s, value, path));
    if (results.every((r) => r.length > 0)) errors.push(`${path}: does not match any allowed type`);
    return errors;
  }
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected an object`];
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) if (obj[req] === undefined) errors.push(`${path}.${req}: required`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (!sub) {
        if (schema.additionalProperties === false) errors.push(`${path}.${k}: unknown property`);
        continue;
      }
      if (v === undefined || v === null) continue;
      errors.push(...validate(sub, v, `${path}.${k}`));
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected an array`];
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}[${i}]`)));
  } else if (t === 'string') {
    if (typeof value === 'number') return errors; // e.g. pitch as a number
    if (typeof value !== 'string') errors.push(`${path}: expected a string`);
    else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  } else if (t === 'number' || t === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path}: expected a number`);
    else {
      if (t === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected an integer`);
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
    }
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean`);
  }
  return errors;
}

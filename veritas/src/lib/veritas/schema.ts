/**
 * Minimal, dependency-free runtime schema validation used to validate every
 * LLM tool output and API request body. Kept tiny on purpose so the engine
 * has zero runtime dependencies (easy to unit-test and to reuse in workers).
 */

export class SchemaError extends Error {
  constructor(public path: string, message: string) {
    super(`${path || "value"}: ${message}`);
    this.name = "SchemaError";
  }
}

export type Validator<T> = (x: unknown, path: string) => T;
export type Infer<V> = V extends Validator<infer T> ? T : never;

export const s = {
  string(opts: { min?: number; max?: number; trim?: boolean } = {}): Validator<string> {
    return (x, path) => {
      if (typeof x !== "string") throw new SchemaError(path, "expected string");
      let v = opts.trim === false ? x : x.trim();
      if (opts.min !== undefined && v.length < opts.min) throw new SchemaError(path, `must be at least ${opts.min} chars`);
      if (opts.max !== undefined && v.length > opts.max) v = v.slice(0, opts.max);
      return v;
    };
  },

  enumOf<T extends string>(values: readonly T[]): Validator<T> {
    return (x, path) => {
      if (typeof x !== "string") throw new SchemaError(path, "expected string enum");
      const up = x.trim().toUpperCase();
      const hit = values.find((v) => v.toUpperCase() === up);
      if (!hit) throw new SchemaError(path, `expected one of ${values.join(", ")}, got "${x}"`);
      return hit;
    };
  },

  array<T>(item: Validator<T>, opts: { max?: number; min?: number } = {}): Validator<T[]> {
    return (x, path) => {
      if (!Array.isArray(x)) throw new SchemaError(path, "expected array");
      if (opts.min !== undefined && x.length < opts.min) throw new SchemaError(path, `expected at least ${opts.min} items`);
      const sliced = opts.max !== undefined ? x.slice(0, opts.max) : x;
      return sliced.map((el, i) => item(el, `${path}[${i}]`));
    };
  },

  object<S extends Record<string, Validator<unknown>>>(shape: S): Validator<{ [K in keyof S]: Infer<S[K]> }> {
    return (x, path) => {
      if (typeof x !== "object" || x === null || Array.isArray(x)) throw new SchemaError(path, "expected object");
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) out[k] = v((x as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return out as { [K in keyof S]: Infer<S[K]> };
    };
  },

  /** Accepts null, undefined, or empty string as null. */
  nullable<T>(inner: Validator<T>): Validator<T | null> {
    return (x, path) => (x === null || x === undefined || x === "" ? null : inner(x, path));
  },

  withDefault<T>(inner: Validator<T>, fallback: T): Validator<T> {
    return (x, path) => (x === undefined || x === null ? fallback : inner(x, path));
  },
};

export function parseWith<T>(validator: Validator<T>, x: unknown): T {
  return validator(x, "");
}

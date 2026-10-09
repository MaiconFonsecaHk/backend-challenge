import { InvalidJsonPayloadError } from './immutable-json.error.js';

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export function cloneAndFreezeJson<T>(value: T): DeepReadonly<T> {
  return cloneJsonValue(value) as DeepReadonly<T>;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidJsonPayloadError();
    }

    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJsonValue(item)));
  }

  if (typeof value !== 'object' || !isPlainObject(value)) {
    throw new InvalidJsonPayloadError();
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new InvalidJsonPayloadError();
  }

  const clone: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      throw new InvalidJsonPayloadError();
    }

    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value: cloneJsonValue(item),
      writable: false,
    });
  }

  return Object.freeze(clone);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;

  return prototype === Object.prototype || prototype === null;
}

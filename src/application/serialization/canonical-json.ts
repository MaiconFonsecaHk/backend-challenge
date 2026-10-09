export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export function serializeCanonicalJson(value: CanonicalJsonValue): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

function normalize(
  value: CanonicalJsonValue,
  ancestors: WeakSet<object>,
): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers.');
    }

    return value;
  }
  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON does not support cyclic values.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => {
        if (!(index in value)) {
          throw new TypeError('Canonical JSON does not support sparse arrays.');
        }

        return normalize(value[index] as CanonicalJsonValue, ancestors);
      });
    }
    const record = value as { readonly [key: string]: CanonicalJsonValue };
    if (
      Object.getPrototypeOf(record) !== Object.prototype &&
      Object.getPrototypeOf(record) !== null
    ) {
      throw new TypeError('Canonical JSON supports only plain objects.');
    }
    if (Object.getOwnPropertySymbols(record).length > 0) {
      throw new TypeError('Canonical JSON does not support symbol keys.');
    }

    const normalized: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalize(record[key] as CanonicalJsonValue, ancestors);
    }

    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

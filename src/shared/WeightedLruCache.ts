interface WeightedEntry<Value> {
  value: Value;
  weight: number;
}

/** Small deterministic LRU bounded by both entry count and retained weight. */
export class WeightedLruCache<Key, Value> {
  readonly #entries = new Map<Key, WeightedEntry<Value>>();
  #weight = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
  ) {
    if (maxEntries < 1 || maxWeight < 1) throw new Error("Weighted LRU limits must be positive.");
  }

  get size(): number {
    return this.#entries.size;
  }

  get weight(): number {
    return this.#weight;
  }

  get(key: Key): Value | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, weight: number): void {
    const normalizedWeight = Math.max(1, Math.ceil(weight));
    const existing = this.#entries.get(key);
    if (existing) {
      this.#weight -= existing.weight;
      this.#entries.delete(key);
    }
    if (normalizedWeight > this.maxWeight) return;
    this.#entries.set(key, { value, weight: normalizedWeight });
    this.#weight += normalizedWeight;
    while (this.#entries.size > this.maxEntries || this.#weight > this.maxWeight) {
      const oldest = this.#entries.keys().next().value as Key | undefined;
      if (oldest === undefined) break;
      const removed = this.#entries.get(oldest);
      this.#entries.delete(oldest);
      this.#weight -= removed?.weight || 0;
    }
  }
}

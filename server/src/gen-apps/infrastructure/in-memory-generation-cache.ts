import { Buffer } from "node:buffer";
import type { CachedGeneration, GenerationCache } from "../ports.js";

export class InMemoryGenerationCache implements GenerationCache {
  private readonly entries = new Map<string, CachedGeneration & { lastHitAt: number }>();

  get(fingerprint: string, now: number): CachedGeneration | null {
    const value = this.entries.get(fingerprint);
    if (!value) return null;
    if (value.expiresAt <= now) {
      this.entries.delete(fingerprint);
      return null;
    }
    value.lastHitAt = now;
    return { ...value };
  }

  put(value: CachedGeneration): void {
    this.entries.set(value.fingerprint, { ...value, lastHitAt: value.createdAt });
  }

  delete(fingerprint: string): void {
    this.entries.delete(fingerprint);
  }

  prune(now: number, maxEntries: number, maxBytes: number): number {
    const before = this.entries.size;
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= now) this.entries.delete(key);
    }
    const ordered = [...this.entries.values()].sort((a, b) => b.lastHitAt - a.lastHitAt);
    let bytes = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      bytes += Buffer.byteLength(ordered[index].markup, "utf8");
      if (index >= maxEntries || bytes > maxBytes) this.entries.delete(ordered[index].fingerprint);
    }
    return before - this.entries.size;
  }
}

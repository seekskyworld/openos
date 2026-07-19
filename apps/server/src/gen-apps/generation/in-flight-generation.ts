type GenerationHooks = {
  onDelta?: (text: string) => void;
  onSnapshot?: (snapshot: { stage: string; markup: string }) => void;
  onPhase?: (phase: { phase: string; round?: number }) => void;
};

type Subscriber<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  hooks: GenerationHooks;
  signal: AbortSignal;
  abort: () => void;
};

type Entry<T> = {
  controller: AbortController;
  subscribers: Set<Subscriber<T>>;
};

/** 同一生成指纹共享一次底层模型流；只有最后一个订阅者离开才取消。 */
export class InFlightGenerationRegistry<T> {
  private readonly entries = new Map<string, Entry<T>>();

  run(
    key: string,
    signal: AbortSignal,
    hooks: GenerationHooks,
    start: (signal: AbortSignal, hooks: Required<GenerationHooks>) => Promise<T>,
  ): Promise<{ value: T; joined: boolean }> {
    let entry = this.entries.get(key);
    const joined = Boolean(entry);
    if (!entry) {
      entry = { controller: new AbortController(), subscribers: new Set() };
      this.entries.set(key, entry);
      const activeEntry = entry;
      queueMicrotask(() => {
        void start(activeEntry.controller.signal, {
          onDelta: (text) => {
            for (const subscriber of activeEntry.subscribers) subscriber.hooks.onDelta?.(text);
          },
          onSnapshot: (snapshot) => {
            for (const subscriber of activeEntry.subscribers) subscriber.hooks.onSnapshot?.(snapshot);
          },
          onPhase: (phase) => {
            for (const subscriber of activeEntry.subscribers) subscriber.hooks.onPhase?.(phase);
          },
        }).then(
          (value) => this.settle(key, activeEntry, value, null),
          (error) => this.settle(key, activeEntry, null, error),
        );
      });
    }

    const activeEntry = entry;
    return new Promise<{ value: T; joined: boolean }>((resolve, reject) => {
      const subscriber: Subscriber<T> = {
        hooks,
        signal,
        resolve: (value) => resolve({ value, joined }),
        reject,
        abort: () => {},
      };
      subscriber.abort = () => {
        activeEntry.subscribers.delete(subscriber);
        reject(new DOMException("Generation cancelled.", "AbortError"));
        if (activeEntry.subscribers.size === 0) activeEntry.controller.abort();
      };
      if (signal.aborted) {
        subscriber.abort();
        return;
      }
      signal.addEventListener("abort", subscriber.abort, { once: true });
      activeEntry.subscribers.add(subscriber);
    });
  }

  private settle(
    key: string,
    entry: Entry<T>,
    value: T | null,
    error: unknown,
  ): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
    for (const subscriber of entry.subscribers) {
      subscriber.signal.removeEventListener("abort", subscriber.abort);
      if (error === null) subscriber.resolve(value as T);
      else subscriber.reject(error);
    }
    entry.subscribers.clear();
  }
}

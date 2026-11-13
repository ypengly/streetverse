/** Minimal typed event emitter used to decouple gameplay systems from UI/audio/camera. */
export interface GameEvents {
  impact: { magnitude: number };
  recovered: { reason: 'manual' | 'overturned' };
  cameraChanged: { mode: string };
  notify: { text: string; kind: 'info' | 'warn' };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const s = set;
    s.add(handler as Handler<never>);
    return () => {
      s.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.handlers.get(event)?.forEach((h) => (h as Handler<E[K]>)(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}

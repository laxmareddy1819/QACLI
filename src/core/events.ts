import type { QabotEventMap, QabotEvent } from '../types/index.js';

type EventHandler<T> = (data: T) => void | Promise<void>;
type AnyHandler = (event: string, data: unknown) => void | Promise<void>;

export class EventEmitter {
  private handlers = new Map<string, Set<EventHandler<unknown>>>();
  private anyHandlers = new Set<AnyHandler>();
  private onceHandlers = new Set<EventHandler<unknown>>();

  on<E extends QabotEvent>(event: E, handler: EventHandler<QabotEventMap[E]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);

    return () => this.off(event, handler);
  }

  once<E extends QabotEvent>(event: E, handler: EventHandler<QabotEventMap[E]>): () => void {
    const wrappedHandler: EventHandler<QabotEventMap[E]> = async (data) => {
      this.off(event, wrappedHandler);
      await handler(data);
    };
    this.onceHandlers.add(wrappedHandler as EventHandler<unknown>);
    return this.on(event, wrappedHandler);
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  off<E extends QabotEvent>(event: E, handler: EventHandler<QabotEventMap[E]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  async emit<E extends QabotEvent>(event: E, data: QabotEventMap[E]): Promise<void> {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const promises: Promise<void>[] = [];
      for (const handler of handlers) {
        const result = handler(data);
        if (result instanceof Promise) promises.push(result);
      }
      if (promises.length > 0) await Promise.all(promises);
    }

    for (const handler of this.anyHandlers) {
      const result = handler(event, data);
      if (result instanceof Promise) await result;
    }
  }

  emitSync<E extends QabotEvent>(event: E, data: QabotEventMap[E]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
    for (const handler of this.anyHandlers) {
      handler(event, data);
    }
  }

  removeAllListeners(event?: QabotEvent): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
      this.anyHandlers.clear();
    }
  }

  listenerCount(event: QabotEvent): number {
    return this.handlers.get(event)?.size || 0;
  }
}

let emitterInstance: EventEmitter | null = null;

export function getEventEmitter(): EventEmitter {
  if (!emitterInstance) {
    emitterInstance = new EventEmitter();
  }
  return emitterInstance;
}

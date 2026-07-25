export class SerialWriteQueue {
  #tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(write: () => Promise<T>): Promise<T> {
    const next = this.#tail.catch(() => undefined).then(write);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

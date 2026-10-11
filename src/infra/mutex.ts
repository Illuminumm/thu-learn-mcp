export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

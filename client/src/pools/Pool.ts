/**
 * Generic object pool for reusing objects and eliminating GC
 */
export class Pool<T> {
  private available: T[] = [];
  private active: Set<T> = new Set();
  private factory: () => T;
  private resetFn: (item: T) => void;
  
  constructor(
    factory: () => T,
    reset: (item: T) => void,
    initialSize: number = 100
  ) {
    this.factory = factory;
    this.resetFn = reset;
    
    // Pre-allocate objects
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }
  
  /**
   * Get an object from the pool (creates new if pool is empty)
   */
  acquire(): T {
    let item: T;
    
    if (this.available.length > 0) {
      item = this.available.pop()!;
    } else {
      item = this.factory();
    }
    
    this.active.add(item);
    return item;
  }
  
  /**
   * Return an object to the pool
   */
  release(item: T): void {
    if (!this.active.has(item)) return;
    
    this.active.delete(item);
    this.resetFn(item);
    this.available.push(item);
  }
  
  /**
   * Release all active objects back to pool
   */
  releaseAll(): void {
    for (const item of this.active) {
      this.resetFn(item);
      this.available.push(item);
    }
    this.active.clear();
  }
  
  /**
   * Get count of active objects
   */
  get activeCount(): number {
    return this.active.size;
  }
  
  /**
   * Get count of available objects
   */
  get availableCount(): number {
    return this.available.length;
  }
  
  /**
   * Get total pool size
   */
  get totalCount(): number {
    return this.active.size + this.available.length;
  }
  
  /**
   * Pre-warm the pool with additional objects
   */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      this.available.push(this.factory());
    }
  }
  
  /**
   * Clear the pool completely (destroys all objects)
   */
  clear(destroyFn?: (item: T) => void): void {
    if (destroyFn) {
      for (const item of this.active) {
        destroyFn(item);
      }
      for (const item of this.available) {
        destroyFn(item);
      }
    }
    this.active.clear();
    this.available = [];
  }
}


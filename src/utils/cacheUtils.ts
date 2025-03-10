import { log, LogLevel } from '../extension.js';

/**
 * Generic cache entry with value and expiration tracking
 */
interface CacheEntry<T> {
  value: T | Promise<T>;
  timestamp: number;
  namespace?: string;
}

/**
 * Generic reusable cache manager for the extension
 */
export class Cache {
  private caches: Map<string, Map<string, CacheEntry<any>>> = new Map();
  private defaultTtl: number = 15000; // 15 seconds default TTL

  /**
   * Constructor
   * @param defaultTtl Default time-to-live for cache entries in milliseconds
   */
  constructor(defaultTtl?: number) {
    if (defaultTtl) {
      this.defaultTtl = defaultTtl;
    }
  }

  /**
   * Get an item from cache or fetch it using the provided function
   * @param group The cache group (e.g., 'pods', 'namespaces')
   * @param key The cache key
   * @param fetchFn Function to call if cache is invalid
   * @param options Additional options
   */
  async getOrFetch<T>(
    group: string,
    key: string,
    fetchFn: () => Promise<T>,
    options: {
      ttl?: number;
      description?: string;
      namespace?: string;
    } = {}
  ): Promise<T> {
    const ttl = options.ttl || this.defaultTtl;
    const description = options.description || `${group}/${key}`;
    const now = Date.now();

    // Check if we already have a valid cache entry.
    const cacheItem = this.get<T>(group, key);
    if (cacheItem && this.isValid(cacheItem.timestamp, ttl)) {
      if (options.namespace && cacheItem.namespace !== options.namespace) {
        log(`Cache namespace mismatch for ${description}, fetching...`, LogLevel.DEBUG);
      } else {
        log(`Using cached ${description}`, LogLevel.DEBUG);
        // Wrap in Promise.resolve in case the stored value is already a Promise.
        return Promise.resolve(cacheItem.value);
      }
    }

    // No valid cache entry exists, so create one immediately.
    const fetchPromise = fetchFn();
    // Store the in-flight promise in the cache.
    this.set<T>(group, key, fetchPromise, options.namespace);
    try {
      const result = await fetchPromise;
      // Once resolved, update the cache with the actual result and a fresh timestamp.
      this.set<T>(group, key, result, options.namespace);
      return result;
    } catch (error) {
      // Optionally, remove the failed cache entry so that the next call will try again.
      // For example:
      this.clear(group);
      log(`Error fetching ${description}: ${error}`, LogLevel.ERROR);
      throw error;
    }
  }

  /**
   * Check if a cache timestamp is still valid
   */
  private isValid(timestamp: number, ttl: number): boolean {
    return Date.now() - timestamp < ttl;
  }

  /**
   * Get an item from cache
   */
  get<T>(group: string, key: string): CacheEntry<T> | undefined {
    if (!this.caches.has(group)) {
      return undefined;
    }

    return this.caches.get(group)?.get(key) as CacheEntry<T> | undefined;
  }

  /**
   * Store an item in cache
   */
  set<T>(group: string, key: string, value: T | Promise<T>, namespace?: string): void {
    if (!this.caches.has(group)) {
      this.caches.set(group, new Map());
    }
    this.caches.get(group)?.set(key, {
      value,
      timestamp: Date.now(),
      namespace,
    });
  }

  /**
   * Clear a specific cache group
   */
  clear(group: string): void {
    this.caches.delete(group);
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.caches.clear();
  }

  /**
   * Remove a specific item from a cache group
   * @param group The cache group
   * @param key The cache key to remove
   * @returns true if the item was removed, false if not found
   */
  remove(group: string, key: string): boolean {
    if (!this.caches.has(group)) {
      return false;
    }
    
    const groupCache = this.caches.get(group);
    if (!groupCache) {
      return false;
    }
    
    return groupCache.delete(key);
  }

}

// Export a singleton instance
export const cache = new Cache();
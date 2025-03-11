// src/services/cacheService.ts
import * as vscode from 'vscode';
import { CoreService } from './coreService';
import { LogLevel, log } from '../extension';

/**
 * Cache options
 */
export interface CacheOptions {
  ttl: number;
  description: string;
  namespace?: string;
}

/**
 * Cache item
 */
interface CacheItem<T> {
  data: T;
  timestamp: number;
  options: CacheOptions;
}

/**
 * Service for caching resources and data
 * Extracted from the original cache utility
 */
export class CacheService extends CoreService {
  private store: Map<string, Map<string, CacheItem<any>>> = new Map();
  private _onDidClearCache = new vscode.EventEmitter<string>();
  readonly onDidClearCache = this._onDidClearCache.event;
  
  constructor() {
    super('Cache');
  }
  
  /**
   * Get or fetch data from cache
   * @param group Cache group
   * @param key Cache key
   * @param fetcher Function to fetch data if not cached or expired
   * @param options Cache options
   * @returns Cached or fetched data
   */
  public async getOrFetch<T>(
    group: string,
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions
  ): Promise<T> {
    // Get or create group
    if (!this.store.has(group)) {
      this.store.set(group, new Map());
    }
    
    const groupMap = this.store.get(group)!;
    const cacheKey = `${options.namespace || 'global'}:${key}`;
    const now = Date.now();
    
    // Check if we have a valid cached item
    if (groupMap.has(cacheKey)) {
      const item = groupMap.get(cacheKey)!;
      
      // If not expired, return cached data
      if (now - item.timestamp < item.options.ttl) {
        return item.data as T;
      }
    }
    
    // If not in cache or expired, fetch data
    log(`Cache miss for ${group}/${key} (${options.description})`, LogLevel.DEBUG);
    
    try {
      const data = await fetcher();
      
      // Cache the fetched data
      groupMap.set(cacheKey, {
        data,
        timestamp: now,
        options
      });
      
      return data;
    } catch (error) {
      log(`Error fetching data for ${group}/${key}: ${error}`, LogLevel.ERROR);
      throw error;
    }
  }
  
  /**
   * Get cached item if exists
   * @param group Cache group
   * @param key Cache key
   * @param namespace Namespace (optional)
   * @returns Cached item or undefined
   */
  public get<T>(group: string, key: string, namespace?: string): T | undefined {
    const groupMap = this.store.get(group);
    if (!groupMap) {
      return undefined;
    }
    
    const cacheKey = `${namespace || 'global'}:${key}`;
    const item = groupMap.get(cacheKey);
    if (!item) {
      return undefined;
    }
    
    // Check if expired
    if (Date.now() - item.timestamp >= item.options.ttl) {
      return undefined;
    }
    
    return item.data as T;
  }
  
  /**
   * Set cache item
   * @param group Cache group
   * @param key Cache key
   * @param data Data to cache
   * @param options Cache options
   */
  public set<T>(group: string, key: string, data: T, options: CacheOptions): void {
    if (!this.store.has(group)) {
      this.store.set(group, new Map());
    }
    
    const groupMap = this.store.get(group)!;
    const cacheKey = `${options.namespace || 'global'}:${key}`;
    
    groupMap.set(cacheKey, {
      data,
      timestamp: Date.now(),
      options
    });
  }
  
  /**
   * Remove cache item
   * @param group Cache group
   * @param key Cache key
   * @param namespace Namespace (optional)
   */
  public remove(group: string, key: string, namespace?: string): void {
    const groupMap = this.store.get(group);
    if (!groupMap) {
      return;
    }
    
    const cacheKey = `${namespace || 'global'}:${key}`;
    groupMap.delete(cacheKey);
  }
  
  /**
   * Clear all items in a cache group
   * @param group Cache group
   */
  public clear(group: string): void {
    if (this.store.has(group)) {
      this.store.get(group)!.clear();
      this._onDidClearCache.fire(group);
      this.logWithPrefix(`Cleared cache group: ${group}`, LogLevel.DEBUG);
    }
  }
  
  /**
   * Clear all cache items
   */
  public clearAll(): void {
    this.logWithPrefix('Clearing all cache items', LogLevel.INFO);
    
    for (const group of this.store.keys()) {
      this.clear(group);
    }
  }
  
  /**
   * Clear cache items for a specific namespace
   * @param namespace Namespace
   */
  public clearNamespace(namespace: string): void {
    this.logWithPrefix(`Clearing cache for namespace: ${namespace}`, LogLevel.INFO);
    
    const clearedGroups = new Set<string>();
    
    for (const [group, groupMap] of this.store.entries()) {
      const keysToDelete: string[] = [];
      
      for (const [key, item] of groupMap.entries()) {
        if (item.options.namespace === namespace) {
          keysToDelete.push(key);
        }
      }
      
      for (const key of keysToDelete) {
        groupMap.delete(key);
      }
      
      if (keysToDelete.length > 0) {
        clearedGroups.add(group);
      }
    }
    
    // Fire events for all affected groups
    for (const group of clearedGroups) {
      this._onDidClearCache.fire(group);
    }
  }
  
  /**
   * Get cache statistics
   * @returns Cache statistics
   */
  public getStats(): { groups: number; items: number; size: number } {
    let totalItems = 0;
    let approximateSize = 0;
    
    for (const groupMap of this.store.values()) {
      totalItems += groupMap.size;
      
      // Roughly estimate the memory size
      for (const item of groupMap.values()) {
        // Add fixed overhead for each item
        approximateSize += 200;
        
        // Add estimate for data
        const data = item.data;
        if (data) {
          if (Array.isArray(data)) {
            approximateSize += data.length * 100;
          } else if (typeof data === 'object') {
            approximateSize += Object.keys(data).length * 100;
          }
        }
      }
    }
    
    return {
      groups: this.store.size,
      items: totalItems,
      size: approximateSize
    };
  }
  
  /**
   * Dispose cache service
   */
  public override dispose(): void {
    this.store.clear();
    this._onDidClearCache.dispose();
    super.dispose();
  }
}
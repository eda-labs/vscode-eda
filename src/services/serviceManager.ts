// src/services/serviceManager.ts
import * as vscode from 'vscode';
import { LogLevel, log } from '../extension';
import { KubernetesClient } from '../clients/kubernetesClient';
import { CoreService } from './coreService';

/**
 * Central registry and lifecycle manager for all services
 */
export class ServiceManager {
  private services: Map<string, CoreService> = new Map();
  private clients: Map<string, any> = new Map();
  private isInitialized: boolean = false;

  constructor() {}

  /**
   * Register a service
   * @param name Service name
   * @param service Service instance
   */
  public registerService<T extends CoreService>(name: string, service: T): T {
    if (this.services.has(name)) {
      throw new Error(`Service ${name} is already registered`);
    }

    this.services.set(name, service);
    return service;
  }

  /**
   * Register a client
   * @param name Client name
   * @param client Client instance
   */
  public registerClient<T>(name: string, client: T): T {
    if (this.clients.has(name)) {
      throw new Error(`Client ${name} is already registered`);
    }

    this.clients.set(name, client);
    return client;
  }

  /**
   * Get a service by name
   * @param name Service name
   * @returns Service instance
   */
  public getService<T extends CoreService>(name: string): T {
    const service = this.services.get(name) as T;

    if (!service) {
      throw new Error(`Service ${name} is not registered`);
    }

    return service;
  }

  /**
   * Get a client by name
   * @param name Client name
   * @returns Client instance
   */
  public getClient<T>(name: string): T {
    const client = this.clients.get(name) as T;

    if (!client) {
      throw new Error(`Client ${name} is not registered`);
    }

    return client;
  }

  /**
   * Get all registered service names
   */
  public getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get all registered client names
   */
  public getClientNames(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Dispose all services
   */
  public dispose(): void {
    log('Disposing service manager...', LogLevel.INFO);

    for (const [name, service] of this.services.entries()) {
      try {
        service.dispose();
        log(`Service ${name} disposed`, LogLevel.DEBUG);
      } catch (error) {
        log(`Error disposing service ${name}: ${error}`, LogLevel.ERROR);
      }
    }

    this.services.clear();
    this.clients.clear();
    this.isInitialized = false;

    log('Service manager disposed', LogLevel.INFO);
  }
}

// Singleton instance
export const serviceManager = new ServiceManager();
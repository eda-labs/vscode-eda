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
   * Initialize all services
   * @param context VSCode extension context
   */
  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    log('Initializing service manager...', LogLevel.INFO, true);
    
    try {
      // Initialize clients first
      await this.initializeClients();
      
      // Initialize services
      await this.initializeServices(context);
      
      // Register disposal of services
      context.subscriptions.push({
        dispose: () => this.dispose()
      });
      
      this.isInitialized = true;
      log('Service manager initialized successfully', LogLevel.INFO, true);
    } catch (error) {
      log(`Error initializing service manager: ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }
  
  /**
   * Initialize clients
   */
  private async initializeClients(): Promise<void> {
    log('Initializing clients...', LogLevel.INFO);
    
    // Initialize Kubernetes client
    const k8sClient = new KubernetesClient();
    this.registerClient('kubernetes', k8sClient);
    
    // Additional clients will be added here
    
    log('Clients initialized successfully', LogLevel.INFO);
  }
  
  /**
   * Initialize services
   */
  private async initializeServices(context: vscode.ExtensionContext): Promise<void> {
    log('Initializing services...', LogLevel.INFO);
    
    // Initialize CacheService first as other services depend on it
    // Services will be registered as they're implemented
    
    // Connect event handlers between services
    this.connectServiceEvents();
    
    log('Services initialized successfully', LogLevel.INFO);
  }
  
  /**
   * Connect event handlers between services for propagation of events
   */
  private connectServiceEvents(): void {
    // Handle namespace changes across services
    for (const service of this.services.values()) {
      service.onDidChangeNamespace(namespace => {
        for (const otherService of this.services.values()) {
          if (otherService !== service) {
            otherService.setNamespace(namespace, false);
          }
        }
      });
    }
  }
  
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
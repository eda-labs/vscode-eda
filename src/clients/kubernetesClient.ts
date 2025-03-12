import {
  KubeConfig,
  ApiextensionsV1Api,
  CustomObjectsApi,
  ApisApi
} from '@kubernetes/client-node';
import { log } from '../extension';

/**
 * Client for interacting with Kubernetes API in a generic way.
 * Only this class is allowed to import from '@kubernetes/client-node'.
 */
export class KubernetesClient {
  private kc: KubeConfig;
  private apiExtensionsV1Api: ApiextensionsV1Api;
  private customObjectsApi: CustomObjectsApi;
  private apisApi: ApisApi;

  constructor() {
    this.kc = new KubeConfig();
    try {
      this.kc.loadFromDefault();
    } catch (error) {
      log(`Failed to load Kubernetes configuration: ${error}`, /* LogLevel.INFO */);
    }

    this.apiExtensionsV1Api = this.kc.makeApiClient(ApiextensionsV1Api);
    this.customObjectsApi = this.kc.makeApiClient(CustomObjectsApi);
    this.apisApi = this.kc.makeApiClient(ApisApi);
  }

  /**
   * List all CustomResourceDefinitions
   */
  public async listCustomResourceDefinitions(): Promise<any[]> {
    try {
      const resp = await this.apiExtensionsV1Api.listCustomResourceDefinition();
      return resp.body.items || [];
    } catch (error) {
      log(`Error listing CRDs: ${error}`, /* LogLevel.INFO */);
      return [];
    }
  }

  /**
   * List cluster-scoped objects for a given CRD
   */
  public async listClusterCustomObject(
    group: string,
    version: string,
    plural: string
  ): Promise<{ items: any[] }> {
    try {
      const res = await this.customObjectsApi.listClusterCustomObject(group, version, plural);
      return res.body as { items: any[] };
    } catch (error) {
      throw new Error(`listClusterCustomObject failed: ${error}`);
    }
  }

  /**
   * List namespaced objects for a given CRD
   */
  public async listNamespacedCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string
  ): Promise<{ items: any[] }> {
    try {
      const res = await this.customObjectsApi.listNamespacedCustomObject(
        group,
        version,
        namespace,
        plural
      );
      return res.body as { items: any[] };
    } catch (error) {
      throw new Error(`listNamespacedCustomObject failed: ${error}`);
    }
  }

  /**
   * Get all items for a cluster-scoped resource path
   * This function is used generically for e.g. 'namespaces' (core) if needed
   */
  public async listClusterCustomObjectGeneric(
    group: string,
    version: string,
    plural: string
  ): Promise<{ items: any[] }> {
    try {
      const res = await this.customObjectsApi.listClusterCustomObject(group, version, plural);
      return res.body as { items: any[] };
    } catch (error) {
      throw new Error(`listClusterCustomObjectGeneric failed: ${error}`);
    }
  }

  /**
   * Helper for listing cluster resources (like "namespaces"),
   * which might have an empty group but a version of "v1".
   */
  public async listClusterCustomObjectCore(
    version: string,
    plural: string
  ): Promise<{ items: any[] }> {
    // group = '' for core resources
    return this.listClusterCustomObjectGeneric('', version, plural);
  }
}

import { Agent, fetch } from 'undici';

interface TokenResponse {
  access_token: string;
}

interface KeycloakClient {
  id: string;
  clientId: string;
}

interface ClientSecretResponse {
  value?: string;
}

export async function fetchClientSecretDirectly(
  baseUrl: string,
  kcUsername: string,
  kcPassword: string
): Promise<string> {
  // Ensure baseUrl doesn't have trailing slash
  baseUrl = baseUrl.replace(/\/$/, '');

  const kcUrl = `${baseUrl}/core/httpproxy/v1/keycloak`;
  const agent = new Agent({ connect: { rejectUnauthorized: false } });

  // Step 1: Get admin token
  const adminTokenUrl = `${kcUrl}/realms/master/protocol/openid-connect/token`;
  const adminTokenRes = await fetch(adminTokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: kcUsername,
      password: kcPassword
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    dispatcher: agent
  });

  if (!adminTokenRes.ok) {
    const errorText = await adminTokenRes.text();
    throw new Error(
      `Failed to authenticate with Keycloak admin: ${adminTokenRes.status} ${adminTokenRes.statusText}. ${errorText}`
    );
  }

  const adminTokenData = (await adminTokenRes.json()) as TokenResponse;
  const adminToken = adminTokenData.access_token;

  // Step 2: List clients to find EDA client
  const clientsUrl = `${kcUrl}/admin/realms/eda/clients`;
  const clientsRes = await fetch(clientsUrl, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    dispatcher: agent
  });

  if (!clientsRes.ok) {
    throw new Error(`Failed to list clients: ${clientsRes.status}`);
  }

  const clients = (await clientsRes.json()) as KeycloakClient[];
  const edaClient = clients.find((c) => c.clientId === 'eda');

  if (!edaClient) {
    throw new Error('EDA client not found in Keycloak');
  }

  // Step 3: Get client secret
  const secretUrl = `${clientsUrl}/${edaClient.id}/client-secret`;
  const secretRes = await fetch(secretUrl, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    dispatcher: agent
  });

  if (!secretRes.ok) {
    throw new Error(`Failed to fetch client secret: ${secretRes.status}`);
  }

  const secretData = (await secretRes.json()) as ClientSecretResponse;
  return secretData.value || '';
}

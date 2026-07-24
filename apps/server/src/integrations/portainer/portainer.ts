export interface PortainerStackRef {
  id: number;
  name: string;
  endpointId: number;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function portainerLogin(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${trimBaseUrl(baseUrl)}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(res.status === 401 ? 'Portainer rejected that username/password' : `Portainer login failed (${res.status})`);
  }
  const data = (await res.json()) as { jwt?: string };
  if (!data.jwt) throw new Error('Portainer login did not return a token');
  return data.jwt;
}

/**
 * Portainer stack "Type": 1 = Swarm, 2 = standalone Compose. Only Type 2 has a docker-compose.yml that we can use.
 * @param baseUrl string
 * @param username string
 * @param password string
 * @returns PortainerStackRef[]
 */
export async function listPortainerStacks(
  baseUrl: string,
  username: string,
  password: string
): Promise<PortainerStackRef[]> {
  const jwt = await portainerLogin(baseUrl, username, password);
  const res = await fetch(`${trimBaseUrl(baseUrl)}/api/stacks`, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Could not list Portainer stacks (${res.status})`);
  }
  
  const data = (await res.json()) as Array<{ Id: number; Name: string; EndpointId: number; Type: number }>;
  return data.filter((s) => s.Type === 2).map((s) => ({ id: s.Id, name: s.Name, endpointId: s.EndpointId }));
}

/**
 * Get a portainer stack file
 * @param baseUrl string
 * @param username string
 * @param password string
 * @param id number
 * @returns 
 */
export async function getPortainerStackFile(
  baseUrl: string,
  username: string,
  password: string,
  id: number
): Promise<string> {
  const jwt = await portainerLogin(baseUrl, username, password);
  const res = await fetch(`${trimBaseUrl(baseUrl)}/api/stacks/${id}/file`, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Could not fetch that stack's compose file (${res.status})`);
  }
  
  const data = (await res.json()) as { StackFileContent?: string };
  
  if (!data.StackFileContent) {
    throw new Error('Portainer returned an empty stack file');
  }
  
  return data.StackFileContent;
}

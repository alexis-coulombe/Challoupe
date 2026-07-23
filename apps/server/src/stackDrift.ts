import YAML from 'yaml';
import type Dockerode from 'dockerode';

export interface StackDriftResult {
  inSync: boolean;
  // Declared in the compose file, but no running-or-stopped container for it.
  missingServices: string[];
  // A container Compose tagged as part of this project, but whose service name isn't in the compose file.
  orphanedContainers: Array<{ id: string; name: string; service: string | null }>;
  // A service present in both, but the running container's image doesn't match what the file currently specifies.
  imageMismatches: Array<{ service: string; expectedImage: string; actualImage: string }>;
}

function parseServices(composeText: string): Record<string, { image?: string }> {
  const parsed = YAML.parse(composeText) as { services?: Record<string, { image?: string }> } | null;
  return parsed?.services ?? {};
}

/**
 * Check stack drift for a stack
 * @param composeText string
 * @param ownContainers Dockerode.ContainerInfo[]
 * @returns StackDriftResult
 */
export function computeStackDrift(
  composeText: string,
  ownContainers: Dockerode.ContainerInfo[]
): StackDriftResult {
  const services = parseServices(composeText);
  const serviceNames = new Set(Object.keys(services));

  const seenServices = new Set<string>();
  const orphanedContainers: StackDriftResult['orphanedContainers'] = [];
  const imageMismatches: StackDriftResult['imageMismatches'] = [];

  for (const c of ownContainers) {
    const service = c.Labels['com.docker.compose.service'] ?? null;
    const name = (c.Names[0] ?? '').replace(/^\//, '');
    if (!service || !serviceNames.has(service)) {
      orphanedContainers.push({ id: c.Id, name, service });
      continue;
    }
    seenServices.add(service);
    const expectedImage = services[service]?.image;
    if (expectedImage && c.Image !== expectedImage) {
      imageMismatches.push({ service, expectedImage, actualImage: c.Image });
    }
  }

  const missingServices = [...serviceNames].filter((s) => !seenServices.has(s));

  return {
    inSync: missingServices.length === 0 && orphanedContainers.length === 0 && imageMismatches.length === 0,
    missingServices,
    orphanedContainers,
    imageMismatches,
  };
}

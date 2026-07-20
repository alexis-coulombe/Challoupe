// Compares what a stack's compose file declares against the containers Docker Compose
// itself tagged as belonging to that project (the same com.docker.compose.project/service
// labels Compose sets on every container it creates) — a pure function over already-fetched
// data so it's cheap to run for every stack in the list view, and easy to unit-test without
// a real Docker daemon.
import YAML from 'yaml';
import type Dockerode from 'dockerode';

export interface StackDriftResult {
  inSync: boolean;
  // Declared in the compose file, but no running-or-stopped container for it — someone
  // removed it outside Challoupe, or it was never deployed after being added to the file.
  missingServices: string[];
  // A container Compose tagged as part of this project, but whose service name isn't (or
  // no longer is) in the compose file — what `--remove-orphans` would clean up on redeploy.
  orphanedContainers: Array<{ id: string; name: string; service: string | null }>;
  // A service present in both, but the running container's image doesn't match what the
  // file currently specifies — a tag bump not yet redeployed, or a manual `docker run`/
  // `docker update` outside Challoupe. Services built from a Dockerfile (no `image:` key)
  // aren't comparable this way and are silently skipped rather than flagged.
  imageMismatches: Array<{ service: string; expectedImage: string; actualImage: string }>;
}

function parseServices(composeText: string): Record<string, { image?: string }> {
  const parsed = YAML.parse(composeText) as { services?: Record<string, { image?: string }> } | null;
  return parsed?.services ?? {};
}

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

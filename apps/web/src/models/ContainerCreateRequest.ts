export interface ContainerCreateRequest {
  name?: string;
  image: string;
  network?: string;
  command: string[];
  workingDir?: string;
  user?: string;
  labels: string[];
  env: string[];
  ports: Array<{ host: number; container: number; protocol: 'tcp' | 'udp' }>;
  volumes: Array<{ host: string; container: string }>;
  restartPolicy: string;
  privileged: boolean;
  autoRemove: boolean;
  memoryMb?: number;
  cpus?: number;
}

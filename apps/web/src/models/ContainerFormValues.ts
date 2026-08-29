export interface ContainerFormValues {
  name?: string;
  image: string;
  network?: string;
  command?: string;
  workingDir?: string;
  user?: string;
  labels?: Array<{ value: string }>;
  ports?: Array<{ host: number; container: number; protocol: 'tcp' | 'udp' }>;
  env?: Array<{ value: string }>;
  volumes?: Array<{ host: string; container: string }>;
  restartPolicy: string;
  privileged?: boolean;
  autoRemove?: boolean;
  memoryMb?: number;
  cpus?: number;
}

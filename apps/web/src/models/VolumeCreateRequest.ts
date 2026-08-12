export interface VolumeCreateRequest {
  name: string;
  driver: string;
  driverOpts?: Record<string, string>;
}

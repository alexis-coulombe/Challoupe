// Builds a same-origin ws:// or wss:// URL, matching the page's protocol.
export function wsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class Api {
  /**
   * Base api request
   * @param path string
   * @param options RequestInit
   * @returns Response data
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api${path}`, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });

    if (res.status === 401 && !path.startsWith('/auth')) {
      window.location.href = '/login';
    }

    const data = (await res.json().catch(() => null)) as { error?: string; details?: string[] } | null;

    if (!res.ok) {
      const detail = data?.details?.length ? data.details.join('; ') : undefined;
      throw new ApiError(res.status, detail ?? data?.error ?? `Error ${res.status}`);
    }

    return data as T;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new Api();

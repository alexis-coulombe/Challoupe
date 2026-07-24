import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import Containers from '../../src/pages/Containers';
import { api } from '../../src/api';
import { AuthProvider } from '../../src/auth';
import { HostProvider } from '../../src/hosts';

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

function renderContainers() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <MemoryRouter>
          <AuthProvider>
            <HostProvider>
              <Containers />
            </HostProvider>
          </AuthProvider>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>
  );
}

describe('Containers create form', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/hosts/local/containers') return [];
      if (path === '/hosts/local/networks') return [];
      if (path === '/hosts') return [];
      if (path === '/settings') return { defaultRestartPolicy: 'no' };
      if (path === '/auth/status') {
        return { setupRequired: false, user: { id: 1, username: 'admin', role: 'admin', created_at: '' } };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    vi.mocked(api.post).mockResolvedValue({ id: 'new-id' });
  });

  it('submits sensible defaults for a minimal container', async () => {
    renderContainers();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Create container/ }));
    await user.type(screen.getByPlaceholderText(/nginx:alpine/), 'alpine:latest');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/hosts/local/containers',
        expect.objectContaining({
          image: 'alpine:latest',
          command: [],
          labels: [],
          env: [],
          ports: [],
          volumes: [],
          privileged: false,
          autoRemove: false,
        })
      )
    );
  });

  it('splits the command field and maps labels from the advanced section', async () => {
    renderContainers();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Create container/ }));
    await user.type(screen.getByPlaceholderText(/nginx:alpine/), 'myapp:latest');

    await user.click(screen.getByText('Advanced settings'));
    await user.type(await screen.findByPlaceholderText('e.g. npm start'), 'npm run start');
    await user.click(screen.getByRole('button', { name: /Add label/ }));
    await user.type(screen.getByPlaceholderText('KEY=value'), 'team=infra');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/hosts/local/containers',
        expect.objectContaining({
          image: 'myapp:latest',
          command: ['npm', 'run', 'start'],
          labels: ['team=infra'],
        })
      )
    );
  });
});

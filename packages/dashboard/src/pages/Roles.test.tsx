import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Roles } from './Roles';
import * as api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  fetchRoles: vi.fn(),
  fetchRole: vi.fn(),
  fetchWhoami: vi.fn(),
}));

const mockFetchRoles = api.fetchRoles as ReturnType<typeof vi.fn>;
const mockFetchRole = api.fetchRole as ReturnType<typeof vi.fn>;
const mockFetchWhoami = api.fetchWhoami as ReturnType<typeof vi.fn>;

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ADMIN_ROLE: api.Role = {
  name: 'admin',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions', 'budgets'],
        verbs: ['get', 'list', 'create', 'update', 'delete', 'allocate'],
        maxAllocation: 500,
      },
    ],
  },
};

const VIEWER_ROLE: api.Role = {
  name: 'viewer',
  namespace: 'production',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions'],
        verbs: ['get', 'list'],
      },
    ],
  },
};

describe('Roles page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the page title', () => {
    mockFetchRoles.mockResolvedValue({ roles: [] });
    mockFetchWhoami.mockResolvedValue({ user: null });
    renderWithProviders(<Roles />);
    expect(screen.getByText('RBAC Roles')).toBeInTheDocument();
  });

  it('displays role cards', async () => {
    mockFetchRoles.mockResolvedValue({ roles: [ADMIN_ROLE, VIEWER_ROLE] });
    mockFetchWhoami.mockResolvedValue({ user: null });
    renderWithProviders(<Roles />);

    await waitFor(() => {
      expect(screen.getByText('admin')).toBeInTheDocument();
      expect(screen.getByText('viewer')).toBeInTheDocument();
    });

    // Viewer role shows namespace
    expect(screen.getByText(/production/)).toBeInTheDocument();
  });

  it('shows current user info', async () => {
    mockFetchRoles.mockResolvedValue({ roles: [ADMIN_ROLE] });
    mockFetchWhoami.mockResolvedValue({
      user: { name: 'alice', roles: ['admin'] },
    });
    renderWithProviders(<Roles />);

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('Current User')).toBeInTheDocument();
    });
  });

  it('shows role detail when clicked', async () => {
    mockFetchRoles.mockResolvedValue({ roles: [ADMIN_ROLE] });
    mockFetchWhoami.mockResolvedValue({ user: null });
    mockFetchRole.mockResolvedValue(ADMIN_ROLE);

    renderWithProviders(<Roles />);

    await waitFor(() => {
      expect(screen.getByText('admin')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('admin'));

    await waitFor(() => {
      // Detail panel renders
      expect(screen.getByText('Resources')).toBeInTheDocument();
      expect(screen.getByText('Verbs')).toBeInTheDocument();
      expect(screen.getByText('$500.00')).toBeInTheDocument();
    });
  });

  it('shows cluster-wide badge for roles without namespace', async () => {
    mockFetchRoles.mockResolvedValue({ roles: [ADMIN_ROLE] });
    mockFetchWhoami.mockResolvedValue({ user: null });
    renderWithProviders(<Roles />);

    await waitFor(() => {
      expect(screen.getAllByText(/cluster-wide/).length).toBeGreaterThan(0);
    });
  });
});

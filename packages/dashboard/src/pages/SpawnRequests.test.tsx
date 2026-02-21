import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SpawnRequests } from './SpawnRequests';
import * as api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  fetchSpawnRequests: vi.fn(),
  approveSpawnRequest: vi.fn(),
  rejectSpawnRequest: vi.fn(),
}));

const mockFetchSpawnRequests = api.fetchSpawnRequests as ReturnType<typeof vi.fn>;
const mockApprove = api.approveSpawnRequest as ReturnType<typeof vi.fn>;

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

const PENDING_REQUEST: api.SpawnRequest = {
  id: 1,
  name: 'db-specialist',
  namespace: 'production',
  requestorCellId: 'backend-team',
  requestedSpec: {
    name: 'db-specialist',
    systemPrompt: 'You are a database expert.',
    model: 'claude-sonnet-4-20250514',
    budget: 15,
    canSpawnChildren: false,
  },
  reason: 'Need a DB expert for schema migration',
  status: 'Pending',
  createdAt: '2026-02-21T12:00:00Z',
};

const APPROVED_REQUEST: api.SpawnRequest = {
  ...PENDING_REQUEST,
  id: 2,
  name: 'ui-designer',
  status: 'Approved',
  decidedBy: 'admin',
  decidedAt: '2026-02-21T13:00:00Z',
};

describe('SpawnRequests page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the page title', async () => {
    mockFetchSpawnRequests.mockResolvedValue({ requests: [] });
    renderWithProviders(<SpawnRequests />);
    expect(screen.getByText('Spawn Requests')).toBeInTheDocument();
  });

  it('displays pending and approved requests', async () => {
    mockFetchSpawnRequests.mockResolvedValue({
      requests: [PENDING_REQUEST, APPROVED_REQUEST],
    });
    renderWithProviders(<SpawnRequests />);

    await waitFor(() => {
      expect(screen.getByText('db-specialist')).toBeInTheDocument();
      expect(screen.getByText('ui-designer')).toBeInTheDocument();
    });

    // Pending request has Approve/Reject buttons
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('shows pending count badge', async () => {
    mockFetchSpawnRequests.mockResolvedValue({
      requests: [PENDING_REQUEST],
    });
    renderWithProviders(<SpawnRequests />);

    await waitFor(() => {
      expect(screen.getByText('1 pending')).toBeInTheDocument();
    });
  });

  it('shows request details including system prompt and budget', async () => {
    mockFetchSpawnRequests.mockResolvedValue({
      requests: [PENDING_REQUEST],
    });
    renderWithProviders(<SpawnRequests />);

    await waitFor(() => {
      expect(screen.getByText('You are a database expert.')).toBeInTheDocument();
      expect(screen.getByText('$15.00')).toBeInTheDocument();
      expect(screen.getByText('Need a DB expert for schema migration')).toBeInTheDocument();
    });
  });

  it('can approve a request', async () => {
    mockFetchSpawnRequests.mockResolvedValue({ requests: [PENDING_REQUEST] });
    mockApprove.mockResolvedValue({ ...PENDING_REQUEST, status: 'Approved' });

    renderWithProviders(<SpawnRequests />);

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith(1);
    });
  });

  it('shows filter buttons', async () => {
    mockFetchSpawnRequests.mockResolvedValue({ requests: [] });
    renderWithProviders(<SpawnRequests />);

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});

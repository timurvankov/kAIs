import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CellTree } from './CellTree';
import * as api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  fetchCellTree: vi.fn(),
  fetchBudgetTree: vi.fn(),
}));

const mockFetchCellTree = api.fetchCellTree as ReturnType<typeof vi.fn>;
const mockFetchBudgetTree = api.fetchBudgetTree as ReturnType<typeof vi.fn>;

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

describe('CellTree page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the page title and search input', () => {
    renderWithProviders(<CellTree />);
    expect(screen.getByText('Cell Tree')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter root cell ID...')).toBeInTheDocument();
  });

  it('loads and displays a tree after search', async () => {
    mockFetchCellTree.mockResolvedValue({
      root: 'root',
      nodes: [
        { cellId: 'root', parentId: null, rootId: 'root', depth: 0, path: 'root', descendantCount: 1, namespace: 'default' },
        { cellId: 'child', parentId: 'root', rootId: 'root', depth: 1, path: 'root/child', descendantCount: 0, namespace: 'default' },
      ],
    });
    mockFetchBudgetTree.mockResolvedValue({ tree: [] });

    renderWithProviders(<CellTree />);

    const input = screen.getByPlaceholderText('Enter root cell ID...');
    fireEvent.change(input, { target: { value: 'root' } });
    fireEvent.click(screen.getByText('Load Tree'));

    await waitFor(() => {
      expect(screen.getByText('root')).toBeInTheDocument();
      expect(screen.getByText('2 nodes from root: root')).toBeInTheDocument();
    });
  });

  it('displays budget info when budget tree is available', async () => {
    mockFetchCellTree.mockResolvedValue({
      root: 'lead',
      nodes: [
        { cellId: 'lead', parentId: null, rootId: 'lead', depth: 0, path: 'lead', descendantCount: 0, namespace: 'default' },
      ],
    });
    mockFetchBudgetTree.mockResolvedValue({
      tree: [{
        cellId: 'lead',
        balance: { cellId: 'lead', allocated: 100, spent: 20, delegated: 30, available: 50 },
        children: [],
      }],
    });

    renderWithProviders(<CellTree />);

    const input = screen.getByPlaceholderText('Enter root cell ID...');
    fireEvent.change(input, { target: { value: 'lead' } });
    fireEvent.click(screen.getByText('Load Tree'));

    await waitFor(() => {
      expect(screen.getByText('$50.00 avail')).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    mockFetchCellTree.mockRejectedValue(new Error('404: Cell not found'));
    mockFetchBudgetTree.mockRejectedValue(new Error('404'));

    renderWithProviders(<CellTree />);

    const input = screen.getByPlaceholderText('Enter root cell ID...');
    fireEvent.change(input, { target: { value: 'missing' } });
    fireEvent.click(screen.getByText('Load Tree'));

    await waitFor(() => {
      expect(screen.getByText(/404: Cell not found/)).toBeInTheDocument();
    });
  });
});

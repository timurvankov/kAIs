import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchSpawnRequests,
  approveSpawnRequest,
  rejectSpawnRequest,
  type SpawnRequest,
} from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-500/20 text-yellow-300',
  Approved: 'bg-green-500/20 text-green-300',
  Rejected: 'bg-red-500/20 text-red-300',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}

function RequestCard({
  request,
  onApprove,
  onReject,
  isLoading,
}: {
  request: SpawnRequest;
  onApprove: () => void;
  onReject: (reason: string) => void;
  isLoading: boolean;
}) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-blue-400">{request.name}</span>
            <StatusBadge status={request.status} />
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Requested by <span className="text-gray-400">{request.requestorCellId}</span>
            {' '}in <span className="text-gray-400">{request.namespace}</span>
            {' '}&middot; {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <span className="text-xs text-gray-600">#{request.id}</span>
      </div>

      {request.reason && (
        <div className="text-sm text-gray-400 mb-3">
          {request.reason}
        </div>
      )}

      <div className="bg-gray-800 rounded p-3 mb-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-gray-500">Model:</span>{' '}
            <span className="text-gray-300">{request.requestedSpec.model ?? 'default'}</span>
          </div>
          <div>
            <span className="text-gray-500">Provider:</span>{' '}
            <span className="text-gray-300">{request.requestedSpec.provider ?? 'default'}</span>
          </div>
          {request.requestedSpec.budget !== undefined && (
            <div>
              <span className="text-gray-500">Budget:</span>{' '}
              <span className="text-green-400">${request.requestedSpec.budget.toFixed(2)}</span>
            </div>
          )}
          {request.requestedSpec.canSpawnChildren !== undefined && (
            <div>
              <span className="text-gray-500">Can spawn:</span>{' '}
              <span className="text-gray-300">{request.requestedSpec.canSpawnChildren ? 'Yes' : 'No'}</span>
            </div>
          )}
        </div>
        <div className="mt-2">
          <span className="text-gray-500">System prompt:</span>
          <div className="text-gray-300 mt-1 whitespace-pre-wrap">{request.requestedSpec.systemPrompt}</div>
        </div>
      </div>

      {request.decidedBy && (
        <div className="text-xs text-gray-500 mb-2">
          {request.status === 'Approved' ? 'Approved' : 'Rejected'} by {request.decidedBy}
          {request.decidedAt && ` on ${new Date(request.decidedAt).toLocaleString()}`}
          {request.rejectionReason && (
            <span className="text-red-400"> &mdash; {request.rejectionReason}</span>
          )}
        </div>
      )}

      {request.status === 'Pending' && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={onApprove}
            disabled={isLoading}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
          >
            Approve
          </button>
          {!showRejectForm ? (
            <button
              onClick={() => setShowRejectForm(true)}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
            >
              Reject
            </button>
          ) : (
            <div className="flex gap-2 flex-1">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason..."
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white flex-1 focus:outline-none focus:border-red-500"
              />
              <button
                onClick={() => {
                  onReject(rejectReason);
                  setShowRejectForm(false);
                }}
                disabled={isLoading}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => setShowRejectForm(false)}
                className="text-gray-400 hover:text-white px-2 text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SpawnRequests() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['spawnRequests', statusFilter],
    queryFn: () => fetchSpawnRequests(statusFilter ? { status: statusFilter } : undefined),
  });

  const approveMut = useMutation({
    mutationFn: (id: number) => approveSpawnRequest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spawnRequests'] }),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectSpawnRequest(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['spawnRequests'] }),
  });

  const requests = query.data?.requests ?? [];
  const pendingCount = requests.filter((r) => r.status === 'Pending').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">
          Spawn Requests
          {pendingCount > 0 && (
            <span className="ml-2 text-sm font-normal bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded">
              {pendingCount} pending
            </span>
          )}
        </h2>
      </div>

      <div className="flex gap-2 mb-6">
        {['', 'Pending', 'Approved', 'Rejected'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded text-sm ${
              statusFilter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {status || 'All'}
          </button>
        ))}
      </div>

      {query.isLoading && <p className="text-gray-400">Loading...</p>}
      {query.error && (
        <p className="text-red-400">Error: {(query.error as Error).message}</p>
      )}

      <div className="space-y-4">
        {requests.map((req) => (
          <RequestCard
            key={req.id}
            request={req}
            isLoading={approveMut.isPending || rejectMut.isPending}
            onApprove={() => approveMut.mutate(req.id)}
            onReject={(reason) => rejectMut.mutate({ id: req.id, reason })}
          />
        ))}
        {!query.isLoading && requests.length === 0 && (
          <p className="text-gray-500 text-sm">No spawn requests found.</p>
        )}
      </div>
    </div>
  );
}

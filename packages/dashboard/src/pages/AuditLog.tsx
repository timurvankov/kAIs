import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAuditLog } from '@/lib/api';

export function AuditLog() {
  const [filters, setFilters] = useState<{
    actor: string;
    action: string;
    resourceType: string;
  }>({ actor: '', action: '', resourceType: '' });

  const query = useQuery({
    queryKey: ['auditLog', filters],
    queryFn: () =>
      fetchAuditLog({
        actor: filters.actor || undefined,
        action: filters.action || undefined,
        resourceType: filters.resourceType || undefined,
        limit: 100,
      }),
  });

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Audit Log</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={filters.actor}
          onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
          placeholder="Filter by actor..."
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-40 focus:outline-none focus:border-blue-500"
        />
        <select
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">All actions</option>
          <option value="create">create</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
          <option value="get">get</option>
        </select>
        <input
          type="text"
          value={filters.resourceType}
          onChange={(e) => setFilters((f) => ({ ...f, resourceType: e.target.value }))}
          placeholder="Resource type..."
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white w-40 focus:outline-none focus:border-blue-500"
        />
      </div>

      {query.isLoading && <p className="text-gray-400">Loading...</p>}
      {query.error && (
        <p className="text-red-400">Error: {(query.error as Error).message}</p>
      )}

      {entries.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-2">
            Showing {entries.length} of {total} entries
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Actor</th>
                  <th className="py-2 px-3">Action</th>
                  <th className="py-2 px-3">Resource</th>
                  <th className="py-2 px-3">Namespace</th>
                  <th className="py-2 px-3">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-gray-300">{entry.actor}</td>
                    <td className="py-2 px-3">
                      <span className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded text-xs">
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-blue-400 text-xs">
                      {entry.resourceType}
                      {entry.resourceId && `/${entry.resourceId}`}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">{entry.namespace}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        entry.outcome === 'success'
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {entry.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!query.isLoading && entries.length === 0 && (
        <p className="text-gray-500 text-sm">No audit entries found.</p>
      )}
    </div>
  );
}

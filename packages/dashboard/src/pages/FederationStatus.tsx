import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFederations, fetchFederation, type Federation } from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-500/20 text-yellow-300',
  Active: 'bg-green-500/20 text-green-300',
  Degraded: 'bg-orange-500/20 text-orange-300',
  Error: 'bg-red-500/20 text-red-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

function ClusterHealthDot({ lastHeartbeat }: { lastHeartbeat?: string }) {
  if (!lastHeartbeat) return <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" title="No heartbeat" />;

  const ageMs = Date.now() - new Date(lastHeartbeat).getTime();
  const ageSec = ageMs / 1000;

  let color = 'bg-green-500';
  if (ageSec > 120) color = 'bg-red-500';
  else if (ageSec > 60) color = 'bg-yellow-500';

  return (
    <span
      className={`w-2 h-2 rounded-full ${color} inline-block`}
      title={`Last heartbeat: ${Math.round(ageSec)}s ago`}
    />
  );
}

function FederationDetailView({ federation }: { federation: Federation }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{federation.name}</h3>
        <PhaseBadge phase={federation.status.phase} />
        <span className="text-xs text-gray-500">{federation.namespace}</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{federation.status.readyClusters}</div>
          <div className="text-xs text-gray-500">Ready / {federation.status.totalClusters} Total</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{federation.status.scheduledCells}</div>
          <div className="text-xs text-gray-500">Scheduled Cells</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-300">{federation.spec.scheduling.strategy.replace(/_/g, ' ')}</div>
          <div className="text-xs text-gray-500">Scheduling Strategy</div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Clusters</h4>
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                <th className="py-2 px-3 w-6">Health</th>
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Endpoint</th>
                <th className="py-2 px-3">Capacity</th>
                <th className="py-2 px-3">Labels</th>
                <th className="py-2 px-3">Last Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {federation.spec.clusters.map((cluster) => (
                <tr key={cluster.name} className="border-t border-gray-800 hover:bg-gray-800/50">
                  <td className="py-2 px-3">
                    <ClusterHealthDot lastHeartbeat={cluster.lastHeartbeat} />
                  </td>
                  <td className="py-2 px-3 font-mono text-blue-400">{cluster.name}</td>
                  <td className="py-2 px-3 text-xs text-gray-400 font-mono">{cluster.endpoint}</td>
                  <td className="py-2 px-3">
                    {cluster.capacity ? (
                      <div className="text-xs">
                        <span className="text-gray-300">{cluster.capacity.availableCells}</span>
                        <span className="text-gray-600"> / {cluster.capacity.maxCells}</span>
                        <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{
                              width: `${((cluster.capacity.maxCells - cluster.capacity.availableCells) / cluster.capacity.maxCells) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {cluster.labels && Object.keys(cluster.labels).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(cluster.labels).map(([k, v]) => (
                          <span key={k} className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs">
                            {k}={v}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-400">
                    {cluster.lastHeartbeat
                      ? new Date(cluster.lastHeartbeat).toLocaleString()
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {federation.spec.scheduling.labelSelector && Object.keys(federation.spec.scheduling.labelSelector).length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-400 mb-2">Label Selector</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(federation.spec.scheduling.labelSelector).map(([k, v]) => (
              <span key={k} className="bg-gray-800 text-gray-300 px-2 py-1 rounded text-xs font-mono">
                {k}={v}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded p-3 text-xs text-gray-400">
        <span className="text-gray-500">NATS leafnode port:</span>{' '}
        <span className="text-gray-300">{federation.spec.natsLeafnodePort}</span>
      </div>

      {federation.status.message && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-gray-400">
          {federation.status.message}
        </div>
      )}
    </div>
  );
}

export default function FederationStatusPage() {
  const [selectedFederation, setSelectedFederation] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['federations'],
    queryFn: () => fetchFederations(),
  });

  const detailQuery = useQuery({
    queryKey: ['federation', selectedFederation],
    queryFn: () => fetchFederation(selectedFederation!),
    enabled: !!selectedFederation,
  });

  const federations = listQuery.data?.federations ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Federation Status</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading federations...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {federations.map((fed) => (
          <button
            key={fed.name}
            onClick={() => setSelectedFederation(fed.name === selectedFederation ? null : fed.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedFederation === fed.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white">{fed.name}</span>
              <PhaseBadge phase={fed.status.phase} />
            </div>
            <div className="text-xs text-gray-500">
              {fed.status.readyClusters}/{fed.status.totalClusters} clusters &middot;{' '}
              {fed.status.scheduledCells} cells &middot;{' '}
              {fed.spec.scheduling.strategy.replace(/_/g, ' ')}
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && federations.length === 0 && (
        <p className="text-gray-500 text-sm">No federations found.</p>
      )}

      {selectedFederation && detailQuery.isLoading && (
        <p className="text-gray-400">Loading federation details...</p>
      )}
      {selectedFederation && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <FederationDetailView federation={detailQuery.data} />}
    </div>
  );
}

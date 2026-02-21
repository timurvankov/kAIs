import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSwarms, fetchSwarm, type Swarm } from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Active: 'bg-green-500/20 text-green-300',
  Suspended: 'bg-yellow-500/20 text-yellow-300',
  Error: 'bg-red-500/20 text-red-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

function ReplicaBar({ current, desired, max }: { current: number; desired: number; max: number }) {
  if (max <= 0) return null;
  const currentPct = (current / max) * 100;
  const desiredPct = (desired / max) * 100;

  return (
    <div className="relative">
      <div className="w-full h-4 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 rounded-full transition-all"
          style={{ width: `${currentPct}%` }}
        />
      </div>
      {desired !== current && (
        <div
          className="absolute top-0 h-4 border-r-2 border-yellow-400"
          style={{ left: `${desiredPct}%` }}
          title={`Desired: ${desired}`}
        />
      )}
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>0</span>
        <span>{max} max</span>
      </div>
    </div>
  );
}

function SwarmDetailView({ swarm }: { swarm: Swarm }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{swarm.name}</h3>
        <PhaseBadge phase={swarm.status.phase} />
        <span className="text-xs text-gray-500">{swarm.namespace}</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{swarm.status.currentReplicas}</div>
          <div className="text-xs text-gray-500">Current Replicas</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{swarm.status.desiredReplicas}</div>
          <div className="text-xs text-gray-500">Desired Replicas</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">
            {swarm.status.lastTriggerValue !== undefined
              ? swarm.status.lastTriggerValue.toFixed(2)
              : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Trigger Value</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-300">
            {swarm.status.lastScaleTime
              ? new Date(swarm.status.lastScaleTime).toLocaleTimeString()
              : 'Never'}
          </div>
          <div className="text-xs text-gray-500">Last Scale Time</div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Replica Scale</h4>
        <ReplicaBar
          current={swarm.status.currentReplicas}
          desired={swarm.status.desiredReplicas}
          max={swarm.spec.scaling.maxReplicas}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Trigger Config</h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">Type:</span>{' '}
              <span className="text-blue-400">{swarm.spec.trigger.type.replace(/_/g, ' ')}</span>
            </div>
            {swarm.spec.trigger.threshold !== undefined && (
              <div>
                <span className="text-gray-500">Threshold:</span>{' '}
                <span className="text-gray-300">{swarm.spec.trigger.threshold}</span>
              </div>
            )}
            {swarm.spec.trigger.metricName && (
              <div>
                <span className="text-gray-500">Metric:</span>{' '}
                <span className="text-gray-300">{swarm.spec.trigger.metricName}</span>
              </div>
            )}
            {swarm.spec.trigger.schedule && (
              <div>
                <span className="text-gray-500">Schedule:</span>{' '}
                <span className="text-gray-300">{swarm.spec.trigger.schedule}</span>
              </div>
            )}
            {swarm.spec.trigger.above !== undefined && (
              <div>
                <span className="text-gray-500">Scale up above:</span>{' '}
                <span className="text-gray-300">{swarm.spec.trigger.above}</span>
              </div>
            )}
            {swarm.spec.trigger.below !== undefined && (
              <div>
                <span className="text-gray-500">Scale down below:</span>{' '}
                <span className="text-gray-300">{swarm.spec.trigger.below}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Scaling Config</h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">Range:</span>{' '}
              <span className="text-gray-300">{swarm.spec.scaling.minReplicas} - {swarm.spec.scaling.maxReplicas}</span>
            </div>
            <div>
              <span className="text-gray-500">Step:</span>{' '}
              <span className="text-gray-300">{swarm.spec.scaling.step}</span>
            </div>
            <div>
              <span className="text-gray-500">Cooldown:</span>{' '}
              <span className="text-gray-300">{swarm.spec.scaling.cooldownSeconds}s</span>
            </div>
            <div>
              <span className="text-gray-500">Stabilization:</span>{' '}
              <span className="text-gray-300">{swarm.spec.scaling.stabilizationSeconds}s</span>
            </div>
            <div>
              <span className="text-gray-500">Drain grace:</span>{' '}
              <span className="text-gray-300">{swarm.spec.drainGracePeriodSeconds}s</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded p-3 text-xs text-gray-400">
        <span className="text-gray-500">Cell template:</span>{' '}
        <span className="font-mono text-blue-400">{swarm.spec.cellTemplate}</span> &middot;{' '}
        <span className="text-gray-500">Formation:</span>{' '}
        <span className="font-mono text-blue-400">{swarm.spec.formationRef}</span>
        {swarm.spec.budget?.maxCostPerHour !== undefined && (
          <>
            {' '}&middot;{' '}
            <span className="text-gray-500">Budget:</span>{' '}
            <span className="text-green-400">${swarm.spec.budget.maxCostPerHour.toFixed(2)}/hr</span>
          </>
        )}
      </div>

      {swarm.status.history && swarm.status.history.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Scaling History</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">From</th>
                  <th className="py-2 px-3">To</th>
                  <th className="py-2 px-3">Trigger</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {swarm.status.history.map((event, i) => (
                  <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {new Date(event.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-gray-300">{event.fromReplicas}</td>
                    <td className="py-2 px-3">
                      <span className={event.toReplicas > event.fromReplicas ? 'text-green-400' : 'text-red-400'}>
                        {event.toReplicas}
                        {event.toReplicas > event.fromReplicas ? ' \u2191' : ' \u2193'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {event.triggerValue !== undefined ? event.triggerValue.toFixed(2) : '-'}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">{event.reason ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {swarm.status.message && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-gray-400">
          {swarm.status.message}
        </div>
      )}
    </div>
  );
}

export default function SwarmStatusPage() {
  const [selectedSwarm, setSelectedSwarm] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['swarms'],
    queryFn: () => fetchSwarms(),
  });

  const detailQuery = useQuery({
    queryKey: ['swarm', selectedSwarm],
    queryFn: () => fetchSwarm(selectedSwarm!),
    enabled: !!selectedSwarm,
  });

  const swarms = listQuery.data?.swarms ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Swarm Status</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading swarms...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {swarms.map((s) => (
          <button
            key={s.name}
            onClick={() => setSelectedSwarm(s.name === selectedSwarm ? null : s.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedSwarm === s.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white">{s.name}</span>
              <PhaseBadge phase={s.status.phase} />
            </div>
            <div className="text-xs text-gray-500">
              {s.status.currentReplicas}/{s.spec.scaling.maxReplicas} replicas &middot;{' '}
              {s.spec.trigger.type.replace(/_/g, ' ')} &middot;{' '}
              Trigger: {s.status.lastTriggerValue?.toFixed(1) ?? 'N/A'}
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && swarms.length === 0 && (
        <p className="text-gray-500 text-sm">No swarms found.</p>
      )}

      {selectedSwarm && detailQuery.isLoading && (
        <p className="text-gray-400">Loading swarm details...</p>
      )}
      {selectedSwarm && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <SwarmDetailView swarm={detailQuery.data} />}
    </div>
  );
}

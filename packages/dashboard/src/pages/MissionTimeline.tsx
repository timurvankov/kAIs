import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMissions, fetchMission, type Mission } from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-500/20 text-yellow-300',
  Running: 'bg-blue-500/20 text-blue-300',
  Succeeded: 'bg-green-500/20 text-green-300',
  Failed: 'bg-red-500/20 text-red-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

const CHECK_STATUS_COLORS: Record<string, string> = {
  Pending: 'text-yellow-400',
  Passed: 'text-green-400',
  Failed: 'text-red-400',
  Error: 'text-orange-400',
};

const CHECK_ICONS: Record<string, string> = {
  Pending: '\u25CB',
  Passed: '\u2713',
  Failed: '\u2717',
  Error: '!',
};

function MissionDetailView({ mission }: { mission: Mission }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{mission.name}</h3>
        <PhaseBadge phase={mission.status.phase} />
        <span className="text-xs text-gray-500">{mission.namespace}</span>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-400 mb-2 font-medium">Objective</div>
        <div className="text-white text-sm">{mission.spec.objective}</div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{mission.status.attempt}</div>
          <div className="text-xs text-gray-500">Attempt / {mission.spec.completion.maxAttempts} max</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">${mission.status.cost.toFixed(4)}</div>
          <div className="text-xs text-gray-500">Cost{mission.spec.budget ? ` / $${mission.spec.budget.maxCost.toFixed(2)} max` : ''}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm font-mono text-blue-400">{mission.spec.entrypoint.cell}</div>
          <div className="text-xs text-gray-500">Entrypoint Cell</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm font-mono text-gray-300">{mission.spec.completion.timeout}</div>
          <div className="text-xs text-gray-500">Timeout</div>
        </div>
      </div>

      {mission.spec.budget && mission.spec.budget.maxCost > 0 && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Cost Progress</span>
            <span>{((mission.status.cost / mission.spec.budget.maxCost) * 100).toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${mission.status.cost / mission.spec.budget.maxCost > 0.9 ? 'bg-red-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min((mission.status.cost / mission.spec.budget.maxCost) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {mission.status.checks && mission.status.checks.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Completion Checks</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
            {mission.status.checks.map((check) => (
              <div key={check.name} className="flex items-center gap-3">
                <span className={`font-mono text-lg ${CHECK_STATUS_COLORS[check.status] ?? 'text-gray-500'}`}>
                  {CHECK_ICONS[check.status] ?? '?'}
                </span>
                <span className="text-sm text-white">{check.name}</span>
                <span className={`text-xs ${CHECK_STATUS_COLORS[check.status] ?? 'text-gray-500'}`}>
                  {check.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mission.status.history && mission.status.history.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Attempt History</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="py-2 px-3">Attempt</th>
                  <th className="py-2 px-3">Started</th>
                  <th className="py-2 px-3">Result</th>
                </tr>
              </thead>
              <tbody>
                {mission.status.history.map((entry) => (
                  <tr key={entry.attempt} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 text-gray-300">#{entry.attempt}</td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {new Date(entry.startedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        entry.result === 'succeeded' ? 'bg-green-500/20 text-green-300'
                        : entry.result === 'failed' ? 'bg-red-500/20 text-red-300'
                        : 'bg-gray-700 text-gray-300'
                      }`}>
                        {entry.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mission.status.message && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-gray-400">
          {mission.status.message}
        </div>
      )}

      <div className="bg-gray-800 rounded p-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          {mission.spec.formationRef && (
            <div>
              <span className="text-gray-500">Formation:</span>{' '}
              <span className="text-blue-400 font-mono">{mission.spec.formationRef}</span>
            </div>
          )}
          {mission.spec.cellRef && (
            <div>
              <span className="text-gray-500">Cell:</span>{' '}
              <span className="text-blue-400 font-mono">{mission.spec.cellRef}</span>
            </div>
          )}
          {mission.status.startedAt && (
            <div>
              <span className="text-gray-500">Started:</span>{' '}
              <span className="text-gray-300">{new Date(mission.status.startedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MissionTimeline() {
  const [selectedMission, setSelectedMission] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['missions'],
    queryFn: () => fetchMissions(),
  });

  const detailQuery = useQuery({
    queryKey: ['mission', selectedMission],
    queryFn: () => fetchMission(selectedMission!),
    enabled: !!selectedMission,
  });

  const missions = listQuery.data?.missions ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Mission Timeline</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading missions...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="space-y-2 mb-6">
        {missions.map((m) => (
          <button
            key={m.name}
            onClick={() => setSelectedMission(m.name === selectedMission ? null : m.name)}
            className={`w-full text-left p-4 rounded-lg border transition-colors ${
              selectedMission === m.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PhaseBadge phase={m.status.phase} />
                <span className="font-medium text-white">{m.name}</span>
                <span className="text-xs text-gray-500">{m.namespace}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Attempt {m.status.attempt}/{m.spec.completion.maxAttempts}</span>
                <span className="text-green-400">${m.status.cost.toFixed(4)}</span>
              </div>
            </div>
            <div className="text-xs text-gray-400 mt-1 truncate">{m.spec.objective}</div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && missions.length === 0 && (
        <p className="text-gray-500 text-sm">No missions found.</p>
      )}

      {selectedMission && detailQuery.isLoading && (
        <p className="text-gray-400">Loading mission details...</p>
      )}
      {selectedMission && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <MissionDetailView mission={detailQuery.data} />}
    </div>
  );
}

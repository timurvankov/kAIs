import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFormations, fetchFormation, type Formation } from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-500/20 text-yellow-300',
  Running: 'bg-green-500/20 text-green-300',
  Paused: 'bg-blue-500/20 text-blue-300',
  Completed: 'bg-gray-500/20 text-gray-300',
  Failed: 'bg-red-500/20 text-red-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

function TopologyVisualization({ topology }: { topology: Formation['spec']['topology'] }) {
  const { type, root, hub, routes } = topology;

  return (
    <div className="bg-gray-800 rounded p-4 text-sm font-mono">
      <div className="text-gray-500 mb-2">Topology: <span className="text-blue-400">{type}</span></div>
      {root && <div className="text-gray-400">Root: <span className="text-white">{root}</span></div>}
      {hub && <div className="text-gray-400">Hub: <span className="text-white">{hub}</span></div>}
      {type === 'full_mesh' && (
        <div className="text-gray-400 mt-2">All cells connected to each other</div>
      )}
      {type === 'ring' && (
        <div className="text-gray-400 mt-2">Cells connected in a ring</div>
      )}
      {type === 'star' && hub && (
        <div className="mt-2 text-gray-400">
          <div className="text-center text-white mb-1">[{hub}]</div>
          <div className="text-center text-gray-600">|--- all cells connect through hub ---|</div>
        </div>
      )}
      {type === 'hierarchy' && root && (
        <div className="mt-2 text-gray-400">
          <div className="text-white">[{root}]</div>
          <div className="ml-4 text-gray-600">|-- child cells --</div>
        </div>
      )}
      {routes && routes.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-gray-500">Routes:</div>
          {routes.map((r, i) => (
            <div key={i} className="ml-2 text-gray-400">
              <span className="text-white">{r.from}</span>
              <span className="text-gray-600"> --{'>'} </span>
              <span className="text-white">{r.to.join(', ')}</span>
              {r.protocol && <span className="text-gray-600 ml-2">({r.protocol})</span>}
            </div>
          ))}
        </div>
      )}
      {topology.broadcast?.enabled && (
        <div className="mt-2 text-gray-400">
          Broadcast from: <span className="text-white">{topology.broadcast.from.join(', ')}</span>
        </div>
      )}
      {topology.blackboard && (
        <div className="mt-2 text-gray-400">
          Blackboard decay: <span className="text-white">{topology.blackboard.decayMinutes}m</span>
        </div>
      )}
    </div>
  );
}

function BudgetBreakdown({ budget, totalCost }: { budget?: Formation['spec']['budget']; totalCost: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-400 mb-3">Budget</h4>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500">Total spent:</span>
          <span className="text-red-400 ml-2">${totalCost.toFixed(4)}</span>
        </div>
        {budget?.maxTotalCost !== undefined && (
          <div>
            <span className="text-gray-500">Max total:</span>
            <span className="text-green-400 ml-2">${budget.maxTotalCost.toFixed(2)}</span>
          </div>
        )}
        {budget?.maxCostPerHour !== undefined && (
          <div>
            <span className="text-gray-500">Max/hour:</span>
            <span className="text-yellow-400 ml-2">${budget.maxCostPerHour.toFixed(2)}</span>
          </div>
        )}
      </div>
      {budget?.maxTotalCost !== undefined && budget.maxTotalCost > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Usage</span>
            <span>{((totalCost / budget.maxTotalCost) * 100).toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${totalCost / budget.maxTotalCost > 0.9 ? 'bg-red-500' : totalCost / budget.maxTotalCost > 0.7 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min((totalCost / budget.maxTotalCost) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
      {budget?.allocation && Object.keys(budget.allocation).length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1">Allocation:</div>
          {Object.entries(budget.allocation).map(([cell, amount]) => (
            <div key={cell} className="text-xs text-gray-400 ml-2">
              {cell}: <span className="text-gray-300">{amount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormationDetailView({ formation }: { formation: Formation }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{formation.name}</h3>
        <PhaseBadge phase={formation.status.phase} />
        <span className="text-xs text-gray-500">{formation.namespace}</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{formation.status.readyCells}</div>
          <div className="text-xs text-gray-500">Ready / {formation.status.totalCells} Total</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">${formation.status.totalCost.toFixed(4)}</div>
          <div className="text-xs text-gray-500">Total Cost</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{formation.spec.cells.length}</div>
          <div className="text-xs text-gray-500">Cell Templates</div>
        </div>
      </div>

      {formation.status.message && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-gray-400">
          {formation.status.message}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Cells</h4>
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Replicas</th>
                <th className="py-2 px-3">Model</th>
                <th className="py-2 px-3">Phase</th>
                <th className="py-2 px-3">Cost</th>
              </tr>
            </thead>
            <tbody>
              {formation.spec.cells.map((cell) => {
                const cellStatus = formation.status.cells?.find((c) => c.name === cell.name);
                return (
                  <tr key={cell.name} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 font-mono text-blue-400">{cell.name}</td>
                    <td className="py-2 px-3 text-gray-300">{cell.replicas}</td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {cell.spec.mind.provider}/{cell.spec.mind.model}
                    </td>
                    <td className="py-2 px-3">
                      {cellStatus ? <PhaseBadge phase={cellStatus.phase} /> : <span className="text-gray-600">-</span>}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {cellStatus ? `$${cellStatus.cost.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Topology</h4>
        <TopologyVisualization topology={formation.spec.topology} />
      </div>

      <BudgetBreakdown budget={formation.spec.budget} totalCost={formation.status.totalCost} />
    </div>
  );
}

export default function FormationDetail() {
  const [selectedFormation, setSelectedFormation] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['formations'],
    queryFn: () => fetchFormations(),
  });

  const detailQuery = useQuery({
    queryKey: ['formation', selectedFormation],
    queryFn: () => fetchFormation(selectedFormation!),
    enabled: !!selectedFormation,
  });

  const formations = listQuery.data?.formations ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Formations</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading formations...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        {formations.map((f) => (
          <button
            key={f.name}
            onClick={() => setSelectedFormation(f.name === selectedFormation ? null : f.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedFormation === f.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white">{f.name}</span>
              <PhaseBadge phase={f.status.phase} />
            </div>
            <div className="text-xs text-gray-500">
              {f.status.readyCells}/{f.status.totalCells} cells &middot;{' '}
              ${f.status.totalCost.toFixed(4)} &middot;{' '}
              {f.spec.topology.type}
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && formations.length === 0 && (
        <p className="text-gray-500 text-sm">No formations found.</p>
      )}

      {selectedFormation && detailQuery.isLoading && (
        <p className="text-gray-400">Loading formation details...</p>
      )}
      {selectedFormation && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <FormationDetailView formation={detailQuery.data} />}
    </div>
  );
}

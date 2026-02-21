import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBlueprints, fetchBlueprint, type Blueprint } from '@/lib/api';

function ParameterTypeTag({ type }: { type: string }) {
  const colors: Record<string, string> = {
    string: 'bg-blue-500/20 text-blue-300',
    integer: 'bg-green-500/20 text-green-300',
    number: 'bg-green-500/20 text-green-300',
    boolean: 'bg-yellow-500/20 text-yellow-300',
    enum: 'bg-purple-500/20 text-purple-300',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${colors[type] ?? 'bg-gray-700 text-gray-300'}`}>
      {type}
    </span>
  );
}

function BlueprintDetailView({ blueprint }: { blueprint: Blueprint }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{blueprint.name}</h3>
        <span className="text-xs text-gray-500">{blueprint.namespace}</span>
      </div>

      {blueprint.spec.description && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm text-gray-300">
          {blueprint.spec.description}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{blueprint.status.usageCount}</div>
          <div className="text-xs text-gray-500">Total Uses</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">
            {blueprint.status.avgSuccessRate !== undefined
              ? `${(blueprint.status.avgSuccessRate * 100).toFixed(0)}%`
              : 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Success Rate</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-300">
            {blueprint.status.lastUsed
              ? new Date(blueprint.status.lastUsed).toLocaleDateString()
              : 'Never'}
          </div>
          <div className="text-xs text-gray-500">Last Used</div>
        </div>
      </div>

      {blueprint.spec.parameters.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Parameters</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="py-2 px-3">Name</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Default</th>
                  <th className="py-2 px-3">Constraints</th>
                  <th className="py-2 px-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {blueprint.spec.parameters.map((p) => (
                  <tr key={p.name} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 font-mono text-blue-400">{p.name}</td>
                    <td className="py-2 px-3">
                      <ParameterTypeTag type={p.type} />
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {p.default !== undefined ? String(p.default) : '-'}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {p.values && p.values.length > 0 && (
                        <span>enum: [{p.values.map(String).join(', ')}]</span>
                      )}
                      {p.min !== undefined && <span>min: {p.min} </span>}
                      {p.max !== undefined && <span>max: {p.max}</span>}
                      {!p.values?.length && p.min === undefined && p.max === undefined && '-'}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {p.description ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {blueprint.spec.evidence && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Evidence</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-3 gap-4 text-sm">
              {blueprint.spec.evidence.successRate !== undefined && (
                <div>
                  <span className="text-gray-500">Success Rate:</span>{' '}
                  <span className="text-green-400">{(blueprint.spec.evidence.successRate * 100).toFixed(0)}%</span>
                </div>
              )}
              {blueprint.spec.evidence.avgCompletionTime !== undefined && (
                <div>
                  <span className="text-gray-500">Avg Completion:</span>{' '}
                  <span className="text-gray-300">{blueprint.spec.evidence.avgCompletionTime.toFixed(1)}s</span>
                </div>
              )}
              {blueprint.spec.evidence.avgCost !== undefined && (
                <div>
                  <span className="text-gray-500">Avg Cost:</span>{' '}
                  <span className="text-green-400">${blueprint.spec.evidence.avgCost.toFixed(4)}</span>
                </div>
              )}
            </div>

            {blueprint.spec.evidence.experiments && blueprint.spec.evidence.experiments.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Experiment Findings:</div>
                <div className="space-y-2">
                  {blueprint.spec.evidence.experiments.map((exp, i) => (
                    <div key={i} className="bg-gray-800 rounded p-2">
                      <div className="text-xs font-mono text-blue-400">{exp.name}</div>
                      <div className="text-xs text-gray-300 mt-1">{exp.finding}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {blueprint.status.versions && blueprint.status.versions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Version History</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="py-2 px-3">Version</th>
                  <th className="py-2 px-3">Created</th>
                  <th className="py-2 px-3">Changes</th>
                </tr>
              </thead>
              <tbody>
                {blueprint.status.versions.map((v) => (
                  <tr key={v.version} className="border-t border-gray-800">
                    <td className="py-2 px-3 text-gray-300">v{v.version}</td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">{v.changes ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BlueprintCatalog() {
  const [selectedBlueprint, setSelectedBlueprint] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['blueprints'],
    queryFn: () => fetchBlueprints(),
  });

  const detailQuery = useQuery({
    queryKey: ['blueprint', selectedBlueprint],
    queryFn: () => fetchBlueprint(selectedBlueprint!),
    enabled: !!selectedBlueprint,
  });

  const blueprints = listQuery.data?.blueprints ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Blueprint Catalog</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading blueprints...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {blueprints.map((bp) => (
          <button
            key={bp.name}
            onClick={() => setSelectedBlueprint(bp.name === selectedBlueprint ? null : bp.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedBlueprint === bp.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="font-medium text-white mb-1">{bp.name}</div>
            {bp.spec.description && (
              <div className="text-xs text-gray-400 mb-2 line-clamp-2">{bp.spec.description}</div>
            )}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{bp.spec.parameters.length} params</span>
              <span>{bp.status.usageCount} uses</span>
              {bp.status.avgSuccessRate !== undefined && (
                <span className="text-green-400">
                  {(bp.status.avgSuccessRate * 100).toFixed(0)}% success
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && blueprints.length === 0 && (
        <p className="text-gray-500 text-sm">No blueprints found.</p>
      )}

      {selectedBlueprint && detailQuery.isLoading && (
        <p className="text-gray-400">Loading blueprint details...</p>
      )}
      {selectedBlueprint && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <BlueprintDetailView blueprint={detailQuery.data} />}
    </div>
  );
}

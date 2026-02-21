import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchExperiments, fetchExperiment, type Experiment } from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-500/20 text-yellow-300',
  Running: 'bg-blue-500/20 text-blue-300',
  Analyzing: 'bg-purple-500/20 text-purple-300',
  Completed: 'bg-green-500/20 text-green-300',
  Failed: 'bg-red-500/20 text-red-300',
  Aborted: 'bg-gray-500/20 text-gray-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

const RUN_PHASE_COLORS: Record<string, string> = {
  pending: 'text-yellow-400',
  running: 'text-blue-400',
  succeeded: 'text-green-400',
  failed: 'text-red-400',
};

function ProgressBar({ completed, failed, total }: { completed: number; failed: number; total: number }) {
  if (total <= 0) return null;
  const completedPct = (completed / total) * 100;
  const failedPct = (failed / total) * 100;
  return (
    <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden flex">
      <div className="bg-green-500 h-full" style={{ width: `${completedPct}%` }} />
      <div className="bg-red-500 h-full" style={{ width: `${failedPct}%` }} />
    </div>
  );
}

function AnalysisDisplay({ analysis }: { analysis: unknown }) {
  if (!analysis) return null;

  const data = analysis as Record<string, unknown>;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-400 mb-3">Statistical Analysis</h4>
      <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-auto max-h-64">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function ExperimentDetailView({ experiment }: { experiment: Experiment }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{experiment.name}</h3>
        <PhaseBadge phase={experiment.status.phase} />
        <span className="text-xs text-gray-500">{experiment.namespace}</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{experiment.status.completedRuns}</div>
          <div className="text-xs text-gray-500">Completed / {experiment.status.totalRuns} total</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-400">{experiment.status.failedRuns}</div>
          <div className="text-xs text-gray-500">Failed Runs</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">${experiment.status.actualCost.toFixed(4)}</div>
          <div className="text-xs text-gray-500">
            Actual Cost{experiment.status.estimatedCost !== undefined ? ` / $${experiment.status.estimatedCost.toFixed(2)} est.` : ''}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm font-mono text-gray-300">
            {experiment.status.estimatedTimeRemaining ?? 'N/A'}
          </div>
          <div className="text-xs text-gray-500">Remaining</div>
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>
            {experiment.status.completedRuns + experiment.status.failedRuns} / {experiment.status.totalRuns}
          </span>
        </div>
        <ProgressBar
          completed={experiment.status.completedRuns}
          failed={experiment.status.failedRuns}
          total={experiment.status.totalRuns}
        />
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Variables</h4>
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                <th className="py-2 px-3">Variable</th>
                <th className="py-2 px-3">Values</th>
              </tr>
            </thead>
            <tbody>
              {experiment.spec.variables.map((v) => (
                <tr key={v.name} className="border-t border-gray-800">
                  <td className="py-2 px-3 font-mono text-blue-400">{v.name}</td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-1">
                      {v.values.map((val, i) => (
                        <span key={i} className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded text-xs">
                          {String(val)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Metrics</h4>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {experiment.spec.metrics.map((m) => (
            <div key={m.name} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="font-mono text-sm text-white">{m.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                Type: <span className="text-gray-400">{m.type}</span>
              </div>
              {m.description && (
                <div className="text-xs text-gray-400 mt-1">{m.description}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {experiment.status.currentRuns && experiment.status.currentRuns.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-3">Current Runs</h4>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-800">
                  <th className="py-2 px-3">Run ID</th>
                  <th className="py-2 px-3">Repeat</th>
                  <th className="py-2 px-3">Variables</th>
                  <th className="py-2 px-3">Phase</th>
                  <th className="py-2 px-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {experiment.status.currentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2 px-3 font-mono text-xs text-gray-300">{run.id}</td>
                    <td className="py-2 px-3 text-gray-400">#{run.repeat}</td>
                    <td className="py-2 px-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(run.variables).map(([k, v]) => (
                          <span key={k} className="bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded text-xs">
                            {k}={String(v)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <span className={RUN_PHASE_COLORS[run.phase] ?? 'text-gray-400'}>
                        {run.phase}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-400">
                      {run.cost !== undefined ? `$${run.cost.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnalysisDisplay analysis={experiment.status.analysis} />

      {experiment.status.suggestions && experiment.status.suggestions.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-400 mb-2">Suggestions</h4>
          <ul className="list-disc list-inside space-y-1">
            {experiment.status.suggestions.map((s, i) => (
              <li key={i} className="text-sm text-gray-300">{s}</li>
            ))}
          </ul>
        </div>
      )}

      {experiment.status.message && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm text-gray-400">
          {experiment.status.message}
        </div>
      )}

      <div className="bg-gray-800 rounded p-3 text-xs text-gray-400">
        <span className="text-gray-500">Repeats:</span> {experiment.spec.repeats} &middot;{' '}
        <span className="text-gray-500">Runtime:</span> {experiment.spec.runtime} &middot;{' '}
        <span className="text-gray-500">Parallel:</span> {experiment.spec.parallel} &middot;{' '}
        <span className="text-gray-500">Budget:</span> ${experiment.spec.budget.maxTotalCost.toFixed(2)}
        {experiment.spec.budget.abortOnOverBudget ? ' (abort on over)' : ''}
      </div>
    </div>
  );
}

export default function ExperimentResults() {
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['experiments'],
    queryFn: () => fetchExperiments(),
  });

  const detailQuery = useQuery({
    queryKey: ['experiment', selectedExperiment],
    queryFn: () => fetchExperiment(selectedExperiment!),
    enabled: !!selectedExperiment,
  });

  const experiments = listQuery.data?.experiments ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Experiment Results</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading experiments...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="space-y-2 mb-6">
        {experiments.map((exp) => (
          <button
            key={exp.name}
            onClick={() => setSelectedExperiment(exp.name === selectedExperiment ? null : exp.name)}
            className={`w-full text-left p-4 rounded-lg border transition-colors ${
              selectedExperiment === exp.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PhaseBadge phase={exp.status.phase} />
                <span className="font-medium text-white">{exp.name}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{exp.status.completedRuns}/{exp.status.totalRuns} runs</span>
                <span className="text-green-400">${exp.status.actualCost.toFixed(4)}</span>
              </div>
            </div>
            <div className="mt-2">
              <ProgressBar
                completed={exp.status.completedRuns}
                failed={exp.status.failedRuns}
                total={exp.status.totalRuns}
              />
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && experiments.length === 0 && (
        <p className="text-gray-500 text-sm">No experiments found.</p>
      )}

      {selectedExperiment && detailQuery.isLoading && (
        <p className="text-gray-400">Loading experiment details...</p>
      )}
      {selectedExperiment && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <ExperimentDetailView experiment={detailQuery.data} />}
    </div>
  );
}

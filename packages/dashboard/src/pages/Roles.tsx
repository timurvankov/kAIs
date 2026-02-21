import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRoles, fetchRole, fetchWhoami, type Role } from '@/lib/api';

function RuleRow({ rule, index }: { rule: Role['spec']['rules'][number]; index: number }) {
  return (
    <tr className="border-t border-gray-800">
      <td className="py-2 px-3 text-gray-500 text-xs">{index + 1}</td>
      <td className="py-2 px-3">
        <div className="flex flex-wrap gap-1">
          {rule.resources.map((r) => (
            <span key={r} className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded text-xs">
              {r}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 px-3">
        <div className="flex flex-wrap gap-1">
          {rule.verbs.map((v) => (
            <span key={v} className="bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded text-xs">
              {v}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 px-3 text-xs text-gray-400">
        {rule.maxAllocation !== undefined ? `$${rule.maxAllocation.toFixed(2)}` : '-'}
      </td>
    </tr>
  );
}

function RoleDetail({ roleName }: { roleName: string }) {
  const query = useQuery({
    queryKey: ['role', roleName],
    queryFn: () => fetchRole(roleName),
  });

  if (query.isLoading) return <p className="text-gray-400 p-4">Loading...</p>;
  if (query.error) return <p className="text-red-400 p-4">Error loading role</p>;
  if (!query.data) return null;

  const role = query.data;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-lg font-bold text-white">{role.name}</h3>
        <span className={`px-2 py-0.5 rounded text-xs ${
          role.namespace
            ? 'bg-orange-500/20 text-orange-300'
            : 'bg-green-500/20 text-green-300'
        }`}>
          {role.namespace ?? 'cluster-wide'}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs">
            <th className="py-2 px-3 w-8">#</th>
            <th className="py-2 px-3">Resources</th>
            <th className="py-2 px-3">Verbs</th>
            <th className="py-2 px-3 w-28">Max Alloc</th>
          </tr>
        </thead>
        <tbody>
          {role.spec.rules.map((rule, i) => (
            <RuleRow key={i} rule={rule} index={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Roles() {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: fetchRoles,
  });

  const whoamiQuery = useQuery({
    queryKey: ['whoami'],
    queryFn: fetchWhoami,
  });

  const roles = rolesQuery.data?.roles ?? [];
  const user = whoamiQuery.data?.user;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">RBAC Roles</h2>

      {user && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <div className="text-sm text-gray-500 mb-1">Current User</div>
          <div className="flex items-center gap-3">
            <span className="text-white font-medium">{user.name}</span>
            <div className="flex gap-1">
              {user.roles.map((r) => (
                <span
                  key={r}
                  className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-xs cursor-pointer hover:bg-blue-500/30"
                  onClick={() => setSelectedRole(r)}
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {rolesQuery.isLoading && <p className="text-gray-400">Loading roles...</p>}
      {rolesQuery.error && (
        <p className="text-red-400">Error: {(rolesQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {roles.map((role) => (
          <button
            key={role.name}
            onClick={() => setSelectedRole(role.name === selectedRole ? null : role.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedRole === role.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="font-medium text-white mb-1">{role.name}</div>
            <div className="text-xs text-gray-500">
              {role.namespace ?? 'cluster-wide'} &middot;{' '}
              {role.spec.rules.length} rule{role.spec.rules.length !== 1 ? 's' : ''}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {[...new Set(role.spec.rules.flatMap((r) => r.resources))].slice(0, 4).map((res) => (
                <span key={res} className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs">
                  {res}
                </span>
              ))}
              {[...new Set(role.spec.rules.flatMap((r) => r.resources))].length > 4 && (
                <span className="text-gray-500 text-xs">+more</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {selectedRole && <RoleDetail roleName={selectedRole} />}
    </div>
  );
}

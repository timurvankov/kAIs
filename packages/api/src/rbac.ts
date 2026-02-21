import type { AuthUser, RbacResource, RbacRule, RbacVerb, Role } from '@kais/core';

/**
 * Storage interface for RBAC data.
 * Allows plugging in Postgres, in-memory, or any other backing store.
 */
export interface RbacStore {
  getRolesByNames(names: string[]): Promise<Role[]>;
  getAllRoles(): Promise<Role[]>;
  getRole(name: string): Promise<Role | undefined>;
}

/**
 * In-memory RBAC store for static configuration (token-based auth).
 * Roles are loaded once at startup.
 */
export class InMemoryRbacStore implements RbacStore {
  private readonly roles: Map<string, Role>;

  constructor(roles: Role[]) {
    this.roles = new Map(roles.map((r) => [r.name, r]));
  }

  async getRolesByNames(names: string[]): Promise<Role[]> {
    const result: Role[] = [];
    for (const name of names) {
      const role = this.roles.get(name);
      if (role) result.push(role);
    }
    return result;
  }

  async getAllRoles(): Promise<Role[]> {
    return [...this.roles.values()];
  }

  async getRole(name: string): Promise<Role | undefined> {
    return this.roles.get(name);
  }
}

/**
 * Check whether a specific rule grants access to a given resource+verb.
 */
function ruleMatches(rule: RbacRule, resource: RbacResource, verb: RbacVerb): boolean {
  return (
    (rule.resources as string[]).includes(resource) &&
    (rule.verbs as string[]).includes(verb)
  );
}

/**
 * Check whether a role applies to a given namespace.
 * - Cluster-wide roles (namespace undefined) apply everywhere.
 * - Namespaced roles only apply to their own namespace.
 */
function roleAppliesToNamespace(role: Role, namespace: string | undefined): boolean {
  if (role.namespace === undefined) return true; // cluster-wide
  if (namespace === undefined) return true; // no namespace constraint on request
  return role.namespace === namespace;
}

export interface RbacCheckOptions {
  user: AuthUser;
  resource: RbacResource;
  verb: RbacVerb;
  namespace?: string;
}

export interface RbacCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Core RBAC engine. Resolves user roles and checks permissions.
 */
export class RbacService {
  constructor(private readonly store: RbacStore) {}

  /**
   * Check whether a user is allowed to perform a verb on a resource.
   */
  async check(opts: RbacCheckOptions): Promise<RbacCheckResult> {
    const { user, resource, verb, namespace } = opts;

    const roles = await this.store.getRolesByNames(user.roles);

    if (roles.length === 0) {
      return {
        allowed: false,
        reason: `No roles found for user ${user.name}`,
      };
    }

    for (const role of roles) {
      if (!roleAppliesToNamespace(role, namespace)) continue;

      for (const rule of role.spec.rules) {
        if (ruleMatches(rule, resource, verb)) {
          return { allowed: true };
        }
      }
    }

    return {
      allowed: false,
      reason: `User ${user.name} cannot ${verb} ${resource}${namespace ? ` in ${namespace}` : ''}`,
    };
  }

  /** List all available roles. */
  async listRoles(): Promise<Role[]> {
    return this.store.getAllRoles();
  }

  /** Get a single role by name. */
  async getRole(name: string): Promise<Role | undefined> {
    return this.store.getRole(name);
  }

  /**
   * Get the maximum budget allocation allowed for a user in a namespace.
   * Returns the highest maxAllocation across all matching budget rules.
   */
  async getMaxAllocation(user: AuthUser, namespace?: string): Promise<number> {
    const roles = await this.store.getRolesByNames(user.roles);
    let max = 0;

    for (const role of roles) {
      if (!roleAppliesToNamespace(role, namespace)) continue;

      for (const rule of role.spec.rules) {
        if (
          (rule.resources as string[]).includes('budgets') &&
          (rule.verbs as string[]).includes('allocate') &&
          rule.maxAllocation !== undefined
        ) {
          max = Math.max(max, rule.maxAllocation);
        }
      }
    }

    return max;
  }
}

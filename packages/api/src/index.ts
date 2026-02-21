// @kais/api — REST/WS API server
export { buildServer } from './server.js';
export type { BuildServerOptions } from './server.js';
export type { NatsClient, NatsSubscription, DbClient, DbQueryResult } from './clients.js';
export { EventConsumer } from './event-consumer.js';

// Auth
export { StaticTokenAuthProvider, extractBearerToken } from './auth.js';
export type { AuthProvider } from './auth.js';

// RBAC
export { RbacService, InMemoryRbacStore } from './rbac.js';
export type { RbacStore, RbacCheckOptions, RbacCheckResult } from './rbac.js';

// Budget Ledger
export { createBudgetLedger } from './budget-ledger.js';
export type { BudgetLedgerService, BudgetTreeNode } from './budget-ledger.js';

// Cell Tree
export { createCellTree } from './cell-tree.js';
export type { CellTreeService } from './cell-tree.js';

// Spawn Request
export { createSpawnRequestService } from './spawn-request.js';
export type { SpawnRequestService } from './spawn-request.js';

// Recursion Validator
export { createRecursionValidator } from './recursion-validator.js';
export type { RecursionValidator, RecursionValidatorConfig, SpawnInput } from './recursion-validator.js';

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

# kAIs dev loop — watches code, builds images, deploys to minikube, streams logs

# Operator image
docker_build(
    'kais-operator',
    '.',
    dockerfile='docker/Dockerfile.operator',
    live_update=[
        sync('packages/core/src', '/app/packages/core/src'),
        sync('packages/operator/src', '/app/packages/operator/src'),
        run('cd /app && pnpm --filter @kais/core build && pnpm --filter @kais/operator build'),
    ],
)

# Cell runtime image
docker_build(
    'kais-cell',
    '.',
    dockerfile='docker/Dockerfile.cell',
    live_update=[
        sync('packages/core/src', '/app/packages/core/src'),
        sync('packages/mind/src', '/app/packages/mind/src'),
        sync('packages/cell-runtime/src', '/app/packages/cell-runtime/src'),
        run('cd /app && pnpm --filter @kais/core build && pnpm --filter @kais/mind build && pnpm --filter @kais/cell-runtime build'),
    ],
)

# Apply CRDs
k8s_yaml('deploy/crds/cell-crd.yaml')

# Deploy operator via Helm (when chart is ready)
# k8s_yaml(helm('helm/kais-operator'))

# Deploy infra (Postgres, NATS, MinIO) via Helm (when chart is ready)
# k8s_yaml(helm('helm/kais-infra'))

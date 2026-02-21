#!/usr/bin/env bash
set -euo pipefail

# E2E test setup — prepares a kind cluster with kAIs infrastructure.
# Assumes: kind cluster already created (by helm/kind-action in CI or manually)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== E2E Setup ==="
echo "Project root: $PROJECT_ROOT"

# 1. Apply CRDs
echo "--- Applying CRDs ---"
kubectl apply -f "$PROJECT_ROOT/crds/"

# 2. Build and load Docker images into kind
echo "--- Building Docker images ---"
docker build -t kais-operator:e2e -f "$PROJECT_ROOT/Dockerfile.operator" "$PROJECT_ROOT"
docker build -t kais-cell:e2e -f "$PROJECT_ROOT/Dockerfile.cell" "$PROJECT_ROOT"

echo "--- Loading images into kind ---"
kind load docker-image kais-operator:e2e --name="${KIND_CLUSTER_NAME:-kais-test}"
kind load docker-image kais-cell:e2e --name="${KIND_CLUSTER_NAME:-kais-test}"

# 3. Deploy infrastructure via helmfile
echo "--- Deploying infrastructure ---"
if command -v helmfile &>/dev/null; then
  cd "$PROJECT_ROOT" && helmfile apply
else
  echo "helmfile not found — deploying manually"
  # Postgres
  helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
  helm upgrade --install kais-postgres bitnami/postgresql \
    --set auth.postgresPassword=kais \
    --set auth.database=kais \
    --set primary.persistence.size=1Gi \
    --wait --timeout 120s

  # NATS
  helm repo add nats https://nats-io.github.io/k8s/helm/charts/ 2>/dev/null || true
  helm upgrade --install kais-nats nats/nats \
    --set config.jetstream.enabled=true \
    --wait --timeout 120s
fi

# 4. Deploy Ollama and pull model
echo "--- Deploying Ollama ---"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          ports:
            - containerPort: 11434
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2"
---
apiVersion: v1
kind: Service
metadata:
  name: ollama
  namespace: default
spec:
  selector:
    app: ollama
  ports:
    - port: 11434
      targetPort: 11434
EOF

echo "--- Waiting for Ollama pod ---"
kubectl wait --for=condition=ready pod -l app=ollama --timeout=120s

echo "--- Pulling qwen2.5:0.5b model ---"
OLLAMA_POD=$(kubectl get pods -l app=ollama -o jsonpath='{.items[0].metadata.name}')
kubectl exec "$OLLAMA_POD" -- ollama pull qwen2.5:0.5b

# 5. Deploy kAIs operator
echo "--- Deploying kAIs operator ---"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kais-operator
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kais-operator
  template:
    metadata:
      labels:
        app: kais-operator
    spec:
      serviceAccountName: default
      containers:
        - name: operator
          image: kais-operator:e2e
          imagePullPolicy: Never
          env:
            - name: NAMESPACE
              value: default
EOF

echo "--- Waiting for operator pod ---"
kubectl wait --for=condition=ready pod -l app=kais-operator --timeout=120s

# 6. Wait for all infrastructure to be ready
echo "--- Verifying all pods ---"
kubectl get pods

echo "=== E2E Setup Complete ==="

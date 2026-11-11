# k8s/ — VEKTORA en Kubernetes (Nivel 3)

| Archivo | Qué es |
|---|---|
| `app-deployment.yaml` | La app: imagen `ghcr.io/nicrolax/vektora:latest`, variables desde ConfigMap + Secret, requests 250m/256Mi y limits 1 CPU/512Mi, `readinessProbe` y `livenessProbe` HTTP sobre `/health`, no root (uid 1001), sin escalada de privilegios, sistema de archivos de solo lectura |
| `app-service.yaml` | `NodePort` 30080 → puerto 3000 de la app |
| `db-deployment.yaml` | PostgreSQL 16 + pgvector con un `PersistentVolumeClaim` de 1 Gi, requests/limits, probes `exec: pg_isready`, y los scripts de `sql/` montados en `/docker-entrypoint-initdb.d` |
| `db-service.yaml` | `ClusterIP` `vektora-db`: la base solo se alcanza desde dentro del clúster |
| `configmap.yaml` | Configuración NO secreta (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSL`, `PORT`…) |
| `secret.yaml.example` | Nombres de los secretos con valores de EJEMPLO. El real (`secret.yaml`) está en `.gitignore` |
| `kustomization.yaml` | Para aplicar todo con `kubectl apply -k k8s/` |

## Pasos (desde la raíz del repo)

```bash
minikube start --driver=docker          # o --driver=virtualbox / --driver=hyperv
npm run k8s:secreto                      # crea k8s/secret.yaml con valores aleatorios
kubectl apply -f k8s/secret.yaml
kubectl create configmap vektora-sql --from-file=sql/
kubectl apply -k k8s/
kubectl get pods,svc -w                  # esperar vektora-db y vektora-app en Running 1/1
minikube service vektora-app --url       # http://<ip>:30080
```

Sin Node en la PC, el Secret se puede hacer a mano: `cp k8s/secret.yaml.example k8s/secret.yaml`
y reemplazar cada `CAMBIAR-…`.

## Comprobar

```bash
kubectl get pods,svc
kubectl exec deploy/vektora-db -- psql -U vektora -d vektora -c "select count(*) from public.project_tasks"   # 8
curl "$(minikube service vektora-app --url)/health"
```

## Empezar de cero

```bash
kubectl delete -k k8s/ && kubectl delete pvc vektora-db-datos
kubectl delete configmap vektora-sql && kubectl delete secret vektora-secret
```

Los scripts de `sql/` solo se ejecutan cuando el volumen de la base está VACÍO: para volver a
cargar los datos de prueba hay que borrar el PVC.

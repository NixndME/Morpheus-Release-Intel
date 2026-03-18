# Morpheus Release Intel

A self-hosted dashboard for tracking Jira project releases. Connects directly to your Atlassian Jira instance via API token and runs entirely on your local machine or private Kubernetes cluster. No data is ever sent to any third party — everything stays between your browser and your Jira instance.

---

## Features

- **Releases** — browse any project version, view issues grouped by type (bugs, features, improvements, tasks) with a release progress bar
- **Issue Search** — search keywords across all issues with filters for released, unreleased, and backlog
- **Release Diff** — compare two versions side by side and see what's new, removed, or shared
- **Component Heatmap** — visualize bug and issue density across components for multiple releases at once

---

## Privacy

- Your Jira credentials (email + API token) are held in browser memory only and are never written to disk or logged
- No analytics, no telemetry, no external requests except to your own Jira instance
- The server acts as a local proxy only — it forwards your credentials to Jira and returns the response. Nothing is stored server-side beyond an optional local notes file
- All data lives inside your Docker container or Kubernetes pod

---

## Prerequisites

- Docker (for local use) or a Kubernetes cluster
- A Jira Cloud or Data Center account with read access to the project
- An Atlassian API token

---

## Getting an Atlassian API Token

1. Log in to your Atlassian account
2. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
3. Click **Create API token**
4. Give it a name (e.g. `release-intel`) and click **Create**
5. Copy the token — it is only shown once
6. Use your Atlassian account email + this token to log in to the dashboard
7. Revoke the token from the same page when no longer needed

---

## Configuration

Before running, open `src/App.jsx` and set your Jira base URL and project key at the top of the file:

```js
const API_BASE    = "/api/jira";
const PROJECT_KEY = "YOUR_PROJECT_KEY";
```

And in `server.js`:

```js
const JIRA_HOST = "https://your-org.atlassian.net";
```

---

## Running with Docker

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), enter your email and API token.

---

## Running on Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl rollout status deployment/morpheus-release-intel
```

The service is `ClusterIP` by default. Add an Ingress or change to `LoadBalancer` as needed for your cluster.

To use a persistent volume for the notes data, mount a PV at `/app/data` in the deployment.

---

## Building the Docker image

```bash
docker buildx create --name multibuilder --use
docker buildx inspect --bootstrap

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-dockerhub-username/morpheus-release-intel:latest \
  --push \
  .
```

---

## Project Structure

```
morpheus-release-intel/
├── src/
│   ├── App.jsx        ← React frontend (all four tabs)
│   ├── main.jsx
│   └── index.css
├── server.js          ← Express server: static files + Jira proxy
├── Dockerfile
├── docker-compose.yml
└── k8s/
    ├── deployment.yaml
    └── service.yaml
```

---

## License

MIT

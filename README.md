# Morpheus Release Intel

A self-hosted dashboard for tracking Jira project releases. Connects directly to your Atlassian Jira instance via API token and runs entirely on your local machine or private Kubernetes cluster. No data is ever sent to any third party — everything stays between your browser and your Jira instance.

---

## Quickstart — Docker Hub (easiest)

The image is available on Docker Hub for both `linux/amd64` and `linux/arm64`.

```bash
docker pull nixndme/morpheus-release-intel:latest
docker run -p 3000:3000 nixndme/morpheus-release-intel:latest
```

Open [http://localhost:3000](http://localhost:3000), enter your Jira email and API token, and you're in. Nothing else to install.

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

## Privacy

- Your Jira credentials (email + API token) are held in browser memory only and are never written to disk or logged
- No analytics, no telemetry, no external requests except to your own Jira instance
- The server acts as a local proxy only — it forwards your credentials to Jira and returns the response
- Nothing is stored server-side beyond an optional local notes file inside the container

---

## Features

- **Releases** — browse any project version, view issues grouped by type (bugs, features, improvements, tasks) with a release progress bar and copy-to-clipboard presales summary
- **Issue Search** — search keywords across all issues with filters for released, unreleased, and backlog
- **Release Diff** — compare two versions side by side and see what's new, removed, or shared
- **Component Heatmap** — visualize bug and issue density across components for multiple releases at once

---

## Configuration

Before building from source, open `src/App.jsx` and set your Jira project key:

```js
const PROJECT_KEY = "YOUR_PROJECT_KEY";
```

And in `server.js` set your Jira base URL:

```js
const JIRA_HOST = "https://your-org.atlassian.net";
```

If you're just pulling from Docker Hub and running locally, enter your Jira base URL and credentials directly in the login screen.

---

## Running with Docker Compose

```bash
docker compose up --build
```

---

## Running on Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl rollout status deployment/morpheus-release-intel
```

The service is `ClusterIP` by default. Add an Ingress or change to `LoadBalancer` as needed.

---

## Building from source

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
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── server.js
├── Dockerfile
├── docker-compose.yml
└── k8s/
    ├── deployment.yaml
    └── service.yaml
```

---

## License

MIT

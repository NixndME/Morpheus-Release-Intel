import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const PORT      = process.env.PORT || 3000;
const JIRA_HOST = "https://hpe.atlassian.net";
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, "data");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(NOTES_FILE)) fs.writeFileSync(NOTES_FILE, "{}");

app.use(express.json());

// ─── Jira proxy ───────────────────────────────────────────────────────────────
app.all("/api/jira/*", async (req, res) => {
  const email = req.headers["x-jira-email"];
  const token = req.headers["x-jira-token"];
  if (!email || !token) return res.status(401).json({ error: "Missing credentials" });

  const upstreamPath = req.originalUrl.replace(/^\/api\/jira/, "");
  const url = `${JIRA_HOST}${upstreamPath}`;
  const headers = {
    "Authorization": `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
    "Accept": "application/json", "Content-Type": "application/json",
  };
  const fetchOpts = { method: req.method, headers };
  if ((req.method === "POST" || req.method === "PUT") && req.body) {
    fetchOpts.body = JSON.stringify(req.body);
  }
  console.log(`[proxy] ${req.method} ${url}`);
  try {
    const { default: fetch } = await import("node-fetch");
    const upstream = await fetch(url, fetchOpts);
    const bodyText = await upstream.text();
    console.log(`[proxy] status: ${upstream.status} | size: ${bodyText.length}b`);
    if (upstream.status >= 400) console.log(`[proxy] error: ${bodyText.slice(0, 300)}`);
    res.status(upstream.status).set("Content-Type", upstream.headers.get("content-type") || "application/json").send(bodyText);
  } catch (err) {
    console.error("[proxy] failed:", err.message);
    res.status(502).json({ error: "Upstream error", detail: err.message });
  }
});

// ─── Notes API (persisted to Docker volume) ───────────────────────────────────
function readNotes() {
  try { return JSON.parse(fs.readFileSync(NOTES_FILE, "utf8")); }
  catch { return {}; }
}
function writeNotes(data) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2));
}

app.get("/api/notes", (req, res) => res.json(readNotes()));

app.post("/api/notes/:key", (req, res) => {
  const notes = readNotes();
  notes[req.params.key] = { ...req.body, updatedAt: new Date().toISOString() };
  writeNotes(notes);
  res.json(notes[req.params.key]);
});

app.delete("/api/notes/:key", (req, res) => {
  const notes = readNotes();
  delete notes[req.params.key];
  writeNotes(notes);
  res.json({ ok: true });
});

// ─── Static ───────────────────────────────────────────────────────────────────
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

app.listen(PORT, () => console.log(`Morph Release Intel → http://localhost:${PORT}`));

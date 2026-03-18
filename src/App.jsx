import { useState, useMemo, useRef, useCallback } from "react";

const API_BASE    = "/api/jira";
const PROJECT_KEY = "MORPH";

const TYPE_CFG = {
  "Bug":         { label: "Bug",         color: "#f87171", bg: "rgba(248,113,113,0.12)", order: 0 },
  "Story":       { label: "Story",       color: "#34d399", bg: "rgba(52,211,153,0.12)",  order: 1 },
  "New Feature": { label: "New Feature", color: "#34d399", bg: "rgba(52,211,153,0.12)",  order: 1 },
  "Improvement": { label: "Improvement", color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  order: 2 },
  "Task":        { label: "Task",        color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  order: 3 },
  "Sub-task":    { label: "Sub-task",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)", order: 4 },
  "Epic":        { label: "Epic",        color: "#f472b6", bg: "rgba(244,114,182,0.12)", order: 5 },
};

const GROUP_CFG = {
  "Bug":         { label: "Bugs Fixed",   color: "#f87171", bg: "rgba(248,113,113,0.12)", order: 0 },
  "Story":       { label: "Features",     color: "#34d399", bg: "rgba(52,211,153,0.12)",  order: 1 },
  "New Feature": { label: "Features",     color: "#34d399", bg: "rgba(52,211,153,0.12)",  order: 1 },
  "Improvement": { label: "Improvements", color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  order: 2 },
  "Task":        { label: "Tasks",        color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  order: 3 },
  "Sub-task":    { label: "Sub-tasks",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)", order: 4 },
  "Epic":        { label: "Epics",        color: "#f472b6", bg: "rgba(244,114,182,0.12)", order: 5 },
};

const STATUS_CLR = {
  "Done": "#34d399", "In Test": "#60a5fa", "In Progress": "#fbbf24",
  "New": "#94a3b8", "Reporter Verification": "#a78bfa", "Closed": "#34d399",
};

const getTypeCfg  = n => TYPE_CFG[n]   || { label: n, color: "#94a3b8", bg: "rgba(148,163,184,0.12)" };
const getGroupCfg = n => GROUP_CFG[n]  || { label: n, color: "#94a3b8", bg: "rgba(148,163,184,0.12)", order: 99 };
const getStCl     = n => STATUS_CLR[n] || "#94a3b8";

// ─── API ──────────────────────────────────────────────────────────────────────
const authHeaders = (email, token) => ({
  "x-jira-email": email, "x-jira-token": token,
  "Accept": "application/json", "Content-Type": "application/json",
});

async function jiraFetch(path, email, token, method = "GET", body = null) {
  const opts = { method, headers: authHeaders(email, token) };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function loadVersions(email, token) {
  const list = await jiraFetch(`/rest/api/3/project/${PROJECT_KEY}/versions`, email, token);
  return [...list].sort((a, b) => {
    if (a.releaseDate && b.releaseDate) return new Date(b.releaseDate) - new Date(a.releaseDate);
    if (a.released && !b.released) return -1;
    if (!a.released && b.released) return 1;
    return 0;
  });
}

async function fetchAllIssuesForVersion(email, token, versionName, extraFields = []) {
  const all = [];
  const jql = `project = "${PROJECT_KEY}" AND fixVersion = "${versionName}" ORDER BY issuetype ASC, priority ASC`;
  let nextPageToken = undefined;
  while (true) {
    const body = {
      jql, maxResults: 100,
      fields: ["summary","issuetype","status","priority","components", ...extraFields],
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const d = await jiraFetch("/rest/api/3/search/jql", email, token, "POST", body);
    const issues = d.issues || d.values || [];
    all.push(...issues);
    if (!d.nextPageToken || !issues.length) break;
    nextPageToken = d.nextPageToken;
  }
  return all;
}

async function searchAllIssues(email, token, keyword, versionFilter) {
  let jql = `project = "${PROJECT_KEY}"`;
  if (keyword.trim()) jql += ` AND (summary ~ "${keyword.trim()}" OR text ~ "${keyword.trim()}")`;
  if (versionFilter === "released")   jql += ` AND fixVersion in releasedVersions()`;
  if (versionFilter === "unreleased") jql += ` AND fixVersion in unreleasedVersions()`;
  if (versionFilter === "backlog")    jql += ` AND fixVersion is EMPTY`;
  jql += ` ORDER BY created DESC`;
  const all = [];
  let nextPageToken = undefined;
  while (all.length < 500) {
    const body = { jql, maxResults: 100, fields: ["summary","issuetype","status","priority","components","fixVersions","created","updated"] };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const d = await jiraFetch("/rest/api/3/search/jql", email, token, "POST", body);
    const issues = d.issues || d.values || [];
    all.push(...issues);
    if (!d.nextPageToken || !issues.length) break;
    nextPageToken = d.nextPageToken;
  }
  return all;
}

function buildSummary(issues, versionName) {
  const bugs   = issues.filter(i => i.fields.issuetype.name === "Bug");
  const feats  = issues.filter(i => ["Story","New Feature"].includes(i.fields.issuetype.name));
  const improv = issues.filter(i => i.fields.issuetype.name === "Improvement");
  const lines  = [`${versionName} — Release Summary (${issues.length} items)\n`];
  if (feats.length)  { lines.push(`NEW FEATURES (${feats.length})`);   feats.forEach(i  => lines.push(`  • [${i.key}] ${i.fields.summary}`)); lines.push(""); }
  if (improv.length) { lines.push(`IMPROVEMENTS (${improv.length})`);  improv.forEach(i => lines.push(`  • [${i.key}] ${i.fields.summary}`)); lines.push(""); }
  if (bugs.length)   { lines.push(`BUGS FIXED (${bugs.length})`);      bugs.forEach(i   => lines.push(`  • [${i.key}] ${i.fields.summary}`)); }
  return lines.join("\n");
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function StatCard({ value, label, color }) {
  return (
    <div style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "1rem 1.25rem" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#475569", marginTop: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
    </div>
  );
}

function TypePill({ name }) {
  const cfg = getTypeCfg(name);
  return <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, color: cfg.color, background: cfg.bg, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{cfg.label}</span>;
}

function VersionPill({ name, released }) {
  return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: released ? "#34d399" : "#fbbf24", background: released ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)", whiteSpace: "nowrap", fontWeight: 500 }}>{name || "No version"}</span>;
}

function ErrorBox({ msg }) {
  return <div style={{ margin: "1rem 1.5rem 0", padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, fontSize: 12, color: "#f87171", lineHeight: 1.6, wordBreak: "break-word" }}>{msg}</div>;
}

// ─── Release Tab ──────────────────────────────────────────────────────────────
function ReleaseIssueRow({ issue }) {
  const status = issue.fields.status?.name || "";
  const comps  = issue.fields.components?.map(c => c.name).join(", ");
  return (
    <a href={`https://hpe.atlassian.net/browse/${issue.key}`} target="_blank" rel="noreferrer"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", textDecoration: "none" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#475569", minWidth: 94, flexShrink: 0 }}>{issue.key}</span>
      <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>{issue.fields.summary}</span>
      {comps && <span style={{ fontSize: 11, color: "#334155", flexShrink: 0, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{comps}</span>}
      <span style={{ fontSize: 11, color: getStCl(status), flexShrink: 0, minWidth: 80, textAlign: "right" }}>{status}</span>
    </a>
  );
}

function IssueGroup({ typeName, issues, collapsed, onToggle }) {
  const cfg = getGroupCfg(typeName);
  return (
    <div style={{ marginBottom: 8, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", background: "#0e1625", border: "none", cursor: "pointer" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, flex: 1 }}>{cfg.label}</span>
        <span style={{ fontSize: 12, color: "#475569", marginRight: 6 }}>{issues.length} issues</span>
        <span style={{ color: "#334155", fontSize: 11 }}>{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && <div style={{ background: "#080f1e" }}>{issues.map(i => <ReleaseIssueRow key={i.key} issue={i} />)}</div>}
    </div>
  );
}

function ReleaseTab({ versions, issues, selectedVersion, issueError, onVersionChange, loading }) {
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [collapsed, setCollapsed]   = useState({});
  const [copied, setCopied]         = useState(false);

  const filtered = useMemo(() => issues.filter(i => {
    const sl = search.toLowerCase();
    return (!search || i.fields.summary.toLowerCase().includes(sl) || i.key.toLowerCase().includes(sl)) &&
           (typeFilter === "all" || i.fields.issuetype.name === typeFilter);
  }), [issues, search, typeFilter]);

  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach(i => { const t = i.fields.issuetype.name; if (!g[t]) g[t] = []; g[t].push(i); });
    return Object.entries(g).sort(([a],[b]) => (getGroupCfg(a).order||99) - (getGroupCfg(b).order||99));
  }, [filtered]);

  const stats = useMemo(() => ({
    total: issues.length,
    bugs:  issues.filter(i => i.fields.issuetype.name === "Bug").length,
    features: issues.filter(i => ["Story","New Feature"].includes(i.fields.issuetype.name)).length,
    improvements: issues.filter(i => i.fields.issuetype.name === "Improvement").length,
    done:  issues.filter(i => ["Done","Closed"].includes(i.fields.status?.name)).length,
  }), [issues]);

  const uniqueTypes = useMemo(() => [...new Set(issues.map(i => i.fields.issuetype.name))], [issues]);
  const ver = selectedVersion;
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div>
      <div style={{ padding: "1rem 1.5rem", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap" }}>
        <select value={ver?.id || ""} onChange={e => { const v = versions.find(v => v.id === e.target.value); if (v) onVersionChange(v); }}
          style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, color: "#e2e8f0", fontSize: 13, padding: "7px 12px", cursor: "pointer", outline: "none", minWidth: 200 }}>
          {versions.map(v => <option key={v.id} value={v.id}>{v.name}{v.released ? " ✓" : " (unreleased)"}</option>)}
        </select>
        {ver?.releaseDate && <span style={{ fontSize: 12, color: "#475569" }}>Released {ver.releaseDate}</span>}
        {!ver?.released && ver && <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(251,191,36,0.1)", color: "#fbbf24", borderRadius: 4, fontWeight: 600 }}>UNRELEASED</span>}
        <div style={{ flex: 1 }} />
        <button onClick={() => { navigator.clipboard.writeText(buildSummary(issues, ver?.name||"")); setCopied(true); setTimeout(()=>setCopied(false),2000); }}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: copied ? "#34d399" : "#475569", fontSize: 12, padding: "5px 12px", cursor: "pointer" }}>
          {copied ? "✓ Copied" : "Copy Presales Summary"}
        </button>
      </div>
      <div style={{ padding: "1.25rem 1.5rem 0", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
        <StatCard value={loading ? "…" : stats.total}        label="Total Issues"  color="#e2e8f0" />
        <StatCard value={loading ? "…" : stats.bugs}         label="Bugs Fixed"    color="#f87171" />
        <StatCard value={loading ? "…" : stats.features}     label="New Features"  color="#34d399" />
        <StatCard value={loading ? "…" : stats.improvements} label="Improvements"  color="#60a5fa" />
        <StatCard value={loading ? "…" : stats.done}         label="Completed"     color="#64748b" />
      </div>
      {!loading && stats.total > 0 && (
        <div style={{ padding: "1rem 1.5rem 0" }}>
          <div style={{ height: 4, background: "#0e1625", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#34d399", transition: "width 0.4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "#334155" }}>Release progress</span>
            <span style={{ fontSize: 11, color: "#475569" }}>{pct}% done</span>
          </div>
        </div>
      )}
      {issueError && <ErrorBox msg={issueError} />}
      <div style={{ padding: "1rem 1.5rem", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search issues or keys…"
          style={{ width: 280, background: "#0e1625", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, padding: "7px 12px", color: "#e2e8f0", fontSize: 13, outline: "none" }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, color: "#e2e8f0", fontSize: 13, padding: "7px 10px", cursor: "pointer", outline: "none" }}>
          <option value="all">All types</option>
          {uniqueTypes.map(t => <option key={t} value={t}>{getGroupCfg(t).label} ({issues.filter(i=>i.fields.issuetype.name===t).length})</option>)}
        </select>
        {(search || typeFilter !== "all") && <button onClick={() => { setSearch(""); setTypeFilter("all"); }} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, color: "#475569", fontSize: 12, padding: "7px 12px", cursor: "pointer" }}>Clear</button>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#1e293b" }}>{filtered.length} of {issues.length}</span>
      </div>
      <div style={{ padding: "0 1.5rem 3rem" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "#334155", fontSize: 14 }}>Fetching issues for <strong style={{ color: "#475569" }}>{ver?.name}</strong>…</div>
        ) : !issueError && grouped.length === 0 ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "#334155", fontSize: 13 }}>No issues found for <code style={{ background: "#0e1625", padding: "2px 8px", borderRadius: 4, color: "#60a5fa" }}>{ver?.name}</code></div>
        ) : grouped.map(([type, typeIssues]) => (
          <IssueGroup key={type} typeName={type} issues={typeIssues} collapsed={!!collapsed[type]} onToggle={() => setCollapsed(c => ({ ...c, [type]: !c[type] }))} />
        ))}
      </div>
    </div>
  );
}

// ─── Search Tab ───────────────────────────────────────────────────────────────
function SearchTab({ creds }) {
  const [keyword, setKeyword]           = useState("");
  const [versionFilter, setVersionFilter] = useState("all");
  const [results, setResults]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [typeFilter, setTypeFilter]     = useState("all");

  const handleSearch = async (kw = keyword) => {
    if (!kw.trim() && versionFilter === "all") return;
    setLoading(true); setError(null); setResults(null);
    try { setResults(await searchAllIssues(creds.email, creds.token, kw, versionFilter)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const quickSearch = (k) => { setKeyword(k); handleSearch(k); };

  const filtered = useMemo(() => {
    if (!results) return [];
    return typeFilter === "all" ? results : results.filter(i => i.fields.issuetype.name === typeFilter);
  }, [results, typeFilter]);

  const uniqueTypes = useMemo(() => results ? [...new Set(results.map(i => i.fields.issuetype.name))] : [], [results]);

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: "1rem", flexWrap: "wrap" }}>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="Search keyword, e.g. 'SCVMM', 'socket', 'OpenShift'…"
          style={{ flex: 1, minWidth: 260, background: "#0e1625", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: 14, outline: "none" }} autoFocus />
        <select value={versionFilter} onChange={e => setVersionFilter(e.target.value)}
          style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 13, padding: "9px 12px", cursor: "pointer", outline: "none" }}>
          <option value="all">All issues</option>
          <option value="released">Released versions only</option>
          <option value="unreleased">Unreleased versions only</option>
          <option value="backlog">Backlog (no version)</option>
        </select>
        <button onClick={() => handleSearch()} disabled={loading || (!keyword.trim() && versionFilter === "all")}
          style={{ background: loading ? "#0c1a2e" : "#0ea5e9", color: loading ? "#334155" : "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          {loading ? "Searching…" : "Search →"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#334155" }}>Quick:</span>
        {["SCVMM","OpenShift","Kubernetes","VMware","socket","FIPS","Ansible","Terraform","HVM","Azure"].map(k => (
          <button key={k} onClick={() => quickSearch(k)}
            style={{ background: keyword === k ? "rgba(14,165,233,0.15)" : "#0e1625", border: `1px solid ${keyword === k ? "#0ea5e9" : "rgba(255,255,255,0.07)"}`, borderRadius: 6, color: keyword === k ? "#0ea5e9" : "#475569", fontSize: 12, padding: "4px 10px", cursor: "pointer" }}>
            {k}
          </button>
        ))}
      </div>
      {error && <ErrorBox msg={error} />}
      {results && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              <strong style={{ color: "#e2e8f0" }}>{results.length}</strong> issues found
              {keyword && <> for <strong style={{ color: "#60a5fa" }}>"{keyword}"</strong></>}
              {results.length === 500 && <span style={{ color: "#fbbf24" }}> (capped at 500)</span>}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, color: "#e2e8f0", fontSize: 12, padding: "5px 8px", cursor: "pointer", outline: "none" }}>
                <option value="all">All types</option>
                {uniqueTypes.map(t => <option key={t} value={t}>{getTypeCfg(t).label} ({results.filter(i=>i.fields.issuetype.name===t).length})</option>)}
              </select>
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 12, padding: "8px 16px", background: "#0e1625", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {["Key","Summary","Type","Fix Version","Status"].map((h,i) => (
                <span key={h} style={{ fontSize: 11, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: i===1?0:0, flex: i===1?1:0, minWidth: i===0?94:i===2?90:i===3?130:80, textAlign: i===4?"right":"left" }}>{h}</span>
              ))}
            </div>
            {filtered.length === 0
              ? <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>No issues match the filter.</div>
              : filtered.map(issue => {
                const status  = issue.fields.status?.name || "";
                const fixVers = issue.fields.fixVersions || [];
                return (
                  <a key={issue.key} href={`https://hpe.atlassian.net/browse/${issue.key}`} target="_blank" rel="noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", textDecoration: "none" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#475569", minWidth: 94, flexShrink: 0 }}>{issue.key}</span>
                    <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>{issue.fields.summary}</span>
                    <span style={{ minWidth: 90, flexShrink: 0 }}><TypePill name={issue.fields.issuetype.name} /></span>
                    <span style={{ minWidth: 130, flexShrink: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      {fixVers.length === 0 ? <span style={{ fontSize: 11, color: "#334155" }}>Backlog</span> : fixVers.map(v => <VersionPill key={v.id} name={v.name} released={v.released} />)}
                    </span>
                    <span style={{ fontSize: 11, color: getStCl(status), minWidth: 80, textAlign: "right", flexShrink: 0 }}>{status}</span>
                  </a>
                );
              })
            }
          </div>
        </>
      )}
      {!results && !loading && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#1e293b" }}>
          <div style={{ fontSize: 32, marginBottom: 12, color: "#1e293b" }}>⌕</div>
          <div style={{ fontSize: 14, color: "#334155" }}>Enter a keyword and press Search</div>
          <div style={{ fontSize: 12, color: "#1e293b", marginTop: 6 }}>Searches summaries and descriptions across all MORPH issues</div>
        </div>
      )}
    </div>
  );
}

// ─── Diff Tab ─────────────────────────────────────────────────────────────────
function DiffTab({ versions, creds }) {
  const [verAId, setVerAId] = useState(versions[1]?.id || "");
  const [verBId, setVerBId] = useState(versions[0]?.id || "");
  const [issuesA, setIssuesA] = useState(null);
  const [issuesB, setIssuesB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [diffFilter, setDiffFilter] = useState("all");  // all | new | removed | shared
  const [typeFilter, setTypeFilter] = useState("all");

  const verA = versions.find(v => v.id === verAId);
  const verB = versions.find(v => v.id === verBId);

  const handleCompare = async () => {
    if (!verA || !verB || verAId === verBId) return;
    setLoading(true); setError(null); setIssuesA(null); setIssuesB(null);
    try {
      const [a, b] = await Promise.all([
        fetchAllIssuesForVersion(creds.email, creds.token, verA.name),
        fetchAllIssuesForVersion(creds.email, creds.token, verB.name),
      ]);
      setIssuesA(a); setIssuesB(b);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const diff = useMemo(() => {
    if (!issuesA || !issuesB) return null;
    const keysA = new Set(issuesA.map(i => i.key));
    const keysB = new Set(issuesB.map(i => i.key));
    return {
      onlyInA: issuesA.filter(i => !keysB.has(i.key)),   // removed in B (old only)
      onlyInB: issuesB.filter(i => !keysA.has(i.key)),   // new in B
      shared:  issuesB.filter(i => keysA.has(i.key)),    // in both
    };
  }, [issuesA, issuesB]);

  const visibleIssues = useMemo(() => {
    if (!diff) return [];
    let list = diffFilter === "new"     ? diff.onlyInB
             : diffFilter === "removed" ? diff.onlyInA
             : diffFilter === "shared"  ? diff.shared
             : [...diff.onlyInB, ...diff.onlyInA, ...diff.shared];
    if (typeFilter !== "all") list = list.filter(i => i.fields.issuetype.name === typeFilter);
    return list;
  }, [diff, diffFilter, typeFilter]);

  const allIssues = useMemo(() => diff ? [...diff.onlyInB, ...diff.onlyInA, ...diff.shared] : [], [diff]);
  const uniqueTypes = useMemo(() => [...new Set(allIssues.map(i => i.fields.issuetype.name))], [allIssues]);

  const getDiffBadge = (issue) => {
    if (!diff) return null;
    const keysA = new Set(issuesA.map(i => i.key));
    const keysB = new Set(issuesB.map(i => i.key));
    if (keysB.has(issue.key) && !keysA.has(issue.key)) return { label: "NEW", color: "#34d399", bg: "rgba(52,211,153,0.12)" };
    if (keysA.has(issue.key) && !keysB.has(issue.key)) return { label: "REMOVED", color: "#f87171", bg: "rgba(248,113,113,0.12)" };
    return { label: "SHARED", color: "#475569", bg: "rgba(71,85,105,0.12)" };
  };

  const selStyle = { background: "#0e1625", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", fontSize: 13, padding: "8px 12px", cursor: "pointer", outline: "none", flex: 1 };

  return (
    <div style={{ padding: "1.5rem" }}>
      {/* Version pickers */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>Base version (older)</div>
          <select value={verAId} onChange={e => setVerAId(e.target.value)} style={selStyle}>
            {versions.map(v => <option key={v.id} value={v.id}>{v.name}{v.released?" ✓":""}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 20, color: "#1e293b", paddingTop: 22, flexShrink: 0 }}>→</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>Target version (newer)</div>
          <select value={verBId} onChange={e => setVerBId(e.target.value)} style={selStyle}>
            {versions.map(v => <option key={v.id} value={v.id}>{v.name}{v.released?" ✓":""}</option>)}
          </select>
        </div>
        <div style={{ paddingTop: 22, flexShrink: 0 }}>
          <button onClick={handleCompare} disabled={loading || verAId === verBId}
            style={{ background: loading || verAId === verBId ? "#0c1a2e" : "#0ea5e9", color: loading || verAId === verBId ? "#334155" : "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {loading ? "Loading…" : "Compare →"}
          </button>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      {diff && (
        <>
          {/* Summary stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginBottom: "1.25rem" }}>
            <StatCard value={diff.onlyInB.length} label={`New in ${verB?.name}`}    color="#34d399" />
            <StatCard value={diff.onlyInA.length} label={`Only in ${verA?.name}`}   color="#f87171" />
            <StatCard value={diff.shared.length}  label="In both versions"           color="#60a5fa" />
            <StatCard value={diff.onlyInB.filter(i=>i.fields.issuetype.name==="Bug").length} label="New bugs fixed" color="#fbbf24" />
          </div>

          {/* Filter pills */}
          <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            {[
              { v: "all",     label: `All (${allIssues.length})` },
              { v: "new",     label: `New in ${verB?.name} (${diff.onlyInB.length})`,    color: "#34d399" },
              { v: "removed", label: `Only in ${verA?.name} (${diff.onlyInA.length})`,   color: "#f87171" },
              { v: "shared",  label: `Shared (${diff.shared.length})`,                   color: "#60a5fa" },
            ].map(o => (
              <button key={o.v} onClick={() => setDiffFilter(o.v)}
                style={{ background: diffFilter===o.v ? "rgba(14,165,233,0.15)" : "#0e1625", border: `1px solid ${diffFilter===o.v ? "#0ea5e9" : "rgba(255,255,255,0.07)"}`, borderRadius: 6, color: diffFilter===o.v ? (o.color||"#0ea5e9") : "#475569", fontSize: 12, padding: "5px 12px", cursor: "pointer" }}>
                {o.label}
              </button>
            ))}
            <div style={{ marginLeft: "auto" }}>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, color: "#e2e8f0", fontSize: 12, padding: "5px 8px", cursor: "pointer", outline: "none" }}>
                <option value="all">All types</option>
                {uniqueTypes.map(t => <option key={t} value={t}>{getTypeCfg(t).label}</option>)}
              </select>
            </div>
          </div>

          {/* Issue list */}
          <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 12, padding: "8px 16px", background: "#0e1625", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 11, color: "#334155", minWidth: 94, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Key</span>
              <span style={{ fontSize: 11, color: "#334155", flex: 1, textTransform: "uppercase", letterSpacing: "0.06em" }}>Summary</span>
              <span style={{ fontSize: 11, color: "#334155", minWidth: 90, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Type</span>
              <span style={{ fontSize: 11, color: "#334155", minWidth: 75, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Diff</span>
              <span style={{ fontSize: 11, color: "#334155", minWidth: 80, textAlign: "right", flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Status</span>
            </div>
            {visibleIssues.length === 0
              ? <div style={{ textAlign: "center", padding: "3rem", color: "#334155", fontSize: 13 }}>No issues match.</div>
              : visibleIssues.map(issue => {
                const badge  = getDiffBadge(issue);
                const status = issue.fields.status?.name || "";
                return (
                  <a key={issue.key + (badge?.label||"")} href={`https://hpe.atlassian.net/browse/${issue.key}`} target="_blank" rel="noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", textDecoration: "none" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#475569", minWidth: 94, flexShrink: 0 }}>{issue.key}</span>
                    <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>{issue.fields.summary}</span>
                    <span style={{ minWidth: 90, flexShrink: 0 }}><TypePill name={issue.fields.issuetype.name} /></span>
                    <span style={{ minWidth: 75, flexShrink: 0 }}>
                      {badge && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, color: badge.color, background: badge.bg, textTransform: "uppercase", letterSpacing: "0.05em" }}>{badge.label}</span>}
                    </span>
                    <span style={{ fontSize: 11, color: getStCl(status), minWidth: 80, textAlign: "right", flexShrink: 0 }}>{status}</span>
                  </a>
                );
              })
            }
          </div>
        </>
      )}

      {!diff && !loading && (
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "#1e293b" }}>
          <div style={{ fontSize: 13, color: "#334155" }}>Pick two versions and click Compare</div>
          <div style={{ fontSize: 12, color: "#1e293b", marginTop: 6 }}>See what's new, what was removed, and what's shared between releases</div>
        </div>
      )}
    </div>
  );
}

// ─── Heatmap Tab ──────────────────────────────────────────────────────────────
function HeatmapTab({ versions, creds }) {
  const [selectedIds, setSelectedIds] = useState(() => versions.slice(0,5).map(v=>v.id));
  const [metric, setMetric]           = useState("bugs");   // bugs | all | improvements
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [tooltip, setTooltip]         = useState(null);

  const toggleVersion = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  };

  const handleLoad = async () => {
    const selected = versions.filter(v => selectedIds.includes(v.id));
    if (!selected.length) return;
    setLoading(true); setError(null); setData(null);
    try {
      const results = await Promise.all(
        selected.map(async v => ({ version: v, issues: await fetchAllIssuesForVersion(creds.email, creds.token, v.name) }))
      );
      // Build component × version matrix
      const compSet = new Set();
      results.forEach(({ issues }) => issues.forEach(i => (i.fields.components||[]).forEach(c => compSet.add(c.name))));
      const components = [...compSet].sort();
      if (!components.length) components.push("(no component)");

      const matrix = {};
      results.forEach(({ version, issues }) => {
        matrix[version.id] = {};
        components.forEach(c => matrix[version.id][c] = { bugs:0, all:0, improvements:0, issues:[] });
        issues.forEach(i => {
          const comps = (i.fields.components||[]).map(c=>c.name);
          const targets = comps.length ? comps : ["(no component)"];
          targets.forEach(c => {
            if (!matrix[version.id][c]) matrix[version.id][c] = { bugs:0, all:0, improvements:0, issues:[] };
            matrix[version.id][c].all++;
            matrix[version.id][c].issues.push(i);
            if (i.fields.issuetype.name === "Bug") matrix[version.id][c].bugs++;
            if (i.fields.issuetype.name === "Improvement") matrix[version.id][c].improvements++;
          });
        });
      });
      setData({ components, versions: selected, matrix });
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const maxVal = useMemo(() => {
    if (!data) return 1;
    let m = 1;
    data.versions.forEach(v => data.components.forEach(c => { const val = data.matrix[v.id]?.[c]?.[metric]||0; if (val>m) m=val; }));
    return m;
  }, [data, metric]);

  const cellColor = (val) => {
    if (val === 0) return "rgba(255,255,255,0.03)";
    const t = val / maxVal;
    if (metric === "bugs") {
      // red ramp
      const r = Math.round(80 + t * 168);
      const g = Math.round(16 + t * 30);
      return `rgba(${r},${g},30,${0.2 + t * 0.7})`;
    }
    if (metric === "improvements") {
      const b = Math.round(100 + t * 155);
      return `rgba(30,80,${b},${0.2 + t * 0.7})`;
    }
    // all — teal
    const g = Math.round(80 + t * 130);
    return `rgba(20,${g},100,${0.2 + t * 0.7})`;
  };

  const cellText = (val) => val === 0 ? "" : String(val);

  return (
    <div style={{ padding: "1.5rem" }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Select versions to compare (up to 8)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {versions.slice(0,20).map(v => (
              <button key={v.id} onClick={() => toggleVersion(v.id)}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${selectedIds.includes(v.id) ? "#0ea5e9" : "rgba(255,255,255,0.07)"}`, background: selectedIds.includes(v.id) ? "rgba(14,165,233,0.15)" : "#0e1625", color: selectedIds.includes(v.id) ? "#0ea5e9" : "#475569" }}>
                {v.name}{v.released ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Metric</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{v:"bugs",l:"Bugs"},{v:"improvements",l:"Improvements"},{v:"all",l:"All Issues"}].map(o => (
              <button key={o.v} onClick={() => setMetric(o.v)}
                style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, cursor: "pointer", border: `1px solid ${metric===o.v?"#0ea5e9":"rgba(255,255,255,0.07)"}`, background: metric===o.v?"rgba(14,165,233,0.15)":"#0e1625", color: metric===o.v?"#0ea5e9":"#475569" }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ paddingTop: 24 }}>
          <button onClick={handleLoad} disabled={loading || !selectedIds.length}
            style={{ background: loading || !selectedIds.length ? "#0c1a2e" : "#0ea5e9", color: loading || !selectedIds.length ? "#334155" : "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Loading…" : "Generate Heatmap →"}
          </button>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      {data && (
        <>
          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
            <span style={{ fontSize: 12, color: "#475569" }}>0</span>
            <div style={{ display: "flex", gap: 2 }}>
              {[0.1,0.3,0.5,0.7,0.9,1.0].map(t => (
                <div key={t} style={{ width: 24, height: 14, borderRadius: 3, background: cellColor(Math.round(t * maxVal)) }} />
              ))}
            </div>
            <span style={{ fontSize: 12, color: "#475569" }}>{maxVal}</span>
            <span style={{ fontSize: 11, color: "#334155", marginLeft: 8 }}>
              {metric === "bugs" ? "Bug count" : metric === "improvements" ? "Improvement count" : "Issue count"} per component/version
            </span>
          </div>

          {/* Heatmap grid */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "#334155", fontWeight: 500, width: 160, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Component</th>
                  {data.versions.map(v => (
                    <th key={v.id} style={{ textAlign: "center", padding: "6px 6px", fontSize: 11, color: "#64748b", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.06)", minWidth: 90 }}>
                      {v.name}
                      {v.released && <div style={{ fontSize: 9, color: "#334155", fontWeight: 400 }}>released</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.components.map((comp, ci) => {
                  const rowTotal = data.versions.reduce((s,v) => s + (data.matrix[v.id]?.[comp]?.[metric]||0), 0);
                  return (
                    <tr key={comp}>
                      <td style={{ padding: "5px 10px", fontSize: 12, color: rowTotal > 0 ? "#94a3b8" : "#334155", borderBottom: "1px solid rgba(255,255,255,0.03)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{comp}</td>
                      {data.versions.map(v => {
                        const val    = data.matrix[v.id]?.[comp]?.[metric] || 0;
                        const issues = data.matrix[v.id]?.[comp]?.issues || [];
                        return (
                          <td key={v.id}
                            title={`${comp} · ${v.name}: ${val} ${metric}`}
                            onMouseEnter={e => val > 0 && setTooltip({ comp, ver: v.name, val, issues, x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setTooltip(null)}
                            style={{ textAlign: "center", padding: "4px 4px", borderBottom: "1px solid rgba(255,255,255,0.03)", background: cellColor(val), fontSize: 12, fontWeight: val > 0 ? 600 : 400, color: val > 0 ? "#e2e8f0" : "transparent", cursor: val > 0 ? "pointer" : "default", transition: "background 0.15s" }}>
                            {cellText(val)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Hover tooltip */}
          {tooltip && (
            <div style={{ position: "fixed", top: tooltip.y + 12, left: tooltip.x + 12, background: "#0e1625", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e2e8f0", zIndex: 999, maxWidth: 340, pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: "#94a3b8" }}>{tooltip.comp} · {tooltip.ver}</div>
              <div style={{ color: "#475569", marginBottom: 6 }}>{tooltip.val} {metric} issue{tooltip.val!==1?"s":""}</div>
              {tooltip.issues.filter(i => metric==="bugs"?i.fields.issuetype.name==="Bug":metric==="improvements"?i.fields.issuetype.name==="Improvement":true).slice(0,5).map(i => (
                <div key={i.key} style={{ fontSize: 11, color: "#64748b", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#334155", fontFamily: "monospace" }}>{i.key}</span> {i.fields.summary}
                </div>
              ))}
              {tooltip.issues.length > 5 && <div style={{ fontSize: 11, color: "#334155" }}>+{tooltip.issues.length-5} more</div>}
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div style={{ textAlign: "center", padding: "4rem 2rem" }}>
          <div style={{ fontSize: 13, color: "#334155" }}>Select versions and click Generate Heatmap</div>
          <div style={{ fontSize: 12, color: "#1e293b", marginTop: 6 }}>See which components have the most bugs across releases</div>
        </div>
      )}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, loading, error }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const inp = { width: "100%", background: "#0a111e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#060c18", padding: "2rem" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ marginBottom: "2rem", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#0ea5e9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff" }}>M</div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>Morph Release Intel</span>
          </div>
          <p style={{ fontSize: 13, color: "#334155" }}>Presales · APAC · MORPH Project</p>
        </div>
        <div style={{ background: "#0e1625", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.75rem" }}>
          <p style={{ fontSize: 13, color: "#475569", marginBottom: "1.5rem", lineHeight: 1.6 }}>Uses your Atlassian API token. Credentials stay in browser memory only.</p>
          <div style={{ marginBottom: "1rem" }}>
            <label style={lbl}>HPE Atlassian Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@hpe.com" style={inp} />
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={lbl}>API Token</label>
            <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="ATATT3x…" style={inp}
              onKeyDown={e => e.key === "Enter" && email && token && !loading && onLogin(email, token)} />
          </div>
          <p style={{ fontSize: 11, color: "#1e293b", marginBottom: "1.5rem" }}>
            Generate at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: "#0ea5e9" }}>id.atlassian.com</a> → Security → API tokens
          </p>
          <button onClick={() => onLogin(email, token)} disabled={loading || !email || !token}
            style={{ width: "100%", background: loading || !email || !token ? "#0c1a2e" : "#0ea5e9", color: loading || !email || !token ? "#334155" : "#fff", border: "none", borderRadius: 8, padding: 11, fontSize: 14, fontWeight: 600, cursor: loading || !email || !token ? "not-allowed" : "pointer" }}>
            {loading ? "Connecting…" : "Connect to Jira →"}
          </button>
          {error && <div style={{ marginTop: "1rem", padding: "10px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, fontSize: 12, color: "#f87171", lineHeight: 1.5, wordBreak: "break-word" }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]                   = useState("login");
  const [loginLoading, setLoginLoading]       = useState(false);
  const [loginError, setLoginError]           = useState(null);
  const [creds, setCreds]                     = useState(null);
  const [versions, setVersions]               = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [issues, setIssues]                   = useState([]);
  const [issuesLoading, setIssuesLoading]     = useState(false);
  const [issueError, setIssueError]           = useState(null);
  const [activeTab, setActiveTab]             = useState("releases");

  const fetchIssues = async (credentials, ver) => {
    setIssuesLoading(true); setIssues([]); setIssueError(null);
    try { setIssues(await fetchAllIssuesForVersion(credentials.email, credentials.token, ver.name)); }
    catch (e) { setIssueError(e.message); }
    finally { setIssuesLoading(false); }
  };

  const handleLogin = async (email, token) => {
    setLoginLoading(true); setLoginError(null);
    try {
      const vers = await loadVersions(email, token);
      if (!vers.length) throw new Error("No versions found for project MORPH.");
      const saved = { email, token };
      setCreds(saved); setVersions(vers);
      const first = vers.find(v => v.released) || vers[0];
      setSelectedVersion(first);
      setScreen("dashboard");
      await fetchIssues(saved, first);
    } catch (e) { setLoginError(e.message); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = () => {
    setScreen("login"); setCreds(null); setIssues([]); setVersions([]);
    setSelectedVersion(null); setLoginError(null); setIssueError(null);
  };

  if (screen === "login") return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={loginError} />;

  const tabs = [
    { id: "releases", label: "Releases" },
    { id: "search",   label: "Issue Search" },
    { id: "diff",     label: "Release Diff" },
    { id: "heatmap",  label: "Component Heatmap" },
  ];

  const tabStyle = active => ({
    background: "transparent", border: "none", cursor: "pointer",
    padding: "0 4px 14px", fontSize: 13, fontWeight: active ? 600 : 400,
    color: active ? "#e2e8f0" : "#475569",
    borderBottom: `2px solid ${active ? "#0ea5e9" : "transparent"}`,
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#060c18", color: "#e2e8f0" }}>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 1.5rem", display: "flex", alignItems: "center", gap: 14, height: 54, background: "#080f1e", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: "#0ea5e9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff" }}>M</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b", letterSpacing: "0.04em" }}>MORPH RELEASE INTEL</span>
        </div>
        <div style={{ width: 1, height: 20, background: "#1e293b", flexShrink: 0 }} />
        <div style={{ display: "flex", gap: 20, height: "100%", alignItems: "flex-end", overflowX: "auto" }}>
          {tabs.map(t => <button key={t.id} style={tabStyle(activeTab===t.id)} onClick={() => setActiveTab(t.id)}>{t.label}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleLogout} style={{ background: "transparent", border: "none", color: "#1e293b", fontSize: 12, cursor: "pointer", padding: "5px 8px", flexShrink: 0 }}>Logout</button>
      </div>

      {activeTab === "releases" && <ReleaseTab versions={versions} issues={issues} selectedVersion={selectedVersion} issueError={issueError} onVersionChange={v => { setSelectedVersion(v); fetchIssues(creds, v); }} loading={issuesLoading} />}
      {activeTab === "search"   && <SearchTab creds={creds} />}
      {activeTab === "diff"     && <DiffTab versions={versions} creds={creds} />}
      {activeTab === "heatmap"  && <HeatmapTab versions={versions} creds={creds} />}
    </div>
  );
}

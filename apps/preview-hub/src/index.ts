export interface Env {
  ACCOUNT_SUBDOMAIN?: string;
  GITHUB_REPO?: string;
}

const APPS = [
  { id: "customer", name: "Customer App", icon: "📱", desc: "Customer ordering & concierge interface" },
  { id: "rider", name: "Rider App", icon: "🛵", desc: "Rider delivery & earnings interface" },
  { id: "merchant", name: "Merchant App", icon: "🏪", desc: "Merchant store & orders management" },
  { id: "restaurant", name: "Restaurant App", icon: "🍽️", desc: "Restaurant kitchen & menu dashboard" },
  { id: "admin", name: "Admin Dashboard", icon: "⚙️", desc: "Superadmin, operations, and cycle control" },
  { id: "web", name: "Marketing Landing", icon: "🌐", desc: "Public landing page and downloads" },
  { id: "api", name: "API Service", icon: "🔌", desc: "Backend Hono API & D1 database health" },
] as const;

type AppId = (typeof APPS)[number]["id"];

function sanitizeBranch(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  s = s.slice(0, 28).replace(/-$/, "");
  return s || "preview";
}

function getAppPreviewUrl(alias: string, app: string, accountSubdomain: string): string {
  return `https://${alias}-tuma-${app}.${accountSubdomain}.workers.dev`;
}

interface BranchInfo {
  name: string;
  alias: string;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  updatedAt?: string;
  isMain?: boolean;
}

async function fetchRecentBranches(repo: string): Promise<BranchInfo[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=20`, {
      headers: {
        "User-Agent": "TumaPreviewHub/1.0",
        Accept: "application/vnd.github.v3+json",
      },
      cf: {
        cacheTtl: 60,
        cacheEverything: true,
      },
    });

    if (!res.ok) {
      return fallbackBranches();
    }

    const data = (await res.json()) as { workflow_runs?: any[] };
    const runs = data.workflow_runs ?? [];
    const seen = new Map<string, BranchInfo>();

    for (const run of runs) {
      const branch = run.head_branch;
      if (!branch || seen.has(branch)) continue;

      seen.set(branch, {
        name: branch,
        alias: sanitizeBranch(branch),
        lastCommitSha: run.head_sha?.slice(0, 7),
        lastCommitMessage: run.head_commit?.message?.split("\n")[0] || "",
        updatedAt: run.created_at,
        isMain: branch === "main",
      });
    }

    return Array.from(seen.values());
  } catch {
    return fallbackBranches();
  }
}

function fallbackBranches(): BranchInfo[] {
  return [
    { name: "main", alias: "main", isMain: true },
    { name: "claude/preview-hub", alias: "claude-preview-hub" },
    { name: "claude/cloudflare-auto-deploy", alias: "claude-cloudflare-auto-deploy" },
  ];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const subdomain = env.ACCOUNT_SUBDOMAIN || "doxalight-inc";
    const repo = env.GITHUB_REPO || "Tuma-Concierge/tuma-concierge";

    // 1. Direct App Subdomains (e.g. customer-preview.tumaffe.online)
    const appSubdomainMatch = host.match(/^([a-z0-9-]+)-preview\.tumaffe\.online$/);
    if (appSubdomainMatch) {
      const requestedApp = appSubdomainMatch[1];
      const validApp = APPS.find((a) => a.id === requestedApp);
      if (validApp) {
        // Query param `?b=branch` or `?branch=branch` specifies branch; otherwise latest branch
        const branchParam = url.searchParams.get("b") || url.searchParams.get("branch");
        let targetAlias = branchParam ? sanitizeBranch(branchParam) : "";

        if (!targetAlias) {
          const branches = await fetchRecentBranches(repo);
          const nonMain = branches.find((b) => !b.isMain);
          targetAlias = nonMain ? nonMain.alias : "claude-preview-hub";
        }

        const targetUrl = `${getAppPreviewUrl(targetAlias, validApp.id, subdomain)}${url.pathname}${url.search}`;
        return Response.redirect(targetUrl, 302);
      }
    }

    // 2. API endpoint: /api/branches
    if (url.pathname === "/api/branches") {
      const branches = await fetchRecentBranches(repo);
      return new Response(JSON.stringify({ branches, apps: APPS }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // 3. Path-based short route: /:branch/:app (e.g. /feat-orders/customer or /customer)
    const pathParts = url.pathname.split("/").filter(Boolean);

    // If single path segment is an app id (e.g. preview.tumaffe.online/customer)
    if (pathParts.length === 1) {
      const matchedApp = APPS.find((a) => a.id === pathParts[0]);
      if (matchedApp) {
        const branchParam = url.searchParams.get("b") || url.searchParams.get("branch");
        let targetAlias = branchParam ? sanitizeBranch(branchParam) : "";
        if (!targetAlias) {
          const branches = await fetchRecentBranches(repo);
          const nonMain = branches.find((b) => !b.isMain);
          targetAlias = nonMain ? nonMain.alias : "claude-preview-hub";
        }
        const targetUrl = `${getAppPreviewUrl(targetAlias, matchedApp.id, subdomain)}${url.search}`;
        return Response.redirect(targetUrl, 302);
      }
    }

    // If two path segments: /:branch/:app
    if (pathParts.length >= 2) {
      const rawBranch = pathParts[0];
      const rawApp = pathParts[1];
      const matchedApp = APPS.find((a) => a.id === rawApp);
      if (matchedApp) {
        const alias = sanitizeBranch(rawBranch);
        const subPath = pathParts.slice(2).join("/");
        const targetUrl = `${getAppPreviewUrl(alias, matchedApp.id, subdomain)}/${subPath}${url.search}`;
        return Response.redirect(targetUrl, 302);
      }
    }

    // 4. Default: Render Central Preview Hub Dashboard
    const branches = await fetchRecentBranches(repo);
    return new Response(renderDashboardHtml(branches, subdomain), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=30, s-maxage=60",
      },
    });
  },
};

function renderDashboardHtml(branches: BranchInfo[], subdomain: string): string {
  const branchRows = branches
    .map((b) => {
      const appButtons = APPS.map((app) => {
        const url = getAppPreviewUrl(b.alias, app.id, subdomain);
        const shortUrl = `https://preview.tumaffe.online/${b.alias}/${app.id}`;
        return `
          <a href="${url}" target="_blank" rel="noopener" class="app-chip" title="${app.name} (${shortUrl})">
            <span>${app.icon}</span>
            <span>${app.id}</span>
          </a>
        `;
      }).join("");

      const isMainBadge = b.isMain
        ? `<span class="badge badge-main">main</span>`
        : `<span class="badge badge-branch">preview</span>`;

      const commitInfo = b.lastCommitSha
        ? `<span class="commit-sha">${b.lastCommitSha}</span> <span class="commit-msg">${escapeHtml(b.lastCommitMessage || "")}</span>`
        : "";

      return `
        <div class="branch-card" data-name="${escapeHtml(b.name.toLowerCase())}">
          <div class="branch-header">
            <div class="branch-title">
              <span class="git-icon">🌿</span>
              <strong class="branch-name">${escapeHtml(b.name)}</strong>
              ${isMainBadge}
            </div>
            <div class="branch-meta">
              Alias: <code>${b.alias}</code>
              ${commitInfo ? `<br>${commitInfo}` : ""}
            </div>
          </div>
          <div class="branch-apps">
            ${appButtons}
          </div>
        </div>
      `;
    })
    .join("");

  const appSubdomainCards = APPS.map((app) => {
    const subUrl = `https://${app.id}-preview.tumaffe.online`;
    return `
      <a href="${subUrl}" target="_blank" class="subdomain-card">
        <div class="subdomain-icon">${app.icon}</div>
        <div class="subdomain-info">
          <h4>${app.name}</h4>
          <code>${app.id}-preview.tumaffe.online</code>
        </div>
        <div class="subdomain-arrow">↗</div>
      </a>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tuma Concierge · Cloudflare Preview Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #121826;
      --card-border: #1f293d;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #10b981;
      --font: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
    }
    header {
      background: #0f172a;
      border-bottom: 1px solid var(--card-border);
      padding: 1.25rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .logo-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo-icon {
      font-size: 1.75rem;
      background: #1e293b;
      padding: 0.35rem 0.6rem;
      border-radius: 10px;
      border: 1px solid #334155;
    }
    h1 { font-size: 1.25rem; font-weight: 700; color: #fff; }
    .subtitle { font-size: 0.825rem; color: var(--text-muted); }
    .live-status {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.3rem 0.75rem;
      border-radius: 9999px;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .live-dot {
      width: 7px;
      height: 7px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
    }
    main {
      flex: 1;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    .hero-banner {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem;
    }
    .hero-banner h2 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    .hero-banner p { color: var(--text-muted); font-size: 0.925rem; max-width: 800px; margin-bottom: 1.25rem; }
    
    .quick-box {
      display: flex;
      gap: 0.5rem;
      max-width: 600px;
    }
    .quick-input {
      flex: 1;
      background: #090d16;
      border: 1px solid #334155;
      color: #fff;
      padding: 0.65rem 1rem;
      border-radius: 8px;
      font-family: var(--mono);
      font-size: 0.875rem;
    }
    .quick-input:focus { outline: none; border-color: var(--primary); }
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 0.65rem 1.25rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--primary-hover); }

    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .subdomain-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
    }
    .subdomain-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1rem 1.2rem;
      text-decoration: none;
      color: inherit;
      display: flex;
      align-items: center;
      gap: 0.85rem;
      transition: all 0.2s;
    }
    .subdomain-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
    }
    .subdomain-icon { font-size: 1.5rem; }
    .subdomain-info h4 { font-size: 0.925rem; font-weight: 600; color: #fff; }
    .subdomain-info code { font-family: var(--mono); font-size: 0.75rem; color: #60a5fa; }
    .subdomain-arrow { margin-left: auto; color: var(--text-muted); font-size: 1.1rem; }

    .search-bar {
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: #fff;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .search-bar:focus { outline: none; border-color: var(--primary); }

    .branch-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .branch-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .branch-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .branch-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1rem;
    }
    .branch-name { color: #fff; font-family: var(--mono); font-size: 0.95rem; }
    .badge {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
    }
    .badge-main { background: #3b82f6; color: #fff; }
    .badge-branch { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
    .branch-meta {
      font-size: 0.775rem;
      color: var(--text-muted);
      font-family: var(--mono);
      text-align: right;
    }
    .commit-sha { color: #cbd5e1; font-weight: 600; }
    .commit-msg { color: #64748b; }

    .branch-apps {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
    }
    .app-chip {
      background: #1e293b;
      border: 1px solid #334155;
      color: #e2e8f0;
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      text-decoration: none;
      font-size: 0.825rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.15s;
    }
    .app-chip:hover {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
      transform: translateY(-1px);
    }

    footer {
      border-top: 1px solid var(--card-border);
      padding: 1.5rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    footer a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <div class="logo-container">
      <div class="logo-icon">🛵</div>
      <div>
        <h1>Tuma Concierge · Preview Hub</h1>
        <div class="subtitle">Cloudflare Automated Staging & Branch Previews</div>
      </div>
    </div>
    <div class="live-status">
      <span class="live-dot"></span>
      <span>Cloudflare Active</span>
    </div>
  </header>

  <main>
    <div class="hero-banner">
      <h2>Short Preview Router</h2>
      <p>Visit any app directly via its short subdomain (e.g. <code>customer-preview.tumaffe.online</code>) or jump directly to any branch using <code>preview.tumaffe.online/&lt;branch&gt;/&lt;app&gt;</code>.</p>
      <div class="quick-box">
        <input type="text" id="quickBranch" class="quick-input" placeholder="Enter branch (e.g. feat-orders)" />
        <select id="quickApp" class="quick-input" style="max-width: 140px;">
          <option value="customer">customer</option>
          <option value="rider">rider</option>
          <option value="merchant">merchant</option>
          <option value="restaurant">restaurant</option>
          <option value="admin">admin</option>
          <option value="web">web</option>
          <option value="api">api</option>
        </select>
        <button class="btn" onclick="launchQuick()">Launch</button>
      </div>
    </div>

    <div>
      <div class="section-title">✨ Direct App Preview Subdomains</div>
      <div class="subdomain-grid">
        ${appSubdomainCards}
      </div>
    </div>

    <div>
      <div class="section-title">🌿 Active Branch Previews</div>
      <input type="text" id="searchBar" class="search-bar" placeholder="🔍 Search branches..." oninput="filterBranches()" />
      <div class="branch-list" id="branchList">
        ${branchRows}
      </div>
    </div>
  </main>

  <footer>
    Tuma Concierge · Automated Cloudflare Previews · Domain: <a href="https://tumaffe.online" target="_blank">tumaffe.online</a>
  </footer>

  <script>
    function launchQuick() {
      const branch = document.getElementById('quickBranch').value.trim();
      const app = document.getElementById('quickApp').value;
      if (!branch) return alert('Please enter a branch name or alias');
      window.location.href = '/' + encodeURIComponent(branch) + '/' + app;
    }

    function filterBranches() {
      const q = document.getElementById('searchBar').value.toLowerCase();
      const cards = document.querySelectorAll('.branch-card');
      cards.forEach(c => {
        const name = c.getAttribute('data-name');
        c.style.display = name.includes(q) ? 'flex' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

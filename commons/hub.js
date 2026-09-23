/* Shared client for The Commons hub. */
const API_BASE = "https://koda-hub-api.benmcnulty.workers.dev";

async function hubGet(path) {
  const r = await fetch(API_BASE + path, { headers: { Accept: "application/json" } });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function hubPost(path, body, token) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/* Shows a demo-mode banner when the API serves seed data (DB not provisioned). */
function maybeDemoBanner(data) {
  if (data && data.demo) {
    const el = document.getElementById("demo-banner");
    if (el) el.style.display = "block";
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function agentCard(a) {
  const badge = a.verified_badge
    ? ' <span class="pill" title="Verified sponsor">✓ verified</span>'
    : "";
  const tier =
    a.sponsor_tier && a.sponsor_tier !== "none"
      ? ` <span class="pill">${esc(a.sponsor_tier)}</span>`
      : "";
  const did = a.did
    ? `<p style="color:var(--text-faint); font-size:12px; word-break:break-all"><code>${esc(a.did)}</code></p>`
    : "";
  const site = a.site
    ? ` <a href="${esc(a.site)}" rel="noopener">site ↗</a>`
    : "";
  return `<div class="card">
    <h3 style="margin-top:0">@${esc(a.handle)}${badge}${tier}</h3>
    <p style="color:var(--text-dim)">${esc(a.agent_type)} agent${site}</p>
    <p>${esc(a.bio || "")}</p>
    ${did}
  </div>`;
}

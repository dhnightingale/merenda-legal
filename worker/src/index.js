// merenda.io/plan/<token> — the preview page behind a shared plan link.
//
// The token is a capability (see supabase/migrations/20260921090000_plan_links.sql in
// the app repo): the page asks plan_link_preview(token) for the little it may say —
// title, when, the host's first name — and renders that as Open Graph tags so iMessage,
// WhatsApp and the rest draw a real card. Nobody RSVPs here. On a phone with merenda
// the universal link opens the app before this page is ever fetched; everyone else
// gets a bounce into friendli://planlink/<token> plus the TestFlight door.
//
// Paths without a token (/plan, /plan/, /plan/?p=<uuid>) fall through to the static
// site on GitHub Pages, which keeps handling the pre-token uuid links.

const TOKEN = /^[A-Za-z0-9_-]{16}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean); // ["plan", "<token>"]
    const token = segments.length === 2 && segments[0] === "plan" ? segments[1] : null;
    if (!token || !TOKEN.test(token)) return fetch(request);

    const preview = await fetchPreview(env, token);
    const html = preview ? livePage(env, token, preview, url) : offPage(env, url);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // A revoked link must stop working on the next tap, and a time change must show.
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  },
};

async function fetchPreview(env, token) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/plan_link_preview`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" && body.title ? body : null;
  } catch {
    return null;
  }
}

// " on Sat, Sep 26 at 7:00 PM" / " tomorrow evening" / " today" — the same vocabulary
// as the app's text invite (planWhenPhrase in PlanTextInviteViews.swift), in the host's
// time zone. A block plan sits on the local-noon sentinel, so a clock time is shown only
// when has_time says one was chosen (a nil has_time falls back to "not 12:00 sharp").
function whenPhrase(p) {
  const tz = p.host_tz || "America/New_York";
  const at = new Date(p.scheduled_at);
  if (Number.isNaN(at.getTime())) return "";

  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const key = dayKey(at);
  let day;
  if (key === today) day = "today";
  else if (key === tomorrow) day = "tomorrow";
  else day = "on " + new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(at);

  const block = (p.time_block || "").toLowerCase();
  if (block === "am") return `${day} in the morning`;
  if (block === "pm") return `${day} in the afternoon`;
  if (block === "evening") return `${day} evening`;

  let hasTime = p.has_time;
  if (hasTime === null || hasTime === undefined) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(at);
    const h = Number(parts.find((x) => x.type === "hour")?.value);
    const m = Number(parts.find((x) => x.type === "minute")?.value);
    hasTime = !(h === 12 && m === 0);
  }
  if (!hasTime) return day;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  return `${day} at ${time}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function shell({ title, description, pageURL, body, script }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageURL)}">
<meta property="og:image" content="https://merenda.io/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="merenda">
<meta name="twitter:card" content="summary">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 480px; margin: 0 auto; padding: 56px 24px; text-align: center;
         color: #1c1c1e; line-height: 1.6; background: #fffdf9; }
  .brand { color: #21ad6e; font-weight: 700; letter-spacing: 0.02em; margin: 0 0 24px; }
  h1 { margin: 0 0 4px; font-size: 28px; line-height: 1.25; }
  p { margin: 12px 0; }
  .muted { color: #6e6e73; font-size: 15px; }
  .btn { display: inline-block; margin: 10px 6px 0; padding: 12px 22px; border-radius: 999px;
         background: #21ad6e; color: #fff; text-decoration: none; font-weight: 600; }
  .btn.secondary { background: transparent; color: #21ad6e; border: 1.5px solid #21ad6e; }
  .link { color: #21ad6e; font-weight: 600; text-decoration: none; }
  .ios { display: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #131313; color: #ececec; }
    .muted { color: #a1a1a6; }
  }
</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

function livePage(env, token, p, url) {
  const raw = whenPhrase(p);
  // "Sat, Sep 26 at 7:00 PM" / "Tomorrow evening" — the phrase minus its leading "on",
  // capitalised, since it opens the line rather than following a verb.
  const when = raw.replace(/^on /, "").replace(/^\w/, (c) => c.toUpperCase());
  const host = p.host_name || "a friend";
  const description = `${when ? when + " · " : ""}Hosted by ${host} · The plan lives in merenda`;
  const deep = `friendli://planlink/${token}`;
  return shell({
    title: p.title,
    description,
    pageURL: `https://merenda.io/plan/${token}`,
    body: `
<p class="brand">merenda</p>
<h1>${esc(p.title)}</h1>
<p class="muted">${esc(when)}${when ? " · " : ""}Hosted by ${esc(host)}</p>
<p id="status" class="muted">&nbsp;</p>
<p>
  <a class="btn" href="${deep}">Open in merenda</a>
  <a id="beta" class="btn secondary" href="${esc(env.TESTFLIGHT_URL)}">Not on merenda yet? Join the beta</a>
</p>
<p id="ios" class="muted ios">merenda is on iPhone for now.</p>
<p id="install" class="muted" style="margin-top:28px">Install from the beta link first, then come back and tap Open — the plan will be waiting.</p>`,
    script: platformScript(deep),
  });
}

function offPage(env, url) {
  return shell({
    title: "merenda — a plan",
    description: "This link isn’t live anymore. The plan lives in merenda 🎈",
    pageURL: "https://merenda.io/plan/",
    body: `
<p class="brand">merenda</p>
<h1>This link isn’t live anymore</h1>
<p class="muted">The host turned it off, or the plan has come and gone. Ask them for a fresh one.</p>
<p>
  <a id="beta" class="btn secondary" href="${esc(env.TESTFLIGHT_URL)}">Not on merenda yet? Join the beta</a>
</p>
<p><a class="link" href="friendli://plans">Open merenda</a></p>
<p id="ios" class="muted ios">merenda is on iPhone for now.</p>`,
    script: platformScript(null),
  });
}

// The bounce, and the honest version of the page for everyone it can't help. No
// "Opening…" promise up front: if the app is here the page is gone before anyone
// reads it, and if it isn't, a line that never resolves reads as broken. After a beat
// the status says what to do instead. Android gets the truth in place of a TestFlight
// door that leads nowhere.
function platformScript(deep) {
  return `(function () {
  var android = /Android/i.test(navigator.userAgent);
  var ios = document.getElementById('ios'), beta = document.getElementById('beta'),
      status = document.getElementById('status'), install = document.getElementById('install');
  if (android) {
    if (beta) beta.style.display = 'none';
    if (install) install.style.display = 'none';
    if (ios) ios.style.display = 'block';
    return;
  }
  if (ios) ios.style.display = 'block';
  ${deep ? `setTimeout(function () { location.href = ${JSON.stringify(deep)}; }, 150);
  setTimeout(function () { if (status) status.textContent = 'Not opening? Install first, then come back and tap Open.'; }, 1500);` : ""}
})();`;
}

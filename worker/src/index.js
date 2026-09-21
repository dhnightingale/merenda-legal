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

import { ImageResponse, loadGoogleFont } from "workers-og";

const TOKEN = /^[A-Za-z0-9_-]{16}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean); // ["plan", "<token>", "og.png"?]
    const token = segments.length >= 2 && segments[0] === "plan" ? segments[1] : null;
    if (!token || !TOKEN.test(token)) return fetch(request);
    if (segments.length === 3 && segments[2] === "og.png") return ogImage(request, env, ctx, token);
    if (segments.length !== 2) return fetch(request);

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

function shell({ title, description, pageURL, body, script, image }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#fffdf9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131313" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<link rel="icon" href="https://merenda.io/icon.png" type="image/png">
<link rel="apple-touch-icon" href="https://merenda.io/apple-touch-icon.png">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageURL)}">
<meta property="og:image" content="${esc(image || "https://merenda.io/og.png")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="merenda">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         color: #1c1c1e; line-height: 1.5; background: #fffdf9;
         -webkit-font-smoothing: antialiased; min-height: 100dvh;
         display: flex; flex-direction: column; }
  main { width: 100%; max-width: 440px; margin: 0 auto; padding: 40px 20px 24px; flex: 1; }
  /* The mark, standalone, the way the app icon shows it. */
  .mast { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .mast img { width: 40px; height: 40px; border-radius: 10px; display: block; }
  .mast span { color: #21ad6e; font-weight: 700; font-size: 18px; letter-spacing: 0.01em; }
  /* The plan as a card: the app's paper card, the same hairline and radius. */
  .card { background: #fff; border: 1px solid #e8e5dd; border-radius: 22px; padding: 22px 22px 20px;
          box-shadow: 0 6px 24px rgba(28, 28, 30, 0.05); text-align: left; }
  .eyebrow { color: #21ad6e; font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
             text-transform: uppercase; margin: 0 0 8px; }
  h1 { margin: 0 0 14px; font-size: 27px; line-height: 1.2; letter-spacing: -0.01em; font-weight: 700; }
  .fact { display: flex; align-items: center; gap: 10px; margin: 8px 0 0; font-size: 16px; color: #1c1c1e; }
  .fact svg { width: 18px; height: 18px; flex: none; color: #8e8e93; }
  .mono { width: 26px; height: 26px; border-radius: 50%; flex: none; display: inline-flex; align-items: center;
          justify-content: center; font-size: 12px; font-weight: 700; color: #fff;
          background: linear-gradient(135deg, #21ad6e, #1a9494); }
  .actions { margin: 20px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .btn { display: block; width: 100%; padding: 15px 20px; border-radius: 999px; text-align: center;
         background: #21ad6e; color: #fff; text-decoration: none; font-weight: 600; font-size: 17px; }
  .btn.secondary { background: rgba(33, 173, 110, 0.10); color: #21ad6e; }
  .status { min-height: 22px; margin: 12px 0 0; font-size: 14px; color: #6e6e73; text-align: center; }
  .about { margin: 28px 0 0; padding: 0 4px; font-size: 15px; color: #6e6e73; text-align: center; }
  .about strong { color: #1c1c1e; font-weight: 600; }
  .link { color: #21ad6e; font-weight: 600; text-decoration: none; }
  footer { padding: 16px 20px calc(16px + env(safe-area-inset-bottom)); font-size: 13px; color: #8e8e93;
           text-align: center; }
  footer a { color: #8e8e93; text-decoration: none; margin: 0 8px; }
  .ios { display: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #131313; color: #ececec; }
    .card { background: #1c1c1e; border-color: #2c2c2e; box-shadow: none; }
    .fact { color: #ececec; }
    .about strong { color: #ececec; }
    .status, .about { color: #a1a1a6; }
  }
</style>
</head>
<body>
<main>
<a class="mast" href="https://merenda.io/" style="text-decoration:none"><img src="https://merenda.io/icon.png" alt="" width="40" height="40"><span>merenda</span></a>
${body}
</main>
<footer><a href="https://merenda.io/">merenda.io</a>·<a href="https://merenda.io/privacy/">Privacy</a></footer>
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

const CAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;

function livePage(env, token, p, url) {
  const raw = whenPhrase(p);
  // "Sat, Sep 26 at 7:00 PM" / "Tomorrow evening" — the phrase minus its leading "on",
  // capitalised, since it opens the line rather than following a verb.
  const when = raw.replace(/^on /, "").replace(/^\w/, (c) => c.toUpperCase());
  const host = p.host_name || "a friend";
  const initial = (p.host_name || "").trim().charAt(0).toUpperCase() || "☺";
  const description = `${when ? when + " · " : ""}Hosted by ${host} · The plan lives in merenda`;
  const deep = `friendli://planlink/${token}`;
  return shell({
    title: p.title,
    description,
    pageURL: `https://merenda.io/plan/${token}`,
    image: `https://merenda.io/plan/${token}/og.png`,
    body: `
<section class="card">
  <p class="eyebrow">You’re invited</p>
  <h1>${esc(p.title)}</h1>
  ${when ? `<p class="fact">${CAL}<span>${esc(when)}</span></p>` : ""}
  <p class="fact"><span class="mono">${esc(initial)}</span><span>Hosted by ${esc(host)}</span></p>
  <div class="actions">
    <a class="btn" href="${deep}">Open in merenda</a>
    <a id="beta" class="btn secondary" href="${esc(env.TESTFLIGHT_URL)}">Get merenda on TestFlight</a>
  </div>
  <p id="status" class="status">&nbsp;</p>
</section>
<p class="about"><strong>merenda</strong> is where friends keep plans. Install it, come back, tap Open — this one’s waiting for you, with the chat and who’s coming.</p>
<p id="ios" class="about ios">merenda is on iPhone for now.</p>`,
    script: platformScript(deep),
  });
}

function offPage(env, url) {
  return shell({
    title: "merenda — a plan",
    description: "This link isn’t live anymore. The plan lives in merenda 🎈",
    pageURL: "https://merenda.io/plan/",
    body: `
<section class="card">
  <p class="eyebrow">Plan link</p>
  <h1>This link isn’t live anymore</h1>
  <p class="fact"><span>The host turned it off, or the plan has come and gone. Ask them for a fresh one.</span></p>
  <div class="actions">
    <a class="btn" href="friendli://plans">Open merenda</a>
    <a id="beta" class="btn secondary" href="${esc(env.TESTFLIGHT_URL)}">Get merenda on TestFlight</a>
  </div>
</section>
<p class="about"><strong>merenda</strong> is where friends keep plans.</p>
<p id="ios" class="about ios">merenda is on iPhone for now.</p>`,
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
  var ua = navigator.userAgent, android = /Android/i.test(ua), iphone = /iPhone|iPad|iPod/i.test(ua);
  var ios = document.getElementById('ios'), beta = document.getElementById('beta'),
      status = document.getElementById('status');
  if (android) {
    if (beta) beta.style.display = 'none';
    if (ios) ios.style.display = 'block';
    return;
  }
  // "iPhone for now" is news on a laptop, not on an iPhone.
  if (ios && !iphone) ios.style.display = 'block';
  ${deep ? `setTimeout(function () { location.href = ${JSON.stringify(deep)}; }, 150);
  setTimeout(function () { if (status) status.textContent = 'Not opening? Install from TestFlight first, then tap Open.'; }, 2500);` : ""}
})();`;
}

// MARK: The preview image

// merenda.io/plan/<token>/og.png — the card iMessage, WhatsApp and Slack draw for a
// shared link: the plan's title, when, and the host's first name on the site's paper,
// with the mark top-left. Rendered from the same preview RPC as the page, so a revoked
// link falls back to the generic brand card and a time change shows within the cache
// window. Fonts come from Google Fonts once per isolate; the PNG sits in the edge cache
// for five minutes.
const OG_CACHE_SECONDS = 300;
let fontCache = null;

async function ogFonts() {
  if (!fontCache) {
    fontCache = Promise.all([
      loadGoogleFont({ family: "Inter", weight: 700 }),
      loadGoogleFont({ family: "Inter", weight: 500 }),
    ]).then(([bold, medium]) => [
      { name: "Inter", data: bold, weight: 700, style: "normal" },
      { name: "Inter", data: medium, weight: 500, style: "normal" },
    ]).catch((e) => { fontCache = null; throw e; });
  }
  return fontCache;
}

async function ogImage(request, env, ctx, token) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const preview = env.DEMO_PREVIEW && token === "DEMODEMODEMODEMO"
    ? { title: new URL(request.url).searchParams.get("t") || "Butter blind taste test", host_name: "Danny", scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), time_block: "evening", host_tz: "America/New_York" }
    : await fetchPreview(env, token);
  if (!preview) return Response.redirect("https://merenda.io/og.png", 302);

  const raw = whenPhrase(preview);
  const when = raw.replace(/^on /, "").replace(/^\w/, (c) => c.toUpperCase());
  const host = preview.host_name || "a friend";
  const title = String(preview.title);
  // Long titles step down rather than wrap off the card.
  const size = title.length > 44 ? 56 : title.length > 28 ? 68 : 80;

  const html = `
<div style="display: flex; flex-direction: column; justify-content: space-between; width: 1200px; height: 630px; padding: 64px 72px; background: #fffdf9; color: #1c1c1e; font-family: Inter;">
  <div style="display: flex; align-items: center;">
    <img src="https://merenda.io/icon.png" width="56" height="56" style="border-radius: 14px;" />
    <div style="display: flex; margin-left: 16px; font-size: 30px; font-weight: 700; color: #21ad6e;">merenda</div>
  </div>
  <div style="display: flex; flex-direction: column;">
    <div style="display: flex; font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #21ad6e; margin-bottom: 14px;">YOU’RE INVITED</div>
    <div style="display: flex; font-size: ${size}px; font-weight: 700; line-height: 1.1; letter-spacing: -1px; max-height: ${size * 2.3}px; overflow: hidden;">${esc(title)}</div>
    <div style="display: flex; margin-top: 26px; font-size: 32px; font-weight: 500; color: #6e6e73;">${esc(when ? when + "  ·  " : "")}Hosted by ${esc(host)}</div>
  </div>
</div>`;

  const image = new ImageResponse(html, { width: 1200, height: 630, fonts: await ogFonts() });
  const response = new Response(image.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${OG_CACHE_SECONDS}`,
      "x-robots-tag": "noindex",
    },
  });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

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
    // merenda.io/add/?u=<id>&n=<first name>: the same page GitHub Pages serves, but
    // with the sender's name on it and on its link card. The name is whatever the app
    // put in the link — the site never turns a user id into a name.
    if (segments[0] === "add") {
      if (segments.length === 1) return addPage(env, url);
      if (segments.length === 2 && segments[1] === "og.png") return addImage(request, env, ctx, url);
      return fetch(request);
    }
    // merenda.io/boston — the week's digest as a public page (2026-09-26): city
    // content only, cached half an hour, indexable. Every card is a door into the app.
    if (segments[0] === "boston" && segments.length === 1) return cityPage(env, url, "boston", "Boston");
    if (env.DEMO_PREVIEW && segments[0] === "og" && segments[1] === "render") return demoRender(url);
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

// MARK: The add page

/// The first name a link carries, made safe for a page and a card: letters, marks,
/// spaces and the punctuation names have; 24 characters at most; else nothing.
function senderName(url) {
  const raw = (url.searchParams.get("n") || "").normalize("NFC").trim();
  const clean = raw.replace(/[^\p{L}\p{M}\s'’.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
  return clean.length >= 1 ? clean : "";
}

function addPage(env, url) {
  const name = senderName(url);
  const headline = name ? `${name} saved you a spot` : "Someone saved you a spot";
  const image = `https://merenda.io/add/og.png${name ? "?n=" + encodeURIComponent(name) : ""}`;
  return new Response(shell({
    title: `${headline} on merenda`,
    description: "Open the link in merenda and you’re connected 🎈",
    pageURL: "https://merenda.io/add/",
    image,
    body: `
<section class="card">
  <p class="eyebrow">Add a friend</p>
  <h1>${esc(headline)}</h1>
  <p class="fact"><span>Open the link in merenda and you’re connected — no searching, no request to wait on.</span></p>
  <div class="actions">
    <a id="open" class="btn" href="#">Open in merenda</a>
    <a id="beta" class="btn secondary" href="${esc(env.TESTFLIGHT_URL)}">Get merenda on TestFlight</a>
  </div>
  <p id="status" class="status">&nbsp;</p>
</section>
<p class="about"><strong>merenda</strong> is where friends keep plans. Install it, come back, tap Open — ${name ? esc(name) : "the person who sent this"} will be waiting.</p>
<p id="ios" class="about ios">merenda is on iPhone for now.</p>`,
    script: addScript(),
  }), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

// The static page's bounce, unchanged: the id is read from the query on the phone.
function addScript() {
  return `(function () {
  var u = new URLSearchParams(location.search).get('u') || '';
  var ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u);
  var deep = ok ? 'friendli://add/' + u.toLowerCase() : 'friendli://connect';
  document.getElementById('open').href = deep;
  var status = document.getElementById('status');
  if (ok) {
    setTimeout(function () { location.href = deep; }, 150);
    setTimeout(function () { status.textContent = 'Not opening? Install from TestFlight first, then tap Open.'; }, 2500);
  } else {
    status.textContent = 'This link is missing its code — ask your friend to share it again.';
  }
  var ua = navigator.userAgent, android = /Android/i.test(ua), iphone = /iPhone|iPad|iPod/i.test(ua);
  if (android) document.getElementById('beta').style.display = 'none';
  if (!iphone) document.getElementById('ios').style.display = 'block';
})();`;
}

async function addImage(request, env, ctx, url) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  const name = senderName(url);
  const response = await renderCard({
    eyebrow: "ADD A FRIEND",
    title: name ? `${name} saved you a spot` : "Someone saved you a spot",
    sub: "Open the link in merenda and you’re connected",
    maxAge: 86_400,
  });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

// wrangler dev only: renders any card, for making the site's static images
// (/og.png is the home card, made here once and committed).
function demoRender(url) {
  return renderCard({
    eyebrow: url.searchParams.get("eyebrow") || "",
    title: url.searchParams.get("title") || "",
    sub: url.searchParams.get("sub") || "",
    maxAge: 0,
  });
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
  const response = await renderCard({
    eyebrow: "YOU’RE INVITED",
    title: String(preview.title),
    sub: `${when ? when + "  ·  " : ""}Hosted by ${host}`,
    maxAge: OG_CACHE_SECONDS,
  });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

/// One card for every preview: the mark top-left, an eyebrow, a title that steps down
/// rather than wrap off the card, one grey line under it. The plan card, the add card
/// and the home card are the same picture with different words.
async function renderCard({ eyebrow, title, sub, maxAge }) {
  const size = title.length > 44 ? 56 : title.length > 28 ? 68 : 80;
  const html = `
<div style="display: flex; flex-direction: column; justify-content: space-between; width: 1200px; height: 630px; padding: 64px 72px; background: #fffdf9; color: #1c1c1e; font-family: Inter;">
  <div style="display: flex; align-items: center;">
    <img src="https://merenda.io/icon.png" width="56" height="56" style="border-radius: 14px;" />
    <div style="display: flex; margin-left: 16px; font-size: 30px; font-weight: 700; color: #21ad6e;">merenda</div>
  </div>
  <div style="display: flex; flex-direction: column;">
    ${eyebrow ? `<div style="display: flex; font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #21ad6e; margin-bottom: 14px;">${esc(eyebrow)}</div>` : ""}
    <div style="display: flex; font-size: ${size}px; font-weight: 700; line-height: 1.1; letter-spacing: -1px; max-height: ${size * 2.3}px; overflow: hidden;">${esc(title)}</div>
    ${sub ? `<div style="display: flex; margin-top: 26px; font-size: 32px; font-weight: 500; color: #6e6e73;">${esc(sub)}</div>` : ""}
  </div>
</div>`;
  const image = new ImageResponse(html, { width: 1200, height: 630, fonts: await ogFonts() });
  return new Response(image.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      "x-robots-tag": "noindex",
    },
  });
}


// MARK: The city page

async function fetchDigest(env, city) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/idea_digest_public`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_city: city }),
      cf: { cacheTtl: 1800, cacheEverything: true },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.ideas ? d : null;
  } catch {
    return null;
  }
}

const DAY_NAMES = { mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays" };
const SOURCE_NAMES = { "thebostoncalendar.com": "Boston Calendar", "bostonmagazine.com": "Boston Magazine", "boston.eater.com": "Eater Boston", "timeout.com": "Time Out", "espn.com": "ESPN", "boston.gov": "City of Boston", "icaboston.org": "the ICA", "mfa.org": "the MFA", "sowaboston.com": "SoWa", "bpl.bibliocommons.com": "the BPL", "ccae.org": "CCAE", "coolidge.org": "the Coolidge", "boston.com": "Boston.com" };
function sourceName(u) {
  try { const h = new URL(u).hostname.replace(/^www\./, ""); return SOURCE_NAMES[h] || h; } catch { return "source"; }
}

/** The app's sections, in the app's order: before the weekend, the weekend, every
 *  week, later this month, just opened, the season. Games stay in the app. */
function citySections(ideas, now) {
  const tz = "America/New_York";
  const dayOf = (d) => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d) + "T00:00:00Z");
  const today = dayOf(now);
  const wd = today.getUTCDay(); // 0 = Sunday
  const daysToFri = wd === 0 ? -2 : wd === 6 ? -1 : (5 - wd);
  const fri = new Date(today.getTime() + daysToFri * 86400000);
  const mon = new Date(fri.getTime() + 3 * 86400000);
  const horizon = new Date(now.getTime() + 14 * 86400000);
  const byStart = (a, b) => (a.window.start < b.window.start ? -1 : 1);
  const events = ideas.filter((i) => i.kind === "event" && !i.id.includes(":game:") && i.window && new Date(i.window.end) > now && new Date(i.window.start) < horizon);
  const weekend = events.filter((i) => new Date(i.window.start) < mon && new Date(i.window.end) >= fri && new Date(i.window.start) >= fri).sort(byStart);
  const before = events.filter((i) => new Date(i.window.start) < fri).sort(byStart);
  const placed = new Set([...weekend, ...before].map((i) => i.id));
  const later = events.filter((i) => !placed.has(i.id)).sort(byStart);
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const start = order.indexOf(["sun", "mon", "tue", "wed", "thu", "fri", "sat"][wd]);
  const away = (i) => Math.min(...(i.days || []).map((d) => (order.indexOf(d) - start + 7) % 7), 7);
  const weekly = ideas.filter((i) => i.kind === "weekly").sort((a, b) => away(a) - away(b) || a.title.localeCompare(b.title));
  const opened = ideas.filter((i) => i.kind === "new");
  const season = ideas.filter((i) => (i.kind === "seasonal" || i.kind === "evergreen") && !i.id.includes(":place:"));
  return [
    ["Before the weekend", before], ["This weekend", weekend], ["Every week", weekly],
    ["Later this month", later], ["Just opened", opened], ["The season", season],
  ].filter(([, list]) => list.length);
}

function ideaCard(i) {
  const place = i.place && i.place.name ? `<span>${esc(i.place.name)}</span>` : "";
  const via = i.citation && i.citation.url ? `<a class="link" href="${esc(i.citation.url)}" rel="nofollow noopener">via ${esc(sourceName(i.citation.url))} ↗</a>` : "";
  const chip = i.kind === "weekly" && i.days && i.days.length === 1
    ? `<span class="chip">${esc(DAY_NAMES[i.days[0]] || "Weekly")}${i.time ? " " + esc(i.time.replace(":00", "")) : ""}</span>`
    : i.kind === "new" ? `<span class="chip">Just opened</span>` : "";
  const tag = i.custom && i.custom.label ? `${esc(i.custom.emoji || "")} ${esc(i.custom.label)}` : (i.tags && i.tags[0] ? esc(i.tags[0]) : "");
  return `<article class="idea" id="${esc(i.id)}">
  <h2>${esc(i.title)}</h2>
  <p class="blurb">${esc(i.blurb || "")}</p>
  <p class="chips">${tag ? `<span class="chip">${tag}</span>` : ""}${chip}</p>
  <p class="meta">${place}${place && via ? " · " : ""}${via}</p>
  <a class="make" href="friendli://idea/${encodeURIComponent(i.id)}">Make a plan</a>
</article>`;
}

async function cityPage(env, url, city, cityName) {
  const d = await fetchDigest(env, city);
  const now = new Date();
  const sections = d ? citySections(d.ideas, now) : [];
  const total = sections.reduce((n, [, l]) => n + l.length, 0);
  const description = `${total} things worth doing in ${cityName} over the next two weeks: what's on, weekly nights, new places. Picked by merenda every Thursday.`;
  const body = `
<section class="card head">
  <p class="eyebrow">This week</p>
  <h1>What’s on in ${esc(cityName)}</h1>
  <p class="sub">${esc(description)}</p>
  <div class="actions">
    <a id="beta" class="btn secondary" href="${esc(env.TESTFLIGHT_URL)}">Get merenda on TestFlight</a>
  </div>
</section>
${sections.map(([title, list]) => `
<h3 class="section">${esc(title)} <span class="count">${list.length}</span></h3>
${list.map(ideaCard).join("\n")}`).join("\n")}
<p class="about">Every card opens as a plan in <strong>merenda</strong>, with your friends and a time on it. Games are in the app too — every Sox, Celtics, Bruins and Patriots night.</p>
<p id="ios" class="about ios">merenda is on iPhone for now.</p>`;
  const html = shell({
    title: `What’s on in ${cityName} · merenda`,
    description,
    pageURL: `https://merenda.io/${city}`,
    body,
    script: platformScript(null),
  }).replace("</style>", `
  .card.head { margin-bottom: 8px; }
  .sub { margin: 0; color: #6e6e73; font-size: 15px; }
  .section { margin: 28px 4px 10px; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6e6e73; }
  .section .count { color: #21ad6e; margin-left: 6px; }
  .idea { background: #fff; border: 1px solid #e8e5dd; border-radius: 18px; padding: 16px 16px 14px; margin: 0 0 10px; }
  .idea h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; }
  .blurb { margin: 0 0 10px; font-size: 15px; color: #3a3a3c; }
  .chips { margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 13px; padding: 4px 10px; border-radius: 999px; background: rgba(120, 120, 128, 0.12); color: #1c1c1e; }
  .meta { margin: 0 0 12px; font-size: 13px; color: #6e6e73; }
  .make { display: inline-block; padding: 9px 16px; border-radius: 999px; background: rgba(33, 173, 110, 0.10); color: #21ad6e; font-weight: 600; font-size: 15px; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    .idea { background: #1c1c1e; border-color: #2c2c2e; }
    .blurb { color: #d1d1d6; }
    .chip { color: #ececec; }
    .sub, .meta, .section { color: #a1a1a6; }
  }
</style>`);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=1800",
    },
  });
}

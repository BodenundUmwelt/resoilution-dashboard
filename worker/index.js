// Cloudflare Worker fuer das ReSoilution-Dashboard
// Aufgaben:
//  1. das Dashboard und die Dateien ausliefern (statische Dateien)
//  2. /_blob/<id>  -> Datei aus dem Supabase-Speicher (signierte URL)
//  3. /api/mail/*  -> Postfaecher aus Microsoft 365 ueber Microsoft Graph, serverseitig
// Anmeldung und Geschaeftsdaten laufen direkt im Browser ueber Supabase.

const MAILBOXES = [
  "info@resoilution.com",
  "h.zimmermann@resoilution.com",
  "p.schwab@resoilution.com",
  "s.thanheiser@resoilution.com"
];

// Diese Konten duerfen die Mail-Schnittstelle nutzen (die drei Logins).
const ALLOWED_LOGINS = [
  "h.zimmermann@resoilution.com",
  "p.schwab@resoilution.com",
  "s.thanheiser@resoilution.com"
];

let tokenCache = { token: null, exp: 0 };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/_blob/")) return await serveBlob(path, env);
      if (path.startsWith("/api/mail/")) return await mailApi(path, url, request, env);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }

    // alles andere: statische Dateien (index.html, postfach.html, rs-*.js ...)
    return env.ASSETS.fetch(request);
  }
};

// ---------- Dateien aus dem Supabase-Speicher ----------
async function serveBlob(path, env) {
  const id = decodeURIComponent(path.slice("/_blob/".length));
  if (!id || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return new Response("nicht gefunden", { status: 404 });
  const r = await fetch(env.SUPABASE_URL + "/storage/v1/object/sign/uploads/" + encodeURIComponent(id), {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 3600 })
  });
  if (!r.ok) return new Response("nicht gefunden", { status: 404 });
  const j = await r.json();
  let signed = j.signedURL || j.signedUrl || "";
  if (!/^https?:/.test(signed)) signed = env.SUPABASE_URL + "/storage/v1" + signed;
  return Response.redirect(signed, 302);
}

// ---------- Mail-Schnittstelle ----------
async function mailApi(path, url, request, env) {
  const azureReady = !!(env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET);

  if (path === "/api/mail/status") {
    const user = await verify(request, env);
    if (!user) return json({ error: "nicht angemeldet" }, 401);
    return json({ configured: azureReady, mailboxes: MAILBOXES });
  }

  const user = await verify(request, env);
  if (!user) return json({ error: "nicht angemeldet" }, 401);
  if (!azureReady) return json({ error: "Die Microsoft-365-Anbindung ist noch nicht eingerichtet." }, 503);

  const mailbox = (url.searchParams.get("mailbox") || "").toLowerCase();
  if (MAILBOXES.indexOf(mailbox) < 0) return json({ error: "Unbekanntes Postfach." }, 400);
  const top = Math.min(parseInt(url.searchParams.get("top") || "25", 10) || 25, 50);

  const token = await graphToken(env);
  const sel = "id,receivedDateTime,subject,bodyPreview,from,isRead,hasAttachments,webLink";

  if (path === "/api/mail/messages") {
    const g = "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(mailbox) +
      "/mailFolders/inbox/messages?$top=" + top + "&$orderby=receivedDateTime%20desc&$select=" + sel;
    return await graphList(g, token);
  }

  if (path === "/api/mail/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ error: "Kein Suchbegriff." }, 400);
    const g = "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(mailbox) +
      "/messages?$search=" + encodeURIComponent('"' + q + '"') + "&$top=" + top + "&$select=" + sel;
    return await graphList(g, token, { ConsistencyLevel: "eventual" });
  }

  return json({ error: "Unbekannter Endpunkt." }, 404);
}

async function graphList(g, token, extraHeaders) {
  const headers = Object.assign({ Authorization: "Bearer " + token }, extraHeaders || {});
  const r = await fetch(g, { headers });
  if (!r.ok) {
    const t = await r.text();
    return json({ error: "Microsoft Graph: " + r.status, detail: t.slice(0, 500) }, 502);
  }
  const j = await r.json();
  const items = (j.value || []).map(m => ({
    id: m.id,
    datum: m.receivedDateTime,
    betreff: m.subject || "(ohne Betreff)",
    vorschau: m.bodyPreview || "",
    von: m.from && m.from.emailAddress ? (m.from.emailAddress.name || m.from.emailAddress.address) : "",
    vonAdresse: m.from && m.from.emailAddress ? m.from.emailAddress.address : "",
    gelesen: !!m.isRead,
    anhang: !!m.hasAttachments,
    link: m.webLink || ""
  }));
  return json({ items });
}

// ---------- Microsoft-Graph-Token (App-only, client credentials) ----------
async function graphToken(env) {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp - 60000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const r = await fetch("https://login.microsoftonline.com/" + env.AZURE_TENANT_ID + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error("Microsoft-Token fehlgeschlagen (" + r.status + ")");
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

// ---------- Anmeldung pruefen (Supabase-Sitzung) ----------
async function verify(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token }
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.email) return null;
  if (ALLOWED_LOGINS.indexOf(u.email.toLowerCase()) < 0) return null;
  return u;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

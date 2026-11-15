// rs-shim.js
// Ersetzt die claude.ai-Artifact-Funktionen (db, user, assets, sample) durch Supabase.
// Das Dashboard aus dem Artifact bleibt unveraendert, es ruft window.claude.use(...) auf.
// Hier wird window.claude mit einer Supabase-Umsetzung bereitgestellt.
(function(){
  "use strict";
  var cfg = window.RS_CONFIG || {};
  var configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/^HIER_/.test(cfg.SUPABASE_URL) && !/^HIER_/.test(cfg.SUPABASE_ANON_KEY);
  var sb = (configured && window.supabase) ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var uuid = function(){ return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2)); };

  // ---------- window.claude ----------
  window.claude = { use: function(name){
    if(name === "db") return Promise.resolve(sb ? dbShim() : null);
    if(name === "user") return Promise.resolve(sb ? userShim() : null);
    if(name === "assets") return Promise.resolve(sb ? assetsShim() : null);
    // KI-Auswertung laeuft spaeter ueber den Worker, vorerst nicht verfuegbar
    if(name === "sample") return Promise.resolve(null);
    return Promise.resolve(null);
  }};

  // ---------- db: eine Tabelle "docs" (collection, id, data jsonb) ----------
  function dbShim(){ return { collection: function(col){ return collectionShim(col); } }; }
  function collectionShim(col){
    return {
      doc: function(id){ return docShim(col, id); },
      onSnapshot: function(cb, errcb){ return subscribe(col, cb, errcb); }
    };
  }
  function docShim(col, id){
    var docId = id || uuid();
    return {
      id: docId,
      set: async function(data){
        var row = { collection: col, id: docId, data: data, updated_at: new Date().toISOString() };
        var res = await sb.from("docs").upsert(row, { onConflict: "collection,id" });
        if(res.error) throw mapDbError(res.error);
      },
      delete: async function(){
        var res = await sb.from("docs").delete().eq("collection", col).eq("id", docId);
        if(res.error) throw mapDbError(res.error);
      }
    };
  }
  function mapDbError(e){
    var msg = (e && (e.message || e.msg)) || "Datenbankfehler";
    var code = "unknown";
    if(e && (e.code === "42501" || /row-level security|permission denied/i.test(msg))) code = "invalid_argument";
    else if(/quota|disk full|too large|payload too large/i.test(msg)) code = "quota_exceeded";
    var err = new Error(msg); err.code = code; return err;
  }

  var channels = {};
  function subscribe(col, cb, errcb){
    async function load(){
      try {
        var res = await sb.from("docs").select("id,data").eq("collection", col);
        if(res.error){ if(errcb) errcb(res.error); return; }
        var docs = (res.data || []).map(function(r){ return { id: r.id, data: (function(d){ return function(){ return d; }; })(r.data) }; });
        cb({ docs: docs, metadata: { fromCache: false } });
      } catch(e){ if(errcb) errcb(e); }
    }
    load();
    try {
      if(channels[col]) sb.removeChannel(channels[col]);
      channels[col] = sb.channel("docs-" + col)
        .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "collection=eq." + col }, function(){ load(); })
        .subscribe();
    } catch(e){}
  }

  // ---------- user ----------
  function userShim(){
    return {
      id: async function(){ var u = await currentUser(); return u ? u.id : null; },
      can: async function(){ return true; }, // alle drei Teamkonten duerfen schreiben
      me: async function(){ var u = await currentUser(); return { name: nameOf(u) }; },
      profiles: async function(ids){
        var out = {};
        try {
          var res = await sb.from("profiles").select("id,name").in("id", ids || []);
          (res.data || []).forEach(function(r){ out[r.id] = { name: r.name || "" }; });
        } catch(e){}
        return out;
      }
    };
  }
  async function currentUser(){ try { var r = await sb.auth.getUser(); return r && r.data ? r.data.user : null; } catch(e){ return null; } }
  function nameOf(u){ if(!u) return ""; return (u.user_metadata && u.user_metadata.name) || (u.email || "").split("@")[0]; }

  // ---------- assets: Supabase Storage, Bucket "uploads" ----------
  function assetsShim(){
    return {
      upload: async function(file){
        var id = uuid();
        var res = await sb.storage.from("uploads").upload(id, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if(res.error) throw mapAssetError(res.error);
        return { id: id };
      }
    };
  }
  function mapAssetError(e){
    var msg = (e && e.message) || "Upload fehlgeschlagen"; var m = msg.toLowerCase(); var code = "quota_or_state";
    if(/maximum allowed size|too large|payload too large/.test(m)) code = "too_large";
    else if(/mime|content type|not supported/.test(m)) code = "unsupported_type";
    else if(/rate/.test(m)) code = "rate_limited";
    var err = new Error(msg); err.code = code; return err;
  }

  // ---------- Anmeldung ----------
  function style(){
    if(document.getElementById("rsAuthStyle")) return;
    var s = document.createElement("style"); s.id = "rsAuthStyle";
    s.textContent = ".rsAuth{position:fixed;inset:0;z-index:9999;background:#131814;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,system-ui,sans-serif}" +
      ".rsCard{width:100%;max-width:380px;background:#1b221d;border:1px solid #2e3a31;border-radius:16px;padding:30px 28px;color:#e7ede8}" +
      ".rsCard h1{font-size:1.5rem;margin:0 0 4px}.rsCard p{color:#9fada3;margin:0 0 20px;font-size:.95rem}" +
      ".rsCard label{display:block;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:#9fada3;margin:14px 0 4px}" +
      ".rsCard input{width:100%;box-sizing:border-box;background:#232c26;border:1px solid #3c4a40;border-radius:10px;padding:12px;color:#e7ede8;font-size:1rem}" +
      ".rsCard button{width:100%;margin-top:22px;background:#6fc79c;color:#0f1a14;border:0;border-radius:10px;padding:13px;font-size:1rem;font-weight:600;cursor:pointer}" +
      ".rsCard button:disabled{opacity:.55;cursor:not-allowed}.rsErr{color:#e08a7a;font-size:.9rem;margin-top:14px;min-height:1.2em}";
    document.head.appendChild(s);
  }
  function showLogin(){
    style();
    var wrap = document.createElement("div"); wrap.className = "rsAuth";
    wrap.innerHTML = '<form class="rsCard" id="rsForm">' +
      '<h1>ReSoilution GmbH</h1><p>Bitte mit E-Mail und Passwort anmelden.</p>' +
      '<label for="rsEmail">E-Mail</label><input id="rsEmail" type="email" autocomplete="username" required>' +
      '<label for="rsPw">Passwort</label><input id="rsPw" type="password" autocomplete="current-password" required>' +
      '<button type="submit" id="rsBtn">Anmelden</button><div class="rsErr" id="rsErr"></div></form>';
    document.body.appendChild(wrap);
    var form = wrap.querySelector("#rsForm");
    form.addEventListener("submit", async function(e){
      e.preventDefault();
      var btn = wrap.querySelector("#rsBtn"), err = wrap.querySelector("#rsErr");
      err.textContent = ""; btn.disabled = true; btn.textContent = "Anmeldung laeuft ...";
      var res = await sb.auth.signInWithPassword({ email: wrap.querySelector("#rsEmail").value.trim(), password: wrap.querySelector("#rsPw").value });
      if(res.error){ err.textContent = "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort pruefen."; btn.disabled = false; btn.textContent = "Anmelden"; return; }
      location.reload();
    });
  }
  function showBanner(text){
    style();
    var wrap = document.createElement("div"); wrap.className = "rsAuth";
    wrap.innerHTML = '<div class="rsCard"><h1>ReSoilution GmbH</h1><p>' + text + '</p></div>';
    document.body.appendChild(wrap);
  }

  async function gate(){
    if(!configured){ showBanner("Das Backend ist noch nicht verbunden. Bitte die Supabase-Zugangsdaten in rs-config.js eintragen."); return; }
    var r = await sb.auth.getSession();
    if(!(r.data && r.data.session)){ showLogin(); return; }
    // angemeldet: Abmelden-Link in die Fusszeile der App setzen, sobald sie da ist
    try {
      var foot = document.querySelector(".side-foot");
      if(foot && !document.getElementById("rsLogout")){
        var a = document.createElement("a"); a.id = "rsLogout"; a.href = "#"; a.textContent = "Abmelden"; a.style.color = "#9fada3";
        a.addEventListener("click", async function(e){ e.preventDefault(); await sb.auth.signOut(); location.reload(); });
        foot.appendChild(a);
      }
    } catch(e){}
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", gate);
  else gate();
})();

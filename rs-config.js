// Konfiguration ReSoilution Dashboard
// Diese beiden Werte stehen im Supabase-Projekt unter Project Settings, API.
// Beide sind oeffentlich und duerfen im Frontend stehen (wie bei der Boden-und-Umwelt-App).
// Den geheimen service_role-Schluessel NIE hier eintragen, der gehoert nur in den Cloudflare-Worker.
window.RS_CONFIG = {
  SUPABASE_URL: "https://njfzhthulwmuhdivqfvw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_l42h6nWdJAvM0BzEBtV8NQ_id-ZVh_k"  // publishable key, oeffentlich
};

# ReSoilution Dashboard mit Backend, Einrichtung

Diese App besteht aus zwei Teilen. Das Dashboard (index.html) laeuft im Browser und speichert alle Daten in Supabase. Der Cloudflare-Worker (worker/index.js) liefert die App aus und bindet die Microsoft-365-Postfaecher an. Anmeldung gibt es nur fuer drei feste Konten, keine offene Registrierung.

Die Schritte bauen aufeinander auf. Am Ende steht alles live auf einer Adresse.

## 1. Supabase-Projekt anlegen

1. Auf supabase.com ein neues Projekt anlegen (Region Europa, z.B. Frankfurt).
2. Im Projekt unter **SQL Editor** die Datei `schema.sql` einmal komplett ausfuehren. Das legt die Datentabelle, die Profile und den Datei-Speicher an.
3. Unter **Authentication, Providers, Email** die Option **Confirm email** so lassen, dass wir die Konten selbst bestaetigen. Unter **Authentication, Sign In / Up** die **oeffentliche Registrierung ausschalten** (Allow new users to sign up = aus).
4. Die drei Konten anlegen unter **Authentication, Users, Add user**, jeweils mit **Auto Confirm User**:
   - h.zimmermann@resoilution.com
   - p.schwab@resoilution.com
   - s.thanheiser@resoilution.com
   Ein Startpasswort vergeben. Jede Person kann es spaeter aendern.
5. Danach `schema.sql` am Ende noch einmal ausfuehren oder nur den `insert into public.profiles`-Block, damit die Namen (Harry, Philipp, Selina) gesetzt werden.

## 2. Zugangsdaten ins Frontend eintragen

In Supabase unter **Project Settings, API** stehen zwei Werte. Beide in `rs-config.js` eintragen:
- **Project URL** nach `SUPABASE_URL`
- **anon public key** nach `SUPABASE_ANON_KEY`

Diese beiden Werte sind oeffentlich und duerfen im Browser stehen. Den **service_role**-Schluessel NIE hier eintragen, der kommt nur in den Cloudflare-Worker (Schritt 4).

## 3. Microsoft 365 und Azure (fuer den Postfach-Teil)

Die Postfaecher werden serverseitig und dauerhaft angebunden. Dafuer braucht es eine Azure-App mit Anwendungsberechtigung und einmalig die Zustimmung als Administrator.

1. **info@resoilution.com** muss ein echtes Postfach sein. Ein freigegebenes Postfach (shared mailbox) reicht und kostet keine eigene Lizenz. Im Microsoft-365-Admin-Center unter **Teams und Gruppen, Freigegebene Postfaecher** anlegen, falls noch nicht vorhanden.
2. Auf **portal.azure.com** gehen, **Microsoft Entra ID** oeffnen, dann **App registrations, New registration**.
   - Name z.B. `ReSoilution Dashboard Mail`
   - Supported account types: **nur dieser Organisation (Single tenant)**
   - Register.
3. Auf der Uebersicht der App stehen **Application (client) ID** und **Directory (tenant) ID**. Beide merken.
4. Links **API permissions, Add a permission, Microsoft Graph, Application permissions**. Hinzufuegen:
   - **Mail.Read** (fuer Lesen und Suchen)
   - spaeter bei Bedarf **Mail.Send** (fuer das Senden in Stufe 4)
   Danach oben auf **Grant admin consent for resoilution.com** klicken und bestaetigen. Bei beiden Berechtigungen muss ein gruener Haken stehen.
5. Links **Certificates & secrets, New client secret**, Laufzeit z.B. 24 Monate. Den **Value** (nicht die ID) sofort kopieren, er ist nur einmal sichtbar.

Damit die App nur auf unsere vier Postfaecher zugreifen kann und nicht auf das ganze Unternehmen, laesst sich spaeter optional eine **Application Access Policy** in Exchange Online setzen. Das ist eine Sicherheitsverbesserung und nicht noetig, damit es laeuft.

## 4. GitHub und Cloudflare

1. Ein neues **privates GitHub-Repo** anlegen und den Inhalt dieses Ordners hineinlegen (`git init`, `git add -A`, `git commit`, `git push`).
2. Auf **dash.cloudflare.com** unter **Workers & Pages** ein Projekt mit dem Repo verbinden. Build command leer lassen, Deploy ueber `wrangler.jsonc`.
3. In `wrangler.jsonc` die oeffentlichen `vars` eintragen: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`.
4. Die geheimen Werte als **Secrets** setzen, nicht in die Datei schreiben. Im Cloudflare-Dashboard unter **Settings, Variables and Secrets** oder per Kommandozeile:
   - `SUPABASE_SERVICE_ROLE` (der geheime service_role-Schluessel aus Supabase, Project Settings, API)
   - `AZURE_CLIENT_SECRET` (der Value aus Schritt 3.5)
5. Push loest den Deploy aus. Danach ist die App unter der Cloudflare-Adresse erreichbar.

## Stufenplan Postfach

- **Stufe 1, jetzt gebaut:** Lesen und Suchen im Eingang je Postfach (Seite Postfach im Dashboard).
- **Stufe 2:** Eingangskorb, der Mails von Eurofins, Agrolab und anderen automatisch erkennt und Projekten zuordnet.
- **Stufe 3:** Senden aus dem Dashboard (dann Mail.Send ergaenzen und erneut Admin-Zustimmung geben).

## Hinweise

- Die KI-Auswertung im Dashboard ist vorerst ausgeblendet. Sie laesst sich spaeter ueber den Worker anbinden.
- Alle alten Daten aus dem Artifact koennen uebernommen werden. Das besprechen wir, sobald das Backend steht.

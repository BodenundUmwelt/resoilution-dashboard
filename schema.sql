-- Supabase-Schema fuer das ReSoilution-Dashboard
-- Im Supabase-Projekt unter SQL Editor einmal ausfuehren.
-- Das Dashboard speichert alle Geschaeftsdaten generisch in einer Tabelle "docs"
-- (collection + id + data als JSON). Das entspricht genau der frueheren Artifact-Datenbank.

create extension if not exists pgcrypto;

-- ---------- Daten ----------
create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);

alter table public.docs enable row level security;

-- Nur angemeldete Teamkonten duerfen lesen und schreiben. Keine oeffentliche Registrierung.
drop policy if exists docs_team_all on public.docs;
create policy docs_team_all on public.docs
  for all to authenticated
  using (true) with check (true);

-- Realtime, damit Aenderungen sofort bei allen ankommen (onSnapshot)
alter publication supabase_realtime add table public.docs;

-- ---------- Profile (Namen fuer die Anzeige) ----------
create table if not exists public.profiles (
  id   uuid primary key references auth.users(id) on delete cascade,
  name text
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Nach dem Anlegen der drei Konten die Anzeige-Namen setzen:
-- (die Konten vorher im Dashboard unter Authentication, Users mit "Auto Confirm" anlegen)
insert into public.profiles (id, name)
select u.id,
       case u.email
         when 'h.zimmermann@resoilution.com' then 'Harry'
         when 'p.schwab@resoilution.com'     then 'Philipp'
         when 's.thanheiser@resoilution.com' then 'Selina'
         else split_part(u.email, '@', 1)
       end
from auth.users u
where u.email in ('h.zimmermann@resoilution.com','p.schwab@resoilution.com','s.thanheiser@resoilution.com')
on conflict (id) do update set name = excluded.name;

-- ---------- Datei-Speicher (Fotos, Pruefberichte) ----------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

drop policy if exists uploads_team_read on storage.objects;
create policy uploads_team_read on storage.objects
  for select to authenticated using (bucket_id = 'uploads');

drop policy if exists uploads_team_write on storage.objects;
create policy uploads_team_write on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');

drop policy if exists uploads_team_delete on storage.objects;
create policy uploads_team_delete on storage.objects
  for delete to authenticated using (bucket_id = 'uploads');

-- À coller en entier dans Supabase > SQL Editor, puis "Run".
-- Le script peut être relancé sans perdre les données.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('mod','resourcepack','shaderpack','config')),
  filename text not null,
  url text not null check (url like 'https://%'),
  storage_path text,
  sha1 text not null check (sha1 ~ '^[0-9a-f]{40}$'),
  size bigint not null default 0,
  description text not null default '',
  icon_url text,
  enabled boolean not null default true,
  optional boolean not null default false,
  default_on boolean not null default true,
  overwrite boolean not null default true,
  project_id text,
  version_id text,
  created_at timestamptz not null default now(),
  unique (category, filename)
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.files enable row level security;
alter table public.news enable row level security;

drop policy if exists "admins self" on public.admins;
create policy "admins self" on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select using (true);
drop policy if exists "settings admin" on public.settings;
create policy "settings admin" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "files read" on public.files;
create policy "files read" on public.files for select using (enabled or public.is_admin());
drop policy if exists "files admin" on public.files;
create policy "files admin" on public.files for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "news read" on public.news;
create policy "news read" on public.news for select using (published or public.is_admin());
drop policy if exists "news admin" on public.news;
create policy "news admin" on public.news for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.settings, public.files, public.news to anon, authenticated;
grant select on public.admins to authenticated;
grant insert, update, delete on public.settings, public.files, public.news to authenticated;

-- Stockage : lecture publique, écriture réservée aux admins
insert into storage.buckets (id, name, public) values ('launcher', 'launcher', true)
on conflict (id) do update set public = true;

drop policy if exists "launcher admin select" on storage.objects;
create policy "launcher admin select" on storage.objects for select to authenticated using (bucket_id = 'launcher' and public.is_admin());
drop policy if exists "launcher admin insert" on storage.objects;
create policy "launcher admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'launcher' and public.is_admin());
drop policy if exists "launcher admin update" on storage.objects;
create policy "launcher admin update" on storage.objects for update to authenticated using (bucket_id = 'launcher' and public.is_admin());
drop policy if exists "launcher admin delete" on storage.objects;
create policy "launcher admin delete" on storage.objects for delete to authenticated using (bucket_id = 'launcher' and public.is_admin());

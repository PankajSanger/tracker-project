-- Run this once in Supabase → SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists posts (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null check (platform in ('instagram','twitter','youtube')),
  url         text not null,
  external_id text not null,           -- IG shortcode / tweet id
  title       text,
  campaign    text,
  author      text,
  active      boolean not null default true,
  last_error  text,
  added_by    text default (auth.jwt() ->> 'email'),   -- which teammate added it
  created_at  timestamptz not null default now(),
  unique (platform, external_id)
);

create table if not exists snapshots (
  id        bigint generated always as identity primary key,
  post_id   uuid not null references posts(id) on delete cascade,
  taken_at  timestamptz not null default now(),
  likes     bigint,
  comments  bigint,
  views     bigint,
  shares    bigint
);
create index if not exists snapshots_post_time on snapshots (post_id, taken_at desc);

create table if not exists accounts (
  id         uuid primary key default gen_random_uuid(),
  platform   text not null check (platform in ('instagram','twitter','youtube')),
  handle     text not null,
  active     boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  unique (platform, handle)
);

create table if not exists account_snapshots (
  id          bigint generated always as identity primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  taken_at    timestamptz not null default now(),
  followers   bigint,
  following   bigint,
  posts_count bigint
);
create index if not exists account_snapshots_time on account_snapshots (account_id, taken_at desc);

create table if not exists alerts (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  post_id    uuid references posts(id) on delete cascade,
  kind       text not null,            -- 'spike' | 'drop' | 'error'
  message    text not null
);

-- Latest snapshot + change since ~24h ago, per post (used by the dashboard)
alter table posts add column if not exists added_by text default (auth.jwt() ->> 'email');
drop view if exists post_latest;
create view post_latest as
select
  p.*,
  l.taken_at as last_taken_at,
  l.likes, l.comments, l.views, l.shares,
  l.likes    - o.likes    as likes_24h,
  l.comments - o.comments as comments_24h,
  l.views    - o.views    as views_24h
from posts p
left join lateral (
  select * from snapshots s where s.post_id = p.id order by taken_at desc limit 1
) l on true
left join lateral (
  select * from snapshots s
  where s.post_id = p.id and s.taken_at <= now() - interval '24 hours'
  order by taken_at desc limit 1
) o on true;

-- Row Level Security: only logged-in users (your team) can use the web app.
-- The scraper uses the service-role key, which bypasses RLS.
alter table posts             enable row level security;
alter table snapshots         enable row level security;
alter table accounts          enable row level security;
alter table account_snapshots enable row level security;
alter table alerts            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['posts','snapshots','accounts','account_snapshots','alerts'] loop
    execute format('drop policy if exists "team access" on %I', t);
    execute format('create policy "team access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

alter view post_latest set (security_invoker = true);

-- Migration for databases created before YouTube support (safe to re-run):
alter table posts    drop constraint if exists posts_platform_check;
alter table posts    add  constraint posts_platform_check    check (platform in ('instagram','twitter','youtube'));
alter table accounts drop constraint if exists accounts_platform_check;
alter table accounts add  constraint accounts_platform_check check (platform in ('instagram','twitter','youtube'));

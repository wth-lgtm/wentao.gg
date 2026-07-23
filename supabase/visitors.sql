-- Unique-visitor counter for wentao.gg.
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- RLS is enabled with NO policies, so the public anon/publishable key has zero access to
-- this table. Only the server-side service_role key (used by app/api/visit/route.ts) can
-- read/write it — the browser can never touch or inflate the count.

create table if not exists public.site_stats (
  key   text primary key,
  value bigint not null default 0
);

insert into public.site_stats (key, value)
values ('unique_visitors', 0)
on conflict (key) do nothing;

alter table public.site_stats enable row level security;
-- (intentionally no policies → locked to everyone except service_role)

-- Atomic increment that returns the new total (avoids read-modify-write races).
create or replace function public.increment_visitors()
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.site_stats
     set value = value + 1
   where key = 'unique_visitors'
  returning value;
$$;

-- Lock execution down to the service role (defense in depth).
revoke all on function public.increment_visitors() from public, anon, authenticated;
grant execute on function public.increment_visitors() to service_role;

-- Run in the Supabase project's SQL Editor for the initial install and updates.
-- The dashboard accesses these tables only from its server with a secret key.

create table if not exists public.inventory (
  id uuid primary key,
  name text not null,
  category text not null default 'Other',
  quantity double precision not null default 0,
  unit text not null,
  threshold double precision not null default 0,
  updated_at date not null
);

create table if not exists public.volunteers (
  id uuid primary key,
  name text not null,
  role text not null default 'Kitchen volunteer',
  phone text,
  email text,
  is_active boolean not null default true,
  hours double precision not null default 0,
  created_at date not null
);

-- Add the roster fields to existing volunteer tables without changing current records.
alter table public.volunteers add column if not exists email text;
alter table public.volunteers add column if not exists is_active boolean not null default true;

create table if not exists public.shifts (
  id uuid primary key,
  volunteer_id uuid not null references public.volunteers(id),
  volunteer_name text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  assignment text not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz
);

create table if not exists public.kitchen_calendar (
  id uuid primary key,
  date date not null,
  entry_type text not null check (entry_type in ('event', 'cooking')),
  title text not null,
  details text,
  meal_period text check (meal_period in ('morning', 'afternoon', 'evening')),
  volunteer_id uuid references public.volunteers(id) on delete set null,
  cook_name text,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint kitchen_calendar_entry_check check (
    (entry_type = 'event' and meal_period is null and volunteer_id is null and cook_name is null)
    or (entry_type = 'cooking' and meal_period is not null and cook_name is not null)
  )
);

-- Festive events can keep their complete meal plan alongside the calendar entry.
alter table public.kitchen_calendar
  add column if not exists event_kind text not null default 'normal',
  add column if not exists end_date date,
  add column if not exists festive_plan jsonb;
alter table public.kitchen_calendar drop constraint if exists kitchen_calendar_event_date_range_check;
alter table public.kitchen_calendar add constraint kitchen_calendar_event_date_range_check
  check (
    (entry_type = 'cooking' and end_date is null)
    or (entry_type = 'event' and (end_date is null or end_date >= date))
  );
alter table public.kitchen_calendar drop constraint if exists kitchen_calendar_event_kind_check;
alter table public.kitchen_calendar add constraint kitchen_calendar_event_kind_check
  check (event_kind in ('normal', 'festive'));

create unique index if not exists kitchen_calendar_one_cook_per_meal
  on public.kitchen_calendar (date, meal_period)
  where entry_type = 'cooking';

create table if not exists public.expenses (
  id uuid primary key,
  description text not null,
  category text not null,
  amount double precision not null,
  spent_at date not null
);

create table if not exists public.kitchen_access (
  id uuid primary key,
  email text not null unique,
  role text not null check (role in ('admin', 'staff', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.change_requests (
  id uuid primary key,
  requester_email text not null,
  requester_name text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'handled', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- New Google sign-ins get read-only access until an Admin changes their role.
drop function if exists public.bootstrap_first_kitchen_admin(text);
create or replace function public.ensure_kitchen_viewer(candidate_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if candidate_email is null or length(trim(candidate_email)) = 0 then
    return false;
  end if;

  insert into public.kitchen_access (id, email, role)
  values (gen_random_uuid(), lower(trim(candidate_email)), 'viewer')
  on conflict (email) do nothing;
  return true;
end;
$$;

revoke all on function public.ensure_kitchen_viewer(text) from public, anon, authenticated;
grant execute on function public.ensure_kitchen_viewer(text) to service_role;

alter table public.inventory enable row level security;
alter table public.volunteers enable row level security;
alter table public.shifts enable row level security;
alter table public.kitchen_calendar enable row level security;
alter table public.expenses enable row level security;
alter table public.kitchen_access enable row level security;
alter table public.change_requests enable row level security;

revoke all on table public.inventory, public.volunteers, public.shifts,
  public.kitchen_calendar, public.expenses, public.kitchen_access, public.change_requests from anon, authenticated;
grant select, insert, update, delete on table public.inventory, public.volunteers,
  public.shifts, public.kitchen_calendar, public.expenses, public.kitchen_access, public.change_requests to service_role;

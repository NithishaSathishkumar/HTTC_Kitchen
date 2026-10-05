-- Add optional event end dates. Existing event rows with NULL end_date
-- continue to behave as single-day events in the application.
alter table public.kitchen_calendar
  add column if not exists end_date date;

alter table public.kitchen_calendar
  drop constraint if exists kitchen_calendar_event_date_range_check;

alter table public.kitchen_calendar
  add constraint kitchen_calendar_event_date_range_check
  check (
    (entry_type = 'cooking' and end_date is null)
    or (entry_type = 'event' and (end_date is null or end_date >= date))
  );

-- Make the new column available to the REST API immediately.
notify pgrst, 'reload schema';

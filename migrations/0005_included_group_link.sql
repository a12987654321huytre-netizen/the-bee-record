-- Included entities on a group certificate are linked, but the group level is not their own certificate.
do $$
declare cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'evidence_entity_links'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%link_state%'
  loop
    execute format('alter table evidence_entity_links drop constraint %I', cname);
  end loop;
end $$;

alter table evidence_entity_links
  add constraint evidence_entity_links_link_state_check
  check (link_state in ('candidate', 'extracted', 'confirmed', 'rejected', 'included'));

create table if not exists major_gap_imports (
  item_key text primary key,
  status text not null,
  detail text,
  applied_at timestamptz not null default now()
);

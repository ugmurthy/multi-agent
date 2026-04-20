begin;

create table if not exists adaptive_agent_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

alter table agent_runs
  add column if not exists model_provider text;

alter table agent_runs
  add column if not exists model_name text;

alter table agent_runs
  add column if not exists model_parameters jsonb;

insert into adaptive_agent_migrations (name)
values ('core:003_run_model_persistence')
on conflict (name) do nothing;

commit;

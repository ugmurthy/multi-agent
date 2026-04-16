alter table agent_events
  add column if not exists tool_call_id text;

create index if not exists agent_events_run_tool_call_idx
  on agent_events (run_id, tool_call_id, seq)
  where tool_call_id is not null;

alter table tool_executions
  add column if not exists input jsonb;

alter table tool_executions
  add column if not exists child_run_id uuid references agent_runs(id) on delete set null;

create index if not exists tool_executions_child_run_idx
  on tool_executions (child_run_id)
  where child_run_id is not null;

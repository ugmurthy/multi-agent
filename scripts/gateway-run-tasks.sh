#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <json-file-name>" >&2
  echo 'Expected JSON: [{"task":"task text","role":"optional-role"}, {"file":"task-file.txt"}]' >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

json_file_name=$1
json_dir=$(cd "$(dirname "$json_file_name")" && pwd)

if [[ ! -f "$json_file_name" ]]; then
  echo "Error: JSON file not found: $json_file_name" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required to parse JSON." >&2
  exit 1
fi

jq -c '
  if type != "array" then
    error("top-level JSON value must be an array")
  else
    .[]
    | if (has("task") and has("file")) or ((has("task") | not) and (has("file") | not)) then
        error("each item must include exactly one of task or file")
      elif has("task") and (.task | type) != "string" then
        error("task must be a string")
      elif has("file") and (.file | type) != "string" then
        error("file must be a string")
      elif has("role") and .role != null and (.role | type) != "string" then
        error("role must be a string when present")
      else
        .
      end
  end
' "$json_file_name" | while IFS= read -r item; do
  role=$(jq -r '.role // empty' <<<"$item")

  if jq -e 'has("file")' >/dev/null <<<"$item"; then
    task_file=$(jq -r '.file' <<<"$item")
    if [[ "$task_file" = /* ]]; then
      task_path=$task_file
    else
      task_path=$json_dir/$task_file
    fi

    if [[ ! -f "$task_path" ]]; then
      echo "Error: task file not found: $task_file" >&2
      exit 1
    fi

    task=$(<"$task_path")
  else
    task=$(jq -r '.task' <<<"$item")
  fi

  if [[ -n "$role" ]]; then
     gateway-ws-client --role $role --run "$task" --auto-approve &
  else
     gateway-ws-client --run "$task" --auto-approve &
  fi
done

gateway-status

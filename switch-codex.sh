#!/usr/bin/env bash

set -Eeuo pipefail

readonly script_name="${0##*/}"
readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly config_file="${DEEPSEEK_CONFIG_FILE:-$script_dir/deepseek.env}"

# DeepSeek's official Codex installer; the model catalog is extracted from it.
readonly upstream_setup_url="https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.sh"
readonly catalog_marker="CODEX_MODELS_JSON"
readonly catalog_file_name="deepseek-models.json"

readonly flash_model="deepseek-v4-flash"
readonly pro_model="deepseek-v4-pro"
readonly default_base_url="https://api.deepseek.com/"

readonly marker_begin='# >>> switch-codex deepseek >>>'
readonly marker_end='# <<< switch-codex deepseek <<<'
# Top-level keys this script owns while DeepSeek mode is active. The last three
# are removed because they mask or redirect the DeepSeek configuration.
readonly managed_keys="model model_provider preferred_auth_method forced_login_method model_reasoning_effort model_catalog_json profile oss_provider openai_base_url"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

usage() {
  cat <<EOF
Switch the persistent Codex configuration (~/.codex/config.toml) between
DeepSeek and the normal OpenAI setup, for the Codex VS Code extension and the
CLI alike.

Usage:
  ./$script_name setup
  ./$script_name deepseek [options]
  ./$script_name openai
  ./$script_name status

How it works:
  The VS Code Codex extension only reads \$CODEX_HOME/config.toml, so the
  switch is persisted there: "deepseek" replaces the top-level model settings
  (saving your originals) and appends a marker-delimited
  [model_providers.deepseek] section; "openai" removes that section and
  restores the saved originals. Everything else in config.toml (projects,
  MCP servers, ...) is left untouched, including edits made while DeepSeek
  mode was active. After switching, reload the VS Code window (or restart the
  extension) so the extension re-reads the file; new CLI sessions pick it up
  automatically.

  The API key is embedded in config.toml as experimental_bearer_token because
  the extension host does not inherit your shell environment. config.toml is
  kept at mode 600.

  "setup" downloads DeepSeek's official installer and extracts its model
  catalog into \$CODEX_HOME/$catalog_file_name. The catalog declares
  $flash_model and $pro_model with their 1M context window and
  reasoning levels; do not override model_context_window on top of it.

Private configuration file:
  $config_file

Fill in DEEPSEEK_API_KEY there (and optionally the settings below), then run
setup once.

DeepSeek options:
  --model MODEL            $flash_model (default) or $pro_model
  --base-url URL           Responses endpoint (default: $default_base_url)
  --key-env NAME           Environment variable holding the API key
                           (default: DEEPSEEK_API_KEY)
  --no-auth                Send no credential (unauthenticated local gateway)
  --reasoning-effort LEVEL low, high, or max (default: high; the catalog
                           declares only these three)
  -h, --help               Show this help

Environment equivalents:
  DEEPSEEK_MODEL
  DEEPSEEK_RESPONSES_BASE_URL
  DEEPSEEK_KEY_ENV
  DEEPSEEK_NO_AUTH=1
  DEEPSEEK_REASONING_EFFORT

Examples:
  ./$script_name setup
  ./$script_name deepseek
  ./$script_name deepseek --model $pro_model
  ./$script_name openai
EOF
}

toml_quote() {
  local value="$1"

  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
    die "TOML values cannot contain newlines"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

codex_home_dir() {
  if [[ -n "${CODEX_SWITCH_HOME:-}" ]]; then
    printf '%s' "$CODEX_SWITCH_HOME"
  elif [[ -n "${CODEX_HOME:-}" ]]; then
    printf '%s' "$CODEX_HOME"
  else
    [[ -n "${HOME:-}" ]] || die "HOME is not set"
    printf '%s/.codex' "$HOME"
  fi
}

catalog_path() {
  printf '%s/%s' "$(codex_home_dir)" "$catalog_file_name"
}

config_path() {
  printf '%s/config.toml' "$(codex_home_dir)"
}

state_path() {
  printf '%s/switch-codex.saved-keys.toml' "$(codex_home_dir)"
}

load_deepseek_config() {
  if [[ -f "$config_file" ]]; then
    # This is a private, user-controlled shell environment file. Export its
    # assignments so the configured credential is available below.
    set -a
    # shellcheck disable=SC1090
    source "$config_file"
    set +a
  fi
}

command="${1:-help}"
if (($#)); then
  shift
fi

case "$command" in
  setup|deepseek|status)
    load_deepseek_config
    ;;
esac

base_url="${DEEPSEEK_RESPONSES_BASE_URL:-$default_base_url}"
model="${DEEPSEEK_MODEL:-$flash_model}"
key_env="${DEEPSEEK_KEY_ENV:-DEEPSEEK_API_KEY}"
no_auth="${DEEPSEEK_NO_AUTH:-0}"
reasoning_effort="${DEEPSEEK_REASONING_EFFORT:-high}"

parse_deepseek_options() {
  while (($#)); do
    case "$1" in
      --base-url)
        (($# >= 2)) || die "--base-url requires a value"
        base_url="$2"
        shift 2
        ;;
      --model)
        (($# >= 2)) || die "--model requires a value"
        model="$2"
        shift 2
        ;;
      --key-env)
        (($# >= 2)) || die "--key-env requires a value"
        key_env="$2"
        no_auth=0
        shift 2
        ;;
      --no-auth)
        no_auth=1
        shift
        ;;
      --reasoning-effort)
        (($# >= 2)) || die "--reasoning-effort requires a value"
        reasoning_effort="$2"
        shift 2
        ;;
      --context-window)
        die "--context-window was removed: the model catalog fixes a 1M context window, and overriding it breaks Codex auto-compaction"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown option: $1"
        ;;
    esac
  done
}

validate_settings() {
  [[ "$base_url" == http://* || "$base_url" == https://* ]] ||
    die "the base URL must begin with http:// or https://"

  [[ -n "$model" ]] || die "the model ID cannot be empty"
  case "$model" in
    "$flash_model"|"$pro_model") ;;
    *)
      warn "model '$model' is not in the DeepSeek catalog ($flash_model, $pro_model); Codex may fall back to generic model metadata"
      ;;
  esac

  [[ "$key_env" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    die "invalid API-key environment variable name: $key_env"

  case "$reasoning_effort" in
    low|high|max) ;;
    *) die "invalid reasoning effort: $reasoning_effort (the DeepSeek catalog declares low, high, and max)" ;;
  esac

  case "$no_auth" in
    0|1) ;;
    *) die "DEEPSEEK_NO_AUTH must be 0 or 1" ;;
  esac

  if [[ -n "${DEEPSEEK_CONTEXT_WINDOW:-}" ]]; then
    warn "ignoring DEEPSEEK_CONTEXT_WINDOW: the model catalog fixes the context window"
  fi
}

fetch_catalog() {
  local codex_dir catalog temp_setup temp_catalog

  command -v curl >/dev/null 2>&1 || die "curl is required to download the model catalog"
  codex_dir="$(codex_home_dir)"
  catalog="$(catalog_path)"
  mkdir -p "$codex_dir"
  temp_setup="$(mktemp "$codex_dir/.$catalog_file_name.setup.XXXXXX")"
  temp_catalog="$(mktemp "$codex_dir/.$catalog_file_name.XXXXXX")"
  trap 'rm -f "$temp_setup" "$temp_catalog"' RETURN

  curl -fsSL --max-time 60 "$upstream_setup_url" -o "$temp_setup" ||
    die "failed to download $upstream_setup_url"

  awk -v marker="$catalog_marker" '
    emitting && $0 == marker { emitting = 0 }
    emitting { print }
    !emitting && index($0, "<<") && index($0, marker) { emitting = 1 }
  ' "$temp_setup" >"$temp_catalog"

  [[ -s "$temp_catalog" ]] ||
    die "could not extract the model catalog from the upstream installer (its format may have changed)"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$temp_catalog" "$flash_model" "$pro_model" <<'PY' ||
import json, sys
with open(sys.argv[1]) as fh:
    catalog = json.load(fh)
slugs = {entry["slug"] for entry in catalog["models"]}
missing = {sys.argv[2], sys.argv[3]} - slugs
sys.exit(1 if missing else 0)
PY
      die "the extracted model catalog is not valid JSON or is missing the DeepSeek models"
  else
    warn "python3 not found; skipping catalog JSON validation"
  fi

  chmod 600 "$temp_catalog"
  mv "$temp_catalog" "$catalog"
  trap - RETURN
  rm -f "$temp_setup"
  printf 'Wrote %s\n' "$catalog"

  # Left over from an earlier version of this script; Codex never read it.
  if [[ -f "$codex_dir/deepseek.config.toml" ]]; then
    rm -f "$codex_dir/deepseek.config.toml"
    printf 'Removed stale %s/deepseek.config.toml\n' "$codex_dir"
  fi
}

require_key() {
  if [[ "$no_auth" == 0 && -z "${!key_env:-}" ]]; then
    die "set $key_env in $config_file (or export it) before switching to DeepSeek"
  fi
}

in_deepseek_mode() {
  [[ -f "$(config_path)" ]] && grep -qxF "$marker_begin" "$(config_path)"
}

# Print the config with the marker block gone and the managed top-level keys
# stripped from the leading area (before the first [section] header). Lines
# removed from the leading area are appended to the file named in $2, so the
# originals can be saved on the first switch. Assumes the leading area holds
# only single-line values, which is what Codex itself writes there.
strip_managed_config() {
  local source_file="$1" removed_file="$2"

  awk -v keys="$managed_keys" \
      -v begin="$marker_begin" -v end="$marker_end" \
      -v removed_file="$removed_file" '
    BEGIN {
      n = split(keys, list, " ")
      for (i = 1; i <= n; i++) keyset[list[i]] = 1
      leading = 1
    }
    $0 == begin { in_marker = 1; next }
    $0 == end   { in_marker = 0; next }
    in_marker { next }
    /^\[/ { leading = 0 }
    leading {
      line = $0
      sub(/^[ \t]+/, "", line)
      if (line ~ /^[A-Za-z0-9_-]+[ \t]*=/) {
        key = line
        sub(/[ \t]*=.*/, "", key)
        if (key in keyset) {
          print $0 >> removed_file
          next
        }
      }
    }
    { print }
  ' "$source_file"
}

write_config() {
  local content="$1" config temp_path

  config="$(config_path)"
  temp_path="$(mktemp "$(codex_home_dir)/.config.toml.XXXXXX")"
  trap 'rm -f "$temp_path"' RETURN
  # Squeeze the blank runs left by stripping so repeated switches don't
  # accumulate empty lines.
  printf '%s\n' "$content" | cat -s >"$temp_path"
  chmod 600 "$temp_path"
  mv "$temp_path" "$config"
  trap - RETURN
}

switch_to_deepseek() {
  local config state removed stripped credential_line

  config="$(config_path)"
  state="$(state_path)"
  mkdir -p "$(codex_home_dir)"
  [[ -f "$config" ]] || : >"$config"

  removed="$(mktemp "$(codex_home_dir)/.removed-keys.XXXXXX")"
  trap 'rm -f "$removed"' RETURN
  stripped="$(strip_managed_config "$config" "$removed")"

  # Save the original top-level values once; re-switching keeps the first
  # snapshot so "openai" always restores the true pre-DeepSeek settings.
  if ! in_deepseek_mode; then
    mv "$removed" "$state"
  fi
  trap - RETURN
  rm -f "$removed"

  if [[ "$no_auth" == 0 ]]; then
    credential_line="experimental_bearer_token = $(toml_quote "${!key_env}")"
  else
    credential_line=''
  fi

  write_config "model = $(toml_quote "$model")
model_provider = \"deepseek\"
preferred_auth_method = \"apikey\"
forced_login_method = \"api\"
model_reasoning_effort = $(toml_quote "$reasoning_effort")
model_catalog_json = $(toml_quote "$(catalog_path)")

$stripped

$marker_begin
[model_providers.deepseek]
name = \"deepseek\"
base_url = $(toml_quote "$base_url")
wire_api = \"responses\"
${credential_line}
$marker_end"

  printf 'Switched %s to DeepSeek (%s).\n' "$config" "$model"
  printf 'Reload the VS Code window (or restart the Codex extension) to apply it.\n'
}

switch_to_openai() {
  local config state removed stripped saved

  config="$(config_path)"
  state="$(state_path)"

  if ! in_deepseek_mode; then
    printf 'Already using the OpenAI configuration; nothing to do.\n'
    return
  fi

  removed="$(mktemp "$(codex_home_dir)/.removed-keys.XXXXXX")"
  trap 'rm -f "$removed"' RETURN
  stripped="$(strip_managed_config "$config" "$removed")"
  trap - RETURN
  rm -f "$removed"

  saved=''
  if [[ -f "$state" ]]; then
    saved="$(<"$state")"
  else
    warn "no saved settings found; your original top-level model keys are gone and Codex will use its defaults"
  fi

  if [[ -n "$saved" ]]; then
    write_config "$saved

$stripped"
  else
    write_config "$stripped"
  fi
  rm -f "$state"

  printf 'Restored the OpenAI configuration in %s.\n' "$config"
  printf 'Reload the VS Code window (or restart the Codex extension) to apply it.\n'
}

show_status() {
  local config catalog

  config="$(config_path)"
  catalog="$(catalog_path)"

  if in_deepseek_mode; then
    printf 'Mode: deepseek\n'
    sed -n -e 's/^model = /Model: /p' "$config" | head -1
    sed -n -e 's/^base_url = /Responses base URL: /p' "$config"
    if grep -q '^experimental_bearer_token = ' "$config"; then
      printf 'Credential: embedded in config.toml\n'
    else
      printf 'Authentication: disabled\n'
    fi
  else
    printf 'Mode: openai\n'
  fi
  if [[ -f "$catalog" ]]; then
    printf 'Model catalog: %s\n' "$catalog"
  else
    printf 'Model catalog: missing (%s) — run ./%s setup\n' "$catalog" "$script_name"
  fi
}

case "$command" in
  setup)
    parse_deepseek_options "$@"
    validate_settings
    fetch_catalog
    ;;
  deepseek)
    parse_deepseek_options "$@"
    validate_settings
    [[ -f "$(catalog_path)" ]] || fetch_catalog
    require_key
    switch_to_deepseek
    ;;
  openai)
    (($# == 0)) || die "openai does not accept arguments"
    switch_to_openai
    ;;
  status)
    (($# == 0)) || die "status does not accept arguments"
    show_status
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    die "unknown command: $command (run ./$script_name --help)"
    ;;
esac

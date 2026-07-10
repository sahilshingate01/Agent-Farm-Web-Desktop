#!/usr/bin/env bash
# shellcheck shell=bash
# equip / setup helpers for usage-farm — sourced by farm.sh
# Uses Vercel skills CLI (npx skills) with CLAUDE_CONFIG_DIR pointed at
# the per-account home so installs land on the mounted volume.

HOST_CLAUDE="${HOST_CLAUDE:-$HOME/.claude}"
PROFILES_DIR="${PROFILES_DIR:-$REPO_DIR/profiles}"
MCP_CATALOG_DIR="${MCP_CATALOG_DIR:-$REPO_DIR/mcp-catalog}"

acct_home() { echo "$ACCOUNTS_DIR/$1/claude-home"; }
acct_profile_path() { echo "$ACCOUNTS_DIR/$1/profile.json"; }

# Resolve host skills dir (may be a symlink into Claude Desktop support)
host_skills_dir() {
  local d="$HOST_CLAUDE/skills"
  if [ -L "$d" ]; then
    # readlink -f not on macOS by default; python is reliable
    python3 -c "import os, sys; print(os.path.realpath(sys.argv[1]))" "$d" 2>/dev/null || readlink "$d"
  else
    echo "$d"
  fi
}

host_agents_dir() { echo "$HOST_CLAUDE/agents"; }
host_commands_dir() { echo "$HOST_CLAUDE/commands"; }

ensure_acct_home() {
  local acct="$1"
  mkdir -p "$(acct_home "$acct")/skills" \
           "$(acct_home "$acct")/agents" \
           "$(acct_home "$acct")/commands" \
           "$(acct_home "$acct")/plugins"
}

list_host_skills() {
  local dir
  dir="$(host_skills_dir)"
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) ! -name '.*' -exec basename {} \; | sort
}

list_host_agents() {
  local dir
  dir="$(host_agents_dir)"
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 \( -type f -o -type d -o -type l \) ! -name '.*' -exec basename {} \; | sed 's/\.md$//' | sort -u
}

list_host_commands() {
  local dir
  dir="$(host_commands_dir)"
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 \( -type f -o -type d -o -type l \) ! -name '.*' -exec basename {} \; | sed 's/\.md$//' | sort -u
}

list_bundled_profiles() {
  [ -d "$PROFILES_DIR" ] || return 0
  find "$PROFILES_DIR" -maxdepth 1 -name '*.json' -exec basename {} .json \; | sort
}

list_mcp_catalog() {
  [ -d "$MCP_CATALOG_DIR" ] || return 0
  find "$MCP_CATALOG_DIR" -maxdepth 1 -name '*.json' -exec basename {} .json \; | sort
}

# Multi-select: fzf if available, else numbered comma-separated
# Usage: pick_multi "prompt" item1 item2 ...   OR pipe items on stdin
pick_multi() {
  local prompt="$1"; shift
  local items=()
  if [ $# -gt 0 ]; then
    items=("$@")
  else
    while IFS= read -r line; do
      [ -n "$line" ] && items+=("$line")
    done
  fi
  [ ${#items[@]} -eq 0 ] && return 0

  if command -v fzf >/dev/null 2>&1 && [ -t 0 ] && [ -t 1 ]; then
    printf '%s\n' "${items[@]}" | fzf --multi --prompt "$prompt> " --height=40% --border --bind 'ctrl-a:select-all,ctrl-d:deselect-all' || true
    return 0
  fi

  # fallback: numbered list
  echo "$prompt (comma-separated numbers, 'all', or empty for none):" >&2
  local i=1
  for it in "${items[@]}"; do
    printf '  %2d) %s\n' "$i" "$it" >&2
    i=$((i + 1))
  done
  printf 'choice> ' >&2
  local choice
  read -r choice || true
  choice="${choice// /}"
  [ -z "$choice" ] && return 0
  if [ "$choice" = "all" ] || [ "$choice" = "*" ]; then
    printf '%s\n' "${items[@]}"
    return 0
  fi
  local IFS=','
  local -a nums
  read -ra nums <<<"$choice"
  for n in "${nums[@]}"; do
    if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le ${#items[@]} ]; then
      echo "${items[$((n - 1))]}"
    fi
  done
}

pick_one() {
  local prompt="$1"; shift
  local items=("$@")
  [ ${#items[@]} -eq 0 ] && return 0

  if command -v fzf >/dev/null 2>&1 && [ -t 0 ] && [ -t 1 ]; then
    printf '%s\n' "${items[@]}" | fzf --prompt "$prompt> " --height=20% --border || true
    return 0
  fi

  echo "$prompt:" >&2
  local i=1
  for it in "${items[@]}"; do
    printf '  %2d) %s\n' "$i" "$it" >&2
    i=$((i + 1))
  done
  printf 'choice [1]> ' >&2
  local choice
  read -r choice || true
  choice="${choice:-1}"
  if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le ${#items[@]} ]; then
    echo "${items[$((choice - 1))]}"
  else
    echo "${items[0]}"
  fi
}

confirm_yn() {
  local prompt="$1" default="${2:-y}"
  local hint="Y/n"
  [ "$default" = "n" ] && hint="y/N"
  printf '%s [%s] ' "$prompt" "$hint" >&2
  local a
  read -r a || true
  a="${a:-$default}"
  case "$a" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# --- apply primitives -------------------------------------------------------

install_skills_package() {
  local home="$1" source="$2"
  shift 2
  local skills=("$@") # empty or list; "*" means all

  echo "farm: skills add $source → $home"
  local -a args=(add "$source" -g -a claude-code -y --copy)
  if [ ${#skills[@]} -eq 0 ] || [ "${skills[0]}" = "*" ]; then
    args+=(--skill '*')
  else
    for s in "${skills[@]}"; do
      args+=(--skill "$s")
    done
  fi

  if ! CLAUDE_CONFIG_DIR="$home" npx --yes skills "${args[@]}"; then
    echo "farm: warning — skills add failed for $source (continuing)" >&2
    return 1
  fi
}

copy_host_skill() {
  local home="$1" name="$2"
  local src_root dest src
  src_root="$(host_skills_dir)"
  src="$src_root/$name"
  dest="$home/skills/$name"
  if [ ! -e "$src" ]; then
    echo "farm: skip host skill '$name' (not found at $src)" >&2
    return 1
  fi
  mkdir -p "$home/skills"
  rm -rf "$dest"
  # dereference one level so container doesn't need host paths
  if [ -L "$src" ]; then
    src="$(python3 -c "import os, sys; print(os.path.realpath(sys.argv[1]))" "$src")"
  fi
  cp -R "$src" "$dest"
  echo "farm: copied skill $name"
}

copy_host_agent() {
  local home="$1" name="$2"
  local src_root="$HOST_CLAUDE/agents"
  local src dest
  mkdir -p "$home/agents"
  if [ -e "$src_root/$name" ]; then
    src="$src_root/$name"
  elif [ -e "$src_root/$name.md" ]; then
    src="$src_root/$name.md"
  else
    echo "farm: skip host agent '$name' (not found)" >&2
    return 1
  fi
  dest="$home/agents/$(basename "$src")"
  rm -rf "$dest"
  cp -R "$src" "$dest"
  echo "farm: copied agent $(basename "$src")"
}

copy_host_command() {
  local home="$1" name="$2"
  local src_root="$HOST_CLAUDE/commands"
  local src dest
  mkdir -p "$home/commands"
  if [ -e "$src_root/$name" ]; then
    src="$src_root/$name"
  elif [ -e "$src_root/$name.md" ]; then
    src="$src_root/$name.md"
  else
    echo "farm: skip host command '$name' (not found)" >&2
    return 1
  fi
  dest="$home/commands/$(basename "$src")"
  rm -rf "$dest"
  cp -R "$src" "$dest"
  echo "farm: copied command $(basename "$src")"
}

merge_mcp_into_home() {
  local home="$1"
  shift
  local ids=("$@")
  [ ${#ids[@]} -eq 0 ] && return 0

  local mcp_path="$home/.mcp.json"
  local work="${WORK:-$FARM_STATE/work}"

  python3 - "$mcp_path" "$MCP_CATALOG_DIR" "$work" "${ids[@]}" <<'PY'
import json, sys, os, re
mcp_path, catalog_dir, work = sys.argv[1], sys.argv[2], sys.argv[3]
ids = sys.argv[4:]

existing = {}
if os.path.exists(mcp_path):
    try:
        existing = json.load(open(mcp_path))
    except Exception:
        existing = {}
servers = existing.get("mcpServers") or {}

for mid in ids:
    path = os.path.join(catalog_dir, f"{mid}.json")
    if not os.path.isfile(path):
        print(f"farm: skip mcp '{mid}' (no catalog entry)", file=sys.stderr)
        continue
    entry = json.load(open(path))
    block = entry.get("mcpServers") or {}
    # expand ${FARM_WORK}
    def expand(obj):
        if isinstance(obj, str):
            return obj.replace("${FARM_WORK}", work)
        if isinstance(obj, list):
            return [expand(x) for x in obj]
        if isinstance(obj, dict):
            return {k: expand(v) for k, v in obj.items()}
        return obj
    for k, v in expand(block).items():
        servers[k] = v
        print(f"farm: mcp +{k}")

existing["mcpServers"] = servers
os.makedirs(os.path.dirname(mcp_path) or ".", exist_ok=True)
with open(mcp_path, "w") as f:
    json.dump(existing, f, indent=2)
    f.write("\n")
PY
}

# Apply a profile JSON file to an account
apply_profile_file() {
  local acct="$1" profile_file="$2"
  [ -f "$profile_file" ] || die "profile not found: $profile_file"
  ensure_acct_home "$acct"
  local home
  home="$(acct_home "$acct")"

  echo "farm: equipping $acct from $profile_file"

  # packages: array of {source, skills[]}
  local pkg_count
  pkg_count=$(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print(len(d.get('skills_packages') or []))" "$profile_file")
  local i
  for ((i=0; i<pkg_count; i++)); do
    local source skills_csv
    source=$(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print(d['skills_packages'][int(sys.argv[2])]['source'])" "$profile_file" "$i")
    skills_csv=$(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); s=d['skills_packages'][int(sys.argv[2])].get('skills') or ['*']; print(','.join(s))" "$profile_file" "$i")
    IFS=',' read -ra skill_arr <<<"$skills_csv"
    install_skills_package "$home" "$source" "${skill_arr[@]}" || true
  done

  # host skills
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    copy_host_skill "$home" "$name" || true
  done < <(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print('\n'.join(d.get('skills_from_host') or []))" "$profile_file")

  while IFS= read -r name; do
    [ -z "$name" ] && continue
    copy_host_agent "$home" "$name" || true
  done < <(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print('\n'.join(d.get('agents_from_host') or []))" "$profile_file")

  while IFS= read -r name; do
    [ -z "$name" ] && continue
    copy_host_command "$home" "$name" || true
  done < <(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print('\n'.join(d.get('commands_from_host') or []))" "$profile_file")

  local -a mcp_ids=()
  while IFS= read -r mid; do
    [ -n "$mid" ] && mcp_ids+=("$mid")
  done < <(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print('\n'.join(d.get('mcp') or []))" "$profile_file")
  if [ ${#mcp_ids[@]} -gt 0 ]; then
    merge_mcp_into_home "$home" "${mcp_ids[@]}"
  fi

  # stamp applied profile (with timestamp + account) under the account root
  python3 - "$profile_file" "$acct" "$(acct_profile_path "$acct")" <<'PY'
import json, sys, time
src, acct, out = sys.argv[1:4]
d = json.load(open(src))
d["_applied_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
d["_account"] = acct
with open(out, "w") as f:
    json.dump(d, f, indent=2)
    f.write("\n")
PY

  echo "farm: equip complete for $acct"
  equip_status "$acct"
}

equip_status() {
  local acct="$1"
  local home
  home="$(acct_home "$acct")"
  [ -d "$home" ] || die "no account home for $acct"

  local skills agents commands mcp_n
  skills=0 agents=0 commands=0 mcp_n=0
  [ -d "$home/skills" ] && skills=$(find "$home/skills" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ' || true)
  [ -d "$home/agents" ] && agents=$(find "$home/agents" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ' || true)
  [ -d "$home/commands" ] && commands=$(find "$home/commands" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ' || true)
  if [ -f "$home/.mcp.json" ]; then
    mcp_n=$(python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print(len(d.get('mcpServers') or {}))" "$home/.mcp.json" 2>/dev/null || echo 0)
  fi

  printf '\n%-12s %s\n' ACCOUNT "$acct"
  printf '%-12s %s\n' HOME "$home"
  printf '%-12s %s\n' SKILLS "$skills"
  printf '%-12s %s\n' AGENTS "$agents"
  printf '%-12s %s\n' COMMANDS "$commands"
  printf '%-12s %s\n' MCP "$mcp_n"
  if [ -f "$(acct_profile_path "$acct")" ]; then
    local pname
    pname=$(python3 -c "import json, sys; print(json.load(open(sys.argv[1])).get('name','?'))" "$(acct_profile_path "$acct")" 2>/dev/null || echo '?')
    printf '%-12s %s\n' PROFILE "$pname ($(acct_profile_path "$acct"))"
  fi

  if [ "$skills" != "0" ]; then
    echo "skills:"
    find "$home/skills" -mindepth 1 -maxdepth 1 -exec basename {} \; 2>/dev/null | sort | sed 's/^/  /'
  fi
  if [ -f "$home/.mcp.json" ] && [ "$mcp_n" != "0" ]; then
    echo "mcp:"
    python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print('\n'.join('  '+k for k in (d.get('mcpServers') or {})))" "$home/.mcp.json"
  fi
}

resolve_profile_path() {
  local name="$1"
  if [ -f "$name" ]; then
    echo "$name"
    return 0
  fi
  if [ -f "$PROFILES_DIR/$name.json" ]; then
    echo "$PROFILES_DIR/$name.json"
    return 0
  fi
  if [ -f "$PROFILES_DIR/$name" ]; then
    echo "$PROFILES_DIR/$name"
    return 0
  fi
  return 1
}

cmd_profiles() {
  local sub="${1:-list}"; shift || true
  case "$sub" in
    list|ls|"")
      echo "Bundled profiles ($PROFILES_DIR):"
      local p
      for p in $(list_bundled_profiles); do
        local desc
        desc=$(python3 -c "import json, sys; print(json.load(open(sys.argv[1])).get('description',''))" "$PROFILES_DIR/$p.json" 2>/dev/null || true)
        printf '  %-12s %s\n' "$p" "$desc"
      done
      echo
      echo "MCP catalog ($MCP_CATALOG_DIR):"
      local m
      for m in $(list_mcp_catalog); do
        local md
        md=$(python3 -c "import json, sys; print(json.load(open(sys.argv[1])).get('description',''))" "$MCP_CATALOG_DIR/$m.json" 2>/dev/null || true)
        printf '  %-12s %s\n' "$m" "$md"
      done
      ;;
    show)
      [ $# -ge 1 ] || die "usage: farm profiles show <name>"
      local path
      path=$(resolve_profile_path "$1") || die "unknown profile: $1"
      cat "$path"
      ;;
    *)
      die "usage: farm profiles [list|show <name>]"
      ;;
  esac
}

cmd_equip() {
  local acct="" profile="" list_only=false
  while [ $# -gt 0 ]; do
    case "$1" in
      --list|-l) list_only=true; shift ;;
      --profile|-p)
        profile="${2:-}"; [ -n "$profile" ] || die "--profile needs a value"
        shift 2
        ;;
      -*) die "unknown equip option: $1" ;;
      *)
        if [ -z "$acct" ]; then acct="$1"; else die "unexpected arg: $1"; fi
        shift
        ;;
    esac
  done
  [ -n "$acct" ] || die "usage: farm equip <acct> [--profile name] | farm equip <acct> --list"

  if $list_only; then
    equip_status "$acct"
    return 0
  fi

  [ -n "$profile" ] || die "equip needs --profile <name> (or run: farm setup $acct)"
  local path
  path=$(resolve_profile_path "$profile") || die "unknown profile: $profile"
  mkdir -p "$ACCOUNTS_DIR/$acct"
  apply_profile_file "$acct" "$path"
}

cmd_setup() {
  local acct="${1:-}"
  [ -n "$acct" ] || die "usage: farm setup <acct>"

  mkdir -p "$ACCOUNTS_DIR/$acct"
  ensure_acct_home "$acct"
  local home
  home="$(acct_home "$acct")"

  echo "usage-farm setup — account: $acct"
  echo "home: $home"
  echo "host skills: $(host_skills_dir)"
  echo
  echo "Hooks from host ~/.claude are intentionally NOT copied (macOS paths break in containers)."
  echo

  # 1) baseline profile
  local -a profile_opts=("blank" "minimal" "coding" "frontend" "custom")
  echo "Baseline profile:"
  local baseline
  baseline=$(pick_one "profile" "${profile_opts[@]}")
  baseline="${baseline:-blank}"
  echo "→ $baseline"
  echo

  local tmp_profile
  tmp_profile="$(mktemp -t farm-profile.XXXXXX.json)"

  if [ "$baseline" != "blank" ] && [ "$baseline" != "custom" ]; then
    local base_path
    base_path=$(resolve_profile_path "$baseline") || die "missing bundled profile: $baseline"
    cp "$base_path" "$tmp_profile"
  else
    cat >"$tmp_profile" <<EOF
{
  "name": "custom",
  "description": "Interactive setup for $acct",
  "skills_packages": [],
  "skills_from_host": [],
  "agents_from_host": [],
  "commands_from_host": [],
  "mcp": []
}
EOF
  fi

  # 2) Vercel / package skills
  if confirm_yn "Add skills via Vercel skills CLI (npx skills)?" y; then
    echo "Common sources (multi-select). You can also type a custom owner/repo after."
    local -a sources_pick=(
      "vercel-labs/agent-skills"
      "vercel-labs/skills"
      "skip"
    )
    local chosen_sources
    chosen_sources=$(pick_multi "skill packages" "${sources_pick[@]}")
    while IFS= read -r src; do
      [ -z "$src" ] || [ "$src" = "skip" ] && continue
      # ask which skills — default all
      if confirm_yn "Install ALL skills from $src?" y; then
        python3 - "$tmp_profile" "$src" <<'PY'
import json, sys
path, source = sys.argv[1], sys.argv[2]
d = json.load(open(path))
pkgs = d.get("skills_packages") or []
# replace if same source
pkgs = [p for p in pkgs if p.get("source") != source]
pkgs.append({"source": source, "skills": ["*"]})
d["skills_packages"] = pkgs
json.dump(d, open(path, "w"), indent=2)
print()
PY
      else
        echo "Enter skill names (comma-separated), or leave empty for all:"
        printf 'skills> ' >&2
        local skill_line
        read -r skill_line || true
        if [ -z "$skill_line" ]; then
          skill_line="*"
        fi
        python3 - "$tmp_profile" "$src" "$skill_line" <<'PY'
import json, sys
path, source, skills = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(path))
pkgs = [p for p in (d.get("skills_packages") or []) if p.get("source") != source]
sk = [s.strip() for s in skills.split(",") if s.strip()]
pkgs.append({"source": source, "skills": sk or ["*"]})
d["skills_packages"] = pkgs
json.dump(d, open(path, "w"), indent=2)
print()
PY
      fi
    done <<<"$chosen_sources"

    if confirm_yn "Add another custom package (owner/repo)?" n; then
      printf 'owner/repo> ' >&2
      local custom_src
      read -r custom_src || true
      if [ -n "$custom_src" ]; then
        python3 - "$tmp_profile" "$custom_src" <<'PY'
import json, sys
path, source = sys.argv[1], sys.argv[2]
d = json.load(open(path))
pkgs = d.get("skills_packages") or []
pkgs.append({"source": source, "skills": ["*"]})
d["skills_packages"] = pkgs
json.dump(d, open(path, "w"), indent=2)
print()
PY
      fi
    fi
  fi

  # 3) host skills
  if confirm_yn "Copy selected skills from host ~/.claude?" y; then
    local -a _hs=()
    while IFS= read -r line; do [ -n "$line" ] && _hs+=("$line"); done < <(list_host_skills)
    if [ ${#_hs[@]} -eq 0 ]; then
      echo "farm: no host skills found"
    else
      echo "Select host skills (Tab multi-select in fzf; ctrl-a = all):"
      local picked
      picked=$(pick_multi "host skills" "${_hs[@]}")
      printf '%s\n' "$picked" | python3 - "$tmp_profile" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
existing = set(d.get("skills_from_host") or [])
for line in sys.stdin:
    line = line.strip()
    if line:
        existing.add(line)
d["skills_from_host"] = sorted(existing)
json.dump(d, open(path, "w"), indent=2)
print(f"farm: {len(existing)} host skills selected")
PY
    fi
  fi

  # 4) host agents
  if confirm_yn "Copy selected agents from host?" y; then
    local -a _ha=()
    while IFS= read -r line; do [ -n "$line" ] && _ha+=("$line"); done < <(list_host_agents)
    if [ ${#_ha[@]} -gt 0 ]; then
      local picked_a
      picked_a=$(pick_multi "host agents" "${_ha[@]}")
      printf '%s\n' "$picked_a" | python3 - "$tmp_profile" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
existing = set(d.get("agents_from_host") or [])
for line in sys.stdin:
    line = line.strip()
    if line:
        existing.add(line)
d["agents_from_host"] = sorted(existing)
json.dump(d, open(path, "w"), indent=2)
print(f"farm: {len(existing)} host agents selected")
PY
    fi
  fi

  # 5) host commands
  if confirm_yn "Copy selected commands from host?" y; then
    local -a _hc=()
    while IFS= read -r line; do [ -n "$line" ] && _hc+=("$line"); done < <(list_host_commands)
    if [ ${#_hc[@]} -gt 0 ]; then
      local picked_c
      picked_c=$(pick_multi "host commands" "${_hc[@]}")
      printf '%s\n' "$picked_c" | python3 - "$tmp_profile" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
existing = set(d.get("commands_from_host") or [])
for line in sys.stdin:
    line = line.strip()
    if line:
        existing.add(line)
d["commands_from_host"] = sorted(existing)
json.dump(d, open(path, "w"), indent=2)
print(f"farm: {len(existing)} host commands selected")
PY
    fi
  fi

  # 6) MCP catalog
  if confirm_yn "Enable MCP servers from farm catalog?" y; then
    local -a _mcp=()
    while IFS= read -r line; do [ -n "$line" ] && _mcp+=("$line"); done < <(list_mcp_catalog)
    if [ ${#_mcp[@]} -gt 0 ]; then
      echo "Container-safe MCP only (host Tolaria/socket MCPs are excluded):"
      local picked_m
      picked_m=$(pick_multi "mcp" "${_mcp[@]}")
      printf '%s\n' "$picked_m" | python3 - "$tmp_profile" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
existing = set(d.get("mcp") or [])
for line in sys.stdin:
    line = line.strip()
    if line:
        existing.add(line)
d["mcp"] = sorted(existing)
json.dump(d, open(path, "w"), indent=2)
print(f"farm: {len(existing)} mcp servers selected")
PY
    fi
  fi

  # name the custom profile
  if [ "$baseline" = "custom" ] || [ "$baseline" = "blank" ]; then
    python3 - "$tmp_profile" "$acct" <<'PY'
import json, sys
path, acct = sys.argv[1], sys.argv[2]
d = json.load(open(path))
d["name"] = d.get("name") or f"custom-{acct}"
d["description"] = d.get("description") or f"Interactive setup for {acct}"
json.dump(d, open(path, "w"), indent=2)
PY
  fi

  echo
  echo "=== Profile to apply ==="
  cat "$tmp_profile"
  echo "========================"
  echo

  if ! confirm_yn "Apply this profile to $acct now?" y; then
    local keep="$ACCOUNTS_DIR/$acct/profile.draft.json"
    cp "$tmp_profile" "$keep"
    rm -f "$tmp_profile"
    echo "farm: draft saved at $keep (apply later with: farm equip $acct --profile $keep)"
    return 0
  fi

  apply_profile_file "$acct" "$tmp_profile"
  rm -f "$tmp_profile"

  echo
  echo "Next:"
  echo "  farm login $acct     # if not authed yet"
  echo "  farm claude $acct    # skills/MCP available inside the container"
  echo "  farm equip $acct --list"
}

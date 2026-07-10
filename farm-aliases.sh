# usage-farm aliases — source from ~/.zshrc or ~/.bashrc:
#   source /path/to/usage-farm/farm-aliases.sh

# resolve this file's directory (works when sourced from zsh or bash)
if [ -n "${ZSH_VERSION:-}" ]; then
  _farm_dir="$(cd "$(dirname "${(%):-%x}")" && pwd)"
else
  _farm_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
FARM="$_farm_dir/farm.sh"
unset _farm_dir

# primary CLI
alias farm="$FARM"
# repo name synonym (optional)
alias usage-farm="$FARM"
alias claude-farm="$FARM"

# one-word account aliases
_farm_state="${FARM_STATE:-$HOME/.usage-farm}"
if [ ! -d "$_farm_state" ] && [ -d "$HOME/.claude-farm" ]; then
  _farm_state="$HOME/.claude-farm"
fi

_farm_accounts="$_farm_state/accounts"
if [ -d "$_farm_accounts" ]; then
  while IFS= read -r _acct; do
    [ -z "$_acct" ] && continue
    alias "usage-$_acct"="$FARM run claude $_acct"
    alias "claude-$_acct"="$FARM run claude $_acct"
  done <<EOF
$(find "$_farm_accounts" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null)
EOF
  unset _acct
fi
unset _farm_accounts

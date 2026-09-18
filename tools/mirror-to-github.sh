#!/usr/bin/env bash
#
# Mirror dieses Repos auf GitHub.
#
# Wichtig: sensible Daten (interner Git-Host, Org-Pfad) stehen NIRGENDS in diesem
# Repo. Das Skript liest sie zur Laufzeit aus dem `origin`-Remote des Quell-Repos
# und ersetzt sie in der kompletten History durch die GitHub-URL.
#
# Nutzung:
#   tools/mirror-to-github.sh <github-url> [--history=full|squash] [--dry-run]
#
# Beispiele:
#   tools/mirror-to-github.sh git@github.com:acme/piagent-pretty-api-error.git
#   tools/mirror-to-github.sh git@github.com:acme/piagent-pretty-api-error.git --history=squash
#   tools/mirror-to-github.sh git@github.com:acme/piagent-pretty-api-error.git --dry-run
#
# Modi:
#   --history=full    (default) komplette History, gescrubbt (git filter-branch)
#   --history=squash  ein einziger sauberer Commit aus dem aktuellen Stand
#
# --dry-run pusht in ein lokales Bare-Repo (kein GitHub-Zugriff); mit --out=<pfad>
# bleibt das Ergebnis zur Kontrolle liegen.
#
# Optional (nur --history=full): Autor/Committer aller Commits umschreiben
#   MIRROR_AUTHOR_NAME="Jane Doe" MIRROR_AUTHOR_EMAIL="jane@example.com" tools/mirror-to-github.sh ...

set -euo pipefail

TARGET="${1:-}"
MODE="full"
DRY_RUN=0
OUT=""

for arg in "${@:2}"; do
  case "$arg" in
    --history=*) MODE="${arg#--history=}" ;;
    --dry-run) DRY_RUN=1 ;;
    --out=*) OUT="${arg#--out=}" ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Nutzung: $0 <github-url> [--history=full|squash] [--dry-run] [--out=<bare-repo>]" >&2
  exit 2
fi
# Ziel muss eine echte Git-URL mit Host sein (sonst ist das Ersetzen sinnlos)
if [[ ! "$TARGET" =~ ^([a-z+]+://)?([^@/]+@)?[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+[:/].+ ]]; then
  echo "Ziel '$TARGET' ist keine Git-URL mit Host (erwartet z. B. <user>@github.com:owner/repo.git)" >&2
  exit 2
fi
case "$MODE" in full|squash) ;; *) echo "--history muss full|squash sein" >&2; exit 2 ;; esac

# URL -> "[user@]host/org/repo" (ohne Schema, SCP-Colon wird zu Slash, user@ bleibt)
normalize() {
  local url="${1%.git}"
  url="${url#ssh://}"; url="${url#https://}"; url="${url#http://}"
  printf '%s' "${url/://}"
}

hostpath_of() { printf '%s' "${1#*@}"; }   # [user@]host/org/repo -> host/org/repo
host_of() { printf '%s' "${1%%/*}"; }       # host/org/repo -> host
path_of() { printf '%s' "${1#*/}"; }        # host/org/repo -> org/repo
org_of()  { printf '%s' "${1%/*}"; }        # host/org/repo -> host/org

SOURCE_NORM="$(normalize "$(git remote get-url origin)")"   # <user>@<host>/<org>/<repo>
SRC_HOSTPATH="$(hostpath_of "$SOURCE_NORM")"
SRC_USER="${SOURCE_NORM%%@*}"; [[ "$SRC_USER" == "$SOURCE_NORM" ]] && SRC_USER="git"
SRC_HOST="$(host_of "$SRC_HOSTPATH")"
SRC_PATH="$(path_of "$SRC_HOSTPATH")"
SRC_HOSTORG="$(org_of "$SRC_HOSTPATH")"
SRC_URL="$(git remote get-url origin)"; SRC_URL="${SRC_URL%.git}"   # Form wie in origin
SRC_NORM="$SOURCE_NORM"                             # <user>@<host>/<org>/<repo>
SRC_SCP="$SRC_USER@$SRC_HOST:$SRC_PATH"             # <user>@<host>:<org>/<repo>

TARGET_NORM="$(normalize "$TARGET")"
TARGET_HOSTPATH="$(hostpath_of "$TARGET_NORM")"
TARGET_HOST="$(host_of "$TARGET_HOSTPATH")"
TARGET_PATH="$(path_of "$TARGET_HOSTPATH")"
DST_HOSTORG="$(org_of "$TARGET_HOSTPATH")"         # github.com/owner
DST_URL="ssh://git@$TARGET_HOST/$TARGET_PATH"
DST_NORM="git@$TARGET_HOST/$TARGET_PATH"
DST_SCP="git@$TARGET_HOST:$TARGET_PATH"

echo "Quelle : $SRC_URL  (Host: ${SRC_HOST:-?}, Org: ${SRC_HOSTORG:-?})"
echo "Ziel   : $DST_URL"
echo "Modus  : $MODE$([[ $DRY_RUN == 1 ]] && echo ' (dry-run)')"
echo

export SRC_URL SRC_SCP SRC_NORM SRC_HOSTORG

export DST_URL DST_SCP DST_NORM DST_HOSTORG

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Ersetzt die internen Quell-URLs im aktuellen Verzeichnis (aktueller Stand bzw.
# pro Commit im Tree-Filter). Als Skript statt Shell-Funktion, weil git
# filter-branch den Tree-Filter nicht in einer Bash mit exportierten Funktionen
# ausfuehrt.
SCRUB="$WORKDIR/scrub-tree.sh"
cat > "$SCRUB" <<'SCRUB_EOF'
#!/usr/bin/env bash
set -u
files=$(grep -rIl -e "$SRC_URL" -e "$SRC_SCP" -e "$SRC_NORM" -e "$SRC_HOSTORG" . 2>/dev/null || true)
for f in $files; do
  sed -i \
    -e "s|$SRC_URL|$DST_URL|g" \
    -e "s|$SRC_SCP|$DST_SCP|g" \
    -e "s|$SRC_NORM|$DST_NORM|g" \
    -e "s|$SRC_HOSTORG|$DST_HOSTORG|g" \
    "$f"
done
SCRUB_EOF
chmod +x "$SCRUB"

echo "→ Mirror-Klon der Quelle"
if ! CLONE_ERR="$(git clone --mirror "$(git remote get-url origin)" "$WORKDIR/mirror.git" 2>&1)"; then
  echo "  ✖ Mirror-Klon von origin fehlgeschlagen:" >&2
  printf '%s\n' "$CLONE_ERR" | sed 's/^/      /' >&2
  exit 1
fi
COMMITS_BEFORE="$(git --git-dir="$WORKDIR/mirror.git" rev-list --all --count)"

if [[ -z "$SRC_HOST" ]]; then
  echo "  ⚠ origin hat keinen Hostnamen (lokaler Pfad?) - die Musterableitung ist eingeschraenkt;"
  echo "    die generische Host-Pruefung faengt Leftovers trotzdem ab."
fi

if [[ "$MODE" == "squash" ]]; then
  echo "→ Squash: ein Commit aus dem aktuellen Stand"
  mkdir -p "$WORKDIR/tree"
  git --git-dir="$WORKDIR/mirror.git" archive HEAD | tar -x -C "$WORKDIR/tree"
  rm -rf "$WORKDIR/mirror.git"
  cd "$WORKDIR/tree"
  echo "→ interne URLs ersetzen"
  "$SCRUB"
  git init -q -b main .
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo mirror)}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo mirror@localhost)}" \
      commit -q -m "Initial commit"
else
  cd "$WORKDIR/mirror.git"
  echo "→ History scrubben (interner Host -> GitHub, $COMMITS_BEFORE Commits)"
  export FILTER_BRANCH_SQUELCH_WARNING=1
  # --tag-name-filter cat: auch annotierte Tags auf die neuen Commits umhaengen
  # (sonst bleibt der alte Commit samt ungescrubbtem Baum reachable).
  FB_ARGS=(-f --prune-empty --tag-name-filter cat)
  if [[ -n "${MIRROR_AUTHOR_NAME:-}" && -n "${MIRROR_AUTHOR_EMAIL:-}" ]]; then
    echo "→ Autor/Tagger umschreiben auf: $MIRROR_AUTHOR_NAME <$MIRROR_AUTHOR_EMAIL>"
    FB_ARGS+=(--env-filter 'export GIT_AUTHOR_NAME="$MIRROR_AUTHOR_NAME" GIT_AUTHOR_EMAIL="$MIRROR_AUTHOR_EMAIL" GIT_COMMITTER_NAME="$MIRROR_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$MIRROR_AUTHOR_EMAIL"')
  fi
  # Reihenfolge im scrub_tree: spezifischste Form zuerst (SRC_URL vor SRC_NORM/SRC_SCP)
  FB_ARGS+=(--tree-filter "$SCRUB" -- --branches --tags)
  # Wichtig: NICHT --all verwenden - refs/remotes/* wuerden den Tree-Filter ein
  # zweites Mal auf schon ersetzte Dateien anwenden (doppelte Praefixe).

  git filter-branch "${FB_ARGS[@]}" >/dev/null 2>&1

  # Annotierte Tags neu schreiben: --tag-name-filter behaelt sonst die alte
  # Tagger-Identitaet (Maschinenaccount) im Tag-Objekt.
  if [[ -n "${MIRROR_AUTHOR_NAME:-}" && -n "${MIRROR_AUTHOR_EMAIL:-}" ]]; then
    while read -r name objtype; do
      [[ "$objtype" == "tag" ]] || continue
      target="$(git rev-parse "$name^{commit}")"
      message="$(git cat-file -p "$name" | sed '1,/^$/d')"
      GIT_COMMITTER_NAME="$MIRROR_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$MIRROR_AUTHOR_EMAIL" \
        git tag -f -a "$name" -m "$message" "$target" >/dev/null
    done < <(git for-each-ref --format='%(refname:short) %(objecttype)' refs/tags)
  fi

  git for-each-ref --format='%(refname)' refs/original/ | xargs -r -n1 git update-ref -d
  # Stale Remote-Refs wuerden die alten (ungescrubbten) Commits am Leben halten
  git for-each-ref --format='%(refname)' refs/remotes/ | xargs -r -n1 git update-ref -d
  git reflog expire --expire=now --all
  git gc --prune=now --quiet

  COMMITS_AFTER="$(git rev-list --all --count)"
  if [[ "$COMMITS_AFTER" != "$COMMITS_BEFORE" ]]; then
    echo "  ✖ Commit-Anzahl weicht ab ($COMMITS_BEFORE -> $COMMITS_AFTER): stale Refs?" >&2
    MISSING_REFS=1
  fi
fi

echo "→ Prüfungen"
FAIL="${MISSING_REFS:-0}"
REVS="$(git rev-list --all)"

# Das Mirror-Werkzeug selbst (Skript + Doku) enthaelt Beispiele fuer URLs und
# Geheimnis-Muster -> bei den Muster-Pruefungen ausklammern, sonst Fehlalarm.
SELF_EXCLUDES=(":(exclude)tools" ":(exclude)MIRRORING.md")

# grep ueber die gesamte History; ohne "head" im Hintergrund koennen SIGPIPEs
# das Skript beenden, daher Ausgabe erst sammeln. <self>=1 blendet das eigene
# Mirror-Werkzeug aus (nur fuer Muster-Pruefungen, die es selbst dokumentiert).
examine() { # <self:0|1> <grep-args...>
  local self="$1"; shift
  if [[ "$self" == "1" ]]; then
    git grep "$@" $REVS -- . "${SELF_EXCLUDES[@]}" 2>/dev/null || true
  else
    git grep "$@" $REVS 2>/dev/null || true
  fi
}

check() { # <label> <self:0|1> <grep-pattern> [extended]
  local label="$1" self="$2" pattern="$3" mode="${4:-}"
  if [[ -z "$pattern" ]]; then
    echo "  ⚠ $label: Muster leer (Quell-Remote ohne Host?) - Pruefung uebersprungen"
    return
  fi
  local hits
  hits="$(examine "$self" -l ${mode} -e "$pattern" | head -20)"
  if [[ -n "$hits" ]]; then
    echo "  ✖ $label gefunden:"
    printf '      %s\n' $hits
    FAIL=1
  else
    echo "  ✔ $label: nicht vorhanden"
  fi
}

# Pruefungen ohne Selbst-Ausnahme: der interne Host darf nirgends stehen
check "interner Host ($SRC_HOSTORG)" 0 "$SRC_HOSTORG"
check "interner Hostname ($SRC_HOST)" 0 "$SRC_HOST"
check "Quell-URL" 0 "$SRC_URL"
check "OpenAI/Anthropic-Keys" 0 'sk-[A-Za-z0-9]{16,}' -E
check "GitHub-Token" 0 'ghp_[A-Za-z0-9]{20,}' -E
check "GitHub-PAT" 0 'github_pat_[A-Za-z0-9_]{20,}' -E
check "AWS-Access-Key" 0 'AKIA[0-9A-Z]{16}' -E
check "Private Keys" 0 'BEGIN [A-Z ]*PRIVATE KEY' -E
# Wert muss wie ein echtes Geheimnis aussehen (alnum, >=8 Zeichen) - Doku wie
# "password=…" erzeugt so keinen Fehlalarm.
PASSWORD_RE="(password|passwd|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9+/_.-]{8,}"
check "Passwort-/Key-Zuweisungen" 1 "$PASSWORD_RE" -E

# Generische Absicherung: JEDER fremde Remote-Host in der History ist verdaechtig.
# Faengt auch Faelle, in denen das Skript gegen den falschen origin laeuft.
# Muster bewusst streng: host muss nach user@ bzw. git@ folgen, damit Doku-/Code-
# Platzhalter (git@$VAR, git@<host>) keine Fehlalarme erzeugen.
HOST_RE=$'git@[A-Za-z0-9._-]+|ssh://[A-Za-z0-9._-]+@[A-Za-z0-9._-]+'
FOREIGN="$(examine 1 -hoE "$HOST_RE" | sed -E 's|^ssh://||; s|^[^@]*@||' | sort -u | grep -vx "$TARGET_HOST" || true)"
if [[ -n "$FOREIGN" ]]; then
  echo "  ✖ fremde Remote-Hosts gefunden (erwartet nur $TARGET_HOST):"
  printf '      %s\n' $FOREIGN
  echo "  ℹ Fundstellen:"
  examine 1 -nE "$HOST_RE" | head -20 | sed 's/^/      /'
  FAIL=1
else
  echo "  ✔ keine fremden Remote-Hosts (nur $TARGET_HOST)"
fi

echo "  ℹ Commits: $(git rev-list --all --count) | Tags: $(git tag | wc -l | tr -d ' ') | Branches: $(git for-each-ref --format='%(refname:short)' refs/heads | tr '\n' ' ')"
git for-each-ref --format='  ℹ %(refname:short) → %(objectname:short)' refs/heads refs/tags

if [[ $FAIL == 1 ]]; then
  echo
  echo "Abbruch: Prüfungen fehlgeschlagen, es wurde nichts gepusht." >&2
  exit 1
fi

if [[ $DRY_RUN == 1 ]]; then
  REMOTE="${OUT:-$WORKDIR/dryrun.git}"
  mkdir -p "$REMOTE"
  git init -q --bare "$REMOTE"
  echo "→ Push (dry-run) nach $REMOTE"
  git push -q --mirror "$REMOTE"
  echo "  ✔ Push ok, GitHub wurde nicht kontaktiert"
else
  echo "→ Push nach $TARGET"
  git push --mirror "$TARGET"
  echo "  ✔ gepusht"
fi

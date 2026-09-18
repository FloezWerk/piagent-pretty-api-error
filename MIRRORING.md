# Mirroring nach GitHub

Primär-Remote ist das interne Gitea (`origin`). GitHub ist ein **Mirror** –
Einbahnstraße: Gitea bleibt Quelle der Wahrheit, GitHub wird nur bespielt.

## Sensible Daten – Stand

| Fund | Ort | Status |
| --- | --- | --- |
| interner Git-Host + Org-Pfad (`…@<host>/<org>/…`) | `README.md` (Installationsanleitung) | **entfernt** – jetzt GitHub-Platzhalter |
| derselbe Host in der **History** (5 ältere README-Revisionen, Tag `v0.1.0`) | Git-Historie | wird beim Mirror **ersetzt** (`tools/mirror-to-github.sh`) |
| lokale Maschinen-Identität in Commits/Tag (`… <…@localhost>`) | Commit-/Tag-Metadaten | optional umschreibbar (siehe unten) |
| `.spec-flow/debug.log` (Session-Log) | lokal, nicht getrackt | per `.gitignore` ausgeschlossen |
| Tokens/Keys/Passwörter | – | keine gefunden (Code + gesamte History geprüft) |

Der interne Host steht bewusst **nirgends** im Repo: das Mirror-Skript liest ihn
zur Laufzeit aus `git remote get-url origin` und baut daraus seine Suchmuster.

## Vorher einmalig ersetzen

Drei Platzhalter `<owner>` (GitHub-Account/Organisation):

1. `README.md` → Installationsanleitung
2. `package.json` → `author`, `repository`, `homepage`, `bugs`
3. `LICENSE` → Copyright-Halter

```bash
grep -rn "<owner>" README.md package.json LICENSE
sed -i 's/<owner>/DEIN-OWNER/g' README.md package.json LICENSE   # Beispiel
```

## Mirror ausführen

```bash
# Vorschau: scrubben, prüfen, in ein lokales Bare-Repo pushen (kein GitHub-Zugriff)
tools/mirror-to-github.sh git@github.com:<owner>/piagent-pretty-api-error.git \
  --dry-run --out=/tmp/mirror-check.git

# Wirklich pushen (komplette History, gescrubbt)
MIRROR_AUTHOR_NAME="Jane Doe" MIRROR_AUTHOR_EMAIL="jane@example.com" \
  tools/mirror-to-github.sh git@github.com:<owner>/piagent-pretty-api-error.git

# Alternative: nur ein sauberer Commit (keine alte History im Mirror)
tools/mirror-to-github.sh git@github.com:<owner>/piagent-pretty-api-error.git --history=squash
```

Was das Skript macht:

1. `git clone --mirror` von `origin`
2. ersetzt internen Host/Org in **allen** Commits (Tree-Filter) + in annotierten Tags
3. optional Autor/Committer **und Tagger** auf eine öffentliche Identität
4. prüft: interner Host, Quell-URL, fremde Remote-Hosts, Token-/Key-Muster,
   `password=…`-Zuweisungen → **bricht ab, wenn etwas übrig ist**
5. `git push --mirror` (Branches + Tags)

Exit-Code ≠ 0 = nichts gepusht.

## Nach dem Mirror

```bash
git ls-remote git@github.com:<owner>/piagent-pretty-api-error.git   # Refs vergleichen
```

- GitHub-Repo kann **privat** bleiben; das Repo selbst enthält keine Zugangsdaten.
- `package.json` hat `"private": true` → kein versehentliches `npm publish`.
- Nur bei Bedarf: Branch-Protection/Secret-Scanning auf GitHub aktivieren.
- Sicherheitsnetz: das Skript prüft generisch auf *jeden* fremden Remote-Host in
  der History – auch wenn es versehentlich gegen ein falsches `origin` läuft.

## Empfehlung zum Workflow

Mirror manuell und bewusst anstoßen (Skript), nicht per Dauer-Sync – so bleibt
kontrollierbar, was wann öffentlich wird. Alternativ in Gitea einen Push-Mirror
auf die GitHub-URL einrichten, dann läuft die Synchronisation serverseitig;
sensible Daten dürfen dann **nie** im Repo landen (History wird live übertragen).

# piagent-pretty-api-error

Pi-Extension, die Provider-/API-Fehler (z. B. OpenRouter-`429`-JSON-Payloads) lesbar
darstellt statt als rohes JSON.

## Verhalten

Fehlerzeile (kurz):

```
Error: ✖ API-Fehler · HTTP 429 · rate limit · Details: ctrl+o
```

Darunter ein rot hinterlegter Detailblock:

```
✖ API-Fehler · HTTP 429 · rate limit
Provider: openrouter · Upstream: Fireworks
Model: deepseek/deepseek-v4.1-flash
Grund: Provider returned error
Upstream: …temporarily rate-limited upstream…
Code: invalid_request_error
Hinweis: Retry shortly, add your own provider key…
… Rohdaten ein-/ausblenden: ctrl+o
```

`ctrl+o` (`app.tools.expand`) blendet die Rohdaten ein:

```
Rohdaten:
429: {"message":"Provider returned error","code":429,"metadata":{…}}
```

## Eigenschaften

- Detailblock ist ein `CustomEntry` → **kein Bestandteil des LLM-Kontexts**, wird aber in der
  Session persistiert und beim Resume/Reload mitgerendert.
- Der Entry wird erst bei `agent_settled` angehängt, d. h. nur für finale Fehler
  (keine Rohdaten-Blöcke für Fehlversuche, die noch erfolgreich retryed werden).
- **Retry-Semantik bleibt unangetastet:** Pi klassifiziert Fehler über
  `isRetryableAssistantError(message.errorMessage)`. Die Kurzzeile wird nur gesetzt,
  wenn die Klassifikation danach identisch ist – sonst bleibt der Fehler roh.
- Rotes Hintergrundfeld wird per ANSI im Text realisiert (kompatibel zu `wrapTextWithAnsi`).

## Installation

Lokal (Entwicklung):

```bash
pi -e ./extensions/api-error-format.ts
```

Als Pi-Package:

```bash
pi install git:git@gitea/FloezWerk/piagent-pretty-api-error
# oder
pi install ssh://git@gitea/FloezWerk/piagent-pretty-api-error.git
```

Alternativ die Datei nach `~/.pi/agent/extensions/` kopieren (Auto-Discovery).

## Befehle

| Befehl | Wirkung |
| --- | --- |
| `/apierrors preview` | Hängt einen Beispiel-Fehlerblock an (mit `ctrl+o` testbar) |
| `/apierrors on` | Roter Hintergrund an |
| `/apierrors off` | Roter Hintergrund aus |

Nach Änderungen in einer laufenden Session: `/reload`.

## Abhängigkeiten

`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` und `@earendil-works/pi-tui` werden
von Pi gebündelt und sind daher nur als `peerDependencies` deklariert.

# piagent-pretty-api-error

Pi-Extension, die Provider-/API-Fehler (z. B. OpenRouter-`429`-JSON-Payloads) lesbar
darstellt statt als rohes JSON.

## Verhalten

Fehlerzeile (kurz):

```
Error: ✖  API-Fehler · HTTP 429 · rate limit · Details: ctrl+o
```

Darunter ein rot hinterlegtes Panel mit Innenabstand, spaltenbündigen Labels und
Hanging-Indent für umgebrochene Werte:

```
                                          ← Innenabstand oben
✖  API-Fehler · HTTP 429 · rate limit      ← Titel (fett)

Provider:  openrouter · Upstream: Fireworks
Model:     deepseek/deepseek-v4.1-flash
Grund:     Provider returned error
Upstream:  deepseek/… is temporarily rate-limited upstream. Please retry shortly,
           or add your own key to accumulate your rate limits: …
Code:      invalid_request_error
Hinweis:   Retry shortly, add your own provider key …

ctrl+o · Rohdaten einblenden              ← gedimmt
                                          ← Innenabstand unten
```

`ctrl+o` (`app.tools.expand`) blendet die Rohdaten ein – als **direkt anschliessendes,
dunkleres Panel** in gleicher Breite/Ausrichtung (gehoert sichtbar zur Meldung).
Enthalten die Rohdaten JSON, wird es eingerückt dargestellt (Label dann
`Rohdaten (JSON):`, führender Status bleibt als Kopfzeile):

```
…
ctrl+o · Rohdaten ausblenden

Rohdaten (JSON):
429:
{
  "message": "Provider returned error",
  "code": 429,
  "metadata": {
    "raw": "deepseek/… is temporarily rate-limited upstream. Please retry shortly.",
    "provider_name": "Fireworks",
    "provider_error_code": "invalid_request_error"
  }
}
```

- Nur wenn der Text parsebar ist; sonst bleiben die Rohdaten unverändert.
- Lange Werte/URLs brechen mit **Hanging-Indent unter dem Wert** um (nicht flush-left).
- Kürzung bei > 8000 Zeichen (`… gekuerzt (N Zeichen)`), damit der Block nicht flutet.

## Eigenschaften

- Detailblock ist ein `CustomEntry` → **kein Bestandteil des LLM-Kontexts**, wird aber in der
  Session persistiert und beim Resume/Reload mitgerendert.
- Der Entry wird erst bei `agent_settled` angehängt, d. h. nur für finale Fehler
  (keine Rohdaten-Blöcke für Fehlversuche, die noch erfolgreich retryed werden).
- **Retry-Semantik bleibt unangetastet:** Pi klassifiziert Fehler über
  `isRetryableAssistantError(message.errorMessage)`. Die Kurzzeile wird nur gesetzt,
  wenn die Klassifikation danach identisch ist – sonst bleibt der Fehler roh.
- Der rote Block ist eine eigene Component: er fuellt die Terminalbreite und bricht lange
  Zeilen selbst um (kein abgeschnittenes/zerrissenes Layout bei schmalen Terminals).
  Aufbau: PiTUI `Box` (Padding + Hintergrund) um einen `ErrorBlock`, der Labels
  spaltenbündig setzt und Fortsetzungszeilen auf die Wertspalte einrückt.
- Farben werden über `getCapabilities().trueColor` gewählt:
  - 24-Bit (Windows Terminal, kitty, iTerm2, Ghostty, …): Meldung `rgb(96,22,22)`,
    Rohdaten `rgb(54,14,14)`
  - 256-Farben-Fallback: beide `color 52` (dunkelstes Rot der Palette), Rohdaten
    zusätzlich über die Schriftfarbe (181 statt 224) abgesetzt

## Installation

Lokal (Entwicklung):

```bash
pi -e ./extensions/api-error-format.ts
```

Als Pi-Package (GitHub, `<owner>` = GitHub-Account/Organisation):

```bash
pi install git:git@github.com:<owner>/piagent-pretty-api-error.git
# oder
pi install https://github.com/<owner>/piagent-pretty-api-error.git
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

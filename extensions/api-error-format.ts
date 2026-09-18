/**
 * api-error-format
 *
 * Rendert Provider-/API-Fehler (z. B. OpenRouter 429 JSON-Payloads) lesbar:
 *  - die Fehlerzeile selbst wird zu einer kurzen Kopfzeile ("✖ API-Fehler · HTTP 429 · rate limit")
 *  - darunter haengt ein rot hinterlegter Detail-Block (als Session-Entry)
 *  - `ctrl+o` (app.tools.expand) blendet die Rohdaten ein/aus
 *
 * Der Detail-Block ist ein CustomEntry und landet NICHT im LLM-Kontext.
 * Retry-Semantik bleibt unangetastet: Pi klassifiziert Fehler anhand von
 * `message.errorMessage` (isRetryableAssistantError). Die Kurzzeile wird nur
 * gesetzt, wenn die Klassifikation danach identisch ist - sonst bleibt der Fehler roh.
 */

import type { EntryRenderOptions, ExtensionAPI, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import { type Component, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "api-error-details";
const MAX_VALUE = 400;

// Roter Hintergrund + helle Schrift, lesbar auf dem dunklen Theme.
const BG = "\x1b[48;5;88m";
const FG = "\x1b[38;5;224m";
const RESET = "\x1b[39m\x1b[49m";

const NON_RETRYABLE_HINTS = [
  "insufficient_quota",
  "quota exceeded",
  "billing",
  "out of budget",
  "available balance",
  "GoUsageLimitError",
  "FreeUsageLimitError",
  "Monthly usage limit reached",
];

const RETRYABLE_HINTS = [
  "429",
  "500",
  "502",
  "503",
  "504",
  "524",
  "rate limit",
  "too many requests",
  "overloaded",
  "service unavailable",
  "server error",
  "internal error",
  "provider returned error",
  "network error",
  "connection error",
  "fetch failed",
  "timeout",
  "timed out",
  "stream ended without",
];

let useBackground = true;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface ParsedError {
  status?: number;
  json?: any;
  text: string;
}

function parseError(raw: string): ParsedError {
  let text = raw.replace(/^error:\s*/i, "").trim();

  let status: number | undefined;
  const lead = text.match(/^(?:HTTP\s*)?(\d{3})\b\s*[:\-–]?\s*/i);
  if (lead) {
    status = Number(lead[1]);
    text = text.slice(lead[0].length).trim();
  } else {
    const inline = text.match(/\bHTTP[ /](\d{3})\b/i);
    if (inline) status = Number(inline[1]);
  }

  let json: any;
  if (text.startsWith("{")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (json === undefined) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        json = JSON.parse(text.slice(start, end + 1));
      } catch {
        json = undefined;
      }
    }
  }

  return { status, json, text };
}

function category(status: number | undefined, haystack: string): string {
  const s = haystack.toLowerCase();
  if (/insufficient_quota|quota exceeded|billing|out of budget|available balance/.test(s)) return "quota/billing";
  if (status === 429 || /rate.?limit|too many requests/.test(s)) return "rate limit";
  if (/overloaded/.test(s)) return "provider overloaded";
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key/.test(s)) return "auth";
  if (status === 408 || status === 504 || status === 524 || /timed out|timeout/.test(s)) return "timeout";
  if (status !== undefined && status >= 500) return "provider error";
  if (status === 400 || status === 422) return "invalid request";
  return "provider error";
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}

// ---------------------------------------------------------------------------
// Fehler -> Daten
// ---------------------------------------------------------------------------

interface ErrorDetails {
  /** Kopfzeile, z. B. "✖ API-Fehler · HTTP 429 · rate limit" */
  headline: string;
  /** Detailzeilen (ohne ANSI), werden im Block umgebrochen */
  lines: string[];
  /** Original-Fehlertext (Rohdaten) */
  raw: string;
  /** Nur fuer die Vorschau: blendet die reale Fehlerzeile mit ein */
  preview?: boolean;
}

function buildDetails(raw: string, provider: string | undefined, model: string | undefined): ErrorDetails {
  const parsed = parseError(raw);
  const j = parsed.json;
  const meta = j?.metadata ?? j?.error?.metadata ?? {};

  const summary =
    clean(j?.message) ??
    clean(j?.error?.message) ??
    clean(typeof j?.error === "string" ? j.error : undefined) ??
    clean(parsed.text) ??
    raw;
  const upstream = clean(meta.raw);
  const hint = clean(meta.remedy_hint);
  const providerErrorCode = clean(meta.provider_error_code);
  const upstreamProvider = clean(meta.provider_name);
  const code = j?.code ?? j?.error?.code;

  const headline =
    parsed.status !== undefined
      ? `✖ API-Fehler · HTTP ${parsed.status} · ${category(parsed.status, raw)}`
      : `✖ API-Fehler · ${category(parsed.status, raw)}`;

  const lines: string[] = [headline];
  const add = (label: string, value: string | undefined) => {
    if (!value) return;
    lines.push(`${label}${truncate(value, MAX_VALUE)}`);
  };

  const origin = [
    provider,
    upstreamProvider && upstreamProvider !== provider ? `Upstream: ${upstreamProvider}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  add("Provider: ", origin || undefined);
  add("Model: ", model);
  add("Grund: ", summary);
  if (upstream && upstream !== summary) add("Upstream: ", upstream);
  if (providerErrorCode || (code !== undefined && code !== parsed.status)) {
    add("Code: ", providerErrorCode ?? String(code));
  }
  add("Hinweis: ", hint);

  return { headline, lines, raw };
}

/** Kurze Fehlerzeile, die auf den Detailblock verweist. */
function shortMessage(details: ErrorDetails, parsedJson: boolean, raw: string): string {
  const suffix = parsedJson ? "" : ` · ${truncate(clean(raw) ?? raw, 60)}`;
  return `${details.headline}${suffix} · Details: ctrl+o`;
}

// ---------------------------------------------------------------------------
// Rendering: rot hinterlegter Block, der sich an die Terminalbreite anpasst
// ---------------------------------------------------------------------------

interface BlockPart {
  text: string;
  /** true = roter Hintergrund ueber die volle Breite */
  bg: boolean;
}

function paint(line: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(line));
  return `${BG}${FG}${line}${" ".repeat(pad)}${RESET}`;
}

class ErrorBlock implements Component {
  private readonly parts: BlockPart[];
  private readonly paddingX: number;

  constructor(parts: BlockPart[], paddingX: number) {
    this.parts = parts;
    this.paddingX = paddingX;
  }

  render(width: number): string[] {
    const paddingX = Math.max(0, Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2))));
    const contentWidth = Math.max(1, width - paddingX * 2);
    const indent = " ".repeat(paddingX);
    const out: string[] = [];

    for (const part of this.parts) {
      for (const logical of part.text.split("\n")) {
        for (const segment of wrapTextWithAnsi(logical, contentWidth)) {
          const line = indent + segment;
          out.push(part.bg ? paint(line, width) : line);
        }
      }
    }

    return out.length > 0 ? out : [""];
  }
}

// ---------------------------------------------------------------------------
// Retry-Klassifikation (identisch zu Pi halten)
// ---------------------------------------------------------------------------

function verdict(raw: string): boolean | undefined {
  try {
    return isRetryableAssistantError({ role: "assistant", stopReason: "error", errorMessage: raw } as any);
  } catch {
    return undefined;
  }
}

/**
 * Liefert die Kurzzeile nur, wenn Pi danach dieselbe Retry-Entscheidung trifft.
 * Sonst undefined (Fehler bleibt roh).
 */
function safeShortMessage(details: ErrorDetails, parsedJson: boolean, raw: string): string | undefined {
  const want = verdict(raw);
  if (want === undefined) return undefined;

  const short = shortMessage(details, parsedJson, raw);
  if (verdict(short) === want) return short;

  // Reparatur: passenden Marker ergaenzen, damit die Klassifikation erhalten bleibt.
  for (const hint of want ? RETRYABLE_HINTS : NON_RETRYABLE_HINTS) {
    if (verdict(hint) !== want) continue;
    const repaired = `${short}\n${want ? `Status: transient (${hint})` : `Grund: ${hint}`}`;
    if (verdict(repaired) === want) return repaired;
  }

  return undefined;
}

// ---------------------------------------------------------------------------

const SAMPLE_ERROR =
  '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"deepseek/deepseek-v4.1-flash is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Fireworks","is_byok":false,"provider_error_code":"invalid_request_error","limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}}';

export default function (pi: ExtensionAPI) {
  /** Letzter, noch nicht abgeschlossener Fehler der aktuellen Ausfuehrung. */
  let pending: ErrorDetails | undefined;

  pi.registerEntryRenderer<ErrorDetails>(ENTRY_TYPE, (entry, options: EntryRenderOptions, theme) => {
    const data = entry.data;
    if (!data || !Array.isArray(data.lines)) return undefined;

    const parts: BlockPart[] = [{ text: data.lines.join("\n"), bg: useBackground }];

    // Vorschau: sieht sonst anders aus als der echte Fehler (Pi rendert dort die Fehlerzeile).
    if (data.preview) {
      parts.unshift({
        text: theme.fg("dim", `Error: ${shortMessage(data, true, data.raw)}`),
        bg: false,
      });
    }

    if (data.raw) {
      if (options.expanded) {
        parts.push({ text: "", bg: false });
        parts.push({ text: theme.fg("dim", "Rohdaten:"), bg: false });
        parts.push({ text: theme.fg("dim", data.raw), bg: false });
      } else {
        parts.push({ text: theme.fg("dim", "… Rohdaten ein-/ausblenden: ctrl+o"), bg: false });
      }
    }

    return new ErrorBlock(parts, 1);
  });

  pi.on("message_end", (event: MessageEndEvent) => {
    const message = event.message;
    if (message.role !== "assistant") return;

    // Erfolgreiche Antwort beendet den Fehlerfall (z. B. nach einem Retry).
    if (message.stopReason !== "error") {
      pending = undefined;
      return;
    }

    const raw = message.errorMessage?.trim();
    if (!raw) return;

    const details = buildDetails(raw, message.provider, message.model);
    pending = details;

    const short = safeShortMessage(details, parseError(raw).json !== undefined, raw);
    if (!short) return;

    return { message: { ...message, errorMessage: short } };
  });

  pi.on("agent_settled", () => {
    // Erst hier steht fest, dass kein Retry mehr folgt -> Rohdaten einmalig anhaengen.
    if (!pending) return;
    const details = pending;
    pending = undefined;
    pi.appendEntry(ENTRY_TYPE, details);
  });

  pi.registerCommand("apierrors", {
    description: "API-Fehler-Darstellung: /apierrors [preview|on|off]",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on" || arg === "off") {
        useBackground = arg === "on";
        ctx.ui.notify(`API-Fehler: roter Hintergrund ${useBackground ? "an" : "aus"}`, "info");
        return;
      }

      if (arg === "" || arg === "preview") {
        const details = buildDetails(SAMPLE_ERROR, "openrouter", "deepseek/deepseek-v4.1-flash");
        pi.appendEntry(ENTRY_TYPE, { ...details, preview: true });
        ctx.ui.notify("Beispiel-Fehlerblock angehaengt - ctrl+o zeigt die Rohdaten", "info");
        return;
      }

      ctx.ui.notify("Nutzung: /apierrors [preview|on|off]", "warning");
    },
  });
}

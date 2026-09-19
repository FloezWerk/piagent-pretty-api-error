/**
 * api-error-format
 *
 * Renders provider/API errors (e.g. OpenRouter 429 JSON payloads) in a readable
 * form instead of raw JSON:
 *  - the error line itself becomes a short headline ("✖  API error · HTTP 429 · rate limit")
 *    (two spaces after the icon: U+2716 is drawn as a 2-cell emoji in many terminals
 *     and would otherwise swallow the following space)
 *  - below it, a red detail panel is attached (as a session entry)
 *  - `ctrl+o` (app.tools.expand) toggles the raw data
 *
 * The detail panel is a CustomEntry and does NOT enter the LLM context.
 * Retry semantics stay untouched: Pi classifies errors via `message.errorMessage`
 * (isRetryableAssistantError). The short line is only applied when the
 * classification stays identical - otherwise the error is left raw.
 */

import type { EntryRenderOptions, ExtensionAPI, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";
import {
  Box,
  type Component,
  Container,
  getCapabilities,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const ENTRY_TYPE = "api-error-details";
const MAX_VALUE = 400;

// Bright text, readable on the dark red.
const FG = "\x1b[38;5;224m";
const RESET = "\x1b[39m\x1b[49m";

/**
 * Backgrounds for the main panel and the raw-data area.
 * Prefers 24-bit colors (WT_SESSION/COLORTERM/kitty/... -> trueColor); the
 * 256-color fallback only offers one dark red step (52), so the raw-data area
 * is set apart via its text color there.
 */
interface BlockPalette {
  panel: string;
  raw: string;
  rawFg: string;
}

function blockPalette(): BlockPalette {
  if (getCapabilities().trueColor) {
    return { panel: "\x1b[48;2;96;22;22m", raw: "\x1b[48;2;54;14;14m", rawFg: FG };
  }
  return { panel: "\x1b[48;5;52m", raw: "\x1b[48;5;52m", rawFg: "\x1b[38;5;181m" };
}

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
// Error -> data
// ---------------------------------------------------------------------------

interface ErrorDetails {
  /** Headline, e.g. "✖  API error · HTTP 429 · rate limit" */
  headline: string;
  /** Detail lines (without ANSI), wrapped inside the panel */
  lines: string[];
  /** Original error text (raw data) */
  raw: string;
  /** Preview only: includes the real error line in the render */
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
      ? `✖  API error · HTTP ${parsed.status} · ${category(parsed.status, raw)}`
      : `✖  API error · ${category(parsed.status, raw)}`;

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
  add("Reason: ", summary);
  if (upstream && upstream !== summary) add("Upstream: ", upstream);
  if (providerErrorCode || (code !== undefined && code !== parsed.status)) {
    add("Code: ", providerErrorCode ?? String(code));
  }
  add("Hint: ", hint);

  return { headline, lines, raw };
}

/** Short error line pointing to the detail panel. */
function shortMessage(details: ErrorDetails, parsedJson: boolean, raw: string): string {
  const suffix = parsedJson ? "" : ` · ${truncate(clean(raw) ?? raw, 60)}`;
  return `${details.headline}${suffix} · Details: ctrl+o`;
}

// ---------------------------------------------------------------------------
// Rendering: red panel that adapts to the terminal width
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const UNBOLD = "\x1b[22m";
const DIM = "\x1b[2m";
const BRIGHT = "\x1b[38;5;231m";

/** Background + text color for the whole panel (including padding). */
const panelBackground = (text: string) => `${blockPalette().panel}${FG}${text}${RESET}`;

/** Background + text color for the raw-data area (darker red). */
const rawBackground = (text: string) => {
  const palette = blockPalette();
  return `${palette.raw}${palette.rawFg}${text}${RESET}`;
};

type RowKind = "title" | "field" | "hint" | "plain";

/** `"raw": value` - for the hanging indent of wrapped JSON values. */
const KEY_VALUE_RE = /^"[^"]+"\s*:\s*/;

const spaces = (count: number) => " ".repeat(Math.max(0, count));

/**
 * Wrapping without the leading whitespace (PiTUI would otherwise break it off
 * as its own line) and without trailing spaces.
 */
function wrapSegments(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, width).map((segment) => segment.replace(/ +$/, ""));
}

interface BlockRow {
  kind: RowKind;
  /** Only for kind === "field": bold label, e.g. "Provider:" */
  label?: string;
  text: string;
}

/** "Provider: openrouter" -> label + value (for column alignment). */
const FIELD_RE = /^([A-Za-z][A-Za-z_-]{0,15}):[ \t]?(.*)$/;

/** Builds the detail panel rows from the stored detail lines. */
function panelRows(lines: string[], expanded: boolean): BlockRow[] {
  const rows: BlockRow[] = [{ kind: "title", text: lines[0] ?? "✖  API error" }];

  const fields: BlockRow[] = [];
  for (const line of lines.slice(1)) {
    const match = line.match(FIELD_RE);
    fields.push(
      match
        ? { kind: "field", label: `${match[1]}:`, text: match[2] }
        : { kind: "field", text: line },
    );
  }

  if (fields.length > 0) {
    rows.push({ kind: "plain", text: "" });
    rows.push(...fields);
  }

  rows.push({ kind: "plain", text: "" });
  rows.push({
    kind: "hint",
    text: expanded ? "ctrl+o · hide raw data" : "ctrl+o · show raw data",
  });

  return rows;
}

/**
 * Panel content: labels aligned in a column, wrapped values with a hanging indent.
 * Padding and background come from a `Box` around it.
 */
class ErrorBlock implements Component {
  private readonly rows: BlockRow[];

  constructor(rows: BlockRow[]) {
    this.rows = rows;
  }

  render(width: number): string[] {
    const contentWidth = Math.max(1, width);
    const labelWidth = this.rows.reduce(
      (max, row) => (row.kind === "field" && row.label ? Math.max(max, visibleWidth(row.label)) : max),
      0,
    );
    const gap = labelWidth > 0 ? 2 : 0;
    const out: string[] = [];

    for (const row of this.rows) {
      if (row.kind === "field" && row.label) {
        const labelPad = " ".repeat(Math.max(0, labelWidth - visibleWidth(row.label)) + gap);
        const hang = labelWidth + gap;
        const avail = Math.max(1, contentWidth - hang);
        wrapSegments(row.text, avail).forEach((segment, index) => {
          out.push(index === 0 ? `${BOLD}${row.label}${labelPad}${UNBOLD}${segment}` : `${spaces(hang)}${segment}`);
        });
        continue;
      }

      for (const logical of row.text.split("\n")) {
        const lead = logical.length - logical.trimStart().length;
        const content = logical.slice(lead);
        const prefix = logical.slice(0, lead);
        const lines: string[] = [];

        // `"key": value`: wrap below the value (like the label rows above),
        // otherwise the value would land on its own line below the key.
        const keyed = content.match(KEY_VALUE_RE);
        const key = keyed?.[0].trimEnd() ?? "";
        const hang = key ? visibleWidth(key) + 1 : Math.min(2, Math.max(0, contentWidth - lead - 8));
        const avail = contentWidth - lead - hang;

        if (keyed && keyed[0].length < content.length && avail >= 8) {
          const value = content.slice(keyed[0].length);
          wrapSegments(value, avail).forEach((segment, index) => {
            lines.push(index === 0 ? `${key} ${segment}` : `${spaces(hang)}${segment}`);
          });
        } else {
          const simpleHang = Math.min(2, Math.max(0, contentWidth - lead - 8));
          wrapSegments(content, Math.max(1, contentWidth - lead - simpleHang)).forEach((segment, index) => {
            lines.push(index === 0 ? segment : `${spaces(simpleHang)}${segment}`);
          });
        }

        for (const line of lines) {
          const full = prefix + line;
          if (row.kind === "title") out.push(`${BOLD}${BRIGHT}${full}${UNBOLD}`);
          else if (row.kind === "hint") out.push(`${DIM}${full}${UNBOLD}`);
          else out.push(full);
        }
      }
    }

    return out.length > 0 ? out : [""];
  }
}

/** Red panel with inner padding. */
function panel(rows: BlockRow[]): Component {
  const box = new Box(1, 1, useBackground ? panelBackground : undefined);
  box.addChild(new ErrorBlock(rows));
  return box;
}

/**
 * Raw data: attaches directly (without a gap) to the panel, same width, same
 * inner padding, but a darker red.
 */
function rawPanel(raw: RawView): Component {
  const box = new Box(1, 1, useBackground ? rawBackground : undefined);
  box.addChild(
    new ErrorBlock([
      { kind: "title", text: raw.json ? "Raw data (JSON):" : "Raw data:" },
      { kind: "plain", text: raw.text },
    ]),
  );
  return box;
}

// ---------------------------------------------------------------------------
// Make raw data readable (indent JSON)
// ---------------------------------------------------------------------------

/** Upper bound so a huge payload does not flood the block. */
const MAX_RAW_CHARS = 8000;

interface RawView {
  text: string;
  /** true = the text was recognized as JSON and indented */
  json: boolean;
}

/**
 * If the raw data contains JSON (e.g. `429: {"message":...}`), it is formatted
 * with a 2-character indent; a leading status stays as a headline. Without
 * parseable JSON the raw data stays unchanged.
 */
function formatRaw(raw: string): RawView {
  const trimmed = raw.trim();
  const start = trimmed.search(/[{[]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start === -1 || end <= start) return { text: raw, json: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return { text: raw, json: false };
  }

  const pretty = JSON.stringify(parsed, null, 2);
  if (typeof pretty !== "string") return { text: raw, json: false };

  const prefix = trimmed.slice(0, start).trim().replace(/[\s:–-]+$/, "");
  const body = prefix ? `${prefix}:\n${pretty}` : pretty;
  if (body.length > MAX_RAW_CHARS) {
    return { text: `${body.slice(0, MAX_RAW_CHARS)}\n… truncated (${body.length} chars)`, json: true };
  }

  return { text: body, json: true };
}

// ---------------------------------------------------------------------------
// Retry classification (kept identical to Pi)
// ---------------------------------------------------------------------------

function verdict(raw: string): boolean | undefined {
  try {
    return isRetryableAssistantError({ role: "assistant", stopReason: "error", errorMessage: raw } as any);
  } catch {
    return undefined;
  }
}

/**
 * Returns the short line only if Pi would make the same retry decision
 * afterwards. Otherwise undefined (error stays raw).
 */
function safeShortMessage(details: ErrorDetails, parsedJson: boolean, raw: string): string | undefined {
  const want = verdict(raw);
  if (want === undefined) return undefined;

  const short = shortMessage(details, parsedJson, raw);
  if (verdict(short) === want) return short;

  // Repair: append a suitable marker so the classification is preserved.
  for (const hint of want ? RETRYABLE_HINTS : NON_RETRYABLE_HINTS) {
    if (verdict(hint) !== want) continue;
    const repaired = `${short}\n${want ? `Status: transient (${hint})` : `Reason: ${hint}`}`;
    if (verdict(repaired) === want) return repaired;
  }

  return undefined;
}

// ---------------------------------------------------------------------------

const SAMPLE_ERROR =
  '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"deepseek/deepseek-v4.1-flash is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Fireworks","is_byok":false,"provider_error_code":"invalid_request_error","limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key (https://openrouter.ai/settings/integrations), or route to another provider with provider routing: https://openrouter.ai/docs/features/provider-routing"}}';

export default function (pi: ExtensionAPI) {
  /** Most recent, not yet settled error of the current run. */
  let pending: ErrorDetails | undefined;

  pi.registerEntryRenderer<ErrorDetails>(ENTRY_TYPE, (entry, options: EntryRenderOptions, theme) => {
    const data = entry.data;
    if (!data || !Array.isArray(data.lines)) return undefined;

    const parts: Component[] = [];

    // Preview: otherwise it would look different from a real error (Pi renders the error line there).
    if (data.preview) {
      parts.push(new Text(theme.fg("dim", `Error: ${shortMessage(data, true, data.raw)}`), 1, 0));
    }

    parts.push(panel(panelRows(data.lines, options.expanded)));

    if (data.raw && options.expanded) {
      parts.push(rawPanel(formatRaw(data.raw)));
    }

    if (parts.length === 1) return parts[0];

    const container = new Container();
    for (const part of parts) container.addChild(part);
    return container;
  });

  pi.on("message_end", (event: MessageEndEvent) => {
    const message = event.message;
    if (message.role !== "assistant") return;

    // A successful answer ends the error state (e.g. after a retry).
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
    // Only here it is certain that no retry follows -> attach the raw data once.
    if (!pending) return;
    const details = pending;
    pending = undefined;
    pi.appendEntry(ENTRY_TYPE, details);
  });

  pi.registerCommand("apierrors", {
    description: "API error display: /apierrors [preview|on|off]",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on" || arg === "off") {
        useBackground = arg === "on";
        ctx.ui.notify(`API errors: red background ${useBackground ? "on" : "off"}`, "info");
        return;
      }

      if (arg === "" || arg === "preview") {
        const details = buildDetails(SAMPLE_ERROR, "openrouter", "deepseek/deepseek-v4.1-flash");
        pi.appendEntry(ENTRY_TYPE, { ...details, preview: true });
        ctx.ui.notify("Sample error block appended - ctrl+o shows the raw data", "info");
        return;
      }

      ctx.ui.notify("Usage: /apierrors [preview|on|off]", "warning");
    },
  });
}

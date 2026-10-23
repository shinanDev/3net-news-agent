// Minimal client for the Meterless Nightshift runtime (OpenAI-compatible chat completions).
// One retry on timeout, network error or HTTP 5xx. Errors never contain the token or headers.

import { USER_AGENT } from "../../config.ts";

export interface NightshiftConfig {
  baseUrl: string;
  token: string;
  model: string;
  app: string;
  scope: string;
  /** Default 60 s per HTTP call. */
  timeoutMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  /** Model id reported in the response. */
  model: string | null;
  /** Duration of each HTTP call, including a failed first one. */
  callDurationsMs: number[];
}

export class NightshiftError extends Error {
  override name = "NightshiftError";
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly callDurationsMs: number[] = [],
  ) {
    super(message);
  }
}

export class NightshiftClient {
  constructor(
    private readonly config: NightshiftConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get model(): string {
    return this.config.model;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const durations: number[] = [];
    try {
      return await this.call(messages, durations);
    } catch (err) {
      if (!(err instanceof NightshiftError) || !err.retryable) throw withDurations(err, durations);
      try {
        return await this.call(messages, durations);
      } catch (retryErr) {
        throw withDurations(retryErr, durations, "after 1 retry");
      }
    }
  }

  private async call(messages: ChatMessage[], durations: number[]): Promise<ChatResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const started = Date.now();
    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "meterless-app": this.config.app,
          "meterless-scope": this.config.scope,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ model: this.config.model, messages, temperature: 0 }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      });
      text = await res.text();
    } catch (err) {
      durations.push(Date.now() - started);
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new NightshiftError(`request to ${url} failed (${reason})`, true);
    }
    durations.push(Date.now() - started);
    if (!res.ok) {
      throw new NightshiftError(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`, res.status >= 500);
    }
    let body: { model?: unknown; choices?: { message?: { content?: unknown } }[] };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new NightshiftError(`response from ${url} is not JSON: ${text.slice(0, 300)}`, false);
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new NightshiftError(`response from ${url} has no message content`, false);
    }
    return {
      content,
      model: typeof body.model === "string" ? body.model : null,
      callDurationsMs: [...durations],
    };
  }
}

function withDurations(err: unknown, durations: number[], suffix?: string): NightshiftError {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = err instanceof NightshiftError && err.retryable;
  return new NightshiftError(suffix ? `${message} (${suffix})` : message, retryable, [...durations]);
}

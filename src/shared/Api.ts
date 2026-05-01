import axios, { AxiosInstance } from "axios";

const root = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");

export const SUPABASE_FUNCTIONS_BASE = `${root}/functions/v1`;
export const GEMINI_PROXY_URL = `${SUPABASE_FUNCTIONS_BASE}/gemini-proxy`;
export const CLAUDE_PROXY_URL = `${SUPABASE_FUNCTIONS_BASE}/claude-proxy`;

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-preview-04-17";

/** `contents[].parts[]` entry: matches gemini-proxy curl (`{ "text": "..." }` only). */
export type GeminiProxyPart = { text: string };

export type GeminiProxyContent = { parts: GeminiProxyPart[] };

/** gemini-proxy JSON body — only `model` and `contents` (same shape as the working curl). */
export type GeminiProxyRequest = { model: string; contents: GeminiProxyContent[] };

/** Single message in a claude-proxy request (Anthropic-style role + content). */
export type ClaudeProxyMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * claude-proxy JSON body — `proactive`, optional `guide`, `max_tokens`, and `messages`
 * (same family as the working curl; add `guide: true` for Guide Mode plans).
 */
export type ClaudeProxyRequest = {
  proactive: boolean;
  /** When true, proxy returns a JSON array of guide steps (see Guide Mode). */
  guide?: boolean;
  max_tokens: number;
  messages: ClaudeProxyMessage[];
};

export function supabaseHeaders(): Record<string, string> {
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    apikey: key,
  };
}

class API {
  instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: SUPABASE_FUNCTIONS_BASE,
      headers: supabaseHeaders(),
    });
  }

  async geminiProxy(body: GeminiProxyRequest) {
    return this.instance.post(GEMINI_PROXY_URL, body);
  }

  async claudeProxy(body: ClaudeProxyRequest) {
    return this.instance.post(CLAUDE_PROXY_URL, body);
  }
}

const api = new API();
export default api;

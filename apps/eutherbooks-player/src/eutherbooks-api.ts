import { AppSettings, Book, Chapter, Health, Job, ModelBackend, Voice } from "./types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const requestTimeoutMs = 3500;

export class EutherBooksApi {
  constructor(private readonly baseUrl: string, private readonly authToken = "") {}

  static async status(baseUrl: string, authToken: string): Promise<{ authenticated: boolean; user: string; lanServerUrl?: string }> {
    const response = await requestJson(`${hostBaseUrl(baseUrl)}/api/app/status`, {
      headers: {
        "content-type": "application/json",
        "X-Euther-App-Token": authToken,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
    }
    return response.json() as Promise<{ authenticated: boolean; user: string; lanServerUrl?: string }>;
  }

  static async login(baseUrl: string, username: string, password: string): Promise<{ token: string; user: string; lanServerUrl?: string }> {
    const response = await requestJson(`${hostBaseUrl(baseUrl)}/api/app/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
    }
    return response.json() as Promise<{ token: string; user: string; lanServerUrl?: string }>;
  }

  async health(): Promise<Health> {
    return this.json<Health>("/health");
  }

  async voices(): Promise<Voice[]> {
    return this.json<Voice[]>("/voices");
  }

  async books(): Promise<Book[]> {
    return this.json<Book[]>("/books");
  }

  async chapters(bookId: string): Promise<Chapter[]> {
    return this.json<Chapter[]>(`/books/${encodeURIComponent(bookId)}/chapters`);
  }

  async jobs(): Promise<Job[]> {
    return this.json<Job[]>("/jobs");
  }

  async job(jobId: string): Promise<Job> {
    return this.json<Job>(`/jobs/${encodeURIComponent(jobId)}`);
  }

  async createJob(
    bookId: string,
    chapterIndex: number,
    settings: AppSettings,
    voice: Voice | null,
    cancelExisting = true,
    forceRegenerate = true,
  ): Promise<Job> {
    const options = jobOptions(settings, voice);
    return this.json<Job>(`/books/${encodeURIComponent(bookId)}/tts`, {
      method: "POST",
      body: JSON.stringify({
        chapters: [chapterIndex],
        voice: settings.voiceId,
        language: voiceLanguage(settings.voiceId),
        model_backend: settings.modelBackend,
        owner: "eutherbooks-player",
        cancel_existing: cancelExisting,
        force_regenerate: forceRegenerate,
        ...options,
      }),
    });
  }

  async reportPlayerLog(payload: Record<string, unknown>): Promise<void> {
    const errors: string[] = [];
    for (const baseUrl of hostReportCandidates(this.baseUrl)) {
      try {
        const response = await requestJson(`${baseUrl}/api/eutherbooks-player/log`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.authToken ? { "X-Euther-App-Token": this.authToken } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          return;
        }
        const text = await response.text().catch(() => "");
        errors.push(`${baseUrl}: ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
      } catch (err) {
        errors.push(`${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(errors.join(" | ") || "No report endpoint available");
  }

  audioUrl(path: string): string {
    return `${this.baseUrl}/audio/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const requestInit = {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.authToken ? { "X-Euther-App-Token": this.authToken } : {}),
        ...(init.headers ?? {}),
      },
    };
    const response = await requestJson(`${this.baseUrl}${path}`, requestInit);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
    }
    return response.json() as Promise<T>;
  }
}

function hostBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.pathname === "/eutherbooks" || url.pathname.startsWith("/eutherbooks/")) {
    url.pathname = "";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function jobOptions(settings: AppSettings, voice: Voice | null): Record<string, number | string> {
  const options: Record<string, number | string> = {};
  if (typeof voice?.default_length_scale === "number") {
    options.length_scale = voice.default_length_scale;
  }
  if (typeof voice?.default_seed === "number") {
    options.seed = voice.default_seed;
  }
  if (settings.modelBackend === "dots.tts-mf" || settings.modelBackend === "dots.tts-soar") {
    options.cfg_value = 2.8;
    options.inference_timesteps = 13;
    options.dots_template_name = "tts";
    options.dots_ode_method = "euler";
    options.dots_num_steps = settings.modelBackend === "dots.tts-mf" ? 4 : 10;
    options.dots_guidance_scale = 1.2;
    options.dots_speaker_scale = 1.5;
    options.dots_max_generate_length = 500;
    options.max_chunk_chars = 520;
  }
  return options;
}

function hostReportCandidates(baseUrl: string): string[] {
  const candidates: string[] = [];
  try {
    const url = new URL(hostBaseUrl(baseUrl));
    candidates.push(url.toString().replace(/\/+$/, ""));
    if (url.hostname === "192.168.32.186" && url.port === "8088") {
      url.port = "8080";
      candidates.push(url.toString().replace(/\/+$/, ""));
    }
  } catch (_err) {
  }
  candidates.push("http://192.168.32.186:8080", "https://apothictech.se");
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    candidates.push(window.location.origin.replace(/\/+$/, ""));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function requestJson(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const requestInit = { ...init, signal: controller.signal };
  const request = window.__TAURI_INTERNALS__
    ? tauriFetch(url, requestInit)
    : fetch(url, { ...requestInit, credentials: "include" });
  let timeoutId = 0;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function voicesForModel(voices: Voice[], modelBackend: ModelBackend): Voice[] {
  return voices.filter((voice) => !voice.model_backend || voice.model_backend === modelBackend);
}

function voiceLanguage(voiceId: string): "sv" | "en" {
  return voiceId.includes("-en") || voiceId.endsWith("en") ? "en" : "sv";
}

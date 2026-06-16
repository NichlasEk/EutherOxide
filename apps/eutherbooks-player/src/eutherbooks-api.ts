import { AppSettings, Book, Chapter, Health, Job, ModelBackend, Voice } from "./types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export class EutherBooksApi {
  constructor(private readonly baseUrl: string) {}

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

  async createJob(bookId: string, chapterIndex: number, settings: AppSettings, cancelExisting = true): Promise<Job> {
    return this.json<Job>(`/books/${encodeURIComponent(bookId)}/tts`, {
      method: "POST",
      body: JSON.stringify({
        chapters: [chapterIndex],
        voice: settings.voiceId,
        language: voiceLanguage(settings.voiceId),
        model_backend: settings.modelBackend,
        owner: "eutherbooks-player",
        cancel_existing: cancelExisting,
      }),
    });
  }

  audioUrl(path: string): string {
    return `${this.baseUrl}/audio/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const requestInit = {
      ...init,
      headers: {
        "content-type": "application/json",
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

async function requestJson(url: string, init: RequestInit): Promise<Response> {
  if (window.__TAURI_INTERNALS__) {
    return tauriFetch(url, init);
  }
  return fetch(url, { ...init, credentials: "include" });
}

export function voicesForModel(voices: Voice[], modelBackend: ModelBackend): Voice[] {
  return voices.filter((voice) => !voice.model_backend || voice.model_backend === modelBackend);
}

function voiceLanguage(voiceId: string): "sv" | "en" {
  return voiceId.includes("-en") || voiceId.endsWith("en") ? "en" : "sv";
}

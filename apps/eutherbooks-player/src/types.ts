export type Book = {
  id: string;
  title: string;
  author?: string;
  format?: string;
};

export type Chapter = {
  index: number;
  title: string;
  char_count?: number;
};

export type Voice = {
  id: string;
  label: string;
  language: string;
  backend: string;
  path: string;
  model_backend?: ModelBackend | string | null;
  default_length_scale?: number | null;
  default_seed?: number | null;
};

export type ModelBackend = "voxcpm2" | "dots.tts-soar" | "dots.tts-mf";

export type JobStatus = "queued" | "running" | "done" | "failed" | string;

export type Job = {
  id: string;
  book_id: string;
  status: JobStatus;
  language: string;
  voice: string;
  chapter_indexes: number[];
  owner: string;
  audio_files: string[];
  audio_durations: number[];
  total_audio_files: number;
  tts_options: Record<string, number | string | boolean | null>;
  progress_label: string;
  progress_detail: string;
  current_chapter_index: number | null;
  current_chunk_index: number;
  worker_progress: number;
  total_chunks: number;
  error: string | null;
};

export type Health = {
  status: string;
  tts_backend: string;
  storage?: {
    audio_dir: string;
    audio_free_bytes: number;
    audio_total_bytes: number;
    audio_used_bytes: number;
  };
  eutherlink?: {
    ok: boolean;
    queued_or_running?: number;
    dots_tts?: {
      ok: boolean;
      status: string;
      model_loaded: boolean;
      loaded_model?: string;
      precision?: string;
    } | null;
  } | null;
};

export type ServerRouteConfig = {
  publicServerUrl?: string;
  lanServerUrl?: string;
  serverUrls: string[];
  eutherbooksUrls: string[];
  updatedAt?: string;
};

export type AppSettings = {
  serverUrl: string;
  username: string;
  authToken: string;
  voiceId: string;
  modelBackend: ModelBackend;
  autoPlay: boolean;
  autoNext: boolean;
  autoBookmark: boolean;
  cacheAudio: boolean;
  sleepTimerMinutes: number;
};

export type PlaybackSession = {
  bookId: string;
  chapterIndex: number;
  jobId: string;
  audioFiles: string[];
  durations: number[];
  currentIndex: number;
  currentSeconds: number;
  generatedSeconds: number;
  totalParts: number;
};

export type Bookmark = {
  id: string;
  bookId: string;
  chapterIndex: number;
  modelBackend: ModelBackend;
  voiceId: string;
  positionSeconds: number;
  partIndex: number;
  partSeconds: number;
  label: string;
  auto: boolean;
  updatedAt: string;
};

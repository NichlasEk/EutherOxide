import { Job, PlaybackSession } from "./types";

export function sessionFromJob(job: Job, previous?: PlaybackSession | null): PlaybackSession {
  const audioFiles = job.audio_files.filter((path) => !path.includes(".stream-"));
  const durations = audioFiles.map((_, index) => cleanDuration(job.audio_durations[index]));
  const currentIndex = Math.min(previous?.currentIndex ?? 0, Math.max(0, audioFiles.length - 1));
  const currentSeconds = previous?.jobId === job.id ? previous.currentSeconds : 0;
  return {
    bookId: job.book_id,
    chapterIndex: job.chapter_indexes[0] ?? 0,
    jobId: job.id,
    audioFiles,
    durations,
    currentIndex,
    currentSeconds,
    generatedSeconds: durations.reduce((sum, duration) => sum + duration, 0),
    totalParts: Math.max(job.total_audio_files, job.total_chunks, audioFiles.length),
  };
}

export function sessionPosition(session: PlaybackSession): number {
  return session.durations.slice(0, session.currentIndex).reduce((sum, duration) => sum + duration, 0)
    + session.currentSeconds;
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function cleanDuration(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : 0;
}

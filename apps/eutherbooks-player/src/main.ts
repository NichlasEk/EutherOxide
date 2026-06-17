import "./styles.css";

import {
  audioCacheState,
  clearAudioCache,
  playableAudioUrl,
  prefetchAudio,
  refreshAudioCacheState,
  setAudioCacheEnabled,
} from "./audio-cache";
import { EutherBooksApi, voicesForModel } from "./eutherbooks-api";
import { installMediaSessionControls, updateMediaSession } from "./media-session";
import {
  canUseNativeAudio,
  nativeAudioState,
  pauseNativeAudio,
  playNativeAudioQueue,
  refreshNativeAudioState,
  seekNativeAudio,
  stopNativeAudio,
} from "./native-audio";
import type { NativeAudioState } from "./native-audio";
import { formatTime, sessionFromJob, sessionPosition } from "./playback-session";
import { bookmarkKey, cleanServerUrl, loadBookmarks, loadSettings, saveBookmark, saveSettings, serverCandidates } from "./storage";
import { AppSettings, Book, Bookmark, Chapter, Health, Job, PlaybackSession, Voice } from "./types";
import { setPlaybackWakeLock, wakeLockStatus } from "./wake-lock";

const root = document.querySelector<HTMLDivElement>("#app");
const minAutoNextFreeBytes = 512 * 1024 * 1024;

if (!root) {
  throw new Error("Missing #app root");
}
const appRoot = root;

let settings = loadSettings();
let api = new EutherBooksApi(settings.serverUrl, settings.authToken);
let health: Health | null = null;
let books: Book[] = [];
let chapters: Chapter[] = [];
let voices: Voice[] = [];
let selectedBookId = localStorage.getItem("eutherbooks-player-book") ?? "";
let selectedChapterIndex = Number(localStorage.getItem("eutherbooks-player-chapter") ?? 0);
let currentJob: Job | null = null;
let nextJob: Job | null = null;
let nextJobKey = "";
let nextJobRequestInFlight = false;
let session: PlaybackSession | null = null;
let statusText = "Ready";
let endpointText = "";
let errorText = "";
let lastEndpointErrors: string[] = [];
let pollTimer: number | null = null;
let sleepTimer: number | null = null;
let sleepDeadline = 0;
let userPausedPlayback = false;
let lastPlaybackEvent = "Idle";
let mediaSessionStatus = "Media Session pending";
let interactionLockUntil = 0;
let queuedRender = false;
let activeSelectControl = false;
let advancingPlayback = false;
let playbackWatchTimer: number | null = null;
let fallbackRefreshRunning = false;
let nativePlaybackActive = false;
let lastAutoBookmarkAt = 0;
let lastBugReportKey = "";
const audio = new Audio();

audio.preload = "auto";
audio.addEventListener("ended", () => void playNextPartOrChapter());
audio.addEventListener("timeupdate", () => {
  if (!session) {
    return;
  }
  session.currentSeconds = audio.currentTime;
  maybeSaveAutoBookmark();
  updatePlayerShell();
  maybeAdvanceNearPartEnd();
  void maybeEnsureNextAhead("timeupdate");
});
audio.addEventListener("error", () => {
  errorText = audio.error?.message || "Audio playback failed";
  render();
});
audio.addEventListener("pause", () => {
  updateAppMediaSession();
  updatePlayerShell();
});
audio.addEventListener("play", () => {
  updateAppMediaSession();
  updatePlayerShell();
});

render();
mediaSessionStatus = installMediaSessionControls({
  play: () => void playFromSession("manual"),
  pause: () => {
    stopPlayback(true, true);
    statusText = "Paused";
    render();
  },
  next: () => void playNextPartOrChapter(),
  previous: () => void playPreviousPart(),
  seekBy,
  seekTo: seekToSessionPosition,
});
setAudioCacheEnabled(settings.cacheAudio);
void boot();

async function boot(): Promise<void> {
  await refreshAudioCacheState();
  await refreshNativeAudioState();
  await refreshAll();
  schedulePoll(600);
}

async function refreshAll(): Promise<void> {
  statusText = "Connecting";
  errorText = "";
  lastEndpointErrors = [];
  render();
  const candidates = serverCandidates(settings.serverUrl);
  for (const candidate of candidates) {
    try {
      await refreshSavedLogin(candidate);
      api = new EutherBooksApi(candidate, settings.authToken);
      endpointText = candidate;
      const [nextHealth, nextVoices, nextBooks, jobs] = await Promise.all([
        api.health(),
        api.voices(),
        api.books(),
        api.jobs(),
      ]);
      health = nextHealth;
      voices = nextVoices;
      books = nextBooks;
      if (settings.serverUrl !== candidate) {
        updateSettings({ ...settings, serverUrl: candidate });
      }
      selectedBookId ||= books[0]?.id ?? "";
      await loadChapters();
      attachExistingJob(jobs);
      statusText = "Connected";
      errorText = "";
      lastEndpointErrors = [];
      render();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed";
      lastEndpointErrors.push(`${candidate}: ${message}`);
    }
  }
  health = null;
  endpointText = "";
  errorText = `All endpoints failed. ${lastEndpointErrors.join(" | ")}`;
  render();
}

async function refreshSavedLogin(serverUrl: string): Promise<void> {
  if (!settings.authToken || !serverUrl.includes("/eutherbooks")) {
    return;
  }
  try {
    const status = await EutherBooksApi.status(serverUrl, settings.authToken);
    if (status.authenticated && status.user && status.user !== settings.username) {
      updateSettings({ ...settings, username: status.user });
    }
  } catch (err) {
    if (serverUrl === settings.serverUrl) {
      updateSettings({ ...settings, authToken: "" });
      errorText = err instanceof Error ? `Saved login expired: ${err.message}` : "Saved login expired";
    }
    throw err;
  }
}

async function loadChapters(): Promise<void> {
  if (!selectedBookId) {
    chapters = [];
    return;
  }
  chapters = await api.chapters(selectedBookId);
  if (!chapters.some((chapter) => chapter.index === selectedChapterIndex)) {
    selectedChapterIndex = chapters[0]?.index ?? 0;
  }
}

function attachExistingJob(jobs: Job[]): void {
  const matching = jobs
    .filter((job) =>
      job.book_id === selectedBookId
      && job.chapter_indexes.includes(selectedChapterIndex)
      && job.voice === settings.voiceId
      && job.tts_options?.model_backend === settings.modelBackend
      && (job.status === "queued" || job.status === "running" || job.audio_files.length > 0)
    )
    .reverse();
  const playable = matching.find((job) => job.audio_files.length > 0);
  currentJob = playable ?? matching[0] ?? currentJob;
  if (currentJob) {
    session = sessionFromJob(currentJob, session);
    applyBookmarkToSession();
    warmAudioCacheForSession();
    void maybeEnsureNextAhead("attach");
  }
}

async function generateCurrentChapter(cancelExisting = true): Promise<void> {
  if (!selectedBookId) {
    return;
  }
  userPausedPlayback = false;
  nextJob = null;
  nextJobKey = "";
  stopPlayback(false);
  statusText = "Starting generation";
  lastPlaybackEvent = "Generating current chapter";
  render();
  try {
    currentJob = await api.createJob(selectedBookId, selectedChapterIndex, settings, selectedVoice(), cancelExisting);
    session = currentJob.audio_files.length ? sessionFromJob(currentJob, session) : null;
    applyBookmarkToSession();
    warmAudioCacheForSession();
    schedulePoll(250);
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Could not create job";
  }
  render();
}

async function pollJobs(): Promise<void> {
  pollTimer = null;
  try {
    if (currentJob) {
      currentJob = await api.job(currentJob.id);
      session = sessionFromJob(currentJob, session);
      warmAudioCacheForSession();
      if (settings.autoPlay && !userPausedPlayback && isPlaybackPaused() && currentJob.audio_files.length > 0 && currentJob.status !== "failed") {
        await playFromSession("auto");
      }
      void maybeEnsureNextAhead("poll-current");
    }
    if (nextJob) {
      nextJob = await api.job(nextJob.id);
      warmAudioCacheForJob(nextJob);
    }
    statusText = currentJob ? currentJob.progress_label || currentJob.status : "Ready";
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Poll failed";
    if (!fallbackRefreshRunning) {
      fallbackRefreshRunning = true;
      try {
        await refreshAll();
      } finally {
        fallbackRefreshRunning = false;
      }
      return;
    }
  }
  render();
  if (currentJob && currentJob.status !== "done" && currentJob.status !== "failed") {
    schedulePoll(900);
  } else if (nextJob && nextJob.status !== "done" && nextJob.status !== "failed") {
    schedulePoll(1400);
  }
}

function schedulePoll(delayMs: number): void {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
  }
  pollTimer = window.setTimeout(() => void pollJobs(), delayMs);
}

async function ensureNextJob(): Promise<void> {
  const nextChapter = chapterAfter(selectedChapterIndex);
  const targetKey = playbackKey(selectedBookId, nextChapter?.index ?? -1, settings.modelBackend, settings.voiceId);
  if (nextJobRequestInFlight || !settings.autoNext || !selectedBookId || !nextChapter || !currentJob || !sessionMatchesCurrentSelection()) {
    return;
  }
  if (nextJob && nextJobKey === targetKey && nextJob.status !== "failed") {
    return;
  }
  if (nextJob && nextJobKey !== targetKey) {
    nextJob = null;
    nextJobKey = "";
  }
  if (currentJob.status !== "done") {
    return;
  }
  nextJobRequestInFlight = true;
  try {
    health = await api.health();
    if (!hasEnoughDiskForAutoNext()) {
      statusText = "Auto-next held: low audio disk space";
      return;
    }
    const jobs = await api.jobs();
    if (hasMoreImportantActiveJob(jobs)) {
      statusText = "Auto-next waiting for active speech job";
      schedulePoll(1500);
      return;
    }
    nextJob = await api.createJob(selectedBookId, nextChapter.index, settings, selectedVoice(), false, false);
    nextJobKey = targetKey;
    warmAudioCacheForJob(nextJob);
    lastPlaybackEvent = `Queued next: ${chapterLabel(nextChapter)}`;
    schedulePoll(1000);
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Could not queue next chapter";
  } finally {
    nextJobRequestInFlight = false;
  }
}

async function maybeEnsureNextAhead(reason: string): Promise<void> {
  if (!settings.autoNext || !currentJob || currentJob.status !== "done" || !sessionMatchesCurrentSelection()) {
    return;
  }
  if (!session || session.audioFiles.length === 0) {
    return;
  }
  const nextChapter = chapterAfter(selectedChapterIndex);
  if (!nextChapter) {
    return;
  }
  lastPlaybackEvent = lastPlaybackEvent === "Idle" ? `Auto-next check: ${reason}` : lastPlaybackEvent;
  await ensureNextJob();
}

async function playFromSession(mode: "manual" | "auto" = "manual"): Promise<void> {
  if (mode === "auto" && userPausedPlayback) {
    lastPlaybackEvent = "Auto-play held by manual pause";
    return;
  }
  if (!session || session.audioFiles.length === 0) {
    lastPlaybackEvent = "No playable audio loaded";
    return;
  }
  const path = session.audioFiles[session.currentIndex];
  if (!path) {
    lastPlaybackEvent = "No audio part at current position";
    return;
  }
  if (await canUseNativeAudio()) {
    await playFromNativeSession(mode);
    return;
  }
  await maybeReportNativeAudioIssue("native-unavailable-before-play");
  const url = await playableAudioUrl(api.audioUrl(path));
  const targetTime = session.currentSeconds;
  const sourceChanged = audio.src !== url;
  if (sourceChanged) {
    audio.src = url;
  }
  applyAudioOffset(targetTime, sourceChanged);
  if (mode === "manual") {
    userPausedPlayback = false;
  }
  await audio.play();
  void maybeEnsureNextAhead("play");
  await setPlaybackWakeLock(true);
  statusText = "Playing";
  lastPlaybackEvent = mode === "auto" ? "Auto-play resumed" : "Manual play";
  scheduleSleepTimer();
  startPlaybackWatchdog();
  updateAppMediaSession();
  render();
}

async function playFromNativeSession(mode: "manual" | "auto" = "manual"): Promise<void> {
  if (!session || session.audioFiles.length === 0) {
    return;
  }
  const book = selectedBook();
  const chapter = selectedChapter();
  const queue = session.audioFiles.map((candidate) => api.audioUrl(candidate));
  if (mode === "manual") {
    userPausedPlayback = false;
  }
  audio.pause();
  const state = await playNativeAudioQueue(
    queue,
    session.currentIndex,
    session.currentSeconds,
    book?.title ?? "EutherBooks",
    chapter ? chapterLabel(chapter) : "Audiobook",
  );
  nativePlaybackActive = state.available && (state.active || state.playing || state.lastEvent.toLowerCase().includes("requested"));
  applyNativeAudioState(state);
  await maybeReportNativeAudioIssue("native-play-request");
  if (state.error || !nativePlaybackActive) {
    const url = await playableAudioUrl(api.audioUrl(session.audioFiles[session.currentIndex]));
    audio.src = url;
    applyAudioOffset(session.currentSeconds, true);
    await audio.play();
    lastPlaybackEvent = "Native failed; browser fallback playing";
  }
  await setPlaybackWakeLock(true);
  statusText = "Playing";
  if (!lastPlaybackEvent.includes("fallback")) {
    lastPlaybackEvent = mode === "auto" ? "Native auto-play resumed" : "Native manual play";
  }
  void maybeEnsureNextAhead("native-play");
  scheduleSleepTimer();
  startPlaybackWatchdog();
  updateAppMediaSession();
  render();
}

function maybeAdvanceNearPartEnd(): void {
  if (nativePlaybackActive) {
    return;
  }
  if (advancingPlayback || !session || audio.paused || !Number.isFinite(audio.duration) || audio.duration <= 0) {
    return;
  }
  if (audio.duration - audio.currentTime > 0.08) {
    return;
  }
  if (session.currentIndex + 1 >= session.audioFiles.length && currentJob?.status !== "done") {
    schedulePoll(250);
    return;
  }
  advancingPlayback = true;
  void playNextPartOrChapter().finally(() => {
    window.setTimeout(() => {
      advancingPlayback = false;
    }, 250);
  });
}

function applyAudioOffset(seconds: number, sourceChanged: boolean): void {
  if (seconds <= 0) {
    return;
  }
  const apply = () => {
    try {
      audio.currentTime = seconds;
    } catch (_err) {
      // Some WebView builds reject seeks until metadata is available.
    }
  };
  if (sourceChanged) {
    audio.addEventListener("loadedmetadata", apply, { once: true });
  }
  apply();
}

async function playNextPartOrChapter(): Promise<void> {
  if (!session) {
    return;
  }
  if (session.currentIndex + 1 < session.audioFiles.length) {
    session.currentIndex += 1;
    session.currentSeconds = 0;
    await playFromSession("auto");
    return;
  }
  if (currentJob?.status !== "done") {
    statusText = "Buffering final audio";
    schedulePoll(300);
    render();
    return;
  }
  if (!settings.autoNext) {
    statusText = "Chapter complete";
    render();
    return;
  }
  if (!nextJob) {
    await ensureNextJob();
  }
  if (nextJob?.audio_files.length) {
    selectedChapterIndex = nextJob.chapter_indexes[0] ?? selectedChapterIndex;
    persistSelection();
    currentJob = nextJob;
    nextJob = null;
    session = sessionFromJob(currentJob);
    await playFromSession("auto");
    return;
  }
  statusText = "Waiting for next chapter";
  schedulePoll(1000);
  render();
}

async function playPreviousPart(): Promise<void> {
  if (!session) {
    return;
  }
  const currentSeconds = nativePlaybackActive ? session.currentSeconds : audio.currentTime;
  if (currentSeconds > 4 || session.currentIndex === 0) {
    session.currentSeconds = 0;
    if (nativePlaybackActive) {
      await seekNativeAudio(session.currentIndex, 0).then(applyNativeAudioState);
    } else {
      audio.currentTime = 0;
    }
  } else {
    session.currentIndex -= 1;
    session.currentSeconds = 0;
    await playFromSession(isPlaybackPaused() ? "manual" : "auto");
  }
  updateAppMediaSession();
  render();
}

function seekBy(seconds: number): void {
  seekToSessionPosition((session ? sessionPosition(session) : 0) + seconds);
}

function seekToSessionPosition(seconds: number): void {
  if (!session) {
    return;
  }
  const target = Math.max(0, Math.min(seconds, Math.max(0, session.generatedSeconds - 0.25)));
  let elapsed = 0;
  for (let index = 0; index < session.durations.length; index += 1) {
    const duration = session.durations[index] || 0;
    if (target <= elapsed + duration || index === session.durations.length - 1) {
      session.currentIndex = index;
      session.currentSeconds = Math.max(0, target - elapsed);
      if (nativePlaybackActive) {
        void seekNativeAudio(session.currentIndex, session.currentSeconds)
          .then((state) => {
            applyNativeAudioState(state);
            updatePlayerShell();
          });
        return;
      }
      audio.currentTime = session.currentSeconds;
      void playFromSession(isPlaybackPaused() ? "manual" : "auto");
      return;
    }
    elapsed += duration;
  }
}

function stopPlayback(savePosition: boolean, manual = false): void {
  if (savePosition && session && !nativePlaybackActive) {
    session.currentSeconds = audio.currentTime;
  }
  if (savePosition) {
    maybeSaveAutoBookmark(true);
  }
  if (manual) {
    userPausedPlayback = true;
    lastPlaybackEvent = "Manual pause";
  } else if (!savePosition) {
    lastPlaybackEvent = "Playback stopped";
  }
  if (nativePlaybackActive) {
    const action = savePosition ? pauseNativeAudio : stopNativeAudio;
    void action().then((state) => {
      applyNativeAudioState(state);
      updatePlayerShell();
    });
  } else {
    audio.pause();
  }
  void setPlaybackWakeLock(false).then(() => {
    updatePlayerShell();
  });
  stopPlaybackWatchdog();
  clearSleepTimer();
  updateAppMediaSession();
}

function startPlaybackWatchdog(): void {
  if (playbackWatchTimer !== null) {
    return;
  }
  playbackWatchTimer = window.setInterval(() => {
    if (nativePlaybackActive) {
      void refreshNativePlayback();
    } else {
      maybeAdvanceNearPartEnd();
    }
  }, 500);
}

function stopPlaybackWatchdog(): void {
  if (playbackWatchTimer !== null) {
    window.clearInterval(playbackWatchTimer);
  }
  playbackWatchTimer = null;
}

function selectedBook(): Book | undefined {
  return books.find((book) => book.id === selectedBookId);
}

function playbackKey(bookId: string, chapterIndex: number, modelBackend: string, voiceId: string): string {
  return `${bookId}::${chapterIndex}::${modelBackend}::${voiceId}`;
}

function selectedPlaybackKey(chapterIndex = selectedChapterIndex): string {
  return playbackKey(selectedBookId, chapterIndex, settings.modelBackend, settings.voiceId);
}

function jobPlaybackKey(job: Job): string {
  return playbackKey(
    job.book_id,
    job.chapter_indexes[0] ?? -1,
    String(job.tts_options?.model_backend || settings.modelBackend),
    job.voice,
  );
}

function sessionMatchesCurrentSelection(): boolean {
  return Boolean(
    session
    && currentJob
    && session.bookId === selectedBookId
    && session.chapterIndex === selectedChapterIndex
    && currentJob.book_id === selectedBookId
    && currentJob.chapter_indexes.includes(selectedChapterIndex)
    && currentJob.voice === settings.voiceId
    && currentJob.tts_options?.model_backend === settings.modelBackend,
  );
}

function selectedChapterHasAudio(): boolean {
  return Boolean(
    currentJob
    && jobPlaybackKey(currentJob) === selectedPlaybackKey()
    && currentJob.audio_files.length > 0,
  );
}

function hasEnoughDiskForAutoNext(): boolean {
  const freeBytes = health?.storage?.audio_free_bytes;
  return typeof freeBytes !== "number" || freeBytes >= minAutoNextFreeBytes;
}

function hasMoreImportantActiveJob(jobs: Job[]): boolean {
  const allowedIds = new Set([currentJob?.id, nextJob?.id].filter(Boolean));
  const targetNextChapter = chapterAfter(selectedChapterIndex);
  const targetNextKey = targetNextChapter
    ? playbackKey(selectedBookId, targetNextChapter.index, settings.modelBackend, settings.voiceId)
    : "";
  return jobs.some((job) => {
    if (job.status !== "queued" && job.status !== "running") {
      return false;
    }
    if (allowedIds.has(job.id)) {
      return false;
    }
    if (job.owner !== "eutherbooks-player") {
      return true;
    }
    return jobPlaybackKey(job) !== targetNextKey;
  });
}

async function refreshNativePlayback(): Promise<void> {
  if (!nativePlaybackActive || !session) {
    return;
  }
  const state = await refreshNativeAudioState();
  applyNativeAudioState(state);
  await maybeReportNativeAudioIssue("native-refresh");
  maybeSaveAutoBookmark();
  if (state.ended) {
    nativePlaybackActive = false;
    await playNextPartOrChapter();
  }
  updatePlayerShell();
}

function applyNativeAudioState(state = nativeAudioState()): void {
  if (!session || !state.available) {
    nativePlaybackActive = false;
    return;
  }
  nativePlaybackActive = state.active || state.playing || nativePlaybackActive;
  if (!nativePlaybackActive) {
    return;
  }
  session.currentIndex = Math.max(0, Math.min(state.index, Math.max(0, session.audioFiles.length - 1)));
  session.currentSeconds = Math.max(0, state.positionSeconds);
}

async function maybeReportNativeAudioIssue(event: string, force = false): Promise<void> {
  const state = nativeAudioState();
  if (!window.__TAURI_INTERNALS__ || (!force && !state.error)) {
    return;
  }
  const key = `${event}:${state.lastEvent}:${state.error}:${selectedBookId}:${selectedChapterIndex}`;
  if (!force && key === lastBugReportKey) {
    return;
  }
  lastBugReportKey = key;
  try {
    await api.reportPlayerLog(playerBugPayload(event, state));
    lastPlaybackEvent = state.error ? "Native bug report sent" : lastPlaybackEvent;
  } catch (err) {
    lastPlaybackEvent = `Bug report failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function playerBugPayload(event: string, state: NativeAudioState): Record<string, unknown> {
  return {
    event,
    app: "eutherbooks-player",
    version: "0.1.17",
    endpoint: settings.serverUrl,
    username: settings.username,
    bookId: selectedBookId,
    chapterIndex: selectedChapterIndex,
    modelBackend: settings.modelBackend,
    voiceId: settings.voiceId,
    jobId: currentJob?.id ?? session?.jobId ?? "",
    session: session
      ? {
          partIndex: session.currentIndex,
          partSeconds: session.currentSeconds,
          generatedSeconds: session.generatedSeconds,
          parts: session.audioFiles.length,
          totalParts: session.totalParts,
        }
      : null,
    nativeAudio: state,
    wakeLock: wakeLockStatus(),
    mediaSession: mediaSessionStatus,
    playback: lastPlaybackEvent,
    userAgent: navigator.userAgent,
    visible: document.visibilityState,
    online: navigator.onLine,
    timestamp: new Date().toISOString(),
  };
}

function isPlaybackPaused(): boolean {
  return nativePlaybackActive ? !nativeAudioState().playing : audio.paused;
}

function currentBookmarkId(): string {
  return bookmarkKey(selectedBookId, selectedChapterIndex, settings.modelBackend, settings.voiceId);
}

function currentBookmark(): Bookmark | undefined {
  return loadBookmarks()[currentBookmarkId()];
}

function saveCurrentBookmark(auto: boolean): void {
  if (!session || !selectedBookId) {
    return;
  }
  if (!nativePlaybackActive && !audio.paused) {
    session.currentSeconds = audio.currentTime;
  }
  const chapter = selectedChapter();
  const positionSeconds = sessionPosition(session);
  saveBookmark({
    id: currentBookmarkId(),
    bookId: selectedBookId,
    chapterIndex: selectedChapterIndex,
    modelBackend: settings.modelBackend,
    voiceId: settings.voiceId,
    positionSeconds,
    partIndex: session.currentIndex,
    partSeconds: session.currentSeconds,
    label: `${chapter ? chapterLabel(chapter) : "Chapter"} · ${formatTime(positionSeconds)}`,
    auto,
    updatedAt: new Date().toISOString(),
  });
  lastAutoBookmarkAt = Date.now();
}

function maybeSaveAutoBookmark(force = false): void {
  if (!settings.autoBookmark || !session) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastAutoBookmarkAt < 5000) {
    return;
  }
  saveCurrentBookmark(true);
}

function applyBookmarkToSession(): void {
  const bookmark = currentBookmark();
  if (!session || !bookmark || bookmark.bookId !== selectedBookId || bookmark.chapterIndex !== selectedChapterIndex) {
    return;
  }
  session.currentIndex = Math.max(0, Math.min(bookmark.partIndex, Math.max(0, session.audioFiles.length - 1)));
  session.currentSeconds = Math.max(0, bookmark.partSeconds);
}

function resumeBookmark(): void {
  const bookmark = currentBookmark();
  if (!bookmark || !session) {
    lastPlaybackEvent = "No bookmark for this voice";
    render();
    return;
  }
  applyBookmarkToSession();
  userPausedPlayback = false;
  void playFromSession("manual");
}

async function loginToServer(): Promise<void> {
  const username = document.querySelector<HTMLInputElement>("#login-username")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#login-password")?.value ?? "";
  const serverUrl = cleanServerUrl(document.querySelector<HTMLInputElement>("#server-url")?.value ?? settings.serverUrl);
  if (!serverUrl || !username || !password) {
    errorText = "Server, user and password are required";
    render();
    return;
  }
  statusText = "Logging in";
  errorText = "";
  render();
  try {
    const login = await EutherBooksApi.login(serverUrl, username, password);
    updateSettings({
      ...settings,
      serverUrl,
      username: login.user || username,
      authToken: login.token,
    });
    await refreshAll();
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Login failed";
    render();
  }
}

function selectedChapter(): Chapter | undefined {
  return chapters.find((chapter) => chapter.index === selectedChapterIndex);
}

function chapterAfter(index: number): Chapter | undefined {
  return chapters.find((chapter) => chapter.index > index);
}

function chapterNumber(chapter: Chapter): number {
  const position = chapters.findIndex((candidate) => candidate.index === chapter.index);
  return position >= 0 ? position + 1 : chapter.index + 1;
}

function chapterLabel(chapter: Chapter): string {
  return `Chapter ${String(chapterNumber(chapter)).padStart(2, "0")} - ${chapter.title}`;
}

function updateSettings(next: AppSettings): void {
  settings = next;
  saveSettings(settings);
  api = new EutherBooksApi(settings.serverUrl, settings.authToken);
  setAudioCacheEnabled(settings.cacheAudio);
}

function persistSelection(): void {
  localStorage.setItem("eutherbooks-player-book", selectedBookId);
  localStorage.setItem("eutherbooks-player-chapter", String(selectedChapterIndex));
}

function scheduleSleepTimer(): void {
  clearSleepTimer();
  if (settings.sleepTimerMinutes <= 0) {
    return;
  }
  sleepDeadline = Date.now() + settings.sleepTimerMinutes * 60_000;
  sleepTimer = window.setTimeout(() => {
    stopPlayback(true, true);
    statusText = "Sleep timer paused playback";
    lastPlaybackEvent = "Sleep timer paused playback";
    render();
  }, settings.sleepTimerMinutes * 60_000);
}

function clearSleepTimer(): void {
  if (sleepTimer !== null) {
    window.clearTimeout(sleepTimer);
  }
  sleepTimer = null;
  sleepDeadline = 0;
}

function updatePlayerShell(): void {
  const position = document.querySelector<HTMLSpanElement>("[data-position]");
  if (position && session) {
    position.textContent = `${formatTime(sessionPosition(session))} / ${formatTime(session.generatedSeconds)}`;
  }
  const thumb = document.querySelector<HTMLElement>("[data-seek-thumb]");
  const fill = document.querySelector<HTMLElement>("[data-seek-fill]");
  const marker = document.querySelector<HTMLElement>("[data-seek-marker]");
  if (thumb && fill && marker && session) {
    const percent = seekPercent(sessionPosition(session));
    thumb.style.left = `${percent}%`;
    fill.style.width = `${percent}%`;
    marker.textContent = formatTime(sessionPosition(session));
  }
  updateAppMediaSession();
}

function warmAudioCacheForSession(): void {
  if (!session || !settings.cacheAudio) {
    return;
  }
  prefetchAudio(session.audioFiles.map((path) => api.audioUrl(path)));
}

function warmAudioCacheForJob(job: Job | null): void {
  if (!job || !settings.cacheAudio || job.audio_files.length === 0) {
    return;
  }
  prefetchAudio(job.audio_files.map((path) => api.audioUrl(path)));
}

function updateAppMediaSession(): void {
  mediaSessionStatus = updateMediaSession(selectedBook(), selectedChapter(), session, !isPlaybackPaused());
}

function selectedVoice(): Voice | null {
  return voices.find((voice) => voice.id === settings.voiceId) ?? null;
}

function render(): void {
  if (shouldDeferRender()) {
    queuedRender = true;
    return;
  }
  queuedRender = false;
  const modelVoices = voicesForModel(voices, settings.modelBackend);
  if (!modelVoices.some((voice) => voice.id === settings.voiceId) && modelVoices[0]) {
    updateSettings({ ...settings, voiceId: modelVoices[0].id });
  }
  appRoot.innerHTML = appMarkup(modelVoices);
  bindUi();
}

function shouldDeferRender(): boolean {
  const activeElement = document.activeElement;
  return activeSelectControl
    || Date.now() < interactionLockUntil
    || activeElement instanceof HTMLSelectElement
    || activeElement instanceof HTMLInputElement;
}

function deferRendersFor(ms: number): void {
  interactionLockUntil = Math.max(interactionLockUntil, Date.now() + ms);
}

function flushDeferredRender(): void {
  activeSelectControl = false;
  interactionLockUntil = 0;
  if (queuedRender) {
    render();
  }
}

function appMarkup(modelVoices: Voice[]): string {
  const book = selectedBook();
  const chapter = selectedChapter();
  const readyParts = session?.audioFiles.length ?? currentJob?.audio_files.length ?? 0;
  const totalParts = session?.totalParts ?? currentJob?.total_audio_files ?? 0;
  const generated = session ? formatTime(session.generatedSeconds) : "0:00";
  const position = session ? `${formatTime(sessionPosition(session))} / ${generated}` : "0:00 / 0:00";
  const progressPercent = totalParts > 0 ? Math.min(100, Math.round((readyParts / totalParts) * 100)) : 0;
  const seekProgress = session ? seekPercent(sessionPosition(session)) : 0;
  const sleepLabel = settings.sleepTimerMinutes > 0
    ? `${settings.sleepTimerMinutes} min${sleepDeadline ? ` · ${Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 60000))} left` : ""}`
    : "Off";
  const cacheState = audioCacheState();
  const nativeState = nativeAudioState();
  const bookmark = currentBookmark();
  const freeAudioDisk = typeof health?.storage?.audio_free_bytes === "number" ? formatBytes(health.storage.audio_free_bytes) : "unknown";
  return `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand-lockup">
          <span class="brand-glyph" aria-hidden="true"></span>
          <div>
            <span class="eyebrow">EutherBooks</span>
            <h1>Player</h1>
          </div>
        </div>
        <strong class="status-pill ${health?.status === "ok" ? "is-ok" : "is-warn"}">${escapeHtml(health?.status ?? "offline")}</strong>
      </header>

      <section class="server-panel">
        <label>
          <span>Server</span>
          <input id="server-url" value="${escapeHtml(settings.serverUrl)}" inputmode="url" />
        </label>
        <label>
          <span>User</span>
          <input id="login-username" value="${escapeHtml(settings.username)}" autocomplete="username" />
        </label>
        <label>
          <span>Password</span>
          <input id="login-password" type="password" autocomplete="current-password" />
        </label>
        <button id="login" type="button">Login</button>
        <button id="reload" type="button">Retry</button>
      </section>

      <section class="library-grid">
        <label>
          <span>Book</span>
          <select id="book-select">
            ${books.map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === selectedBookId ? "selected" : ""}>${escapeHtml(candidate.title)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Chapter</span>
          <select id="chapter-select">
            ${chapters.map((candidate) => `<option value="${candidate.index}" ${candidate.index === selectedChapterIndex ? "selected" : ""}>${escapeHtml(chapterLabel(candidate))}</option>`).join("")}
          </select>
        </label>
      </section>

      <section class="voice-grid">
        <label>
          <span>Model</span>
          <select id="model-select">
            ${modelOption("dots.tts-mf", "Dots MF")}
            ${modelOption("dots.tts-soar", "Dots SOAR")}
            ${modelOption("voxcpm2", "VoxCPM2")}
          </select>
        </label>
        <label>
          <span>Voice</span>
          <select id="voice-select">
            ${modelVoices.map((voice) => `<option value="${escapeHtml(voice.id)}" ${voice.id === settings.voiceId ? "selected" : ""}>${escapeHtml(voice.label)}</option>`).join("")}
          </select>
        </label>
      </section>

      <section class="player-panel">
        <div class="now-playing">
          <span>${escapeHtml(book?.author ?? "Audiobook")}</span>
          <strong>${escapeHtml(book?.title ?? "No book selected")}</strong>
          <em>${escapeHtml(chapter ? chapterLabel(chapter) : "No chapter")}</em>
        </div>
        <div class="transport">
          <button id="play" type="button">${isPlaybackPaused() ? "Play" : "Pause"}</button>
          <button id="generate" type="button">Generate</button>
          <button id="bookmark" type="button">Bookmark</button>
          <button id="resume-bookmark" type="button" ${bookmark ? "" : "disabled"}>Resume bookmark</button>
        </div>
        <div class="progress-row">
          <span data-position>${escapeHtml(position)}</span>
          <span>${readyParts}/${Math.max(totalParts, readyParts)} parts · ${progressPercent}%</span>
        </div>
        <div class="seekbar" data-seekbar role="slider" aria-label="Seek generated audio" aria-valuemin="0" aria-valuemax="${Math.max(0, Math.floor(session?.generatedSeconds ?? 0))}" aria-valuenow="${Math.floor(session ? sessionPosition(session) : 0)}">
          <i data-seek-fill style="width:${seekProgress}%"></i>
          <b data-seek-thumb style="left:${seekProgress}%"></b>
          <span data-seek-marker>${session ? formatTime(sessionPosition(session)) : "0:00"}</span>
        </div>
        <div class="progress-bar"><i style="width:${progressPercent}%"></i></div>
      </section>

      <section class="options-row">
        <button id="auto-play" class="${settings.autoPlay ? "is-selected" : ""}" type="button">Auto-play</button>
        <button id="auto-next" class="${settings.autoNext ? "is-selected" : ""}" type="button">Auto-next</button>
        <button id="auto-bookmark" class="${settings.autoBookmark ? "is-selected" : ""}" type="button">Auto-bookmark</button>
        <button id="cache-audio" class="${settings.cacheAudio ? "is-selected" : ""}" type="button">Cache</button>
        <label>
          <span>Sleep</span>
          <select id="sleep-select">
            ${sleepOption(0, "Off")}
            ${sleepOption(5, "5 min")}
            ${sleepOption(10, "10 min")}
            ${sleepOption(15, "15 min")}
            ${sleepOption(30, "30 min")}
            ${sleepOption(45, "45 min")}
            ${sleepOption(60, "60 min")}
          </select>
        </label>
      </section>

      <section class="backend-panel">
        <strong>${escapeHtml(statusText)}</strong>
        <small>Endpoint: ${escapeHtml(endpointText || settings.serverUrl)}</small>
        <small>Login: ${settings.authToken ? `saved for ${escapeHtml(settings.username || "current user")}` : "not saved"}</small>
        <span>${escapeHtml(currentJob?.progress_detail || "No active job")}</span>
        <small>Sleep timer: ${escapeHtml(sleepLabel)}</small>
        <small>Playback: ${escapeHtml(lastPlaybackEvent)}${userPausedPlayback ? " · manual pause lock" : ""}</small>
        <small>Bookmark: ${bookmark ? `${escapeHtml(bookmark.label)} · ${bookmark.auto ? "auto" : "manual"}` : "none for this voice"}</small>
        <small>Wake: ${escapeHtml(wakeLockStatus())}</small>
        <small>Native audio: ${nativeState.available ? "available" : "off"} · ${nativeState.playing ? "playing" : "paused"} · ${escapeHtml(nativeState.lastEvent)}${nativeState.error ? ` · ${escapeHtml(nativeState.error)}` : ""}</small>
        <small>Media: ${escapeHtml(mediaSessionStatus)}</small>
        <small>Cache: ${cacheState.enabled ? "on" : "off"} · ${cacheState.cached} parts · ${cacheState.pending} pending · ${escapeHtml(cacheState.lastEvent)}</small>
        <small>Audio disk free: ${escapeHtml(freeAudioDisk)}</small>
        ${nextJob ? `<small>Next: ${escapeHtml(nextJob.status)} · ${nextJob.audio_files.length}/${Math.max(nextJob.total_audio_files, nextJob.audio_files.length)} parts</small>` : settings.autoNext ? `<small>Next: waiting for current chapter to be ready</small>` : ""}
        <button id="clear-cache" type="button">Clear audio cache</button>
        <button id="report-native-bug" type="button">Report native bug</button>
      </section>

      <section class="beta-panel">
        <strong>Beta roadmap</strong>
        <ul>
          <li><span class="done">Live</span> Endpoint failover, native HTTP, signed APK pipeline</li>
          <li><span class="done">Live</span> Native Android audio service, foreground playback, wake lock</li>
          <li><span class="done">Live</span> Manual bookmarks, auto-bookmark, resume per voice and model</li>
          <li><span class="done">Live</span> Sleep timer hold, auto-next generation, local audio cache</li>
          <li><span class="beta">Beta</span> Media Session controls, native queue status, buffer diagnostics</li>
          <li><span class="next">Next</span> Lockscreen notification controls, richer queue controls, playback telemetry</li>
        </ul>
      </section>

      ${errorText ? `<p class="error">${escapeHtml(errorText)}</p>` : ""}
    </main>
  `;
}

function bindUi(): void {
  document.querySelector<HTMLButtonElement>("#login")?.addEventListener("click", () => void loginToServer());
  document.querySelector<HTMLButtonElement>("#reload")?.addEventListener("click", () => void refreshAll());
  document.querySelector<HTMLInputElement>("#server-url")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    const serverUrl = cleanServerUrl(value);
    if (serverUrl) {
      updateSettings({ ...settings, serverUrl });
      void refreshAll();
    }
  });
  bindStableControls();
  bindSeekbar();
  document.querySelector<HTMLSelectElement>("#book-select")?.addEventListener("change", (event) => {
    selectedBookId = (event.currentTarget as HTMLSelectElement).value;
    selectedChapterIndex = 0;
    userPausedPlayback = false;
    currentJob = null;
    nextJob = null;
    nextJobKey = "";
    session = null;
    persistSelection();
    void loadChapters().then(() => refreshAll());
  });
  document.querySelector<HTMLSelectElement>("#chapter-select")?.addEventListener("change", (event) => {
    selectedChapterIndex = Number((event.currentTarget as HTMLSelectElement).value);
    userPausedPlayback = false;
    currentJob = null;
    nextJob = null;
    nextJobKey = "";
    session = null;
    persistSelection();
    void refreshAll();
  });
  document.querySelector<HTMLSelectElement>("#model-select")?.addEventListener("change", (event) => {
    updateSettings({ ...settings, modelBackend: (event.currentTarget as HTMLSelectElement).value as AppSettings["modelBackend"] });
    userPausedPlayback = false;
    currentJob = null;
    nextJob = null;
    nextJobKey = "";
    session = null;
    render();
  });
  document.querySelector<HTMLSelectElement>("#voice-select")?.addEventListener("change", (event) => {
    updateSettings({ ...settings, voiceId: (event.currentTarget as HTMLSelectElement).value });
    userPausedPlayback = false;
    currentJob = null;
    nextJob = null;
    nextJobKey = "";
    session = null;
    void refreshAll();
  });
  document.querySelector<HTMLButtonElement>("#generate")?.addEventListener("click", () => {
    if (selectedChapterHasAudio()) {
      const confirmed = window.confirm("This chapter already has generated audio for the selected voice and model. Regenerate it now?");
      if (!confirmed) {
        lastPlaybackEvent = "Generate cancelled";
        render();
        return;
      }
    }
    void generateCurrentChapter(true);
  });
  document.querySelector<HTMLButtonElement>("#bookmark")?.addEventListener("click", () => {
    saveCurrentBookmark(false);
    lastPlaybackEvent = "Bookmark saved";
    render();
  });
  document.querySelector<HTMLButtonElement>("#resume-bookmark")?.addEventListener("click", () => resumeBookmark());
  document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => {
    if (isPlaybackPaused()) {
      void playFromSession("manual");
    } else {
      stopPlayback(true, true);
      statusText = "Paused";
      render();
    }
  });
  document.querySelector<HTMLButtonElement>("#auto-play")?.addEventListener("click", () => {
    updateSettings({ ...settings, autoPlay: !settings.autoPlay });
    render();
  });
  document.querySelector<HTMLButtonElement>("#auto-next")?.addEventListener("click", () => {
    updateSettings({ ...settings, autoNext: !settings.autoNext });
    render();
  });
  document.querySelector<HTMLButtonElement>("#auto-bookmark")?.addEventListener("click", () => {
    updateSettings({ ...settings, autoBookmark: !settings.autoBookmark });
    render();
  });
  document.querySelector<HTMLButtonElement>("#cache-audio")?.addEventListener("click", () => {
    updateSettings({ ...settings, cacheAudio: !settings.cacheAudio });
    warmAudioCacheForSession();
    warmAudioCacheForJob(nextJob);
    render();
  });
  document.querySelector<HTMLButtonElement>("#clear-cache")?.addEventListener("click", () => {
    void clearAudioCache().then(() => render());
  });
  document.querySelector<HTMLButtonElement>("#report-native-bug")?.addEventListener("click", () => {
    void maybeReportNativeAudioIssue("manual-native-report", true).then(() => render());
  });
  document.querySelector<HTMLSelectElement>("#sleep-select")?.addEventListener("change", (event) => {
    updateSettings({ ...settings, sleepTimerMinutes: Number((event.currentTarget as HTMLSelectElement).value) });
    if (isPlaybackPaused()) {
      clearSleepTimer();
    } else {
      scheduleSleepTimer();
    }
    render();
  });
}

function bindStableControls(): void {
  for (const control of document.querySelectorAll("select, input")) {
    control.addEventListener("pointerdown", () => {
      activeSelectControl = control instanceof HTMLSelectElement;
      deferRendersFor(2500);
    });
    control.addEventListener("focus", () => {
      activeSelectControl = control instanceof HTMLSelectElement;
      deferRendersFor(control instanceof HTMLSelectElement ? 4000 : 1500);
    });
    control.addEventListener("blur", () => window.setTimeout(flushDeferredRender, 80));
    control.addEventListener("change", () => window.setTimeout(flushDeferredRender, 80));
  }
}

function bindSeekbar(): void {
  const seekbar = document.querySelector<HTMLElement>("[data-seekbar]");
  if (!seekbar) {
    return;
  }
  let dragging = false;
  const seek = (event: PointerEvent, commit: boolean) => {
    if (!session) {
      return;
    }
    const rect = seekbar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const seconds = ratio * session.generatedSeconds;
    const marker = seekbar.querySelector<HTMLElement>("[data-seek-marker]");
    const thumb = seekbar.querySelector<HTMLElement>("[data-seek-thumb]");
    const fill = seekbar.querySelector<HTMLElement>("[data-seek-fill]");
    const percent = ratio * 100;
    if (marker) {
      marker.textContent = formatTime(seconds);
    }
    if (thumb) {
      thumb.style.left = `${percent}%`;
    }
    if (fill) {
      fill.style.width = `${percent}%`;
    }
    if (commit) {
      seekToSessionPosition(seconds);
    }
  };
  seekbar.addEventListener("pointerdown", (event) => {
    dragging = true;
    seekbar.setPointerCapture(event.pointerId);
    deferRendersFor(5000);
    seek(event, false);
  });
  seekbar.addEventListener("pointermove", (event) => {
    if (dragging) {
      seek(event, false);
    }
  });
  seekbar.addEventListener("pointerup", (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    seek(event, true);
    flushDeferredRender();
  });
  seekbar.addEventListener("pointercancel", () => {
    dragging = false;
    flushDeferredRender();
  });
}

function seekPercent(position: number): number {
  if (!session || session.generatedSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (position / session.generatedSeconds) * 100));
}

function modelOption(value: AppSettings["modelBackend"], label: string): string {
  return `<option value="${value}" ${settings.modelBackend === value ? "selected" : ""}>${label}</option>`;
}

function sleepOption(value: number, label: string): string {
  return `<option value="${value}" ${settings.sleepTimerMinutes === value ? "selected" : ""}>${label}</option>`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "unknown";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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
  updateNativeAudioQueue,
} from "./native-audio";
import type { NativeAudioState, NativeQueueManifest } from "./native-audio";
import { formatTime, sessionFromJob, sessionPosition } from "./playback-session";
import {
  bookmarkKey,
  cleanServerUrl,
  hostConfigCandidates,
  loadBookmarks,
  loadServerRouteConfig,
  loadSettings,
  saveBookmark,
  saveServerRouteConfig,
  saveSettings,
  serverCandidates,
} from "./storage";
import { AppSettings, Book, Bookmark, Chapter, Health, Job, PlaybackSession, ServerRouteConfig, Voice } from "./types";
import { setPlaybackWakeLock, wakeLockStatus } from "./wake-lock";

const root = document.querySelector<HTMLDivElement>("#app");
const minAutoNextFreeBytes = 512 * 1024 * 1024;
const appVersion = "0.1.35";
const appBuild = "0.1.35-beta";

if (!root) {
  throw new Error("Missing #app root");
}
const appRoot = root;

let settings = loadSettings();
let routeConfig: ServerRouteConfig = loadServerRouteConfig();
let api = new EutherBooksApi(settings.serverUrl, settings.authToken);
let health: Health | null = null;
let books: Book[] = [];
let chapters: Chapter[] = [];
let voices: Voice[] = [];
let allJobs: Job[] = [];
let selectedBookId = localStorage.getItem("eutherbooks-player-book") ?? "";
let selectedChapterIndex = Number(localStorage.getItem("eutherbooks-player-chapter") ?? 0);
let chapterQuery = "";
let batchQueueCount = cleanBatchQueueCount(Number(localStorage.getItem("eutherbooks-player-batch-count") ?? 5));
let currentJob: Job | null = null;
let nextJob: Job | null = null;
let nextJobKey = "";
let secondNextJob: Job | null = null;
let secondNextJobKey = "";
let nextJobRequestInFlight = false;
let batchQueueInFlight = false;
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
let playbackEvents: string[] = ["Idle"];
let mediaSessionStatus = "Media Session pending";
let interactionLockUntil = 0;
let queuedRender = false;
let activeSelectControl = false;
let advancingPlayback = false;
let playbackWatchTimer: number | null = null;
let fallbackRefreshRunning = false;
let nativePlaybackActive = false;
let nativeQueuedUrlsKey = "";
let nativeQueueSessionStartIndex = 0;
let nativeServiceQueuePrefix: string[] = [];
let nativeRegressionResyncInFlight = false;
let lastNativeSeekCommandAt = 0;
let lastAutoBookmarkAt = 0;
let lastBugReportKey = "";
let lastWatchdogPosition = -1;
let lastWatchdogSessionKey = "";
let stuckPlaybackTicks = 0;
let watchdogRecovering = false;
let lastTelemetryReportAt = 0;
let secondNextRetryKey = "";
let secondNextRetryAfter = 0;
let backgroundStateEvent = `${document.visibilityState} · ${navigator.onLine ? "online" : "offline"}`;
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
    pausePlayback();
  },
  next: () => void playNextPartOrChapter(),
  previous: () => void playPreviousPart(),
  seekBy,
  seekTo: seekToSessionPosition,
});
setAudioCacheEnabled(settings.cacheAudio);
installBackgroundTelemetry();
void boot();

async function boot(): Promise<void> {
  await refreshAudioCacheState();
  await refreshNativeAudioState();
  await refreshServerRouteConfig();
  await refreshAll();
  schedulePoll(600);
}

async function refreshServerRouteConfig(): Promise<void> {
  const errors: string[] = [];
  for (const candidate of hostConfigCandidates(settings.serverUrl, routeConfig)) {
    try {
      routeConfig = saveServerRouteConfig(await EutherBooksApi.appConfig(candidate));
      endpointText = routeConfig.publicServerUrl || routeConfig.lanServerUrl || candidate;
      setPlaybackEvent(`Route config loaded from ${candidate}`);
      return;
    } catch (err) {
      errors.push(`${candidate}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  if (errors.length > 0 && !routeConfig.eutherbooksUrls.length) {
    lastEndpointErrors = errors;
  }
}

async function refreshAll(): Promise<void> {
  statusText = "Connecting";
  errorText = "";
  lastEndpointErrors = [];
  render();
  await refreshServerRouteConfig();
  const candidates = serverCandidates(settings.serverUrl, routeConfig);
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
      allJobs = jobs;
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
    attachExistingNextJob(jobs);
    void maybeEnsureNextAhead("attach");
  }
}

function attachExistingNextJob(jobs: Job[]): void {
  const nextChapter = chapterAfter(selectedChapterIndex);
  if (!nextChapter || !currentJob || currentJob.status !== "done") {
    return;
  }
  const targetKey = playbackKey(selectedBookId, nextChapter.index, settings.modelBackend, settings.voiceId);
  if (nextJob && nextJobKey === targetKey && nextJob.status !== "failed") {
    void ensureSecondNextJob("existing-next");
    return;
  }
  const candidate = matchingJobForChapter(jobs, nextChapter.index);
  if (!candidate) {
    return;
  }
  nextJob = candidate;
  nextJobKey = targetKey;
  warmAudioCacheForJob(nextJob);
  void ensureSecondNextJob("attach-next");
  void updateNativeQueue("attach-next");
}

function clearLookaheadQueue(): void {
  nextJob = null;
  nextJobKey = "";
  secondNextJob = null;
  secondNextJobKey = "";
  nativeQueuedUrlsKey = "";
  nativeQueueSessionStartIndex = 0;
  nativeServiceQueuePrefix = [];
}

async function generateCurrentChapter(cancelExisting = true): Promise<void> {
  if (!selectedBookId) {
    return;
  }
  userPausedPlayback = false;
  clearLookaheadQueue();
  stopPlayback(false);
  statusText = "Starting generation";
  setPlaybackEvent("Generating current chapter");
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
      void updateNativeQueue("poll-current");
      if (settings.autoPlay && !userPausedPlayback && isPlaybackPaused() && currentJob.audio_files.length > 0 && currentJob.status !== "failed") {
        await playFromSession("auto");
      }
      void maybeEnsureNextAhead("poll-current");
    }
    if (nextJob) {
      nextJob = await api.job(nextJob.id);
      warmAudioCacheForJob(nextJob);
      void updateNativeQueue("poll-next");
      void ensureSecondNextJob("poll-next");
    }
    if (secondNextJob) {
      secondNextJob = await api.job(secondNextJob.id);
      warmAudioCacheForJob(secondNextJob);
      void updateNativeQueue("poll-second-next");
    } else if (currentJob?.status === "done" && settings.autoNext) {
      void maybeEnsureNextAhead("poll-ready");
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
  } else if ((nextJob && nextJob.status !== "done" && nextJob.status !== "failed") || (secondNextJob && secondNextJob.status !== "done" && secondNextJob.status !== "failed")) {
    schedulePoll(1400);
  }
}

function schedulePoll(delayMs: number): void {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
  }
  pollTimer = window.setTimeout(() => void pollJobs(), delayMs);
}

async function ensureNextJob(force = false): Promise<void> {
  const nextChapter = chapterAfter(selectedChapterIndex);
  const targetKey = playbackKey(selectedBookId, nextChapter?.index ?? -1, settings.modelBackend, settings.voiceId);
  if (nextJobRequestInFlight || (!force && !settings.autoNext) || !selectedBookId || !nextChapter || !currentJob || !sessionMatchesCurrentSelection()) {
    if (force) {
      statusText = !nextChapter ? "Queue: no later chapter" : "Queue: play or generate this chapter first";
      setPlaybackEvent(statusText);
      render();
    }
    return;
  }
  if (nextJob && nextJobKey === targetKey && nextJob.status !== "failed") {
    void ensureSecondNextJob("existing-next");
    return;
  }
  if (nextJob && nextJobKey !== targetKey) {
    clearLookaheadQueue();
  }
  if (currentJob.status !== "done") {
    if (force) {
      statusText = "Queue: current chapter must finish first";
      setPlaybackEvent(statusText);
      render();
    }
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
    allJobs = jobs;
    if (hasMoreImportantActiveJob(jobs)) {
      statusText = "Auto-next waiting for active speech job";
      schedulePoll(1500);
      return;
    }
    const existing = matchingJobForChapter(jobs, nextChapter.index);
    nextJob = existing ?? await api.createJob(selectedBookId, nextChapter.index, settings, selectedVoice(), false, false);
    nextJobKey = targetKey;
    allJobs = upsertJobList(allJobs, nextJob);
    warmAudioCacheForJob(nextJob);
    void updateNativeQueue("queue-next");
    void ensureSecondNextJob("queue-next");
    setPlaybackEvent(`${existing ? "Found next" : "Queued next"}: ${chapterLabel(nextChapter)}`);
    schedulePoll(1000);
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Could not queue next chapter";
  } finally {
    nextJobRequestInFlight = false;
  }
}

async function ensureSecondNextJob(reason: string): Promise<void> {
  if (!settings.autoNext || !selectedBookId || !nextJob || nextJob.status === "failed") {
    return;
  }
  const nextChapterIndex = nextJob.chapter_indexes[0] ?? -1;
  const secondChapter = chapterAfter(nextChapterIndex);
  if (!secondChapter) {
    return;
  }
  const targetKey = playbackKey(selectedBookId, secondChapter.index, settings.modelBackend, settings.voiceId);
  if (secondNextRetryKey === targetKey && Date.now() < secondNextRetryAfter) {
    return;
  }
  if (secondNextJob && secondNextJobKey === targetKey && secondNextJob.status !== "failed") {
    return;
  }
  if (secondNextJob && secondNextJobKey !== targetKey) {
    secondNextJob = null;
    secondNextJobKey = "";
  }
  try {
    const jobs = await api.jobs();
    allJobs = jobs;
    const existing = matchingJobForChapter(jobs, secondChapter.index);
    secondNextJob = existing ?? await api.createJob(selectedBookId, secondChapter.index, settings, selectedVoice(), false, false);
    secondNextJobKey = targetKey;
    secondNextRetryKey = "";
    secondNextRetryAfter = 0;
    allJobs = upsertJobList(allJobs, secondNextJob);
    warmAudioCacheForJob(secondNextJob);
    void updateNativeQueue(`queue-second-next:${reason}`);
  } catch (err) {
    secondNextRetryKey = targetKey;
    secondNextRetryAfter = Date.now() + 15_000;
    setPlaybackEvent(`Second prefetch held: ${err instanceof Error ? err.message : "failed"}`);
  }
}

async function queueChapterBatch(): Promise<void> {
  if (batchQueueInFlight || nextJobRequestInFlight || !selectedBookId) {
    return;
  }
  const targets = chaptersAfter(selectedChapterIndex, batchQueueCount);
  if (targets.length === 0) {
    statusText = "Batch queue: end of book";
    setPlaybackEvent(statusText);
    render();
    return;
  }
  batchQueueInFlight = true;
  statusText = `Batch queue: checking ${targets.length} chapters`;
  setPlaybackEvent(statusText);
  render();
  try {
    health = await api.health();
    if (!hasEnoughDiskForAutoNext()) {
      statusText = "Batch queue held: low audio disk space";
      setPlaybackEvent(statusText);
      return;
    }
    allJobs = await api.jobs();
    const missing = targets.filter((chapter) => !matchingJobForChapter(allJobs, chapter.index));
    const createdJobs = missing.length
      ? await api.createJobsForChapters(
          selectedBookId,
          missing.map((chapter) => chapter.index),
          settings,
          selectedVoice(),
          false,
          false,
        )
      : [];
    const batchJobs = targets
      .map((chapter) => {
        const created = createdJobs.find((job) => job.chapter_indexes.includes(chapter.index));
        return created ?? matchingJobForChapter(allJobs, chapter.index);
      })
      .filter((job): job is Job => Boolean(job));
    allJobs = batchJobs.reduce((jobs, job) => upsertJobList(jobs, job), allJobs);
    for (const job of batchJobs) {
      warmAudioCacheForJob(job);
      attachBatchLookaheadJob(job);
    }
    if (createdJobs.length > 0) {
      schedulePoll(1000);
    }
    void updateNativeQueue("batch-queue");
    const reused = targets.length - createdJobs.length;
    statusText = `Batch queue: ${createdJobs.length} queued, ${reused} found`;
    setPlaybackEvent(statusText);
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Could not batch queue chapters";
  } finally {
    batchQueueInFlight = false;
    render();
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
  if (lastPlaybackEvent === "Idle") {
    setPlaybackEvent(`Auto-next check: ${reason}`);
  }
  await ensureNextJob();
}

async function playFromSession(mode: "manual" | "auto" = "manual"): Promise<void> {
  if (mode === "auto" && userPausedPlayback) {
    setPlaybackEvent("Auto-play held by manual pause");
    return;
  }
  if (!session || session.audioFiles.length === 0) {
    setPlaybackEvent("No playable audio loaded");
    return;
  }
  const path = session.audioFiles[session.currentIndex];
  if (!path) {
    setPlaybackEvent("No audio part at current position");
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
  setPlaybackEvent(mode === "auto" ? "Auto-play resumed" : "Manual play");
  void reportPlaybackTelemetry(mode === "auto" ? "browser-auto-play" : "browser-manual-play");
  scheduleSleepTimer();
  startPlaybackWatchdog();
  updateAppMediaSession();
  render();
}

async function playFromNativeSession(mode: "manual" | "auto" = "manual"): Promise<void> {
  if (!session || session.audioFiles.length === 0) {
    return;
  }
  await maybeEnsureNextAhead("native-play-start");
  const book = selectedBook();
  const chapter = selectedChapter();
  nativeServiceQueuePrefix = [];
  const queue = nativeQueueUrlsForService();
  nativeQueuedUrlsKey = queue.join("\n");
  nativeQueueSessionStartIndex = 0;
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
    nativeQueueManifest(),
  );
  nativePlaybackActive = state.available && (state.active || state.playing || state.lastEvent.toLowerCase().includes("requested"));
  applyNativeAudioState(state);
  await maybeReportNativeAudioIssue("native-play-request");
  if (state.error || !nativePlaybackActive) {
    const url = await playableAudioUrl(api.audioUrl(session.audioFiles[session.currentIndex]));
    audio.src = url;
    applyAudioOffset(session.currentSeconds, true);
    await audio.play();
    setPlaybackEvent("Native failed; browser fallback playing");
  }
  await setPlaybackWakeLock(true);
  statusText = "Playing";
  if (!lastPlaybackEvent.includes("fallback")) {
    setPlaybackEvent(mode === "auto" ? "Native auto-play resumed" : "Native manual play");
  }
  void reportPlaybackTelemetry(mode === "auto" ? "native-auto-play" : "native-manual-play");
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

function clampSessionPartIndex(index: number): number {
  if (!session || session.audioFiles.length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, session.audioFiles.length - 1));
}

function clampSessionPartSeconds(index: number, seconds: number): number {
  if (!session) {
    return Math.max(0, seconds);
  }
  const duration = session.durations[index] ?? 0;
  if (duration > 0) {
    return Math.max(0, Math.min(seconds, Math.max(0, duration - 0.25)));
  }
  return Math.max(0, seconds);
}

function setSessionPartPosition(index: number, seconds: number): void {
  if (!session) {
    return;
  }
  const safeIndex = clampSessionPartIndex(index);
  session.currentIndex = safeIndex;
  session.currentSeconds = clampSessionPartSeconds(safeIndex, seconds);
}

function nativeAbsoluteIndexForSession(index = session?.currentIndex ?? 0): number {
  return nativeQueueSessionStartIndex + Math.max(0, index);
}

function sessionPositionForPart(index: number, seconds: number): number {
  if (!session) {
    return 0;
  }
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, session.durations.length - 1)));
  return session.durations.slice(0, safeIndex).reduce((sum, duration) => sum + duration, 0)
    + Math.max(0, seconds);
}

function requestNativeSeek(index: number, seconds: number, reason: string): void {
  lastNativeSeekCommandAt = Date.now();
  void seekNativeAudio(index, seconds)
    .then((state) => {
      if (state.error) {
        setPlaybackEvent(`Native seek failed: ${state.error}`);
        void maybeReportNativeAudioIssue(`native-seek-${reason}`, true);
      }
      window.setTimeout(() => void refreshNativePlayback(), 350);
    })
    .catch((err) => {
      setPlaybackEvent(`Native seek failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function playNextPartOrChapter(): Promise<void> {
  if (!session) {
    return;
  }
  if (session.currentIndex + 1 < session.audioFiles.length) {
    setSessionPartPosition(session.currentIndex + 1, 0);
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
    advanceToNextJobSession(0, 0, "Chapter advanced");
    render();
    await playFromSession("auto");
    return;
  }
  statusText = "Waiting for next chapter";
  schedulePoll(1000);
  render();
}

function selectChapter(index: number, options: { keepPlaying?: boolean; source?: string } = {}): void {
  if (!chapters.some((chapter) => chapter.index === index)) {
    return;
  }
  const shouldResume = Boolean(options.keepPlaying) && !isPlaybackPaused();
  stopPlayback(true, true);
  selectedChapterIndex = index;
  userPausedPlayback = false;
  currentJob = null;
  clearLookaheadQueue();
  session = null;
  persistSelection();
  setPlaybackEvent(options.source ? `${options.source}: ${chapterLabel(chapters.find((chapter) => chapter.index === index)!)}` : "Chapter selected");
  void refreshAll().then(async () => {
    if (!shouldResume) {
      return;
    }
    if (!session && currentJob?.audio_files.length) {
      session = sessionFromJob(currentJob, session);
      applyBookmarkToSession();
    }
    if (session?.audioFiles.length) {
      await playFromSession("manual");
      return;
    }
    if (selectedBookId) {
      await generateCurrentChapter(false);
    }
  });
}

function selectRelativeChapter(direction: -1 | 1): void {
  const target = direction < 0 ? chapterBefore(selectedChapterIndex) : chapterAfter(selectedChapterIndex);
  if (target) {
    selectChapter(target.index);
  }
}

function playRelativeChapter(direction: -1 | 1, source: string): void {
  const target = direction < 0 ? chapterBefore(selectedChapterIndex) : chapterAfter(selectedChapterIndex);
  if (!target) {
    setPlaybackEvent(direction < 0 ? "No previous chapter" : "No next chapter");
    render();
    return;
  }
  selectChapter(target.index, { keepPlaying: true, source });
}

function togglePlayback(source: string): void {
  if (isPlaybackPaused()) {
    setPlaybackEvent(`${source}: play`);
    void playFromSession("manual");
    return;
  }
  pausePlayback(source);
}

function pausePlayback(source = "Manual pause"): void {
  stopPlayback(true, true);
  statusText = "Paused";
  setPlaybackEvent(source);
  render();
}

async function playPreviousPart(): Promise<void> {
  if (!session) {
    return;
  }
  const currentSeconds = nativePlaybackActive ? session.currentSeconds : audio.currentTime;
  if (currentSeconds > 4 || session.currentIndex === 0) {
    setSessionPartPosition(session.currentIndex, 0);
    if (nativePlaybackActive) {
      const targetIndex = nativeAbsoluteIndexForSession();
      requestNativeSeek(targetIndex, 0, "previous-reset");
    } else {
      audio.currentTime = 0;
    }
  } else {
    setSessionPartPosition(session.currentIndex - 1, 0);
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
      setSessionPartPosition(index, Math.max(0, target - elapsed));
      if (nativePlaybackActive) {
        const targetIndex = nativeAbsoluteIndexForSession(session.currentIndex);
        const targetSeconds = session.currentSeconds;
        requestNativeSeek(targetIndex, targetSeconds, "seekbar");
        setPlaybackEvent(`Seek: ${formatTime(target)}`);
        updatePlayerShell();
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
    setPlaybackEvent("Manual pause");
  } else if (!savePosition) {
    setPlaybackEvent("Playback stopped");
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
  if (!savePosition) {
    nativeQueuedUrlsKey = "";
    nativeQueueSessionStartIndex = 0;
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
  lastWatchdogPosition = currentPlaybackPosition();
  lastWatchdogSessionKey = watchdogSessionKey();
  stuckPlaybackTicks = 0;
  playbackWatchTimer = window.setInterval(() => {
    void playbackWatchdogTick();
  }, 500);
}

function stopPlaybackWatchdog(): void {
  if (playbackWatchTimer !== null) {
    window.clearInterval(playbackWatchTimer);
  }
  playbackWatchTimer = null;
  lastWatchdogPosition = -1;
  lastWatchdogSessionKey = "";
  stuckPlaybackTicks = 0;
  watchdogRecovering = false;
}

function installBackgroundTelemetry(): void {
  document.addEventListener("visibilitychange", () => {
    backgroundStateEvent = `${document.visibilityState} · ${navigator.onLine ? "online" : "offline"}`;
    setPlaybackEvent(`Visibility ${document.visibilityState}`);
    if (!isPlaybackPaused()) {
      void reportPlaybackTelemetry(`visibility-${document.visibilityState}`, true);
    }
    updatePlayerShell();
  });
  window.addEventListener("online", () => {
    backgroundStateEvent = `${document.visibilityState} · online`;
    setPlaybackEvent("Network online");
    if (!isPlaybackPaused()) {
      void reportPlaybackTelemetry("network-online", true);
    }
    updatePlayerShell();
  });
  window.addEventListener("offline", () => {
    backgroundStateEvent = `${document.visibilityState} · offline`;
    setPlaybackEvent("Network offline");
    if (!isPlaybackPaused()) {
      void reportPlaybackTelemetry("network-offline", true);
    }
    updatePlayerShell();
  });
  window.addEventListener("pagehide", () => {
    if (!isPlaybackPaused()) {
      void reportPlaybackTelemetry("pagehide-playing", true);
    }
  });
}

async function playbackWatchdogTick(): Promise<void> {
  if (!session) {
    stopPlaybackWatchdog();
    return;
  }
  if (nativePlaybackActive) {
    await refreshNativePlayback();
    const state = nativeAudioState();
    if (isNativeWaitingForMoreAudio(state)) {
      void maybeEnsureNextAhead("watchdog-native-buffering");
      void updateNativeQueue("watchdog-native-buffering");
    }
  } else {
    maybeAdvanceNearPartEnd();
  }
  if (!session || isPlaybackPaused()) {
    lastWatchdogPosition = currentPlaybackPosition();
    lastWatchdogSessionKey = watchdogSessionKey();
    stuckPlaybackTicks = 0;
    return;
  }
  const key = watchdogSessionKey();
  const position = currentPlaybackPosition();
  if (key !== lastWatchdogSessionKey || position < lastWatchdogPosition - 2) {
    lastWatchdogSessionKey = key;
    lastWatchdogPosition = position;
    stuckPlaybackTicks = 0;
    return;
  }
  const moved = position > lastWatchdogPosition + 0.15;
  const nearEnd = session.generatedSeconds > 0 && session.generatedSeconds - position < 1.5;
  if (moved || nearEnd) {
    lastWatchdogSessionKey = key;
    lastWatchdogPosition = position;
    stuckPlaybackTicks = 0;
    return;
  }
  stuckPlaybackTicks += 1;
  if (stuckPlaybackTicks < 12 || watchdogRecovering) {
    return;
  }
  watchdogRecovering = true;
  setPlaybackEvent(`Watchdog stalled at ${formatTime(position)}; restarting audio`);
  await reportPlaybackTelemetry("playback-watchdog-stalled", true);
  try {
    await playFromSession("auto");
  } finally {
    lastWatchdogPosition = currentPlaybackPosition();
    lastWatchdogSessionKey = watchdogSessionKey();
    stuckPlaybackTicks = 0;
    watchdogRecovering = false;
  }
}

function resetPlaybackWatchdogBaseline(): void {
  if (!session) {
    return;
  }
  lastWatchdogPosition = currentPlaybackPosition();
  lastWatchdogSessionKey = watchdogSessionKey();
  stuckPlaybackTicks = 0;
}

function isNativeWaitingForMoreAudio(state = nativeAudioState()): boolean {
  return state.active
    && !state.ended
    && state.lastEvent.toLowerCase().includes("buffering for more audio");
}

function watchdogSessionKey(): string {
  return session ? `${session.jobId}:${session.chapterIndex}:${nativeQueueSessionStartIndex}` : "";
}

function currentPlaybackPosition(): number {
  if (!session) {
    return 0;
  }
  if (nativePlaybackActive) {
    return sessionPosition(session);
  }
  return session.durations.slice(0, session.currentIndex).reduce((sum, duration) => sum + duration, 0)
    + (Number.isFinite(audio.currentTime) ? audio.currentTime : session.currentSeconds);
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
  const allowedIds = new Set([currentJob?.id, nextJob?.id, secondNextJob?.id].filter(Boolean));
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

function upsertJobList(jobs: Job[], job: Job): Job[] {
  return [job, ...jobs.filter((candidate) => candidate.id !== job.id)];
}

function attachBatchLookaheadJob(job: Job): void {
  const nextChapter = chapterAfter(selectedChapterIndex);
  const secondChapter = nextChapter ? chapterAfter(nextChapter.index) : undefined;
  const chapterIndex = job.chapter_indexes[0] ?? -1;
  const key = playbackKey(selectedBookId, chapterIndex, settings.modelBackend, settings.voiceId);
  if (nextChapter && chapterIndex === nextChapter.index) {
    nextJob = job;
    nextJobKey = key;
  } else if (secondChapter && chapterIndex === secondChapter.index) {
    secondNextJob = job;
    secondNextJobKey = key;
  }
}

function nativeQueueUrlsWithNext(): string[] {
  if (!session) {
    return [];
  }
  const currentUrls = session.audioFiles.map((candidate) => api.audioUrl(candidate));
  const nextUrls = nextJob && nextJobKey === selectedNextPlaybackKey()
    ? nextJob.audio_files.map((candidate) => api.audioUrl(candidate))
    : [];
  const secondNextUrls = secondNextJob && secondNextJobKey === selectedSecondNextPlaybackKey()
    ? secondNextJob.audio_files.map((candidate) => api.audioUrl(candidate))
    : [];
  return [...currentUrls, ...nextUrls, ...secondNextUrls];
}

function nativeQueueUrlsForService(): string[] {
  return [...nativeServiceQueuePrefix, ...nativeQueueUrlsWithNext()];
}

function nativeQueueManifest(): NativeQueueManifest | null {
  if (!session || !nextJob || nextJobKey !== selectedNextPlaybackKey()) {
    return null;
  }
  const baseUrl = currentApiBaseUrl();
  if (!baseUrl) {
    return null;
  }
  const manifestUrls = [`${baseUrl}/jobs/${encodeURIComponent(nextJob.id)}`];
  if (secondNextJob && secondNextJobKey === selectedSecondNextPlaybackKey()) {
    manifestUrls.push(`${baseUrl}/jobs/${encodeURIComponent(secondNextJob.id)}`);
  }
  return {
    manifestUrls,
    audioBaseUrl: `${baseUrl}/audio/`,
    startIndex: nativeServiceQueuePrefix.length + session.audioFiles.length,
  };
}

function currentApiBaseUrl(): string {
  return (endpointText || settings.serverUrl).replace(/\/+$/, "");
}

function selectedNextPlaybackKey(): string {
  const nextChapter = chapterAfter(selectedChapterIndex);
  return nextChapter ? selectedPlaybackKey(nextChapter.index) : "";
}

function selectedSecondNextPlaybackKey(): string {
  const nextChapter = chapterAfter(selectedChapterIndex);
  const secondChapter = nextChapter ? chapterAfter(nextChapter.index) : undefined;
  return secondChapter ? selectedPlaybackKey(secondChapter.index) : "";
}

function matchingJobForChapter(jobs: Job[], chapterIndex: number): Job | null {
  const matching = jobs
    .filter((job) =>
      job.book_id === selectedBookId
      && job.chapter_indexes.includes(chapterIndex)
      && job.voice === settings.voiceId
      && job.tts_options?.model_backend === settings.modelBackend
      && (job.status === "queued" || job.status === "running" || job.audio_files.length > 0)
    )
    .reverse();
  return matching.find((job) => job.audio_files.length > 0) ?? matching[0] ?? null;
}

async function updateNativeQueue(reason: string): Promise<void> {
  if (!nativePlaybackActive || !session) {
    return;
  }
  const urls = nativeQueueUrlsForService();
  if (urls.length === 0) {
    return;
  }
  const key = urls.join("\n");
  if (key === nativeQueuedUrlsKey) {
    return;
  }
  nativeQueuedUrlsKey = key;
  const state = await updateNativeAudioQueue(urls, nativeQueueManifest());
  const changedChapter = applyNativeAudioState(state);
  setPlaybackEvent(`Native queue updated: ${reason}`);
  if (changedChapter) {
    render();
  } else {
    updatePlayerShell();
  }
}

async function refreshNativePlayback(): Promise<void> {
  if (!nativePlaybackActive || !session) {
    return;
  }
  const state = await refreshNativeAudioState();
  const changedChapter = applyNativeAudioState(state);
  await maybeReportNativeAudioIssue("native-refresh");
  maybeSaveAutoBookmark();
  if (state.ended) {
    nativePlaybackActive = false;
    await playNextPartOrChapter();
  }
  if (changedChapter) {
    render();
  } else {
    updatePlayerShell();
  }
}

function applyNativeAudioState(state = nativeAudioState()): boolean {
  if (!session || !state.available) {
    nativePlaybackActive = false;
    return false;
  }
  nativePlaybackActive = state.active || state.playing || nativePlaybackActive;
  if (!nativePlaybackActive) {
    return false;
  }
  const currentPartCount = session.audioFiles.length;
  const relativeIndex = Math.max(0, state.index - nativeQueueSessionStartIndex);
  if (relativeIndex >= currentPartCount && nextJob?.audio_files.length && nextJobKey === selectedNextPlaybackKey()) {
    const nextIndex = Math.max(0, relativeIndex - currentPartCount);
    nativeServiceQueuePrefix = nativeServiceQueuePrefix.concat(session.audioFiles.map((candidate) => api.audioUrl(candidate)));
    nativeQueueSessionStartIndex += currentPartCount;
    advanceToNextJobSession(nextIndex, state.positionSeconds, "Native advanced to next chapter");
    return true;
  }
  if (shouldResyncNativeRegression(relativeIndex, state.positionSeconds, state)) {
    void resyncNativeAfterRegression(relativeIndex, state.positionSeconds);
    return false;
  }
  setSessionPartPosition(relativeIndex, state.positionSeconds);
  return false;
}

function shouldResyncNativeRegression(relativeIndex: number, seconds: number, state: NativeAudioState): boolean {
  if (!session || !state.playing || Date.now() - lastNativeSeekCommandAt < 4_000) {
    return false;
  }
  const currentPosition = sessionPosition(session);
  const reportedPosition = sessionPositionForPart(relativeIndex, seconds);
  const movedBack = reportedPosition < currentPosition - 10;
  const indexMovedBack = relativeIndex < session.currentIndex;
  return currentPosition > 20 && (movedBack || indexMovedBack);
}

async function resyncNativeAfterRegression(relativeIndex: number, seconds: number): Promise<void> {
  if (!session || nativeRegressionResyncInFlight) {
    return;
  }
  nativeRegressionResyncInFlight = true;
  const targetIndex = nativeAbsoluteIndexForSession(session.currentIndex);
  const targetSeconds = session.currentSeconds;
  const targetPosition = sessionPosition(session);
  setPlaybackEvent(`Native index moved back; resync ${formatTime(targetPosition)}`);
  void reportPlaybackTelemetry("native-index-regression", true);
  try {
    lastNativeSeekCommandAt = Date.now();
    await seekNativeAudio(targetIndex, targetSeconds);
    window.setTimeout(() => void refreshNativePlayback(), 350);
  } catch (err) {
    setPlaybackEvent(`Native resync failed: ${err instanceof Error ? err.message : String(err)}`);
    setSessionPartPosition(relativeIndex, seconds);
  } finally {
    window.setTimeout(() => {
      nativeRegressionResyncInFlight = false;
    }, 1_500);
  }
}

function advanceToNextJobSession(partIndex: number, partSeconds: number, event: string): boolean {
  if (!nextJob?.audio_files.length) {
    return false;
  }
  selectedChapterIndex = nextJob.chapter_indexes[0] ?? selectedChapterIndex;
  persistSelection();
  currentJob = nextJob;
  nextJob = secondNextJob;
  nextJobKey = secondNextJobKey;
  secondNextJob = null;
  secondNextJobKey = "";
  session = sessionFromJob(currentJob);
  setSessionPartPosition(partIndex, partSeconds);
  warmAudioCacheForSession();
  resetPlaybackWatchdogBaseline();
  setPlaybackEvent(event);
  void ensureSecondNextJob(event === "Native advanced to next chapter" ? "native-advanced" : "chapter-advanced");
  return true;
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
    if (state.error) {
      setPlaybackEvent("Native bug report sent");
    }
  } catch (err) {
    setPlaybackEvent(`Bug report failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function reportPlaybackTelemetry(event: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastTelemetryReportAt < 15_000) {
    return;
  }
  lastTelemetryReportAt = now;
  try {
    await api.reportPlayerLog(playerBugPayload(event, nativeAudioState()));
  } catch (err) {
    setPlaybackEvent(`Telemetry failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function playerBugPayload(event: string, state: NativeAudioState): Record<string, unknown> {
  const cacheState = audioCacheState();
  return {
    event,
    app: "eutherbooks-player",
    version: appVersion,
    build: appBuild,
    endpoint: settings.serverUrl,
    username: settings.username,
    bookId: selectedBookId,
    chapterIndex: selectedChapterIndex,
    settings: {
      modelBackend: settings.modelBackend,
      voiceId: settings.voiceId,
      autoPlay: settings.autoPlay,
      autoNext: settings.autoNext,
      autoBookmark: settings.autoBookmark,
      cacheAudio: settings.cacheAudio,
      sleepTimerMinutes: settings.sleepTimerMinutes,
    },
    jobId: currentJob?.id ?? session?.jobId ?? "",
    currentJob: summarizeJob(currentJob),
    nextJob: summarizeJob(nextJob),
    nativeQueue: {
      queuedUrls: nativeQueuedUrlsKey ? nativeQueuedUrlsKey.split("\n").filter(Boolean).length : 0,
      stateQueueSize: state.queueSize,
      index: state.index,
      sessionStartIndex: nativeQueueSessionStartIndex,
      sessionRelativeIndex: Math.max(0, state.index - nativeQueueSessionStartIndex),
    },
    session: session
      ? {
          partIndex: session.currentIndex,
          partSeconds: session.currentSeconds,
          generatedSeconds: session.generatedSeconds,
          parts: session.audioFiles.length,
          totalParts: session.totalParts,
        }
      : null,
    health: {
      status: health?.status ?? "unknown",
      ttsBackend: health?.tts_backend ?? "unknown",
      audioFreeBytes: health?.storage?.audio_free_bytes ?? null,
      audioDir: health?.storage?.audio_dir ?? null,
      eutherlinkQueuedOrRunning: health?.eutherlink?.queued_or_running ?? null,
      dotsLoadedModel: health?.eutherlink?.dots_tts?.loaded_model ?? null,
      dotsStatus: health?.eutherlink?.dots_tts?.status ?? null,
    },
    cache: {
      enabled: cacheState.enabled,
      cached: cacheState.cached,
      pending: cacheState.pending,
      lastEvent: cacheState.lastEvent,
    },
    nativeAudio: state,
    wakeLock: wakeLockStatus(),
    mediaSession: mediaSessionStatus,
    background: backgroundStateEvent,
    watchdog: {
      active: playbackWatchTimer !== null,
      stuckTicks: stuckPlaybackTicks,
      recovering: watchdogRecovering,
      lastPosition: lastWatchdogPosition,
      sessionKey: lastWatchdogSessionKey,
      currentPosition: currentPlaybackPosition(),
    },
    browserAudio: {
      paused: audio.paused,
      currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      readyState: audio.readyState,
      networkState: audio.networkState,
      src: audio.currentSrc || audio.src || "",
    },
    playback: lastPlaybackEvent,
    playbackEvents,
    userAgent: navigator.userAgent,
    visible: document.visibilityState,
    online: navigator.onLine,
    timestamp: new Date().toISOString(),
  };
}

function setPlaybackEvent(event: string): void {
  lastPlaybackEvent = event;
  if (event && playbackEvents[playbackEvents.length - 1] !== event) {
    playbackEvents = [...playbackEvents, `${new Date().toISOString()} ${event}`].slice(-16);
  }
}

function summarizeJob(job: Job | null): Record<string, unknown> | null {
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    status: job.status,
    owner: job.owner,
    bookId: job.book_id,
    chapters: job.chapter_indexes,
    voice: job.voice,
    modelBackend: job.tts_options?.model_backend ?? null,
    audioFiles: job.audio_files.length,
    totalAudioFiles: job.total_audio_files,
    currentChapterIndex: job.current_chapter_index,
    currentChunkIndex: job.current_chunk_index,
    totalChunks: job.total_chunks,
    workerProgress: job.worker_progress,
    progressLabel: job.progress_label,
    progressDetail: job.progress_detail,
    error: job.error,
  };
}

function isPlaybackPaused(): boolean {
  if (!nativePlaybackActive) {
    return audio.paused;
  }
  const state = nativeAudioState();
  return !state.playing && !isNativeWaitingForMoreAudio(state);
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
    setPlaybackEvent("No bookmark for this voice");
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

function chapterBefore(index: number): Chapter | undefined {
  return chapters.slice().reverse().find((chapter) => chapter.index < index);
}

function chapterAfter(index: number): Chapter | undefined {
  return chapters.find((chapter) => chapter.index > index);
}

function chaptersAfter(index: number, count: number): Chapter[] {
  return chapters.filter((chapter) => chapter.index > index).slice(0, cleanBatchQueueCount(count));
}

function cleanBatchQueueCount(count: number): number {
  return [3, 5, 10, 20].includes(count) ? count : 5;
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
    setPlaybackEvent("Sleep timer paused playback");
    void reportPlaybackTelemetry("sleep-timer-paused", true);
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
  const visibleChapters = filteredChapters();
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
            ${visibleChapters.map((candidate) => `<option value="${candidate.index}" ${candidate.index === selectedChapterIndex ? "selected" : ""}>${escapeHtml(chapterLabel(candidate))}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Find chapter</span>
          <input id="chapter-search" value="${escapeHtml(chapterQuery)}" placeholder="Title or number" />
        </label>
        <div class="chapter-actions">
          <button id="prev-chapter" type="button" ${chapterBefore(selectedChapterIndex) ? "" : "disabled"}>Previous chapter</button>
          <button id="next-chapter" type="button" ${chapterAfter(selectedChapterIndex) ? "" : "disabled"}>Next chapter</button>
        </div>
      </section>

      <section class="voice-grid">
        <label>
          <span>Model</span>
          <select id="model-select">
            ${modelOption("dots.tts-mf", "Dots MF")}
            ${modelOption("dots.tts-soar", "Dots SOAR")}
            ${modelOption("auto-fallback", "Auto fallback")}
            ${modelOption("voxcpm2", "VoxCPM2")}
            ${modelOption("grapheneos-matcha-en", "GrapheneOS Matcha EN")}
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
          <button id="back-30" type="button">-30s</button>
          <button id="forward-30" type="button">+30s</button>
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
        <small>Background: ${escapeHtml(backgroundStateEvent)} · watchdog ${playbackWatchTimer !== null ? "on" : "off"} · stuck ${stuckPlaybackTicks}</small>
        <small>Native audio: ${nativeState.available ? "available" : "off"} · ${nativeState.playing ? "playing" : "paused"} · queue ${nativeState.index}/${nativeState.queueSize} · wake ${nativeState.wakeLockHeld ? "on" : "off"} · wifi ${nativeState.wifiLockHeld ? "on" : "off"} · headset ${nativeState.noisyReceiverRegistered ? "watching" : "off"} · ${escapeHtml(nativeState.lastEvent)}${nativeState.error ? ` · ${escapeHtml(nativeState.error)}` : ""}</small>
        <small>Media: ${escapeHtml(mediaSessionStatus)}</small>
        <small>Cache: ${cacheState.enabled ? "on" : "off"} · ${cacheState.cached} parts · ${cacheState.pending} pending · ${escapeHtml(cacheState.lastEvent)}</small>
        <small>Audio disk free: ${escapeHtml(freeAudioDisk)}</small>
        ${nextJob ? `<small>Next: ${escapeHtml(nextJob.status)} · ${nextJob.audio_files.length}/${Math.max(nextJob.total_audio_files, nextJob.audio_files.length)} parts</small>` : settings.autoNext ? `<small>Next: waiting for current chapter to be ready</small>` : ""}
        <button id="clear-cache" type="button">Clear audio cache</button>
        <button id="report-native-bug" type="button">Report native bug</button>
      </section>

      ${queuePanelMarkup()}

      <section class="beta-panel">
        <strong>Beta roadmap · ${escapeHtml(appBuild)}</strong>
        <ul>
          <li><span class="done">Live</span> Endpoint failover, native HTTP, signed APK pipeline</li>
          <li><span class="done">Live</span> Native Android audio service, foreground playback, wake lock</li>
          <li><span class="done">Live</span> Manual bookmarks, auto-bookmark, resume per voice and model</li>
          <li><span class="done">Live</span> Sleep timer hold, auto-next generation, local audio cache</li>
          <li><span class="done">Live</span> Media Session controls, native queue status, buffer diagnostics</li>
          <li><span class="beta">Beta</span> Versioned APK reports with lock, queue, cache and job telemetry</li>
          <li><span class="done">Live</span> Lockscreen notification controls for previous, play/pause, next and stop</li>
          <li><span class="done">Live</span> Chapter search, previous/next chapter controls and sticky mini-player</li>
          <li><span class="beta">Beta</span> Background playback telemetry and watchdog recovery reports</li>
          <li><span class="beta">Beta</span> Queue diagnostics with auto-next visibility</li>
          <li><span class="beta">Beta</span> Batch chapter queue editor and smarter generated-audio reuse</li>
          <li><span class="next">Next</span> Sleep-ready cache audit and long-playback stability report</li>
        </ul>
      </section>

      ${errorText ? `<p class="error">${escapeHtml(errorText)}</p>` : ""}
      ${miniPlayerMarkup()}
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
    chapterQuery = "";
    userPausedPlayback = false;
    currentJob = null;
    clearLookaheadQueue();
    session = null;
    persistSelection();
    void loadChapters().then(() => refreshAll());
  });
  document.querySelector<HTMLInputElement>("#chapter-search")?.addEventListener("input", (event) => {
    chapterQuery = (event.currentTarget as HTMLInputElement).value;
    deferRendersFor(900);
    render();
  });
  document.querySelector<HTMLSelectElement>("#chapter-select")?.addEventListener("change", (event) => {
    selectChapter(Number((event.currentTarget as HTMLSelectElement).value));
  });
  document.querySelector<HTMLButtonElement>("#prev-chapter")?.addEventListener("click", () => selectRelativeChapter(-1));
  document.querySelector<HTMLButtonElement>("#next-chapter")?.addEventListener("click", () => selectRelativeChapter(1));
  document.querySelector<HTMLSelectElement>("#model-select")?.addEventListener("change", (event) => {
    updateSettings({ ...settings, modelBackend: (event.currentTarget as HTMLSelectElement).value as AppSettings["modelBackend"] });
    userPausedPlayback = false;
    currentJob = null;
    clearLookaheadQueue();
    session = null;
    render();
  });
  document.querySelector<HTMLSelectElement>("#voice-select")?.addEventListener("change", (event) => {
    updateSettings({ ...settings, voiceId: (event.currentTarget as HTMLSelectElement).value });
    userPausedPlayback = false;
    currentJob = null;
    clearLookaheadQueue();
    session = null;
    void refreshAll();
  });
  document.querySelector<HTMLButtonElement>("#generate")?.addEventListener("click", () => {
    if (selectedChapterHasAudio()) {
      const confirmed = window.confirm("This chapter already has generated audio for the selected voice and model. Regenerate it now?");
      if (!confirmed) {
        setPlaybackEvent("Generate cancelled");
        render();
        return;
      }
    }
    void generateCurrentChapter(true);
  });
  document.querySelector<HTMLButtonElement>("#bookmark")?.addEventListener("click", () => {
    saveCurrentBookmark(false);
    setPlaybackEvent("Bookmark saved");
    render();
  });
  document.querySelector<HTMLButtonElement>("#resume-bookmark")?.addEventListener("click", () => resumeBookmark());
  document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => togglePlayback("Player"));
  document.querySelector<HTMLButtonElement>("#mini-play")?.addEventListener("click", () => togglePlayback("Mini player"));
  document.querySelector<HTMLButtonElement>("#mini-prev-chapter")?.addEventListener("click", () => playRelativeChapter(-1, "Mini previous"));
  document.querySelector<HTMLButtonElement>("#mini-next-chapter")?.addEventListener("click", () => playRelativeChapter(1, "Mini next"));
  document.querySelector<HTMLButtonElement>("#back-30")?.addEventListener("click", () => {
    seekBy(-30);
    render();
  });
  document.querySelector<HTMLButtonElement>("#forward-30")?.addEventListener("click", () => {
    seekBy(30);
    render();
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
  document.querySelector<HTMLButtonElement>("#prefetch-next")?.addEventListener("click", () => {
    void ensureNextJob(true);
  });
  document.querySelector<HTMLSelectElement>("#batch-count")?.addEventListener("change", (event) => {
    batchQueueCount = Math.max(1, Number((event.currentTarget as HTMLSelectElement).value));
    localStorage.setItem("eutherbooks-player-batch-count", String(batchQueueCount));
    render();
  });
  document.querySelector<HTMLButtonElement>("#batch-queue")?.addEventListener("click", () => {
    void queueChapterBatch();
  });
  document.querySelector<HTMLButtonElement>("#sync-native-queue")?.addEventListener("click", () => {
    void updateNativeQueue("manual").then(() => render());
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

function queuePanelMarkup(): string {
  const nativeState = nativeAudioState();
  const nextChapter = chapterAfter(selectedChapterIndex);
  const queueUrls = nativeQueueUrlsWithNext();
  const batchTargets = chaptersAfter(selectedChapterIndex, batchQueueCount);
  const batchLabel = batchTargets.length > 0
    ? `${batchTargets.length} chapters`
    : "End of book";
  const relevantJobs = allJobs
    .filter((job) => job.book_id === selectedBookId && job.owner === "eutherbooks-player")
    .slice()
    .reverse()
    .slice(0, 5);
  const currentParts = currentJob
    ? `${currentJob.audio_files.length}/${Math.max(currentJob.total_audio_files, currentJob.audio_files.length)}`
    : "0/0";
  const nextParts = nextJob
    ? `${nextJob.audio_files.length}/${Math.max(nextJob.total_audio_files, nextJob.audio_files.length)}`
    : "0/0";
  return `
      <section class="queue-panel">
        <div class="queue-head">
          <strong>Queue</strong>
          <span>${queueUrls.length} audio parts · native ${nativeState.index}/${nativeState.queueSize}</span>
        </div>
        <div class="queue-actions">
          <button id="prefetch-next" type="button" ${nextChapter && currentJob ? "" : "disabled"}>Prefetch next</button>
          <button id="sync-native-queue" type="button" ${nativePlaybackActive && session ? "" : "disabled"}>Sync native queue</button>
        </div>
        <div class="batch-actions">
          <select id="batch-count" aria-label="Batch chapter count">
            ${[3, 5, 10, 20].map((count) => `<option value="${count}" ${count === batchQueueCount ? "selected" : ""}>Next ${count}</option>`).join("")}
          </select>
          <button id="batch-queue" type="button" ${batchQueueInFlight || batchTargets.length === 0 ? "disabled" : ""}>Queue batch</button>
          <span>${escapeHtml(batchLabel)}</span>
        </div>
        <div class="queue-grid">
          <span>Current</span>
          <strong>${escapeHtml(currentJob ? chapterLabel(selectedChapter() ?? { index: selectedChapterIndex, title: "Selected chapter" }) : "No current job")}</strong>
          <em>${escapeHtml(currentJob?.status ?? "idle")} · ${currentParts} parts</em>
          <span>Next</span>
          <strong>${escapeHtml(nextChapter ? chapterLabel(nextChapter) : "End of book")}</strong>
          <em>${escapeHtml(nextJob?.status ?? (settings.autoNext ? "waiting" : "manual"))} · ${nextParts} parts</em>
        </div>
        <div class="job-list">
          ${relevantJobs.length
            ? relevantJobs.map((job) => `<small>${escapeHtml(jobSummary(job))}</small>`).join("")
            : "<small>No recent jobs for this book</small>"}
        </div>
      </section>
  `;
}

function miniPlayerMarkup(): string {
  const book = selectedBook();
  const chapter = selectedChapter();
  const position = session ? `${formatTime(sessionPosition(session))} / ${formatTime(session.generatedSeconds)}` : "0:00 / 0:00";
  return `
      <section class="mini-player">
        <div>
          <strong>${escapeHtml(book?.title ?? "EutherBooks")}</strong>
          <small>${escapeHtml(chapter ? chapterLabel(chapter) : statusText)} · ${escapeHtml(position)}</small>
        </div>
        <button id="mini-prev-chapter" type="button" aria-label="Previous chapter" ${chapterBefore(selectedChapterIndex) ? "" : "disabled"}>Prev</button>
        <button id="mini-play" type="button">${isPlaybackPaused() ? "Play" : "Pause"}</button>
        <button id="mini-next-chapter" type="button" aria-label="Next chapter" ${chapterAfter(selectedChapterIndex) ? "" : "disabled"}>Next</button>
      </section>
  `;
}

function filteredChapters(): Chapter[] {
  const query = chapterQuery.trim().toLowerCase();
  if (!query) {
    return chapters;
  }
  const selected = selectedChapter();
  const matches = chapters.filter((chapter) => {
    const label = chapterLabel(chapter).toLowerCase();
    return label.includes(query) || String(chapterNumber(chapter)).includes(query) || String(chapter.index + 1).includes(query);
  });
  if (selected && !matches.some((chapter) => chapter.index === selected.index)) {
    return [selected, ...matches];
  }
  return matches;
}

function jobSummary(job: Job): string {
  const chapter = chapters.find((candidate) => candidate.index === (job.chapter_indexes[0] ?? -1));
  const label = chapter ? chapterLabel(chapter) : `Chapter ${job.chapter_indexes.join(", ") || "?"}`;
  const ready = `${job.audio_files.length}/${Math.max(job.total_audio_files, job.audio_files.length)}`;
  return `${job.status} · ${label} · ${ready} parts · ${job.voice}`;
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

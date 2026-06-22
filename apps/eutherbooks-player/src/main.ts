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
  hostConfigCandidates,
  loadBookmarks,
  loadServerRouteConfig,
  loadSettings,
  saveBookmark,
  saveServerRouteConfig,
  saveSettings,
  serverCandidates,
  toEutherBooksUrl,
} from "./storage";
import { AppSettings, Book, Bookmark, Chapter, Health, HostUserPreferences, Job, PlaybackSession, ServerRouteConfig, Voice } from "./types";
import { appBuild, appVersion } from "./version";
import { requestBatteryOptimizationExemption, setPlaybackWakeLock, wakeLockStatus } from "./wake-lock";

const root = document.querySelector<HTMLDivElement>("#app");
const minAutoNextFreeBytes = 512 * 1024 * 1024;
const minNativeLookaheadChapters = 5;

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
let appView: "player" | "debug" = localStorage.getItem("eutherbooks-player-view") === "debug" ? "debug" : "player";
let settingsPanelOpen = localStorage.getItem("eutherbooks-player-settings-open") === "true";
let chapterQuery = "";
let batchQueueCount = cleanBatchQueueCount(Number(localStorage.getItem("eutherbooks-player-batch-count") ?? 5));
let currentJob: Job | null = null;
let nextJob: Job | null = null;
let nextJobKey = "";
let secondNextJob: Job | null = null;
let secondNextJobKey = "";
let nextJobRequestInFlight = false;
let batchQueueInFlight = false;
let nativeLookaheadRequestInFlight = false;
let nativeLookaheadRetryAfter = 0;
let endpointSwitchInFlight = false;
let endpointSwitchRetryAfter = 0;
let failedJobRecoveryInFlight = false;
let failedJobRecoveryKey = "";
let session: PlaybackSession | null = null;
let statusText = "Ready";
let endpointText = "";
let errorText = "";
let lastEndpointErrors: string[] = [];
let pollTimer: number | null = null;
let sleepTimer: number | null = null;
let sleepDeadline = 0;
let sleepTimerMode: "off" | "minutes" | "chapter-end" = localStorage.getItem("eutherbooks-player-sleep-mode") === "chapter-end" ? "chapter-end" : "off";
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
let optimisticPlaybackState: "playing" | "paused" | null = null;
let optimisticPlaybackUntil = 0;
let nativeQueuedUrlsKey = "";
let nativeQueueSessionStartIndex = 0;
let nativeServiceQueuePrefix: string[] = [];
let nativeRegressionResyncInFlight = false;
let nativeAdvanceBufferKey = "";
let nativeAdvanceBufferRetryAfter = 0;
let lastNativeSeekCommandAt = 0;
let nativePlayRequestUntil = 0;
let nativePlayConfirmTimer: ReturnType<typeof window.setTimeout> | null = null;
let nativePlayConfirmToken = 0;
let lastAutoBookmarkAt = 0;
let lastBugReportKey = "";
let lastWatchdogPosition = -1;
let lastWatchdogSessionKey = "";
let stuckPlaybackTicks = 0;
let watchdogRecovering = false;
let watchdogRecoveryCount = 0;
let lastWatchdogDiagnosis = "steady";
let lastWatchdogRecovery = "none";
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
  void recoverEndpointAfterNetworkError("browser-audio-error");
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
  void refreshServerRouteConfig();
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
  void refreshServerRouteConfig();
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
      if (candidate !== settings.serverUrl) {
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
    await loadRemotePlayerPreferences(serverUrl);
  } catch (err) {
    if (serverUrl === settings.serverUrl && isAuthRejectedError(err)) {
      updateSettings({ ...settings, authToken: "" });
      errorText = err instanceof Error ? `Saved login expired: ${err.message}` : "Saved login expired";
    }
    throw err;
  }
}

async function loadRemotePlayerPreferences(serverUrl = settings.serverUrl): Promise<void> {
  if (!settings.authToken) {
    return;
  }
  const preferences = await EutherBooksApi.userPreferences(serverUrl, settings.authToken);
  applyRemotePlayerPreferences(preferences);
}

function applyRemotePlayerPreferences(preferences: HostUserPreferences): void {
  const remoteServerUrl = typeof preferences.eutherbooksPlayerServerUrl === "string"
    ? toEutherBooksUrl(preferences.eutherbooksPlayerServerUrl)
    : "";
  const publicServerUrl = toEutherBooksUrl(routeConfig.publicServerUrl ?? defaultPublicServerUrl());
  const serverUrl = remoteServerUrl && !isLanEndpoint(remoteServerUrl)
    ? remoteServerUrl
    : publicServerUrl;
  const username = typeof preferences.eutherbooksPlayerUsername === "string"
    ? preferences.eutherbooksPlayerUsername.trim()
    : "";
  const modelBackend = normalizeModelBackend(preferences.eutherbooksPlayerModelBackend);
  const voiceId = typeof preferences.eutherbooksVoice === "string" && preferences.eutherbooksVoice.trim()
    ? preferences.eutherbooksVoice.trim()
    : "";
  const nextSettings = {
    ...settings,
    ...(serverUrl ? { serverUrl } : {}),
    ...(username ? { username } : {}),
    ...(modelBackend ? { modelBackend } : {}),
    ...(voiceId ? { voiceId } : {}),
  };
  if (settingsChanged(settings, nextSettings)) {
    updateSettings(nextSettings);
  }
}

function defaultPublicServerUrl(): string {
  return "https://apothictech.se:8443/eutherbooks";
}

function isAuthRejectedError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return /\b(401|403)\b/.test(err.message);
}

async function saveRemotePlayerPreferences(): Promise<void> {
  if (!settings.authToken) {
    return;
  }
  const existing = await EutherBooksApi.userPreferences(settings.serverUrl, settings.authToken).catch(() => ({} as HostUserPreferences));
  await EutherBooksApi.updateUserPreferences(settings.serverUrl, settings.authToken, {
    ...existing,
    eutherbooksVoice: settings.voiceId,
    eutherbooksPlayerServerUrl: settings.serverUrl,
    eutherbooksPlayerUsername: settings.username,
    eutherbooksPlayerModelBackend: settings.modelBackend,
  });
}

function settingsChanged(left: AppSettings, right: AppSettings): boolean {
  return left.serverUrl !== right.serverUrl
    || left.username !== right.username
    || left.authToken !== right.authToken
    || left.voiceId !== right.voiceId
    || left.modelBackend !== right.modelBackend
    || left.autoPlay !== right.autoPlay
    || left.autoNext !== right.autoNext
    || left.autoBookmark !== right.autoBookmark
    || left.cacheAudio !== right.cacheAudio
    || left.sleepTimerMinutes !== right.sleepTimerMinutes;
}

function normalizeModelBackend(value: unknown): AppSettings["modelBackend"] | "" {
  return value === "dots.tts-mf"
    || value === "dots.tts-soar"
    || value === "auto-fallback"
    || value === "voxcpm2"
    || value === "grapheneos-matcha-en"
    ? value
    : "";
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
  const failed = jobs
    .filter((job) =>
      job.book_id === selectedBookId
      && job.chapter_indexes.includes(selectedChapterIndex)
      && job.voice === settings.voiceId
      && job.tts_options?.model_backend === settings.modelBackend
      && job.status === "failed"
    )
    .reverse()[0];
  const matching = jobs
    .filter((job) =>
      job.book_id === selectedBookId
      && job.chapter_indexes.includes(selectedChapterIndex)
      && job.voice === settings.voiceId
      && job.tts_options?.model_backend === settings.modelBackend
      && isUsableJob(job)
    )
    .reverse();
  const playable = matching.find(isPlayableJob);
  currentJob = playable ?? matching[0] ?? null;
  if (currentJob) {
    session = sessionFromJob(currentJob, session);
    applyBookmarkToSession();
    warmAudioCacheForSession();
    attachExistingNextJob(jobs);
    void maybeEnsureNextAhead("attach");
  } else if (failed) {
    currentJob = failed;
    session = null;
    void recoverFailedCurrentJob("attach-failed");
  } else {
    session = null;
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

async function stopAllActiveJobs(): Promise<void> {
  const activeCount = allJobs.filter(isActiveJob).length;
  if (activeCount <= 0) {
    statusText = "No active jobs to stop";
    render();
    return;
  }
  if (!window.confirm(`Stop ${activeCount} active EutherBooks job${activeCount === 1 ? "" : "s"}? Are you sure?`)) {
    return;
  }
  stopPlayback(false);
  clearLookaheadQueue();
  statusText = "Stopping active jobs";
  setPlaybackEvent("Stop all active jobs requested");
  render();
  try {
    const result = await api.cancelActiveJobs();
    currentJob = currentJob && isActiveJob(currentJob) ? null : currentJob;
    session = currentJob ? session : null;
    allJobs = await api.jobs();
    statusText = `Stopped ${result.cancelled} active job${result.cancelled === 1 ? "" : "s"}`;
    setPlaybackEvent(statusText);
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Could not stop active jobs";
  } finally {
    render();
  }
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
      if (!currentJobMatchesSelection(currentJob)) {
        setPlaybackEvent("Discarded stale job for another chapter");
        allJobs = await api.jobs();
        currentJob = null;
        session = null;
        clearLookaheadQueue();
        attachExistingJob(allJobs);
        render();
        schedulePoll(500);
        return;
      }
      if (await recoverFailedCurrentJob("poll-current")) {
        render();
        schedulePoll(1000);
        return;
      }
      const shouldAutoPlayCurrent = settings.autoPlay
        && !userPausedPlayback
        && currentJob.audio_files.length > 0
        && currentJob.status !== "failed"
        && (!session || session.jobId !== currentJob.id || isPlaybackPaused());
      session = sessionFromJob(currentJob, session);
      warmAudioCacheForSession();
      void updateNativeQueue("poll-current");
      if (shouldAutoPlayCurrent) {
        await playFromSession("auto");
      }
      void maybeEnsureNextAhead("poll-current");
    }
    if (nextJob) {
      nextJob = await api.job(nextJob.id);
      if (nextJob.status === "failed") {
        nextJob = null;
        nextJobKey = "";
        void ensureNextJob();
      }
      warmAudioCacheForJob(nextJob);
      void updateNativeQueue("poll-next");
      void ensureSecondNextJob("poll-next");
    }
    if (secondNextJob) {
      secondNextJob = await api.job(secondNextJob.id);
      if (secondNextJob.status === "failed") {
        secondNextJob = null;
        secondNextJobKey = "";
      }
      warmAudioCacheForJob(secondNextJob);
      void updateNativeQueue("poll-second-next");
      void ensureNativeLookahead("poll-second-next");
    } else if (currentJob?.status === "done" && settings.autoNext) {
      void maybeEnsureNextAhead("poll-ready");
    }
    statusText = currentJob ? currentJob.progress_label || currentJob.status : "Ready";
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Poll failed";
    if (await recoverEndpointAfterNetworkError("poll-failed")) {
      render();
      schedulePoll(900);
      return;
    }
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
  void ensureNativeLookahead(reason);
}

async function ensureNativeLookahead(reason: string): Promise<void> {
  if (
    nativeLookaheadRequestInFlight
    || batchQueueInFlight
    || Date.now() < nativeLookaheadRetryAfter
    || !settings.autoNext
    || !selectedBookId
    || !currentJob
    || currentJob.status !== "done"
    || !sessionMatchesCurrentSelection()
  ) {
    return;
  }
  const targets = chaptersAfter(selectedChapterIndex, Math.max(minNativeLookaheadChapters, batchQueueCount));
  if (targets.length === 0) {
    return;
  }
  nativeLookaheadRequestInFlight = true;
  try {
    health = await api.health();
    if (!hasEnoughDiskForAutoNext()) {
      statusText = "Lookahead held: low audio disk space";
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
    const lookaheadJobs = targets
      .map((chapter) => {
        const created = createdJobs.find((job) => job.chapter_indexes.includes(chapter.index));
        return created ?? matchingJobForChapter(allJobs, chapter.index);
      })
      .filter((job): job is Job => Boolean(job));
    allJobs = lookaheadJobs.reduce((jobs, job) => upsertJobList(jobs, job), allJobs);
    for (const job of lookaheadJobs) {
      warmAudioCacheForJob(job);
      attachBatchLookaheadJob(job);
    }
    if (createdJobs.length > 0) {
      schedulePoll(1000);
      setPlaybackEvent(`Lookahead queued ${createdJobs.length}: ${reason}`);
    }
    nativeLookaheadRetryAfter = 0;
    void updateNativeQueue(`lookahead:${reason}`);
  } catch (err) {
    nativeLookaheadRetryAfter = Date.now() + 20_000;
    setPlaybackEvent(`Lookahead held: ${err instanceof Error ? err.message : "failed"}`);
  } finally {
    nativeLookaheadRequestInFlight = false;
  }
}

async function recoverFailedCurrentJob(reason: string): Promise<boolean> {
  if (!currentJob || currentJob.status !== "failed" || isPlayableJob(currentJob) || failedJobRecoveryInFlight) {
    return false;
  }
  if (!selectedBookId || !settings.autoNext) {
    statusText = "Chapter failed; regenerate it to continue";
    setPlaybackEvent(statusText);
    return false;
  }
  const key = `${currentJob.id}:${selectedPlaybackKey()}`;
  if (failedJobRecoveryKey === key) {
    return false;
  }
  failedJobRecoveryInFlight = true;
  failedJobRecoveryKey = key;
  try {
    stopPlayback(false);
    clearLookaheadQueue();
    statusText = "Chapter failed; regenerating";
    setPlaybackEvent(`Recovering failed chapter: ${reason}`);
    currentJob = await api.createJob(selectedBookId, selectedChapterIndex, settings, selectedVoice(), false, true);
    session = currentJob.audio_files.length ? sessionFromJob(currentJob, null) : null;
    allJobs = upsertJobList(allJobs, currentJob);
    schedulePoll(500);
    return true;
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Could not recover failed chapter";
    failedJobRecoveryKey = "";
    return false;
  } finally {
    failedJobRecoveryInFlight = false;
  }
}

async function playFromSession(mode: "manual" | "auto" = "manual"): Promise<void> {
  if (mode === "auto" && userPausedPlayback) {
    setPlaybackEvent("Auto-play held by manual pause");
    return;
  }
  if (currentJob?.status === "failed" && !isPlayableJob(currentJob)) {
    if (await recoverFailedCurrentJob("play")) {
      render();
      return;
    }
  }
  if (!session || session.audioFiles.length === 0) {
    clearOptimisticPlaybackState();
    setPlaybackEvent("No playable audio loaded");
    return;
  }
  const path = session.audioFiles[session.currentIndex];
  if (!path) {
    clearOptimisticPlaybackState();
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
  const previousState = nativeAudioState();
  const keepNativeQueuePosition = mode === "auto"
    && nativePlaybackActive
    && previousState.active
    && !previousState.ended
    && nativeServiceQueuePrefix.length > 0
    && nativeQueuedUrlsKey.length > 0;
  if (!keepNativeQueuePosition) {
    nativeServiceQueuePrefix = [];
    nativeQueueSessionStartIndex = 0;
  }
  const queue = nativeQueueUrlsForService();
  nativeQueuedUrlsKey = queue.join("\n");
  const startIndex = keepNativeQueuePosition
    ? nativeAbsoluteIndexForSession(session.currentIndex)
    : session.currentIndex;
  if (mode === "manual") {
    userPausedPlayback = false;
  }
  audio.pause();
  const startPositionSeconds = session.currentSeconds;
  const nativeTitle = book?.title ?? "EutherBooks";
  const nativeSubtitle = chapter ? chapterLabel(chapter) : "Audiobook";
  const state = await playNativeAudioQueue(
    queue,
    startIndex,
    startPositionSeconds,
    nativeTitle,
    nativeSubtitle,
    nativeQueueManifest(),
  );
  nativePlayRequestUntil = Date.now() + 20_000;
  scheduleNativePlayConfirmation(mode, queue, startIndex, startPositionSeconds, nativeTitle, nativeSubtitle);
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


function clearNativePlayConfirmation(): void {
  nativePlayConfirmToken += 1;
  if (nativePlayConfirmTimer) {
    window.clearTimeout(nativePlayConfirmTimer);
    nativePlayConfirmTimer = null;
  }
}

function scheduleNativePlayConfirmation(
  mode: "manual" | "auto",
  queue: string[],
  startIndex: number,
  positionSeconds: number,
  title: string,
  subtitle: string,
): void {
  clearNativePlayConfirmation();
  const token = nativePlayConfirmToken;
  const queuedUrls = [...queue];
  nativePlayConfirmTimer = window.setTimeout(() => {
    nativePlayConfirmTimer = null;
    void confirmNativePlayStarted(token, mode, queuedUrls, startIndex, positionSeconds, title, subtitle);
  }, 4_000);
}

async function confirmNativePlayStarted(
  token: number,
  mode: "manual" | "auto",
  queue: string[],
  startIndex: number,
  positionSeconds: number,
  title: string,
  subtitle: string,
): Promise<void> {
  if (token !== nativePlayConfirmToken || !nativePlaybackActive || isPlaybackPaused()) {
    return;
  }
  await refreshNativePlayback();
  const state = nativeAudioState();
  if (token !== nativePlayConfirmToken || !nativePlaybackActive || state.playing || state.ended || !isNativePlayRequestPending(state)) {
    return;
  }
  const retryPosition = state.positionSeconds > 0 ? state.positionSeconds : positionSeconds;
  const retryState = await playNativeAudioQueue(queue, startIndex, retryPosition, title, subtitle, nativeQueueManifest());
  nativePlayRequestUntil = Date.now() + 10_000;
  applyNativeAudioState(retryState);
  setPlaybackEvent(mode === "auto" ? "Native auto-play confirmed" : "Native manual play confirmed");
  await reportPlaybackTelemetry(mode === "auto" ? "native-auto-play-confirm" : "native-manual-play-confirm", true);
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
  if (currentJob?.status === "failed" && !isPlayableJob(currentJob)) {
    if (await recoverFailedCurrentJob("chapter-end")) {
      render();
      return;
    }
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
  if (sleepTimerMode === "chapter-end") {
    stopPlayback(true, true);
    setSleepTimerMode("off", 0);
    statusText = "Sleep timer stopped at chapter end";
    setPlaybackEvent("Sleep timer stopped at chapter end");
    void reportPlaybackTelemetry("sleep-timer-chapter-end", true);
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
  if (isNativePlayRequestPending()) {
    setPlaybackEvent(`${source}: native play starting`);
    updatePlayerShell();
    return;
  }
  if (isPlaybackPaused()) {
    setPlaybackEvent(`${source}: play`);
    setOptimisticPlaybackState("playing");
    void playFromSession("manual");
    return;
  }
  pausePlayback(source);
}

function pausePlayback(source = "Manual pause"): void {
  setOptimisticPlaybackState("paused");
  stopPlayback(true, true);
  statusText = "Paused";
  setPlaybackEvent(source);
  updatePlayerShell();
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
  const wasNativePlaybackActive = nativePlaybackActive;
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
  if (wasNativePlaybackActive) {
    nativePlaybackActive = false;
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
  lastWatchdogDiagnosis = "stopped";
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
    void recoverEndpointAfterNetworkError("network-online", true);
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
      lastWatchdogDiagnosis = playbackStallDiagnosis(state);
      void maybeEnsureNextAhead("watchdog-native-buffering");
      void recoverEndpointAfterNetworkError("watchdog-native-buffering");
      void updateNativeQueue("watchdog-native-buffering");
    }
    if (isNativePlayRequestPending(state)) {
      lastWatchdogDiagnosis = playbackStallDiagnosis(state);
      lastWatchdogPosition = currentPlaybackPosition();
      lastWatchdogSessionKey = watchdogSessionKey();
      stuckPlaybackTicks = 0;
      return;
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
    lastWatchdogDiagnosis = moved ? "moving" : "near generated edge";
    return;
  }
  stuckPlaybackTicks += 1;
  lastWatchdogDiagnosis = playbackStallDiagnosis(nativeAudioState());
  if (stuckPlaybackTicks < 12 || watchdogRecovering) {
    return;
  }
  watchdogRecovering = true;
  watchdogRecoveryCount += 1;
  setPlaybackEvent(`Watchdog stalled at ${formatTime(position)}; ${lastWatchdogDiagnosis}`);
  await reportPlaybackTelemetry(`playback-watchdog-stalled:${lastWatchdogDiagnosis}`, true);
  try {
    await recoverStalledPlayback(position);
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

function playbackStallDiagnosis(state = nativeAudioState()): string {
  if (nativePlaybackActive && isNativeWaitingForMoreAudio(state)) {
    if (nextJob && !isCompleteJob(nextJob)) {
      return `native waiting for next chapter ${nextJob.audio_files.length}/${Math.max(nextJob.total_audio_files, nextJob.audio_files.length)} parts`;
    }
    return "native waiting for queue extension";
  }
  if (nativePlaybackActive && state.playing) {
    return "native playing but position stalled";
  }
  if (nativePlaybackActive && state.active && !state.playing) {
    return `native paused while active: ${state.lastEvent || "unknown"}`;
  }
  if (!nativePlaybackActive && !audio.paused) {
    return `browser audio stalled ready=${audio.readyState} network=${audio.networkState}`;
  }
  return "playback not moving";
}

async function recoverStalledPlayback(position: number): Promise<void> {
  const reason = lastWatchdogDiagnosis || "unknown";
  lastWatchdogRecovery = `refreshing queue: ${reason}`;
  setPlaybackEvent(`Watchdog recovery: refreshing queue at ${formatTime(position)}`);
  try {
    const jobs = await api.jobs();
    allJobs = jobs;
    const matchingCurrent = matchingJobForChapter(jobs, selectedChapterIndex);
    const sameChapterCurrent = currentJob?.chapter_indexes.includes(selectedChapterIndex)
      ? jobs.find((job) => job.id === currentJob?.id)
      : null;
    const freshCurrent = matchingCurrent ?? sameChapterCurrent;
    if (freshCurrent) {
      currentJob = freshCurrent;
      if (isPlayableJob(freshCurrent)) {
        const refreshedSession = sessionFromJob(freshCurrent, session);
        session = refreshedSession;
        setSessionPartPosition(refreshedSession.currentIndex, refreshedSession.currentSeconds);
        warmAudioCacheForSession();
      }
    }
    attachExistingNextJob(jobs);
    await maybeEnsureNextAhead("watchdog-stall-recovery");
    await ensureNextJob(true);
    await ensureSecondNextJob("watchdog-stall-recovery");
    await ensureNativeLookahead("watchdog-stall-recovery");
    await recoverEndpointAfterNetworkError("watchdog-stall-recovery", true);
    if (nativePlaybackActive) {
      await updateNativeQueue("watchdog-stall-recovery");
      await refreshNativePlayback();
    }
    lastWatchdogRecovery = `restarting audio: ${reason}`;
    await playFromSession("auto");
    lastWatchdogRecovery = `recovered at ${new Date().toLocaleTimeString()}: ${reason}`;
    await reportPlaybackTelemetry("playback-watchdog-recovered", true);
  } catch (err) {
    lastWatchdogRecovery = `failed: ${err instanceof Error ? err.message : String(err)}`;
    setPlaybackEvent(`Watchdog recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    await playFromSession("auto");
  }
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


function currentJobMatchesSelection(job: Job | null): boolean {
  return Boolean(
    job
    && job.book_id === selectedBookId
    && job.chapter_indexes.includes(selectedChapterIndex)
    && job.voice === settings.voiceId
    && job.tts_options?.model_backend === settings.modelBackend,
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
  const matchingJob = matchingJobForChapter(allJobs, selectedChapterIndex);
  return Boolean(
    (
      currentJob
      && jobPlaybackKey(currentJob) === selectedPlaybackKey()
      && isPlayableJob(currentJob)
    )
    || (matchingJob && isPlayableJob(matchingJob)),
  );
}

function isActiveJob(job: Job): boolean {
  return job.status === "queued" || job.status === "running";
}

function isCompleteJob(job: Job): boolean {
  return job.status === "done"
    && job.audio_files.length > 0
    && (job.total_audio_files <= 0 || job.audio_files.length >= job.total_audio_files);
}

function isPlayableJob(job: Job): boolean {
  return isCompleteJob(job) || (isActiveJob(job) && job.audio_files.length > 0);
}

function isUsableJob(job: Job): boolean {
  return isActiveJob(job) || isCompleteJob(job);
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

function nativeLookaheadJobs(): Job[] {
  return chaptersAfter(selectedChapterIndex, Math.max(minNativeLookaheadChapters, batchQueueCount))
    .map((chapter) => matchingJobForChapter(allJobs, chapter.index))
    .filter((job): job is Job => job !== null && job.status !== "failed");
}

function nativeManifestJobs(): Job[] {
  return [currentJob, ...nativeLookaheadJobs()]
    .filter((job): job is Job => job !== null && job.status !== "failed");
}

function nativeQueueUrlsWithNext(): string[] {
  if (!session) {
    return [];
  }
  const currentUrls = session.audioFiles.map((candidate) => api.audioUrl(candidate));
  const lookaheadUrls = nativeLookaheadJobs()
    .flatMap((job) => job.audio_files.map((candidate) => api.audioUrl(candidate)));
  return [...currentUrls, ...lookaheadUrls];
}

function nativeQueueUrlsForService(): string[] {
  return [...nativeServiceQueuePrefix, ...nativeQueueUrlsWithNext()];
}

function nativeQueueManifest(): NativeQueueManifest | null {
  if (!session) {
    return null;
  }
  const baseUrl = currentApiBaseUrl();
  if (!baseUrl) {
    return null;
  }
  const manifestUrls = nativeManifestJobs()
    .map((job) => `${baseUrl}/jobs/${encodeURIComponent(job.id)}`);
  if (manifestUrls.length === 0) {
    return null;
  }
  return {
    manifestUrls,
    audioBaseUrl: `${baseUrl}/audio/`,
    startIndex: nativeServiceQueuePrefix.length,
  };
}

function currentApiBaseUrl(): string {
  return (endpointText || settings.serverUrl).replace(/\/+$/, "");
}

async function recoverEndpointAfterNetworkError(reason: string, force = false): Promise<boolean> {
  if (endpointSwitchInFlight || (!force && Date.now() < endpointSwitchRetryAfter)) {
    return false;
  }
  endpointSwitchInFlight = true;
  try {
    await refreshServerRouteConfig();
    const currentBaseUrl = currentApiBaseUrl();
    const candidates = failoverServerCandidates(currentBaseUrl);
    for (const candidate of candidates) {
      try {
        const nextApi = new EutherBooksApi(candidate, settings.authToken);
        const [nextHealth, jobs] = await Promise.all([nextApi.health(), nextApi.jobs()]);
        api = nextApi;
        endpointText = candidate;
        health = nextHealth;
        allJobs = jobs;
        attachExistingJob(jobs);
        nativeQueuedUrlsKey = "";
        endpointSwitchRetryAfter = 0;
        setPlaybackEvent(`Endpoint switched: ${reason}`);
        if (nativePlaybackActive) {
          void updateNativeQueue(`endpoint-switch:${reason}`);
        } else if (!isPlaybackPaused() && session?.audioFiles.length) {
          void playFromSession("auto");
        }
        return candidate !== currentBaseUrl;
      } catch (_err) {
      }
    }
    endpointSwitchRetryAfter = Date.now() + 10_000;
  } finally {
    endpointSwitchInFlight = false;
  }
  return false;
}

function failoverServerCandidates(currentBaseUrl: string): string[] {
  const current = currentBaseUrl.replace(/\/+$/, "");
  const candidates = serverCandidates(settings.serverUrl, routeConfig)
    .map((candidate) => candidate.replace(/\/+$/, ""));
  const alternatives = candidates.filter((candidate) => candidate && candidate !== current);
  const currentIsLan = isLanEndpoint(current);
  alternatives.sort((left, right) => {
    const leftLan = isLanEndpoint(left);
    const rightLan = isLanEndpoint(right);
    if (leftLan === rightLan) {
      return 0;
    }
    return currentIsLan ? (leftLan ? 1 : -1) : (leftLan ? -1 : 1);
  });
  return [...new Set([...alternatives, current].filter(Boolean))];
}

function isLanEndpoint(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost"
      || host === "127.0.0.1"
      || host.startsWith("10.")
      || host.startsWith("192.168.")
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch (_err) {
    return false;
  }
}

function selectedNextPlaybackKey(): string {
  const nextChapter = chapterAfter(selectedChapterIndex);
  return nextChapter ? selectedPlaybackKey(nextChapter.index) : "";
}

function matchingJobForChapter(jobs: Job[], chapterIndex: number): Job | null {
  const matching = jobs
    .filter((job) =>
      job.book_id === selectedBookId
      && job.chapter_indexes.includes(chapterIndex)
      && job.voice === settings.voiceId
      && job.tts_options?.model_backend === settings.modelBackend
      && isUsableJob(job)
    )
    .reverse();
  return matching.find(isCompleteJob)
    ?? matching.find((job) => isActiveJob(job) && job.audio_files.length > 0)
    ?? matching[0]
    ?? null;
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
  let changedChapter = false;
  let relativeIndex = Math.max(0, state.index - nativeQueueSessionStartIndex);
  let advanceGuard = 0;
  while (session && relativeIndex >= session.audioFiles.length && advanceGuard < 8) {
    const currentPartCount = session.audioFiles.length;
    if (!prepareNextJobForNativeAdvance()) {
      break;
    }
    nativeServiceQueuePrefix = nativeServiceQueuePrefix.concat(session.audioFiles.map((candidate) => api.audioUrl(candidate)));
    nativeQueueSessionStartIndex += currentPartCount;
    relativeIndex = Math.max(0, relativeIndex - currentPartCount);
    if (!advanceToNextJobSession(0, 0, "Native advanced to next chapter")) {
      break;
    }
    changedChapter = true;
    advanceGuard += 1;
  }
  if (shouldResyncNativeRegression(relativeIndex, state.positionSeconds, state)) {
    void resyncNativeAfterRegression(relativeIndex, state.positionSeconds);
    return changedChapter;
  }
  setSessionPartPosition(relativeIndex, state.positionSeconds);
  return changedChapter;
}

function prepareNextJobForNativeAdvance(): boolean {
  const targetKey = selectedNextPlaybackKey();
  if (nextJob && nextJobKey === targetKey && isCompleteJob(nextJob)) {
    nativeAdvanceBufferKey = "";
    nativeAdvanceBufferRetryAfter = 0;
    return true;
  }
  const nextChapter = chapterAfter(selectedChapterIndex);
  if (!nextChapter) {
    return false;
  }
  const candidate = matchingJobForChapter(allJobs, nextChapter.index);
  if (!candidate || !isCompleteJob(candidate)) {
    holdNativeAdvanceForBuffer(candidate, targetKey);
    return false;
  }
  nextJob = candidate;
  nextJobKey = selectedPlaybackKey(nextChapter.index);
  nativeAdvanceBufferKey = "";
  nativeAdvanceBufferRetryAfter = 0;
  return true;
}

function holdNativeAdvanceForBuffer(candidate: Job | null, targetKey: string): void {
  if (candidate && targetKey) {
    nextJob = candidate;
    nextJobKey = targetKey;
    allJobs = upsertJobList(allJobs, candidate);
  }
  if (nativeAdvanceBufferKey === targetKey && Date.now() < nativeAdvanceBufferRetryAfter) {
    return;
  }
  nativeAdvanceBufferKey = targetKey;
  nativeAdvanceBufferRetryAfter = Date.now() + 5_000;
  const ready = candidate
    ? candidate.audio_files.length + "/" + (candidate.total_audio_files || "?")
    : "0/0";
  setPlaybackEvent("Native waiting for next chapter buffer: " + ready);
  schedulePoll(1_000);
  void ensureNativeLookahead("native-buffer");
  void updateNativeQueue("native-buffer");
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
  const expectedNextKey = selectedNextPlaybackKey();
  if (secondNextJob && secondNextJobKey === expectedNextKey && secondNextJob.status !== "failed") {
    nextJob = secondNextJob;
    nextJobKey = secondNextJobKey;
  } else {
    nextJob = null;
    nextJobKey = "";
  }
  secondNextJob = null;
  secondNextJobKey = "";
  session = sessionFromJob(currentJob);
  setSessionPartPosition(partIndex, partSeconds);
  warmAudioCacheForSession();
  resetPlaybackWatchdogBaseline();
  setPlaybackEvent(event);
  void ensureSecondNextJob(event === "Native advanced to next chapter" ? "native-advanced" : "chapter-advanced");
  void ensureNativeLookahead(event === "Native advanced to next chapter" ? "native-advanced" : "chapter-advanced");
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
    secondNextJob: summarizeJob(secondNextJob),
    queueDiagnostics: playbackQueueDiagnostics(state),
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
      recoveryCount: watchdogRecoveryCount,
      diagnosis: lastWatchdogDiagnosis,
      lastRecovery: lastWatchdogRecovery,
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

function playbackQueueDiagnostics(state = nativeAudioState()): Record<string, unknown> {
  return {
    summary: playbackQueueSummary(state),
    current: jobQueueState(currentJob),
    next: jobQueueState(nextJob),
    secondNext: jobQueueState(secondNextJob),
    nativeQueueIndex: state.index,
    nativeQueueSize: state.queueSize,
    nativeRelativeIndex: Math.max(0, state.index - nativeQueueSessionStartIndex),
    nativeQueuedUrls: nativeQueuedUrlsKey ? nativeQueuedUrlsKey.split("\n").filter(Boolean).length : 0,
    prefixParts: nativeServiceQueuePrefix.length,
    lookaheadJobs: nativeLookaheadJobs().map(jobQueueState),
  };
}

function playbackQueueSummary(state = nativeAudioState()): string {
  const current = jobQueueState(currentJob);
  const next = jobQueueState(nextJob);
  const second = jobQueueState(secondNextJob);
  const native = nativePlaybackActive
    ? `native ${state.index}/${state.queueSize}`
    : "browser audio";
  const recovery = watchdogRecovering ? "recovering" : lastWatchdogDiagnosis;
  return `current ${current.parts} ${current.status}; next ${next.parts} ${next.status}; second ${second.parts} ${second.status}; ${native}; ${recovery}`;
}

function jobQueueState(job: Job | null): Record<string, string | number | boolean> {
  if (!job) {
    return {
      id: "",
      chapter: "",
      status: "missing",
      parts: "0/0",
      readyParts: 0,
      totalParts: 0,
      playable: false,
      complete: false,
    };
  }
  const totalParts = Math.max(job.total_audio_files, job.audio_files.length);
  return {
    id: job.id,
    chapter: job.chapter_indexes.join(","),
    status: job.status,
    parts: `${job.audio_files.length}/${totalParts}`,
    readyParts: job.audio_files.length,
    totalParts,
    playable: isPlayableJob(job),
    complete: isCompleteJob(job),
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
  if (isNativePlayRequestPending(state)) {
    return false;
  }
  return !state.playing && !isNativeWaitingForMoreAudio(state);
}

function isNativePlayRequestPending(state = nativeAudioState()): boolean {
  if (!nativePlaybackActive || Date.now() > nativePlayRequestUntil) {
    return false;
  }
  const event = state.lastEvent.toLowerCase();
  return state.active
    && !state.playing
    && !state.ended
    && (
      event.includes("requested")
      || event.includes("preparing")
      || event.includes("caching audio")
      || event.includes("queue loaded")
      || event.includes("queue update")
    );
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

async function refreshJobsForCurrentSelection(reason: string): Promise<void> {
  try {
    allJobs = await api.jobs();
    attachExistingJob(allJobs);
    return;
  } catch (err) {
    await recoverEndpointAfterNetworkError(reason, true);
    try {
      allJobs = await api.jobs();
      attachExistingJob(allJobs);
      return;
    } catch (_retryErr) {
      throw err;
    }
  }
}

async function resumeBookmark(): Promise<void> {
  const bookmark = currentBookmark();
  if (!bookmark) {
    setPlaybackEvent("No bookmark for this voice");
    render();
    return;
  }
  if (!session || !sessionMatchesCurrentSelection()) {
    statusText = "Refreshing bookmark audio";
    setPlaybackEvent("Refreshing bookmark audio");
    render();
    try {
      await refreshJobsForCurrentSelection("resume-bookmark");
    } catch (err) {
      errorText = err instanceof Error ? err.message : "Could not refresh bookmark audio";
      render();
      return;
    }
  }
  if (!session || !sessionMatchesCurrentSelection()) {
    setPlaybackEvent("No generated audio for this bookmark");
    render();
    return;
  }
  applyBookmarkToSession();
  userPausedPlayback = false;
  await playFromSession("manual");
}

async function loginToServer(): Promise<void> {
  const username = document.querySelector<HTMLInputElement>("#login-username")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#login-password")?.value ?? "";
  const serverUrl = toEutherBooksUrl(document.querySelector<HTMLInputElement>("#server-url")?.value ?? settings.serverUrl);
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
    saveLocalLoginPassword(password);
    await saveRemotePlayerPreferences();
    await refreshAll();
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Login failed";
    render();
  }
}

function localLoginPassword(): string {
  return localStorage.getItem("eutherbooks-player-login-password") ?? "";
}

function saveLocalLoginPassword(password: string): void {
  if (password) {
    localStorage.setItem("eutherbooks-player-login-password", password);
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

function nextChapterStatus(): { tone: "ready" | "working" | "waiting" | "off" | "error"; title: string; detail: string } {
  const nextChapter = chapterAfter(selectedChapterIndex);
  if (!settings.autoNext) {
    return { tone: "off", title: "Auto-next off", detail: "Use Next or enable Auto-next." };
  }
  if (!nextChapter) {
    return { tone: "off", title: "End of book", detail: "No later chapter." };
  }
  const targetKey = selectedPlaybackKey(nextChapter.index);
  const job = nextJobKey === targetKey && nextJob ? nextJob : matchingJobForChapter(allJobs, nextChapter.index);
  const label = chapterLabel(nextChapter);
  if (nextJobRequestInFlight) {
    return { tone: "working", title: "Checking next chapter", detail: label };
  }
  if (job) {
    const total = Math.max(job.total_audio_files, job.audio_files.length);
    const parts = total > 0 ? `${job.audio_files.length}/${total} parts` : "no parts yet";
    if (job.status === "failed") {
      return { tone: "error", title: "Next chapter failed", detail: `${label} · ${parts}` };
    }
    if (isPlayableJob(job)) {
      return { tone: "ready", title: "Next chapter ready", detail: `${label} · ${parts}` };
    }
    if (job.status === "running") {
      return { tone: "working", title: "Generating next chapter", detail: `${label} · ${parts}` };
    }
    return { tone: "waiting", title: "Next chapter queued", detail: `${label} · ${parts}` };
  }
  if (!currentJob) {
    return { tone: "waiting", title: "Next chapter not queued", detail: "Play or generate this chapter first." };
  }
  if (currentJob.status !== "done" && !isPlayableJob(currentJob)) {
    return { tone: "waiting", title: "Next chapter pending", detail: "Waiting for current chapter audio." };
  }
  return { tone: "waiting", title: "Next chapter not queued", detail: label };
}

function updateSettings(next: AppSettings): void {
  settings = {
    ...next,
    serverUrl: toEutherBooksUrl(next.serverUrl) || settings.serverUrl,
  };
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
  if (sleepTimerMode !== "minutes" || settings.sleepTimerMinutes <= 0) {
    return;
  }
  sleepDeadline = Date.now() + settings.sleepTimerMinutes * 60_000;
  sleepTimer = window.setTimeout(() => {
    stopPlayback(true, true);
    setSleepTimerMode("off", 0);
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

function setSleepTimerMode(mode: "off" | "minutes" | "chapter-end", minutes = settings.sleepTimerMinutes): void {
  sleepTimerMode = mode;
  localStorage.setItem("eutherbooks-player-sleep-mode", mode);
  const nextMinutes = mode === "minutes" ? minutes : 0;
  if (settings.sleepTimerMinutes !== nextMinutes) {
    updateSettings({ ...settings, sleepTimerMinutes: nextMinutes });
  }
  if (mode === "minutes" && !isPlaybackPaused()) {
    scheduleSleepTimer();
  } else {
    clearSleepTimer();
  }
}

function sleepTimerLabel(): string {
  if (sleepTimerMode === "chapter-end") {
    return "End of chapter";
  }
  if (sleepTimerMode === "minutes" && settings.sleepTimerMinutes > 0) {
    const remaining = sleepDeadline ? ` · ${Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 60000))} left` : "";
    return `${settings.sleepTimerMinutes} min${remaining}`;
  }
  return "Off";
}

function updatePlayerShell(): void {
  updatePlaybackControlLabels();
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

function playbackControlLabel(): "Play" | "Pause" {
  return isPlaybackEffectivelyPaused() ? "Play" : "Pause";
}

function isPlaybackEffectivelyPaused(): boolean {
  if (optimisticPlaybackState && Date.now() < optimisticPlaybackUntil) {
    return optimisticPlaybackState === "paused";
  }
  optimisticPlaybackState = null;
  return isPlaybackPaused();
}

function setOptimisticPlaybackState(state: "playing" | "paused"): void {
  optimisticPlaybackState = state;
  optimisticPlaybackUntil = Date.now() + 4_000;
  updatePlaybackControlLabels();
}

function clearOptimisticPlaybackState(): void {
  optimisticPlaybackState = null;
  optimisticPlaybackUntil = 0;
  updatePlaybackControlLabels();
}

function updatePlaybackControlLabels(): void {
  const label = playbackControlLabel();
  for (const selector of ["#play", "#mini-play"]) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (!button) {
      continue;
    }
    button.textContent = label;
    button.setAttribute("aria-label", label);
  }
}

function selectedVoice(): Voice | null {
  const modelVoices = voicesForModel(voices, settings.modelBackend);
  return modelVoices.find((voice) => voice.id === settings.voiceId)
    ?? modelVoices[0]
    ?? null;
}

function normalizeVoiceForCurrentModel(): Voice | null {
  const modelVoices = voicesForModel(voices, settings.modelBackend);
  if (modelVoices.some((voice) => voice.id === settings.voiceId)) {
    return modelVoices.find((voice) => voice.id === settings.voiceId) ?? null;
  }
  const fallback = modelVoices[0] ?? null;
  if (fallback) {
    updateSettings({ ...settings, voiceId: fallback.id });
  }
  return fallback;
}

function matchingVoiceForModel(previousVoiceId: string, modelBackend: AppSettings["modelBackend"]): Voice | null {
  const modelVoices = voicesForModel(voices, modelBackend);
  if (modelVoices.length === 0) {
    return null;
  }
  const exact = modelVoices.find((voice) => voice.id === previousVoiceId);
  if (exact) {
    return exact;
  }
  const suffix = voiceFamilySuffix(previousVoiceId);
  return modelVoices.find((voice) => voiceFamilySuffix(voice.id) === suffix)
    ?? modelVoices.find((voice) => voice.language === voiceIdLanguage(previousVoiceId))
    ?? modelVoices[0]
    ?? null;
}

function fallbackVoiceIdForModel(modelBackend: AppSettings["modelBackend"]): string {
  return voicesForModel(voices, modelBackend)[0]?.id ?? settings.voiceId;
}

function voiceFamilySuffix(voiceId: string): string {
  return voiceId
    .replace(/^dots-mf-/, "")
    .replace(/^dots-soar-/, "")
    .replace(/^auto-/, "");
}

function voiceIdLanguage(voiceId: string): string {
  return voiceId.includes("-en") || voiceId.endsWith("en") ? "en" : "sv";
}

function render(force = false): void {
  if (!force && shouldDeferRender()) {
    queuedRender = true;
    return;
  }
  queuedRender = false;
  const currentVoice = normalizeVoiceForCurrentModel();
  const modelVoices = voicesForModel(voices, settings.modelBackend);
  appRoot.innerHTML = appMarkup(modelVoices, currentVoice);
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

function appMarkup(modelVoices: Voice[], currentVoice: Voice | null): string {
  const book = selectedBook();
  const chapter = selectedChapter();
  const readyParts = session?.audioFiles.length ?? currentJob?.audio_files.length ?? 0;
  const totalParts = session?.totalParts ?? currentJob?.total_audio_files ?? 0;
  const generated = session ? formatTime(session.generatedSeconds) : "0:00";
  const position = session ? `${formatTime(sessionPosition(session))} / ${generated}` : "0:00 / 0:00";
  const progressPercent = totalParts > 0 ? Math.min(100, Math.round((readyParts / totalParts) * 100)) : 0;
  const seekProgress = session ? seekPercent(sessionPosition(session)) : 0;
  const sleepLabel = sleepTimerLabel();
  const nextStatus = nextChapterStatus();
  const cacheState = audioCacheState();
  const nativeState = nativeAudioState();
  const queueSummary = playbackQueueSummary(nativeState);
  const bookmark = currentBookmark();
  const visibleChapters = filteredChapters();
  const freeAudioDisk = typeof health?.storage?.audio_free_bytes === "number" ? formatBytes(health.storage.audio_free_bytes) : "unknown";
  const activeJobCount = allJobs.filter(isActiveJob).length;
  const serverStatus = health?.status ?? "offline";
  const serverStatusClass = serverStatus === "ok" ? "is-ok" : serverStatus === "offline" ? "is-offline" : "is-warn";
  const serverStatusLabel = serverStatus === "ok" ? "Server OK" : serverStatus === "offline" ? "Server offline" : `Server ${serverStatus}`;
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
        <div class="topbar-actions">
          <button id="view-player" class="${appView === "player" ? "is-selected" : ""}" type="button">Player</button>
          <button id="view-debug" class="${appView === "debug" ? "is-selected" : ""}" type="button">Debug</button>
          <button id="settings-toggle" class="icon-button ${settingsPanelOpen ? "is-selected" : ""}" type="button" aria-label="Settings" title="Settings">⚙</button>
          <span class="status-led ${serverStatusClass}" role="status" aria-label="${escapeHtml(serverStatusLabel)}" title="${escapeHtml(serverStatusLabel)}"></span>
        </div>
      </header>

      ${settingsPanelOpen ? `
      <section class="server-panel settings-panel">
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
          <input id="login-password" type="password" autocomplete="current-password" value="${escapeHtml(localLoginPassword())}" />
        </label>
        <button id="login" type="button">Login</button>
        <button id="reload" type="button">Retry</button>
        <button id="battery-unrestricted" type="button">Unrestricted battery</button>
        <small>Server, user, model and voice sync to your server profile. Password stays local on this device.</small>
      </section>
      ` : ""}

      <section class="player-panel">
        <div class="player-library">
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
        </div>
        <div class="now-playing">
          <span>${escapeHtml(book?.author ?? "Audiobook")}</span>
          <strong>${escapeHtml(book?.title ?? "No book selected")}</strong>
          <em>${escapeHtml(chapter ? chapterLabel(chapter) : "No chapter")}</em>
        </div>
        <div class="transport">
          <button id="play" type="button" aria-label="${playbackControlLabel()}">${playbackControlLabel()}</button>
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
        <small class="player-status">${escapeHtml(statusText)}${currentJob?.progress_detail ? ` · ${escapeHtml(currentJob.progress_detail)}` : ""}</small>
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
            ${modelVoices.map((voice) => `<option value="${escapeHtml(voice.id)}" ${voice.id === (currentVoice?.id ?? settings.voiceId) ? "selected" : ""}>${escapeHtml(voice.label)}</option>`).join("")}
          </select>
        </label>
      </section>

      <section class="next-status ${nextStatus.tone}">
        <span>Next</span>
        <strong>${escapeHtml(nextStatus.title)}</strong>
        <small>${escapeHtml(nextStatus.detail)}</small>
      </section>

      <section class="sleep-panel">
        <div>
          <span>Sleep</span>
          <strong>${escapeHtml(sleepLabel)}</strong>
        </div>
        <div class="sleep-buttons">
          ${sleepButton("off", "Off")}
          ${sleepButton("15", "15")}
          ${sleepButton("30", "30")}
          ${sleepButton("60", "60")}
          ${sleepButton("chapter-end", "Chapter end")}
        </div>
      </section>

      <section class="options-row">
        <button id="auto-play" class="${settings.autoPlay ? "is-selected" : ""}" type="button">Auto-play</button>
        <button id="auto-next" class="${settings.autoNext ? "is-selected" : ""}" type="button">Auto-next</button>
        <button id="auto-bookmark" class="${settings.autoBookmark ? "is-selected" : ""}" type="button">Auto-bookmark</button>
        <button id="cache-audio" class="${settings.cacheAudio ? "is-selected" : ""}" type="button">Cache</button>
      </section>

      ${appView === "debug" ? `
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
        <small>Queue health: ${escapeHtml(queueSummary)}</small>
        <small>Self-heal: ${escapeHtml(lastWatchdogRecovery)} · recoveries ${watchdogRecoveryCount}</small>
        <small>Native audio: ${nativeState.available ? "available" : "off"} · ${nativeState.playing ? "playing" : "paused"} · queue ${nativeState.index}/${nativeState.queueSize} · wake ${nativeState.wakeLockHeld ? "on" : "off"} · wifi ${nativeState.wifiLockHeld ? "on" : "off"} · headset ${nativeState.noisyReceiverRegistered ? "watching" : "off"} · ${escapeHtml(nativeState.lastEvent)}${nativeState.error ? ` · ${escapeHtml(nativeState.error)}` : ""}</small>
        <small>Media: ${escapeHtml(mediaSessionStatus)}</small>
        <small>Cache: ${cacheState.enabled ? "on" : "off"} · ${cacheState.cached} parts · ${cacheState.pending} pending · ${escapeHtml(cacheState.lastEvent)}</small>
        <small>Audio disk free: ${escapeHtml(freeAudioDisk)}</small>
        <small>Active jobs: ${activeJobCount}</small>
        ${nextJob ? `<small>Next: ${escapeHtml(nextJob.status)} · ${nextJob.audio_files.length}/${Math.max(nextJob.total_audio_files, nextJob.audio_files.length)} parts</small>` : settings.autoNext ? `<small>Next: waiting for current chapter to be ready</small>` : ""}
        <button id="stop-active-jobs" type="button" ${activeJobCount > 0 ? "" : "disabled"}>Stop all active jobs</button>
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
      ` : ""}

      ${errorText ? `<p class="error">${escapeHtml(errorText)}</p>` : ""}
      ${miniPlayerMarkup()}
    </main>
  `;
}

function bindUi(): void {
  document.querySelector<HTMLButtonElement>("#view-player")?.addEventListener("click", () => setAppView("player"));
  document.querySelector<HTMLButtonElement>("#view-debug")?.addEventListener("click", () => setAppView("debug"));
  document.querySelector<HTMLButtonElement>("#settings-toggle")?.addEventListener("click", () => toggleSettingsPanel());
  document.querySelector<HTMLButtonElement>("#login")?.addEventListener("click", () => void loginToServer());
  document.querySelector<HTMLButtonElement>("#reload")?.addEventListener("click", () => void refreshAll());
  document.querySelector<HTMLButtonElement>("#battery-unrestricted")?.addEventListener("click", () => {
    void requestBatteryOptimizationExemption().then((status) => {
      setPlaybackEvent(status);
      render();
    });
  });
  document.querySelector<HTMLInputElement>("#server-url")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    const serverUrl = toEutherBooksUrl(value);
    if (serverUrl) {
      updateSettings({ ...settings, serverUrl });
      void saveRemotePlayerPreferences().catch(() => undefined);
      void refreshAll();
    }
  });
  document.querySelector<HTMLInputElement>("#login-password")?.addEventListener("change", (event) => {
    saveLocalLoginPassword((event.currentTarget as HTMLInputElement).value);
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
    const modelBackend = (event.currentTarget as HTMLSelectElement).value as AppSettings["modelBackend"];
    const voice = matchingVoiceForModel(settings.voiceId, modelBackend);
    updateSettings({ ...settings, modelBackend, voiceId: voice?.id ?? fallbackVoiceIdForModel(modelBackend) });
    userPausedPlayback = false;
    currentJob = null;
    clearLookaheadQueue();
    session = null;
    activeSelectControl = false;
    interactionLockUntil = 0;
    render(true);
    void saveRemotePlayerPreferences().catch(() => undefined);
    void refreshAll();
  });
  document.querySelector<HTMLSelectElement>("#voice-select")?.addEventListener("change", (event) => {
    updateSettings({ ...settings, voiceId: (event.currentTarget as HTMLSelectElement).value });
    userPausedPlayback = false;
    currentJob = null;
    clearLookaheadQueue();
    session = null;
    void saveRemotePlayerPreferences().catch(() => undefined);
    void refreshAll();
  });
  document.querySelector<HTMLButtonElement>("#stop-active-jobs")?.addEventListener("click", () => {
    void stopAllActiveJobs();
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
  document.querySelectorAll<HTMLButtonElement>("[data-sleep]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.sleep ?? "off";
      if (value === "chapter-end") {
        setSleepTimerMode("chapter-end", 0);
      } else if (value === "off") {
        setSleepTimerMode("off", 0);
      } else {
        setSleepTimerMode("minutes", Number(value));
      }
      render();
    });
  });
}

function setAppView(view: "player" | "debug"): void {
  appView = view;
  localStorage.setItem("eutherbooks-player-view", view);
  render(true);
}

function toggleSettingsPanel(): void {
  settingsPanelOpen = !settingsPanelOpen;
  localStorage.setItem("eutherbooks-player-settings-open", String(settingsPanelOpen));
  render(true);
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
  const secondNextChapter = nextChapter ? chapterAfter(nextChapter.index) : null;
  const secondNextParts = secondNextJob
    ? `${secondNextJob.audio_files.length}/${Math.max(secondNextJob.total_audio_files, secondNextJob.audio_files.length)}`
    : "0/0";
  return `
      <section class="queue-panel">
        <div class="queue-head">
          <strong>Queue</strong>
          <span>${queueUrls.length} audio parts · native ${nativeState.index}/${nativeState.queueSize} · ${escapeHtml(lastWatchdogDiagnosis)}</span>
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
          <span>Second</span>
          <strong>${escapeHtml(secondNextChapter ? chapterLabel(secondNextChapter) : "End of book")}</strong>
          <em>${escapeHtml(secondNextJob?.status ?? (settings.autoNext ? "waiting" : "manual"))} · ${secondNextParts} parts</em>
          <span>Recovery</span>
          <strong>${escapeHtml(lastWatchdogRecovery)}</strong>
          <em>${watchdogRecovering ? "recovering" : "idle"} · ${watchdogRecoveryCount} attempts</em>
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
        <button id="mini-play" type="button" aria-label="${playbackControlLabel()}">${playbackControlLabel()}</button>
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

function sleepButton(value: "off" | "15" | "30" | "60" | "chapter-end", label: string): string {
  const selected = value === "chapter-end"
    ? sleepTimerMode === "chapter-end"
    : value === "off"
      ? sleepTimerMode === "off"
      : sleepTimerMode === "minutes" && settings.sleepTimerMinutes === Number(value);
  return `<button data-sleep="${value}" class="${selected ? "is-selected" : ""}" type="button">${label}</button>`;
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

import { invoke } from "@tauri-apps/api/core";

export type NativeAudioState = {
  available: boolean;
  active: boolean;
  playing: boolean;
  ended: boolean;
  index: number;
  queueSize: number;
  positionSeconds: number;
  durationSeconds: number;
  lastEvent: string;
  error: string;
  wakeLockHeld: boolean;
  wifiLockHeld: boolean;
  noisyReceiverRegistered: boolean;
  recentEvents: string[];
};

const unavailableState: NativeAudioState = {
  available: false,
  active: false,
  playing: false,
  ended: false,
  index: 0,
  queueSize: 0,
  positionSeconds: 0,
  durationSeconds: 0,
  lastEvent: "Native audio unavailable",
  error: "",
  wakeLockHeld: false,
  wifiLockHeld: false,
  noisyReceiverRegistered: false,
  recentEvents: [],
};

let lastState: NativeAudioState = unavailableState;
let checked = false;

export type NativeQueueManifest = {
  manifestUrls: string[];
  audioBaseUrl: string;
  startIndex: number;
};

export function nativeAudioState(): NativeAudioState {
  return lastState;
}

export async function refreshNativeAudioState(): Promise<NativeAudioState> {
  if (!window.__TAURI_INTERNALS__) {
    lastState = unavailableState;
    checked = true;
    return lastState;
  }
  try {
    lastState = parseState(await invokeNativeAudio("status", {}, "native_audio_status"));
  } catch (err) {
    lastState = failedState("status", err);
  }
  checked = true;
  return lastState;
}

export async function canUseNativeAudio(): Promise<boolean> {
  if (!checked) {
    await refreshNativeAudioState();
  }
  return lastState.available;
}

export async function playNativeAudioQueue(
  urls: string[],
  index: number,
  positionSeconds: number,
  title: string,
  subtitle: string,
  manifest?: NativeQueueManifest | null,
): Promise<NativeAudioState> {
  try {
    const raw = await invokeNativeAudio("play_queue", {
      urlsJson: JSON.stringify(urls),
      index,
      positionSeconds,
      title,
      subtitle,
      manifestUrlsJson: JSON.stringify(manifest?.manifestUrls ?? []),
      audioBaseUrl: manifest?.audioBaseUrl ?? "",
      manifestStartIndex: manifest?.startIndex ?? urls.length,
    }, "native_audio_play_queue", {
      urls,
      index,
      positionSeconds,
      title,
      subtitle,
    });
    lastState = parseState(raw);
  } catch (err) {
    lastState = failedState("play_queue", err);
  }
  checked = true;
  return lastState;
}

export async function updateNativeAudioQueue(urls: string[], manifest?: NativeQueueManifest | null): Promise<NativeAudioState> {
  try {
    const raw = await invokeNativeAudio("update_queue", {
      urlsJson: JSON.stringify(urls),
      manifestUrlsJson: JSON.stringify(manifest?.manifestUrls ?? []),
      audioBaseUrl: manifest?.audioBaseUrl ?? "",
      manifestStartIndex: manifest?.startIndex ?? urls.length,
    }, "native_audio_status");
    lastState = parseState(raw);
  } catch (err) {
    lastState = failedState("update_queue", err);
  }
  checked = true;
  return lastState;
}

export async function pauseNativeAudio(): Promise<NativeAudioState> {
  try {
    lastState = parseState(await invokeNativeAudio("pause", {}, "native_audio_pause"));
  } catch (err) {
    lastState = failedState("pause", err);
  }
  checked = true;
  return lastState;
}

export async function seekNativeAudio(index: number, positionSeconds: number): Promise<NativeAudioState> {
  try {
    lastState = parseState(await invokeNativeAudio(
      "seek",
      { index, positionSeconds },
      "native_audio_seek",
      { index, positionSeconds },
    ));
  } catch (err) {
    lastState = failedState("seek", err);
  }
  checked = true;
  return lastState;
}

export async function stopNativeAudio(): Promise<NativeAudioState> {
  try {
    lastState = parseState(await invokeNativeAudio("stop", {}, "native_audio_stop"));
  } catch (err) {
    lastState = failedState("stop", err);
  }
  checked = true;
  return lastState;
}

async function invokeNativeAudio(
  pluginCommand: string,
  pluginArgs: Record<string, unknown>,
  fallbackCommand: string,
  fallbackArgs?: Record<string, unknown>,
): Promise<string> {
  const pluginCommands = pluginCommandAliases(pluginCommand);
  const pluginErrors: string[] = [];
  for (const command of pluginCommands) {
    try {
      return extractState(await invoke<unknown>(`plugin:eutherbooks-native-audio|${command}`, pluginArgs));
    } catch (pluginErr) {
      pluginErrors.push(`${command}: ${pluginErrorMessage(pluginErr)}`);
    }
  }
  try {
    const fallback = await invoke<string>(fallbackCommand, fallbackArgs);
    const parsed = JSON.parse(fallback) as Partial<NativeAudioState>;
    if (parsed.available === false) {
      return JSON.stringify({
        ...unavailableState,
        lastEvent: `Native audio ${pluginCommand} plugin failed`,
        error: pluginErrors.join(" | "),
      });
    }
    return fallback;
  } catch (fallbackErr) {
    return JSON.stringify({
      ...unavailableState,
      lastEvent: `Native audio ${pluginCommand} plugin failed`,
      error: `${pluginErrors.join(" | ")}; fallback: ${pluginErrorMessage(fallbackErr)}`,
    });
  }
}

function pluginCommandAliases(command: string): string[] {
  if (command === "play_queue") {
    return ["play_queue", "playQueue"];
  }
  if (command === "update_queue") {
    return ["update_queue", "updateQueue"];
  }
  return [command];
}

function pluginErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch (_jsonErr) {
    return String(err);
  }
}

function extractState(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "state" in value) {
    const state = (value as { state?: unknown }).state;
    if (typeof state === "string") {
      return state;
    }
  }
  return JSON.stringify(value ?? {});
}

function parseState(raw: string): NativeAudioState {
  try {
    return {
      ...unavailableState,
      ...JSON.parse(raw),
    };
  } catch (_err) {
    return {
      ...unavailableState,
      lastEvent: raw || "Native audio returned invalid state",
    };
  }
}

function failedState(command: string, err: unknown): NativeAudioState {
  return {
    ...unavailableState,
    lastEvent: `Native audio ${command} failed`,
    error: pluginErrorMessage(err),
  };
}

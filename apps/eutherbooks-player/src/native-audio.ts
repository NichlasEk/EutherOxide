import { invoke } from "@tauri-apps/api/core";

export type NativeAudioState = {
  available: boolean;
  active: boolean;
  playing: boolean;
  ended: boolean;
  index: number;
  positionSeconds: number;
  durationSeconds: number;
  lastEvent: string;
  error: string;
};

const unavailableState: NativeAudioState = {
  available: false,
  active: false,
  playing: false,
  ended: false,
  index: 0,
  positionSeconds: 0,
  durationSeconds: 0,
  lastEvent: "Native audio unavailable",
  error: "",
};

let lastState: NativeAudioState = unavailableState;
let checked = false;

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
    lastState = parseState(await invoke<string>("native_audio_status"));
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
): Promise<NativeAudioState> {
  try {
    const raw = await invoke<string>("native_audio_play_queue", {
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

export async function pauseNativeAudio(): Promise<NativeAudioState> {
  try {
    lastState = parseState(await invoke<string>("native_audio_pause"));
  } catch (err) {
    lastState = failedState("pause", err);
  }
  checked = true;
  return lastState;
}

export async function seekNativeAudio(index: number, positionSeconds: number): Promise<NativeAudioState> {
  try {
    lastState = parseState(await invoke<string>("native_audio_seek", { index, positionSeconds }));
  } catch (err) {
    lastState = failedState("seek", err);
  }
  checked = true;
  return lastState;
}

export async function stopNativeAudio(): Promise<NativeAudioState> {
  try {
    lastState = parseState(await invoke<string>("native_audio_stop"));
  } catch (err) {
    lastState = failedState("stop", err);
  }
  checked = true;
  return lastState;
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
  const error = err instanceof Error ? err.message : String(err);
  return {
    ...unavailableState,
    lastEvent: `Native audio ${command} failed`,
    error,
  };
}

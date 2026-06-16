import { Book, Chapter, PlaybackSession } from "./types";
import { sessionPosition } from "./playback-session";

export type MediaSessionControls = {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (seconds: number) => void;
};

export function installMediaSessionControls(controls: MediaSessionControls): string {
  const mediaSession = mediaSessionApi();
  if (!mediaSession) {
    return "Media Session unavailable";
  }
  setActionHandler(mediaSession, "play", controls.play);
  setActionHandler(mediaSession, "pause", controls.pause);
  setActionHandler(mediaSession, "nexttrack", controls.next);
  setActionHandler(mediaSession, "previoustrack", controls.previous);
  setActionHandler(mediaSession, "seekbackward", () => controls.seekBy(-15));
  setActionHandler(mediaSession, "seekforward", () => controls.seekBy(30));
  setActionHandler(mediaSession, "seekto", (details: MediaSessionActionDetails) => {
    if (typeof details.seekTime === "number") {
      controls.seekTo(details.seekTime);
    }
  });
  return "Media Session controls ready";
}

export function updateMediaSession(
  book: Book | undefined,
  chapter: Chapter | undefined,
  session: PlaybackSession | null,
  isPlaying: boolean,
): string {
  const mediaSession = mediaSessionApi();
  if (!mediaSession) {
    return "Media Session unavailable";
  }
  mediaSession.metadata = new MediaMetadata({
    title: chapter?.title || book?.title || "EutherBooks",
    artist: book?.author || "EutherBooks",
    album: book?.title || "Audiobook",
  });
  mediaSession.playbackState = isPlaying ? "playing" : "paused";
  if (session && "setPositionState" in mediaSession) {
    try {
      mediaSession.setPositionState({
        duration: Math.max(1, session.generatedSeconds),
        playbackRate: 1,
        position: Math.min(sessionPosition(session), Math.max(1, session.generatedSeconds)),
      });
    } catch (_err) {
      return "Media Session metadata ready";
    }
  }
  return "Media Session active";
}

function mediaSessionApi(): MediaSession | null {
  return "mediaSession" in navigator ? navigator.mediaSession : null;
}

function setActionHandler(
  mediaSession: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler,
): void {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch (_err) {
    // Some Android WebView builds expose only a subset of Media Session actions.
  }
}

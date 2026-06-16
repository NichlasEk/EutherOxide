#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/eutherbooks-player"
TAURI_DIR="$APP_DIR/src-tauri"
ANDROID_DIR="$TAURI_DIR/gen/android"
APK_OUTPUT_ROOT="$ANDROID_DIR/app/build/outputs/apk"
ANDROID_APP_GRADLE="$ANDROID_DIR/app/build.gradle.kts"
ANDROID_TARGET="${EUTHERBOOKS_PLAYER_ANDROID_TARGET:-aarch64}"
OUT_APK="${OUT_APK:-/home/nichlas/EutherBooksPlayer-release-signed.apk}"
REPO_APK="${REPO_APK:-$APP_DIR/releases/EutherBooksPlayer-release-signed.apk}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

KEYSTORE="${EUTHERBOOKS_PLAYER_KEYSTORE:-${EUTHERLIST_KEYSTORE:-/home/nichlas/.eutherlist/eutherlist-sideload.jks}}"
KEY_ALIAS="${EUTHERBOOKS_PLAYER_KEY_ALIAS:-${EUTHERLIST_KEY_ALIAS:-eutherlist}}"
KEYSTORE_PASS="${EUTHERBOOKS_PLAYER_KEYSTORE_PASS:-${EUTHERLIST_KEYSTORE_PASS:-EutherList2026}}"
KEY_PASS="${EUTHERBOOKS_PLAYER_KEY_PASS:-${EUTHERLIST_KEY_PASS:-$KEYSTORE_PASS}}"

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "[eutherbooks-player-release-apk] Android SDK not found: $ANDROID_HOME" >&2
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "[eutherbooks-player-release-apk] Keystore not found: $KEYSTORE" >&2
  exit 1
fi

if ! command -v apksigner >/dev/null 2>&1; then
  echo "[eutherbooks-player-release-apk] apksigner not found on PATH" >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "[eutherbooks-player-release-apk] initializing Android project"
  npm run android:init
fi

if [[ -f "$ANDROID_APP_GRADLE" ]]; then
  perl -0pi -e 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/' "$ANDROID_APP_GRADLE"
fi

ANDROID_MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
ensure_permission() {
  local permission="$1"
  if [[ -f "$ANDROID_MANIFEST" ]] && ! grep -q "android.permission.$permission" "$ANDROID_MANIFEST"; then
    echo "[eutherbooks-player-release-apk] enabling Android permission $permission"
    perl -0pi -e "s#(<uses-permission android:name=\"android.permission.INTERNET\" />)#\$1\\n    <uses-permission android:name=\"android.permission.$permission\" />#" "$ANDROID_MANIFEST"
  fi
}

if [[ -f "$ANDROID_MANIFEST" ]]; then
  ensure_permission "WAKE_LOCK"
  ensure_permission "FOREGROUND_SERVICE"
  ensure_permission "FOREGROUND_SERVICE_MEDIA_PLAYBACK"
  ensure_permission "POST_NOTIFICATIONS"
  if ! grep -q 'NativeAudioService' "$ANDROID_MANIFEST"; then
    echo "[eutherbooks-player-release-apk] registering native audio service"
    perl -0pi -e 's#(\s*</application>)#        <service\n            android:name=".NativeAudioService"\n            android:exported="false"\n            android:foregroundServiceType="mediaPlayback" />\n$1#' "$ANDROID_MANIFEST"
  fi
fi

ANDROID_PACKAGE_DIR="$ANDROID_DIR/app/src/main/java/com/nichlasek/eutherbooksplayer"
mkdir -p "$ANDROID_PACKAGE_DIR"
cat > "$ANDROID_PACKAGE_DIR/NativeAudioBridge.kt" <<'KOTLIN'
package com.nichlasek.eutherbooksplayer

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

object NativeAudioBridge {
    @JvmStatic
    fun playQueue(context: Context, urlsJson: String, index: Int, positionSeconds: Double, title: String, subtitle: String): String {
        NativeAudioService.prepareQueueState(
            urlsJson,
            index,
            (positionSeconds.coerceAtLeast(0.0) * 1000.0).toLong(),
            title,
            subtitle
        )
        val intent = Intent(context.applicationContext, NativeAudioService::class.java)
            .setAction(NativeAudioService.ACTION_PLAY_QUEUE)
            .putExtra(NativeAudioService.EXTRA_URLS_JSON, urlsJson)
            .putExtra(NativeAudioService.EXTRA_INDEX, index)
            .putExtra(NativeAudioService.EXTRA_POSITION_MS, (positionSeconds.coerceAtLeast(0.0) * 1000.0).toLong())
            .putExtra(NativeAudioService.EXTRA_TITLE, title)
            .putExtra(NativeAudioService.EXTRA_SUBTITLE, subtitle)
        ContextCompat.startForegroundService(context.applicationContext, intent)
        return NativeAudioService.stateJson("Native playback requested")
    }

    @JvmStatic
    fun pause(context: Context): String {
        context.applicationContext.startService(Intent(context.applicationContext, NativeAudioService::class.java).setAction(NativeAudioService.ACTION_PAUSE))
        return NativeAudioService.stateJson("Native pause requested")
    }

    @JvmStatic
    fun stop(context: Context): String {
        context.applicationContext.startService(Intent(context.applicationContext, NativeAudioService::class.java).setAction(NativeAudioService.ACTION_STOP))
        return NativeAudioService.stateJson("Native stop requested")
    }

    @JvmStatic
    fun seek(context: Context, index: Int, positionSeconds: Double): String {
        context.applicationContext.startService(
            Intent(context.applicationContext, NativeAudioService::class.java)
                .setAction(NativeAudioService.ACTION_SEEK)
                .putExtra(NativeAudioService.EXTRA_INDEX, index)
                .putExtra(NativeAudioService.EXTRA_POSITION_MS, (positionSeconds.coerceAtLeast(0.0) * 1000.0).toLong())
        )
        return NativeAudioService.stateJson("Native seek requested")
    }

    @JvmStatic
    fun status(context: Context): String = NativeAudioService.stateJson("Native audio status")
}
KOTLIN

cat > "$ANDROID_PACKAGE_DIR/NativeAudioService.kt" <<'KOTLIN'
package com.nichlasek.eutherbooksplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioFocusRequest
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

class NativeAudioService : Service() {
    private val binder = Binder()
    private var player: MediaPlayer? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        currentService = this
        ensureChannel()
        ensureMediaSession()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_QUEUE -> handlePlayQueue(intent)
            ACTION_PAUSE -> handlePause()
            ACTION_RESUME -> handleResume()
            ACTION_STOP -> handleStop()
            ACTION_SEEK -> handleSeek(intent)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        releasePlayer()
        releaseAudioFocus()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        synchronized(lock) {
            active = false
            playing = false
            lastEvent = "Native service stopped"
        }
        currentService = null
        super.onDestroy()
    }

    private fun handlePlayQueue(intent: Intent) {
        val urls = parseUrls(intent.getStringExtra(EXTRA_URLS_JSON).orEmpty())
        val startIndex = intent.getIntExtra(EXTRA_INDEX, 0)
        val startPositionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L)
        synchronized(lock) {
            queue = urls
            index = startIndex.coerceIn(0, max(0, urls.size - 1))
            positionMs = max(0L, startPositionMs)
            durationMs = 0L
            active = urls.isNotEmpty()
            playing = false
            ended = false
            title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "EutherBooks" }
            subtitle = intent.getStringExtra(EXTRA_SUBTITLE).orEmpty().ifBlank { "Audiobook" }
            error = ""
            lastEvent = "Native queue loaded"
        }
        if (urls.isEmpty()) {
            handleStop()
            return
        }
        requestAudioFocus()
        ensureMediaSession()
        startForeground(NOTIFICATION_ID, notification())
        updatePlaybackState()
        playCurrent(positionMs)
    }

    private fun handlePause() {
        player?.let {
            if (it.isPlaying) {
                it.pause()
            }
        }
        synchronized(lock) {
            positionMs = currentPositionMs()
            playing = false
            lastEvent = "Native playback paused"
        }
        updatePlaybackState()
        updateNotification()
    }

    private fun handleStop() {
        releasePlayer()
        synchronized(lock) {
            active = false
            playing = false
            ended = false
            positionMs = 0L
            durationMs = 0L
            lastEvent = "Native playback stopped"
        }
        releaseAudioFocus()
        updatePlaybackState()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun handleSeek(intent: Intent) {
        val targetIndex = intent.getIntExtra(EXTRA_INDEX, 0)
        val targetPositionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L)
        val shouldStart: Boolean
        synchronized(lock) {
            if (queue.isEmpty()) {
                return
            }
            index = targetIndex.coerceIn(0, queue.size - 1)
            positionMs = max(0L, targetPositionMs)
            shouldStart = active
            lastEvent = "Native seek"
        }
        if (shouldStart) {
            playCurrent(positionMs)
        }
    }

    private fun playCurrent(startPositionMs: Long) {
        val url = synchronized(lock) { queue.getOrNull(index) }
        if (url.isNullOrBlank()) {
            markEnded()
            return
        }
        releasePlayer()
        val nextPlayer = MediaPlayer()
        player = nextPlayer
        try {
            nextPlayer.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
            nextPlayer.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            nextPlayer.setDataSource(url)
            nextPlayer.setOnPreparedListener { prepared ->
                synchronized(lock) {
                    durationMs = prepared.duration.toLong().coerceAtLeast(0L)
                    positionMs = startPositionMs.coerceIn(0L, max(0L, durationMs - 250L))
                    playing = true
                    active = true
                    ended = false
                    error = ""
                    lastEvent = "Native playback started"
                }
                if (positionMs > 0L) {
                    prepared.seekTo(positionMs.toInt())
                }
                prepared.start()
                updatePlaybackState()
                updateNotification()
            }
            nextPlayer.setOnCompletionListener {
                advanceAfterCompletion()
            }
            nextPlayer.setOnErrorListener { _mp, what, extra ->
                synchronized(lock) {
                    error = "MediaPlayer error $what/$extra"
                    lastEvent = error
                }
                advanceAfterCompletion()
                true
            }
            synchronized(lock) {
                lastEvent = "Native preparing audio"
            }
            nextPlayer.prepareAsync()
            updatePlaybackState()
            updateNotification()
        } catch (err: Exception) {
            releasePlayer()
            synchronized(lock) {
                error = err.message ?: err.javaClass.simpleName
                playing = false
                lastEvent = "Native playback failed"
            }
            updatePlaybackState()
            updateNotification()
        }
    }

    private fun advanceAfterCompletion() {
        val nextIndex: Int
        synchronized(lock) {
            positionMs = durationMs
            nextIndex = index + 1
        }
        if (nextIndex < synchronized(lock) { queue.size }) {
            synchronized(lock) {
                index = nextIndex
                positionMs = 0L
                durationMs = 0L
                lastEvent = "Native advancing"
            }
            playCurrent(0L)
        } else {
            markEnded()
        }
    }

    private fun markEnded() {
        releasePlayer()
        synchronized(lock) {
            active = false
            playing = false
            ended = true
            lastEvent = "Native queue ended"
        }
        releaseAudioFocus()
        updatePlaybackState()
        updateNotification()
        stopForeground(STOP_FOREGROUND_DETACH)
    }

    private fun releasePlayer() {
        player?.let {
            try {
                it.setOnPreparedListener(null)
                it.setOnCompletionListener(null)
                it.setOnErrorListener(null)
                it.release()
            } catch (_err: Exception) {
            }
        }
        player = null
    }

    private fun currentPositionMs(): Long {
        val current = player
        return try {
            if (current != null) current.currentPosition.toLong().coerceAtLeast(0L) else positionMs
        } catch (_err: Exception) {
            positionMs
        }
    }

    private fun updateNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification())
    }

    private fun notification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val snapshot = snapshot()
        val playPauseIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, NativeAudioService::class.java).setAction(if (snapshot.playing) ACTION_PAUSE else ACTION_RESUME),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, NativeAudioService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        builder
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(snapshot.title.ifBlank { "EutherBooks" })
            .setContentText(snapshot.subtitle.ifBlank { snapshot.lastEvent })
            .setOngoing(snapshot.playing)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
            .addAction(
                if (snapshot.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (snapshot.playing) "Pause" else "Play",
                playPauseIntent
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopIntent)
            .setStyle(Notification.MediaStyle().setMediaSession(mediaSession?.sessionToken))
        return builder.build()
    }

    private fun ensureMediaSession() {
        if (mediaSession != null) {
            mediaSession?.isActive = true
            return
        }
        mediaSession = MediaSession(this, "EutherBooksPlayback").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    handleResume()
                }

                override fun onPause() {
                    handlePause()
                }

                override fun onStop() {
                    handleStop()
                }

                override fun onSeekTo(pos: Long) {
                    handleSeek(Intent(this@NativeAudioService, NativeAudioService::class.java).putExtra(EXTRA_INDEX, index).putExtra(EXTRA_POSITION_MS, pos))
                }
            })
            isActive = true
        }
    }

    private fun handleResume() {
        val current = player
        if (current != null) {
            try {
                current.start()
                synchronized(lock) {
                    active = true
                    playing = true
                    ended = false
                    lastEvent = "Native playback resumed"
                }
                updatePlaybackState()
                updateNotification()
                return
            } catch (_err: Exception) {
            }
        }
        synchronized(lock) {
            if (queue.isEmpty()) {
                return
            }
            active = true
            ended = false
            lastEvent = "Native playback resumed"
        }
        requestAudioFocus()
        startForeground(NOTIFICATION_ID, notification())
        playCurrent(positionMs)
    }

    private fun updatePlaybackState() {
        val snapshot = snapshot()
        val state = when {
            snapshot.ended -> PlaybackState.STATE_STOPPED
            snapshot.playing -> PlaybackState.STATE_PLAYING
            snapshot.active -> PlaybackState.STATE_PAUSED
            else -> PlaybackState.STATE_STOPPED
        }
        mediaSession?.setPlaybackState(
            PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or
                        PlaybackState.ACTION_PAUSE or
                        PlaybackState.ACTION_STOP or
                        PlaybackState.ACTION_SEEK_TO
                )
                .setState(state, snapshot.positionMs, if (snapshot.playing) 1.0f else 0.0f)
                .build()
        )
    }

    private fun requestAudioFocus() {
        val manager = getSystemService(AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setOnAudioFocusChangeListener { change ->
                    if (change == AudioManager.AUDIOFOCUS_LOSS) {
                        handlePause()
                    }
                }
                .build()
            audioFocusRequest = request
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    private fun releaseAudioFocus() {
        val manager = getSystemService(AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(null)
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "EutherBooks playback", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    private fun parseUrls(raw: String): List<String> {
        return try {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val url = array.optString(i)
                    if (url.isNotBlank()) add(url)
                }
            }
        } catch (_err: Exception) {
            emptyList()
        }
    }

    private data class StateSnapshot(
        val active: Boolean,
        val playing: Boolean,
        val ended: Boolean,
        val index: Int,
        val positionMs: Long,
        val durationMs: Long,
        val title: String,
        val subtitle: String,
        val lastEvent: String,
        val error: String,
    )

    companion object {
        const val ACTION_PLAY_QUEUE = "com.nichlasek.eutherbooksplayer.PLAY_QUEUE"
        const val ACTION_PAUSE = "com.nichlasek.eutherbooksplayer.PAUSE"
        const val ACTION_RESUME = "com.nichlasek.eutherbooksplayer.RESUME"
        const val ACTION_STOP = "com.nichlasek.eutherbooksplayer.STOP"
        const val ACTION_SEEK = "com.nichlasek.eutherbooksplayer.SEEK"
        const val EXTRA_URLS_JSON = "urlsJson"
        const val EXTRA_INDEX = "index"
        const val EXTRA_POSITION_MS = "positionMs"
        const val EXTRA_TITLE = "title"
        const val EXTRA_SUBTITLE = "subtitle"

        private const val CHANNEL_ID = "eutherbooks_playback"
        private const val NOTIFICATION_ID = 9042
        private val lock = Any()
        private var queue: List<String> = emptyList()
        private var index = 0
        private var positionMs = 0L
        private var durationMs = 0L
        private var active = false
        private var playing = false
        private var ended = false
        private var title = "EutherBooks"
        private var subtitle = "Audiobook"
        private var lastEvent = "Native audio idle"
        private var error = ""
        @Volatile private var currentService: NativeAudioService? = null

        @JvmStatic
        fun prepareQueueState(urlsJson: String, startIndex: Int, startPositionMs: Long, nextTitle: String, nextSubtitle: String) {
            val urls = parseUrlsFromJson(urlsJson)
            synchronized(lock) {
                queue = urls
                index = startIndex.coerceIn(0, max(0, urls.size - 1))
                positionMs = max(0L, startPositionMs)
                durationMs = 0L
                active = urls.isNotEmpty()
                playing = false
                ended = false
                title = nextTitle.ifBlank { "EutherBooks" }
                subtitle = nextSubtitle.ifBlank { "Audiobook" }
                error = ""
                lastEvent = "Native queue requested"
            }
        }

        private fun snapshot(): StateSnapshot = synchronized(lock) {
            if (active) {
                positionMs = currentService?.currentPositionMs() ?: positionMs
            }
            StateSnapshot(active, playing, ended, index, positionMs, durationMs, title, subtitle, lastEvent, error)
        }

        private fun parseUrlsFromJson(raw: String): List<String> {
            return try {
                val array = JSONArray(raw)
                buildList {
                    for (i in 0 until array.length()) {
                        val url = array.optString(i)
                        if (url.isNotBlank()) add(url)
                    }
                }
            } catch (_err: Exception) {
                emptyList()
            }
        }

        @JvmStatic
        fun stateJson(event: String): String {
            val snapshot = snapshot()
            val output = JSONObject()
                .put("available", true)
                .put("active", snapshot.active)
                .put("playing", snapshot.playing)
                .put("ended", snapshot.ended)
                .put("index", snapshot.index)
                .put("positionSeconds", snapshot.positionMs / 1000.0)
                .put("durationSeconds", snapshot.durationMs / 1000.0)
                .put("lastEvent", if (event.isNotBlank()) event else snapshot.lastEvent)
                .put("error", snapshot.error)
            return output.toString()
        }
    }
}
KOTLIN

if [[ -d "$TAURI_DIR/icons/android" ]]; then
  echo "[eutherbooks-player-release-apk] syncing Android launcher icons"
  mkdir -p "$ANDROID_DIR/app/src/main/res"
  cp -R "$TAURI_DIR/icons/android/." "$ANDROID_DIR/app/src/main/res/"
fi

echo "[eutherbooks-player-release-apk] building unsigned APK"
npm run android:build -- --target "$ANDROID_TARGET"

UNSIGNED_APK="$(
  find "$APK_OUTPUT_ROOT" -type f -name '*release-unsigned.apk' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print }'
)"

if [[ -z "$UNSIGNED_APK" || ! -f "$UNSIGNED_APK" ]]; then
  echo "[eutherbooks-player-release-apk] unsigned APK not found under: $APK_OUTPUT_ROOT" >&2
  exit 1
fi

SIGNED_APK="$(dirname "$UNSIGNED_APK")/EutherBooksPlayer-${ANDROID_TARGET}-release-signed.apk"

echo "[eutherbooks-player-release-apk] signing APK"
rm -f "$SIGNED_APK" "$SIGNED_APK.idsig" "$OUT_APK" "$OUT_APK.idsig" "$REPO_APK" "$REPO_APK.idsig"
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KEYSTORE_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --out "$SIGNED_APK" \
  "$UNSIGNED_APK"

mkdir -p "$(dirname "$OUT_APK")"
cp "$SIGNED_APK" "$OUT_APK"
mkdir -p "$(dirname "$REPO_APK")"
cp "$SIGNED_APK" "$REPO_APK"

apksigner verify "$OUT_APK"

echo "[eutherbooks-player-release-apk] ready: $OUT_APK"
echo "[eutherbooks-player-release-apk] repo copy: $REPO_APK"

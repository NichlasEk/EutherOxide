#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/eutherbooks-player"
TAURI_DIR="$APP_DIR/src-tauri"
ANDROID_DIR="$TAURI_DIR/gen/android"
APK_OUTPUT_ROOT="$ANDROID_DIR/app/build/outputs/apk"
ANDROID_APP_GRADLE="$ANDROID_DIR/app/build.gradle.kts"
ANDROID_GRADLE_PROPERTIES="$ANDROID_DIR/gradle.properties"
ANDROID_TARGET="${EUTHERBOOKS_PLAYER_ANDROID_TARGET:-aarch64}"
OUT_APK="${OUT_APK:-/home/nichlas/EutherBooksPlayer-release-signed.apk}"
REPO_APK="${REPO_APK:-$APP_DIR/releases/EutherBooksPlayer-release-signed.apk}"
PUBLIC_APK="${PUBLIC_APK:-/srv/eutheroxide-downloads/EutherBooksPlayer-release-signed.apk}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

KEYSTORE="${EUTHERBOOKS_PLAYER_KEYSTORE:-${EUTHERLIST_KEYSTORE:-/home/nichlas/.eutherlist/eutherlist-sideload.jks}}"
KEY_ALIAS="${EUTHERBOOKS_PLAYER_KEY_ALIAS:-${EUTHERLIST_KEY_ALIAS:-eutherlist}}"
KEYSTORE_PASS="${EUTHERBOOKS_PLAYER_KEYSTORE_PASS:-${EUTHERLIST_KEYSTORE_PASS:-EutherList2026}}"
KEY_PASS="${EUTHERBOOKS_PLAYER_KEY_PASS:-${EUTHERLIST_KEY_PASS:-$KEYSTORE_PASS}}"
BOOTSTRAP_USER="${EUTHERBOOKS_PLAYER_BOOTSTRAP_USER:-nichlas}"
HOST_USERS_FILE="$ROOT/.euther-host/users.toml"

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

if [[ -z "${VITE_EUTHERBOOKS_PLAYER_USERNAME:-}" ]]; then
  export VITE_EUTHERBOOKS_PLAYER_USERNAME="$BOOTSTRAP_USER"
fi

if [[ -z "${VITE_EUTHERBOOKS_PLAYER_AUTH_TOKEN:-}" && -f "$HOST_USERS_FILE" ]]; then
  VITE_EUTHERBOOKS_PLAYER_AUTH_TOKEN="$(
    awk -v wanted="$BOOTSTRAP_USER" '
      /^\[\[user\]\]/ { in_user = 0; next }
      /^name = "/ {
        name = $0
        sub(/^name = "/, "", name)
        sub(/"$/, "", name)
        in_user = (name == wanted)
        next
      }
      in_user && /^app_token = "/ {
        token = $0
        sub(/^app_token = "/, "", token)
        sub(/"$/, "", token)
        print token
        exit
      }
    ' "$HOST_USERS_FILE"
  )"
  export VITE_EUTHERBOOKS_PLAYER_AUTH_TOKEN
fi

if [[ -z "${VITE_EUTHERBOOKS_PLAYER_AUTH_TOKEN:-}" ]]; then
  echo "[eutherbooks-player-release-apk] bootstrap app token not found for $BOOTSTRAP_USER" >&2
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

if [[ -f "$ANDROID_GRADLE_PROPERTIES" ]] && ! grep -q '^android.enableAapt2Daemon=false$' "$ANDROID_GRADLE_PROPERTIES"; then
  printf '\nandroid.enableAapt2Daemon=false\n' >> "$ANDROID_GRADLE_PROPERTIES"
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
  ensure_permission "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
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
    fun playQueue(context: Context, urlsJson: String, index: Int, positionSeconds: Double, title: String, subtitle: String, manifestUrlsJson: String, audioBaseUrl: String, manifestStartIndex: Int): String {
        NativeAudioService.prepareQueueState(
            urlsJson,
            index,
            (positionSeconds.coerceAtLeast(0.0) * 1000.0).toLong(),
            title,
            subtitle,
            manifestUrlsJson,
            audioBaseUrl,
            manifestStartIndex
        )
        val intent = Intent(context.applicationContext, NativeAudioService::class.java)
            .setAction(NativeAudioService.ACTION_PLAY_QUEUE)
            .putExtra(NativeAudioService.EXTRA_URLS_JSON, urlsJson)
            .putExtra(NativeAudioService.EXTRA_INDEX, index)
            .putExtra(NativeAudioService.EXTRA_POSITION_MS, (positionSeconds.coerceAtLeast(0.0) * 1000.0).toLong())
            .putExtra(NativeAudioService.EXTRA_TITLE, title)
            .putExtra(NativeAudioService.EXTRA_SUBTITLE, subtitle)
            .putExtra(NativeAudioService.EXTRA_MANIFEST_URLS_JSON, manifestUrlsJson)
            .putExtra(NativeAudioService.EXTRA_AUDIO_BASE_URL, audioBaseUrl)
            .putExtra(NativeAudioService.EXTRA_MANIFEST_START_INDEX, manifestStartIndex)
        ContextCompat.startForegroundService(context.applicationContext, intent)
        return NativeAudioService.stateJson("Native playback requested")
    }

    @JvmStatic
    fun updateQueue(context: Context, urlsJson: String, manifestUrlsJson: String, audioBaseUrl: String, manifestStartIndex: Int): String {
        context.applicationContext.startService(
            Intent(context.applicationContext, NativeAudioService::class.java)
                .setAction(NativeAudioService.ACTION_UPDATE_QUEUE)
                .putExtra(NativeAudioService.EXTRA_URLS_JSON, urlsJson)
                .putExtra(NativeAudioService.EXTRA_MANIFEST_URLS_JSON, manifestUrlsJson)
                .putExtra(NativeAudioService.EXTRA_AUDIO_BASE_URL, audioBaseUrl)
                .putExtra(NativeAudioService.EXTRA_MANIFEST_START_INDEX, manifestStartIndex)
        )
        return NativeAudioService.stateJson("Native queue update requested")
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

cat > "$ANDROID_PACKAGE_DIR/NativeAudioPlugin.kt" <<'KOTLIN'
package com.nichlasek.eutherbooksplayer

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class NativeAudioPlayQueueArgs {
    lateinit var urlsJson: String
    var index: Int = 0
    var positionSeconds: Double = 0.0
    var title: String = ""
    var subtitle: String = ""
    var manifestUrlsJson: String = ""
    var audioBaseUrl: String = ""
    var manifestStartIndex: Int = 0
}

@InvokeArg
class NativeAudioSeekArgs {
    var index: Int = 0
    var positionSeconds: Double = 0.0
}

@InvokeArg
class NativeAudioUpdateQueueArgs {
    lateinit var urlsJson: String
    var manifestUrlsJson: String = ""
    var audioBaseUrl: String = ""
    var manifestStartIndex: Int = 0
}

@InvokeArg
class NativeAudioWakeLockArgs {
    var enabled: Boolean = false
}

@TauriPlugin
class NativeAudioPlugin(private val activity: Activity): Plugin(activity) {
    companion object {
        private var wakeLock: PowerManager.WakeLock? = null
    }

    @Command
    fun play_queue(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NativeAudioPlayQueueArgs::class.java)
            resolveState(
                invoke,
                NativeAudioBridge.playQueue(
                    activity,
                    args.urlsJson,
                    args.index,
                    args.positionSeconds,
                    args.title,
                    args.subtitle,
                    args.manifestUrlsJson,
                    args.audioBaseUrl,
                    args.manifestStartIndex
                )
            )
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun playQueue(invoke: Invoke) {
        play_queue(invoke)
    }

    @Command
    fun update_queue(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NativeAudioUpdateQueueArgs::class.java)
            resolveState(invoke, NativeAudioBridge.updateQueue(activity, args.urlsJson, args.manifestUrlsJson, args.audioBaseUrl, args.manifestStartIndex))
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun updateQueue(invoke: Invoke) {
        update_queue(invoke)
    }

    @Command
    fun pause(invoke: Invoke) {
        try {
            resolveState(invoke, NativeAudioBridge.pause(activity))
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        try {
            resolveState(invoke, NativeAudioBridge.stop(activity))
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun seek(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NativeAudioSeekArgs::class.java)
            resolveState(invoke, NativeAudioBridge.seek(activity, args.index, args.positionSeconds))
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun status(invoke: Invoke) {
        try {
            resolveState(invoke, NativeAudioBridge.status(activity))
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun ping(invoke: Invoke) {
        resolveState(invoke, NativeAudioService.stateJson("Native audio plugin ping"))
    }

    @Command
    fun set_wake_lock(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(NativeAudioWakeLockArgs::class.java)
            if (args.enabled) {
                if (wakeLock?.isHeld != true) {
                    val powerManager = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
                    wakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "EutherBooksPlayer:AudioPlayback"
                    ).apply { acquire() }
                }
                resolveState(invoke, "partial wake lock acquired")
            } else {
                wakeLock?.takeIf { it.isHeld }?.release()
                wakeLock = null
                resolveState(invoke, "wake lock released")
            }
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun setWakeLock(invoke: Invoke) {
        set_wake_lock(invoke)
    }


    @Command
    fun request_ignore_battery_optimizations(invoke: Invoke) {
        try {
            val powerManager = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (powerManager.isIgnoringBatteryOptimizations(activity.packageName)) {
                resolveState(invoke, "battery unrestricted already enabled")
                return
            }
            val packageUri = Uri.parse("package:" + activity.packageName)
            val requestIntent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = packageUri
            }
            try {
                activity.startActivity(requestIntent)
                resolveState(invoke, "battery unrestricted request opened")
            } catch (_err: Exception) {
                activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                resolveState(invoke, "battery optimization settings opened")
            }
        } catch (err: Exception) {
            invoke.reject(err.message ?: err.toString())
        }
    }

    @Command
    fun requestIgnoreBatteryOptimizations(invoke: Invoke) {
        request_ignore_battery_optimizations(invoke)
    }

    private fun resolveState(invoke: Invoke, state: String) {
        val obj = JSObject()
        obj.put("state", state)
        invoke.resolve(obj)
    }
}
KOTLIN

cat > "$ANDROID_PACKAGE_DIR/NativeAudioService.kt" <<'KOTLIN'
package com.nichlasek.eutherbooksplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioFocusRequest
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.view.KeyEvent
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

class NativeAudioService : Service() {
    private val binder = Binder()
    private var player: MediaPlayer? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var mediaSession: MediaSession? = null
    private var playbackWakeLock: PowerManager.WakeLock? = null
    private var playbackWifiLock: WifiManager.WifiLock? = null
    private var noisyReceiverRegistered = false
    private var ignoreMediaPauseUntilMs = 0L
    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
            synchronized(lock) {
                lastEvent = "Paused because headphones disconnected"
                rememberEvent(lastEvent)
            }
            handlePause()
        }
        }
    }

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
            ACTION_UPDATE_QUEUE -> handleUpdateQueue(intent)
            ACTION_PAUSE -> handlePause()
            ACTION_RESUME -> handleResume()
            ACTION_TOGGLE_PLAYBACK -> handleTogglePlayback()
            ACTION_PREVIOUS -> handlePrevious()
            ACTION_NEXT -> handleNext()
            ACTION_STOP -> handleStop()
            ACTION_SEEK -> handleSeek(intent)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        releasePlayer()
        releasePlaybackLocks()
        unregisterNoisyReceiver()
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
        rememberManifest(intent, urls.size)
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
            rememberEvent(lastEvent)
        }
        if (urls.isEmpty()) {
            handleStop()
            return
        }
        acquirePlaybackLocks()
        registerNoisyReceiver()
        requestAudioFocus()
        ensureMediaSession()
        startForeground(NOTIFICATION_ID, notification())
        updatePlaybackState()
        prefetchQueueFrom(index)
        playCurrent(positionMs)
    }

    private fun handlePause(reason: String = "Native playback paused", honorResumeDebounce: Boolean = false) {
        if (honorResumeDebounce && shouldIgnoreImmediateMediaPause()) {
            synchronized(lock) {
                lastEvent = "Native duplicate media pause ignored"
                rememberEvent(lastEvent)
            }
            updatePlaybackState()
            updateNotification()
            return
        }
        player?.let {
            if (it.isPlaying) {
                it.pause()
            }
        }
        synchronized(lock) {
            positionMs = currentPositionMs()
            playing = false
            lastEvent = reason
            rememberEvent(lastEvent)
        }
        releasePlaybackLocks()
        unregisterNoisyReceiver()
        updatePlaybackState()
        updateNotification()
    }

    private fun handleUpdateQueue(intent: Intent) {
        val urls = parseUrls(intent.getStringExtra(EXTRA_URLS_JSON).orEmpty())
        rememberManifest(intent, urls.size)
        var shouldResumeFromBufferedEnd = false
        synchronized(lock) {
            if (urls.isEmpty() || !active) {
                lastEvent = "Native queue update ignored"
                rememberEvent(lastEvent)
                return
            }
            val oldSize = queue.size
            val waitingAtEnd = !playing && !ended && index >= oldSize
            val currentUrl = queue.getOrNull(index)
            val replacementUrl = urls.getOrNull(index)
            if (!currentUrl.isNullOrBlank() && currentUrl != replacementUrl) {
                lastEvent = "Native queue update rejected"
                rememberEvent(lastEvent)
                return
            }
            if (urls.size >= queue.size) {
                queue = urls
                lastEvent = "Native queue extended to ${urls.size} parts"
                rememberEvent(lastEvent)
                if (waitingAtEnd && urls.size > oldSize) {
                    index = oldSize
                    positionMs = 0L
                    durationMs = 0L
                    shouldResumeFromBufferedEnd = true
                }
            } else {
                lastEvent = "Native queue update ignored"
                rememberEvent(lastEvent)
            }
        }
        if (shouldResumeFromBufferedEnd) {
            playCurrent(0L)
            return
        }
        if (synchronized(lock) { active }) {
            ensurePlaybackSessionActive()
        }
        prefetchQueueFrom(synchronized(lock) { index })
        updatePlaybackState()
        updateNotification()
    }

    private fun handleStop() {
        releasePlayer()
        releasePlaybackLocks()
        unregisterNoisyReceiver()
        synchronized(lock) {
            active = false
            playing = false
            ended = false
            positionMs = 0L
            durationMs = 0L
            lastEvent = "Native playback stopped"
            rememberEvent(lastEvent)
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
            rememberEvent(lastEvent)
        }
        if (shouldStart) {
            playCurrent(positionMs)
        }
    }

    private fun handlePrevious() {
        val targetIndex: Int
        val targetPositionMs: Long
        synchronized(lock) {
            if (queue.isEmpty()) {
                lastEvent = "Native previous ignored: empty queue"
                rememberEvent(lastEvent)
                return
            }
            val currentPosition = currentPositionMs()
            if (currentPosition > 3500L || index <= 0) {
                targetIndex = index.coerceIn(0, queue.size - 1)
                targetPositionMs = 0L
            } else {
                targetIndex = (index - 1).coerceIn(0, queue.size - 1)
                targetPositionMs = 0L
            }
            index = targetIndex
            positionMs = targetPositionMs
            durationMs = 0L
            active = true
            ended = false
            lastEvent = "Native previous"
            rememberEvent(lastEvent)
        }
        requestAudioFocus()
        acquirePlaybackLocks()
        registerNoisyReceiver()
        ensureMediaSession()
        startForeground(NOTIFICATION_ID, notification())
        playCurrent(targetPositionMs)
    }

    private fun handleNext() {
        val targetIndex: Int
        synchronized(lock) {
            if (queue.isEmpty()) {
                lastEvent = "Native next ignored: empty queue"
                rememberEvent(lastEvent)
                return
            }
            targetIndex = index + 1
        }
        if (targetIndex < synchronized(lock) { queue.size }) {
            synchronized(lock) {
                index = targetIndex
                positionMs = 0L
                durationMs = 0L
                active = true
                ended = false
                lastEvent = "Native next"
                rememberEvent(lastEvent)
            }
            requestAudioFocus()
            acquirePlaybackLocks()
            registerNoisyReceiver()
            ensureMediaSession()
            startForeground(NOTIFICATION_ID, notification())
            playCurrent(0L)
        } else {
            bufferAtQueueEnd(targetIndex)
        }
    }

    private fun playCurrent(startPositionMs: Long) {
        val url = synchronized(lock) { queue.getOrNull(index) }
        if (url.isNullOrBlank()) {
            markEnded()
            return
        }
        releasePlayer()
        ensurePlaybackSessionActive()
        val requestId: Long
        synchronized(lock) {
            playRequestId += 1
            requestId = playRequestId
            lastEvent = if (isCached(url)) "Native preparing cached audio" else "Native caching audio"
            rememberEvent(lastEvent)
        }
        prefetchQueueFrom(synchronized(lock) { index + 1 })
        Thread {
            try {
                val source = playableSource(url)
                synchronized(lock) {
                    if (requestId != playRequestId) {
                        return@Thread
                    }
                }
                preparePlayer(source, startPositionMs, requestId)
            } catch (err: Exception) {
                synchronized(lock) {
                    if (requestId != playRequestId) {
                        return@Thread
                    }
                    error = "Native cache failed: ${err.message ?: err.javaClass.simpleName}"
                    playing = false
                    lastEvent = error
                    rememberEvent(lastEvent)
                }
                updatePlaybackState()
                updateNotification()
            }
        }.start()
        updatePlaybackState()
        updateNotification()
    }

    private fun preparePlayer(source: String, startPositionMs: Long, requestId: Long) {
        val nextPlayer = MediaPlayer()
        synchronized(lock) {
            if (requestId != playRequestId) {
                nextPlayer.release()
                return
            }
            player = nextPlayer
        }
        try {
            nextPlayer.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
            nextPlayer.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            nextPlayer.setDataSource(source)
            nextPlayer.setOnPreparedListener { prepared ->
                synchronized(lock) {
                    if (requestId != playRequestId) {
                        prepared.release()
                        return@setOnPreparedListener
                    }
                    durationMs = prepared.duration.toLong().coerceAtLeast(0L)
                    positionMs = startPositionMs.coerceIn(0L, max(0L, durationMs - 250L))
                    playing = true
                    active = true
                    ended = false
                    error = ""
                    lastEvent = "Native playback started"
                    rememberEvent(lastEvent)
                }
                if (positionMs > 0L) {
                    prepared.seekTo(positionMs.toInt())
                }
                prepared.start()
                updatePlaybackState()
                updateNotification()
            }
            nextPlayer.setOnCompletionListener {
                synchronized(lock) {
                    if (requestId != playRequestId) {
                        return@setOnCompletionListener
                    }
                }
                advanceAfterCompletion()
            }
            nextPlayer.setOnErrorListener { _mp, what, extra ->
                synchronized(lock) {
                    if (requestId != playRequestId) {
                        return@setOnErrorListener true
                    }
                    error = "MediaPlayer error $what/$extra"
                    lastEvent = error
                    rememberEvent(lastEvent)
                }
                advanceAfterCompletion()
                true
            }
            synchronized(lock) {
                if (requestId != playRequestId) {
                    nextPlayer.release()
                    return
                }
                lastEvent = "Native preparing audio"
                rememberEvent(lastEvent)
            }
            nextPlayer.prepareAsync()
            updatePlaybackState()
            updateNotification()
        } catch (err: Exception) {
            releasePlayer()
            synchronized(lock) {
                if (requestId != playRequestId) {
                    return
                }
                error = err.message ?: err.javaClass.simpleName
                playing = false
                lastEvent = "Native playback failed"
                rememberEvent(lastEvent)
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
                rememberEvent(lastEvent)
            }
            playCurrent(0L)
        } else {
            bufferAtQueueEnd(nextIndex)
        }
    }

    private fun bufferAtQueueEnd(nextIndex: Int) {
        releasePlayer()
        synchronized(lock) {
            index = nextIndex
            positionMs = 0L
            durationMs = 0L
            active = true
            playing = false
            ended = false
            lastEvent = "Native buffering for more audio"
            rememberEvent(lastEvent)
        }
        acquirePlaybackLocks()
        updatePlaybackState()
        updateNotification()
        startManifestPoll(nextIndex)
    }

    private fun ensurePlaybackSessionActive() {
        requestAudioFocus()
        acquirePlaybackLocks()
        registerNoisyReceiver()
        ensureMediaSession()
        startForeground(NOTIFICATION_ID, notification())
    }

    private fun prefetchQueueFrom(startIndex: Int) {
        val urls = synchronized(lock) {
            queue.drop(startIndex.coerceAtLeast(0)).take(AUDIO_PREFETCH_LIMIT)
        }
        if (urls.isEmpty()) {
            return
        }
        Thread {
            for (url in urls) {
                try {
                    playableSource(url)
                } catch (_err: Exception) {
                }
            }
            pruneAudioCache()
            synchronized(lock) {
                lastEvent = "Native audio cache ready"
                rememberEvent(lastEvent)
            }
            updatePlaybackState()
            updateNotification()
        }.start()
    }

    private fun playableSource(url: String): String {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return url
        }
        val file = cacheFileForUrl(url)
        if (file.isFile && file.length() > 0L) {
            file.setLastModified(System.currentTimeMillis())
            return file.absolutePath
        }
        return downloadAudio(url, file).absolutePath
    }

    private fun isCached(url: String): Boolean {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return true
        }
        val file = cacheFileForUrl(url)
        return file.isFile && file.length() > 0L
    }

    private fun cacheFileForUrl(url: String): File {
        val extension = URL(url).path.substringAfterLast('/', "").substringAfterLast('.', "wav").ifBlank { "wav" }
        return File(audioCacheDir(), "${sha256(url)}.$extension")
    }

    private fun audioCacheDir(): File {
        return File(cacheDir, AUDIO_CACHE_DIR).apply { mkdirs() }
    }

    private fun downloadAudio(url: String, destination: File): File {
        synchronized(cacheDownloads) {
            if (!cacheDownloads.add(destination.absolutePath)) {
                repeat(80) {
                    if (destination.isFile && destination.length() > 0L) {
                        return destination
                    }
                    try {
                        Thread.sleep(250L)
                    } catch (_err: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return destination
                    }
                }
            }
        }
        try {
            if (destination.isFile && destination.length() > 0L) {
                destination.setLastModified(System.currentTimeMillis())
                return destination
            }
            val tmp = File(destination.parentFile, "${destination.name}.tmp")
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 30000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "EutherBooksPlayerNativeAudio/1")
            }
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IllegalStateException("audio HTTP $code")
            }
            connection.inputStream.use { input ->
                tmp.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            if (tmp.length() <= 0L) {
                tmp.delete()
                throw IllegalStateException("empty audio cache file")
            }
            if (!tmp.renameTo(destination)) {
                tmp.copyTo(destination, overwrite = true)
                tmp.delete()
            }
            destination.setLastModified(System.currentTimeMillis())
            pruneAudioCache()
            return destination
        } finally {
            synchronized(cacheDownloads) {
                cacheDownloads.remove(destination.absolutePath)
            }
        }
    }

    private fun pruneAudioCache() {
        val files = audioCacheDir().listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= AUDIO_CACHE_MAX_BYTES) {
            return
        }
        for (file in files.sortedBy { it.lastModified() }) {
            if (total <= AUDIO_CACHE_MAX_BYTES) {
                break
            }
            val size = file.length()
            if (file.delete()) {
                total -= size
            }
        }
    }

    private fun sha256(value: String): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun rememberManifest(intent: Intent, defaultStartIndex: Int) {
        synchronized(lock) {
            manifestUrls = parseUrlsFromJson(intent.getStringExtra(EXTRA_MANIFEST_URLS_JSON).orEmpty())
            audioBaseUrl = intent.getStringExtra(EXTRA_AUDIO_BASE_URL).orEmpty()
            manifestStartIndex = intent.getIntExtra(EXTRA_MANIFEST_START_INDEX, defaultStartIndex).coerceAtLeast(0)
        }
    }

    private fun startManifestPoll(waitingIndex: Int) {
        synchronized(lock) {
            if (manifestPollActive || manifestUrls.isEmpty() || audioBaseUrl.isBlank()) {
                return
            }
            manifestPollActive = true
            lastEvent = "Native polling next chapters"
            rememberEvent(lastEvent)
        }
        Thread {
            try {
                repeat(120) {
                    val manifests: List<String>
                    val audioBase: String
                    val startIndex: Int
                    synchronized(lock) {
                        manifests = manifestUrls
                        audioBase = audioBaseUrl
                        startIndex = manifestStartIndex.coerceAtLeast(0)
                    }
                    val fetched = try {
                        fetchMergedManifestAudioUrls(manifests, audioBase)
                    } catch (err: Exception) {
                        synchronized(lock) {
                            lastEvent = "Native manifest poll retry: ${err.message ?: err.javaClass.simpleName}"
                            rememberEvent(lastEvent)
                        }
                        updatePlaybackState()
                        updateNotification()
                        emptyList()
                    }
                    var shouldResume = false
                    synchronized(lock) {
                        val prefix = queue.take(startIndex.coerceAtMost(queue.size))
                        val merged = prefix + fetched
                        if (fetched.isNotEmpty() && merged.size > queue.size) {
                            val oldSize = queue.size
                            queue = merged
                            lastEvent = "Native manifest extended to ${queue.size} parts"
                            rememberEvent(lastEvent)
                            if (!playing && active && waitingIndex >= oldSize) {
                                index = oldSize
                                positionMs = 0L
                                durationMs = 0L
                                shouldResume = true
                            }
                        }
                        if (!active || playing || ended || queue.size > waitingIndex) {
                            manifestPollActive = false
                            if (!shouldResume) {
                                return@Thread
                            }
                        }
                    }
                    if (shouldResume) {
                        playCurrent(0L)
                        synchronized(lock) {
                            manifestPollActive = false
                        }
                        return@Thread
                    }
                    Thread.sleep(3000L)
                }
                synchronized(lock) {
                    manifestPollActive = false
                    lastEvent = "Native manifest polling timed out"
                    rememberEvent(lastEvent)
                }
                updatePlaybackState()
                updateNotification()
            } catch (err: Exception) {
                synchronized(lock) {
                    manifestPollActive = false
                    error = "Native manifest poll failed: ${err.message ?: err.javaClass.simpleName}"
                    lastEvent = error
                    rememberEvent(lastEvent)
                }
                updatePlaybackState()
                updateNotification()
            }
        }.start()
    }

    private fun fetchMergedManifestAudioUrls(manifests: List<String>, audioBase: String): List<String> {
        val merged = mutableListOf<String>()
        for (manifest in manifests) {
            val fetched = fetchManifestAudioUrls(manifest, audioBase)
            if (fetched.isEmpty()) {
                break
            }
            merged.addAll(fetched)
        }
        return merged
    }

    private fun fetchManifestAudioUrls(manifest: String, audioBase: String): List<String> {
        val connection = (URL(manifest).openConnection() as HttpURLConnection).apply {
            connectTimeout = 5000
            readTimeout = 5000
            requestMethod = "GET"
        }
        return connection.inputStream.bufferedReader().use { reader ->
            val json = JSONObject(reader.readText())
            val files = json.optJSONArray("audio_files") ?: JSONArray()
            (0 until files.length())
                .mapNotNull { files.optString(it).takeIf { value -> value.isNotBlank() } }
                .map { value ->
                    if (value.startsWith("http://") || value.startsWith("https://")) {
                        value
                    } else {
                        audioBase.trimEnd('/') + "/" + value.trimStart('/')
                    }
                }
        }
    }

    private fun markEnded() {
        releasePlayer()
        synchronized(lock) {
            active = false
            playing = false
            ended = true
            lastEvent = "Native queue ended"
            rememberEvent(lastEvent)
        }
        releasePlaybackLocks()
        unregisterNoisyReceiver()
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
            Intent(this, NativeAudioService::class.java).setAction(ACTION_TOGGLE_PLAYBACK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val previousIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, NativeAudioService::class.java).setAction(ACTION_PREVIOUS),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val nextIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, NativeAudioService::class.java).setAction(ACTION_NEXT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this,
            4,
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
            .addAction(android.R.drawable.ic_media_previous, "Previous", previousIntent)
            .addAction(
                if (snapshot.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (snapshot.playing) "Pause" else "Play",
                playPauseIntent
            )
            .addAction(android.R.drawable.ic_media_next, "Next", nextIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopIntent)
            .setStyle(Notification.MediaStyle().setMediaSession(mediaSession?.sessionToken).setShowActionsInCompactView(0, 1, 2))
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
                    handlePause("Native playback paused by media session", true)
                }

                override fun onSkipToNext() {
                    handleNext()
                }

                override fun onSkipToPrevious() {
                    handlePrevious()
                }

                override fun onStop() {
                    handleStop()
                }

                override fun onSeekTo(pos: Long) {
                    handleSeek(Intent(this@NativeAudioService, NativeAudioService::class.java).putExtra(EXTRA_INDEX, index).putExtra(EXTRA_POSITION_MS, pos))
                }

                override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
                    val event = mediaButtonIntent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return super.onMediaButtonEvent(mediaButtonIntent)
                    if (event.action != KeyEvent.ACTION_UP) {
                        return true
                    }
                    when (event.keyCode) {
                        KeyEvent.KEYCODE_MEDIA_PLAY -> handleResume()
                        KeyEvent.KEYCODE_MEDIA_PAUSE -> handlePause("Native playback paused by media button", true)
                        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> handleTogglePlayback()
                        KeyEvent.KEYCODE_MEDIA_NEXT -> handleNext()
                        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> handlePrevious()
                        KeyEvent.KEYCODE_MEDIA_STOP -> handleStop()
                        else -> return super.onMediaButtonEvent(mediaButtonIntent)
                    }
                    return true
                }
            })
            isActive = true
        }
    }

    private fun handleTogglePlayback() {
        if (snapshot().playing) {
            handlePause("Native playback paused by toggle", true)
        } else {
            handleResume()
        }
    }

    private fun shouldIgnoreImmediateMediaPause(): Boolean {
        return snapshot().playing && System.currentTimeMillis() < ignoreMediaPauseUntilMs
    }

    private fun markMediaResumeWindow() {
        ignoreMediaPauseUntilMs = System.currentTimeMillis() + 1200L
    }

    private fun handleResume() {
        markMediaResumeWindow()
        requestAudioFocus()
        acquirePlaybackLocks()
        registerNoisyReceiver()
        ensureMediaSession()
        startForeground(NOTIFICATION_ID, notification())
        val current = player
        if (current != null) {
            try {
                current.start()
                synchronized(lock) {
                    active = true
                    playing = true
                    ended = false
                    lastEvent = "Native playback resumed"
                    rememberEvent(lastEvent)
                }
                updatePlaybackState()
                updateNotification()
                return
            } catch (err: Exception) {
                synchronized(lock) {
                    error = "Native resume failed: ${err.message ?: err.javaClass.simpleName}"
                    lastEvent = error
                    rememberEvent(lastEvent)
                }
            }
        }
        synchronized(lock) {
            if (queue.isEmpty()) {
                lastEvent = "Native resume ignored: empty queue"
                rememberEvent(lastEvent)
                return
            }
            active = true
            ended = false
            lastEvent = "Native playback resumed"
            rememberEvent(lastEvent)
        }
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
                        PlaybackState.ACTION_PLAY_PAUSE or
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackState.ACTION_SKIP_TO_NEXT or
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

    private fun acquirePlaybackLocks() {
        try {
            if (playbackWakeLock?.isHeld != true) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                playbackWakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "EutherBooksPlayer:NativeAudioService"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (err: Exception) {
            synchronized(lock) {
                error = "Wake lock failed: ${err.message ?: err.javaClass.simpleName}"
                lastEvent = error
                rememberEvent(lastEvent)
            }
        }
        try {
            if (playbackWifiLock?.isHeld != true) {
                val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                playbackWifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "EutherBooksPlayer:NativeAudioWifi"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (err: Exception) {
            synchronized(lock) {
                error = "Wi-Fi lock failed: ${err.message ?: err.javaClass.simpleName}"
                lastEvent = error
                rememberEvent(lastEvent)
            }
        }
    }

    private fun releasePlaybackLocks() {
        try {
            playbackWifiLock?.takeIf { it.isHeld }?.release()
        } catch (_err: Exception) {
        }
        playbackWifiLock = null
        try {
            playbackWakeLock?.takeIf { it.isHeld }?.release()
        } catch (_err: Exception) {
        }
        playbackWakeLock = null
    }

    private fun registerNoisyReceiver() {
        if (noisyReceiverRegistered) {
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
            }
            noisyReceiverRegistered = true
        } catch (err: Exception) {
            synchronized(lock) {
                error = "Noisy receiver failed: ${err.message ?: err.javaClass.simpleName}"
                lastEvent = error
                rememberEvent(lastEvent)
            }
        }
    }

    private fun unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) {
            return
        }
        try {
            unregisterReceiver(noisyReceiver)
        } catch (_err: Exception) {
        }
        noisyReceiverRegistered = false
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
        val queueSize: Int,
        val positionMs: Long,
        val durationMs: Long,
        val title: String,
        val subtitle: String,
        val lastEvent: String,
        val error: String,
        val wakeLockHeld: Boolean,
        val wifiLockHeld: Boolean,
        val noisyReceiverRegistered: Boolean,
        val recentEvents: List<String>,
    )

    companion object {
        const val ACTION_PLAY_QUEUE = "com.nichlasek.eutherbooksplayer.PLAY_QUEUE"
        const val ACTION_UPDATE_QUEUE = "com.nichlasek.eutherbooksplayer.UPDATE_QUEUE"
        const val ACTION_PAUSE = "com.nichlasek.eutherbooksplayer.PAUSE"
        const val ACTION_RESUME = "com.nichlasek.eutherbooksplayer.RESUME"
        const val ACTION_TOGGLE_PLAYBACK = "com.nichlasek.eutherbooksplayer.TOGGLE_PLAYBACK"
        const val ACTION_PREVIOUS = "com.nichlasek.eutherbooksplayer.PREVIOUS"
        const val ACTION_NEXT = "com.nichlasek.eutherbooksplayer.NEXT"
        const val ACTION_STOP = "com.nichlasek.eutherbooksplayer.STOP"
        const val ACTION_SEEK = "com.nichlasek.eutherbooksplayer.SEEK"
        const val EXTRA_URLS_JSON = "urlsJson"
        const val EXTRA_INDEX = "index"
        const val EXTRA_POSITION_MS = "positionMs"
        const val EXTRA_TITLE = "title"
        const val EXTRA_SUBTITLE = "subtitle"
        const val EXTRA_MANIFEST_URLS_JSON = "manifestUrlsJson"
        const val EXTRA_AUDIO_BASE_URL = "audioBaseUrl"
        const val EXTRA_MANIFEST_START_INDEX = "manifestStartIndex"

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
        private var manifestUrls: List<String> = emptyList()
        private var audioBaseUrl = ""
        private var manifestStartIndex = 0
        private var manifestPollActive = false
        private var playRequestId = 0L
        private var lastEvent = "Native audio idle"
        private var error = ""
        private var recentEvents: List<String> = listOf("Native audio idle")
        private const val AUDIO_CACHE_DIR = "native-audio-cache"
        private const val AUDIO_CACHE_MAX_BYTES = 768L * 1024L * 1024L
        private const val AUDIO_PREFETCH_LIMIT = 32
        private val cacheDownloads = mutableSetOf<String>()
        @Volatile private var currentService: NativeAudioService? = null

        @JvmStatic
        fun prepareQueueState(urlsJson: String, startIndex: Int, startPositionMs: Long, nextTitle: String, nextSubtitle: String, nextManifestUrlsJson: String, nextAudioBaseUrl: String, nextManifestStartIndex: Int) {
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
                manifestUrls = parseUrlsFromJson(nextManifestUrlsJson)
                audioBaseUrl = nextAudioBaseUrl
                manifestStartIndex = nextManifestStartIndex.coerceAtLeast(0)
                manifestPollActive = false
                error = ""
                lastEvent = "Native queue requested"
                rememberEvent(lastEvent)
            }
        }

        private fun snapshot(): StateSnapshot = synchronized(lock) {
            if (active) {
                positionMs = currentService?.currentPositionMs() ?: positionMs
            }
            val service = currentService
            StateSnapshot(
                active,
                playing,
                ended,
                index,
                queue.size,
                positionMs,
                durationMs,
                title,
                subtitle,
                lastEvent,
                error,
                service?.playbackWakeLock?.isHeld == true,
                service?.playbackWifiLock?.isHeld == true,
                service?.noisyReceiverRegistered == true,
                recentEvents,
            )
        }

        private fun rememberEvent(event: String) {
            if (event.isBlank()) {
                return
            }
            if (recentEvents.lastOrNull() == event) {
                return
            }
            recentEvents = (recentEvents + event).takeLast(12)
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
            val statusEvent = if (event.isNotBlank()) event else snapshot.lastEvent
            synchronized(lock) {
                rememberEvent(statusEvent)
            }
            val recent = JSONArray()
            snapshot().recentEvents.forEach { recent.put(it) }
            val output = JSONObject()
                .put("available", true)
                .put("active", snapshot.active)
                .put("playing", snapshot.playing)
                .put("ended", snapshot.ended)
                .put("index", snapshot.index)
                .put("queueSize", snapshot.queueSize)
                .put("positionSeconds", snapshot.positionMs / 1000.0)
                .put("durationSeconds", snapshot.durationMs / 1000.0)
                .put("lastEvent", snapshot.lastEvent)
                .put("statusEvent", statusEvent)
                .put("error", snapshot.error)
                .put("wakeLockHeld", snapshot.wakeLockHeld)
                .put("wifiLockHeld", snapshot.wifiLockHeld)
                .put("noisyReceiverRegistered", snapshot.noisyReceiverRegistered)
                .put("recentEvents", recent)
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
if [[ -d "$(dirname "$PUBLIC_APK")" && -w "$(dirname "$PUBLIC_APK")" ]]; then
  cp "$SIGNED_APK" "$PUBLIC_APK"
fi

apksigner verify "$OUT_APK"

echo "[eutherbooks-player-release-apk] ready: $OUT_APK"
echo "[eutherbooks-player-release-apk] repo copy: $REPO_APK"
if [[ -f "$PUBLIC_APK" ]]; then
  echo "[eutherbooks-player-release-apk] public copy: $PUBLIC_APK"
fi

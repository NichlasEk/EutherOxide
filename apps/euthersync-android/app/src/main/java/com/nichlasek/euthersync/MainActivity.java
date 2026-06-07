package com.nichlasek.euthersync;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 42;
    private static final int CAMERA_CAPTURE_REQUEST = 43;

    private WebView webView;
    private TextView statusView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
    private File cameraOutputFile;
    private String pendingCameraUploadPath;
    private String pendingCameraBaseUrl;
    private final List<String> candidateUrls = new ArrayList<>();
    private int selectedUrlIndex = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        parseCandidateUrls();

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        webView.setBackgroundColor(Color.rgb(16, 24, 32));

        statusView = new TextView(this);
        statusView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        statusView.setTextColor(Color.WHITE);
        statusView.setBackgroundColor(Color.rgb(16, 24, 32));
        statusView.setPadding(28, 28, 28, 28);
        statusView.setText("Connecting to EutherSync...");

        root.addView(webView);
        root.addView(statusView);
        setContentView(root);

        configureWebView();
        selectReachableUrl();
    }

    private void parseCandidateUrls() {
        for (String rawUrl : BuildConfig.EUTHERSYNC_URLS.split(",")) {
            String url = rawUrl.trim();
            if (!url.isEmpty()) {
                candidateUrls.add(url);
            }
        }
        if (candidateUrls.isEmpty()) {
            candidateUrls.add("https://apothictech.se/euthersync/");
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        }
        webView.addJavascriptInterface(new CameraBridge(), "EutherSyncCamera");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                statusView.setVisibility(android.view.View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    loadNextUrlOrShowError();
                }
            }

            @Override
            public void onReceivedHttpError(
                WebView view,
                WebResourceRequest request,
                WebResourceResponse errorResponse
            ) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                    loadNextUrlOrShowError();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    return true;
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = filePathCallback;

                Intent intent = fileChooserParams.isCaptureEnabled() && acceptsImages(fileChooserParams)
                    ? createCameraIntent()
                    : fileChooserParams.createIntent();
                if (intent == null) {
                    fileCallback = null;
                    return false;
                }
                if (!fileChooserParams.isCaptureEnabled()) {
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                }
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private boolean acceptsImages(WebChromeClient.FileChooserParams fileChooserParams) {
        String[] acceptTypes = fileChooserParams.getAcceptTypes();
        if (acceptTypes == null || acceptTypes.length == 0) {
            return true;
        }
        for (String acceptType : acceptTypes) {
            if (acceptType == null || acceptType.isEmpty() || acceptType.startsWith("image/")) {
                return true;
            }
        }
        return false;
    }

    private Intent createCameraIntent() {
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(getPackageManager()) == null) {
            return null;
        }
        try {
            File imageFile = createCameraImageFile();
            cameraOutputFile = imageFile;
            cameraOutputUri = FileProvider.getUriForFile(
                this,
                BuildConfig.APPLICATION_ID + ".fileprovider",
                imageFile
            );
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return intent;
        } catch (IOException error) {
            cameraOutputUri = null;
            return null;
        }
    }

    private File createCameraImageFile() throws IOException {
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        File directory = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (directory == null) {
            directory = getCacheDir();
        }
        return File.createTempFile("euthersync_" + stamp + "_", ".jpg", directory);
    }

    private class CameraBridge {
        @JavascriptInterface
        public void captureFeedPhoto(String uploadPath) {
            runOnUiThread(() -> {
                pendingCameraUploadPath = uploadPath;
                pendingCameraBaseUrl = webView.getUrl();
                Intent intent = createCameraIntent();
                if (intent == null) {
                    dispatchCameraError("Camera is not available.");
                    return;
                }
                try {
                    startActivityForResult(intent, CAMERA_CAPTURE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    dispatchCameraError("Camera is not available.");
                }
            });
        }
    }

    private void loadSelectedUrl() {
        String url = candidateUrls.get(selectedUrlIndex);
        statusView.setVisibility(android.view.View.VISIBLE);
        statusView.setText("Connecting to EutherSync...\n" + url);
        webView.loadUrl(url);
    }

    private void selectReachableUrl() {
        statusView.setVisibility(android.view.View.VISIBLE);
        statusView.setText("Finding the best EutherSync route...");
        new Thread(() -> {
            for (int index = selectedUrlIndex; index < candidateUrls.size(); index += 1) {
                String url = candidateUrls.get(index);
                showStatus("Checking EutherSync route...\n" + url);
                if (isHealthy(url)) {
                    selectedUrlIndex = index;
                    runOnUiThread(this::loadSelectedUrl);
                    return;
                }
            }
            runOnUiThread(this::showUnreachable);
        }).start();
    }

    private void showStatus(String message) {
        runOnUiThread(() -> {
            statusView.setVisibility(android.view.View.VISIBLE);
            statusView.setText(message);
        });
    }

    private boolean isHealthy(String baseUrl) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(healthUrl(baseUrl));
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            connection.setUseCaches(false);
            connection.setRequestMethod("GET");
            int status = connection.getResponseCode();
            return status >= 200 && status < 400;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String healthUrl(String baseUrl) {
        String trimmed = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        return trimmed + "/health";
    }

    private void loadNextUrlOrShowError() {
        if (selectedUrlIndex + 1 < candidateUrls.size()) {
            selectedUrlIndex += 1;
            selectReachableUrl();
            return;
        }
        showUnreachable();
    }

    private void showUnreachable() {
        statusView.setVisibility(android.view.View.VISIBLE);
        statusView.setText(
            "EutherSync is unreachable.\n\nTried:\n" +
                String.join("\n", candidateUrls)
        );
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) {
            if (requestCode == CAMERA_CAPTURE_REQUEST) {
                handleBridgeCameraResult(resultCode);
            }
            return;
        }

        Uri[] result = resultCode == RESULT_OK && cameraOutputUri != null
            ? new Uri[] { cameraOutputUri }
            : WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        fileCallback.onReceiveValue(result);
        fileCallback = null;
        cameraOutputUri = null;
    }

    private void handleBridgeCameraResult(int resultCode) {
        if (resultCode != RESULT_OK || cameraOutputFile == null || pendingCameraUploadPath == null) {
            dispatchCameraError("Camera cancelled.");
            clearBridgeCameraState();
            return;
        }
        File uploadFile = cameraOutputFile;
        String uploadPath = pendingCameraUploadPath;
        String baseUrl = pendingCameraBaseUrl;
        new Thread(() -> uploadCameraPhoto(uploadFile, baseUrl, uploadPath)).start();
    }

    private void uploadCameraPhoto(File file, String baseUrl, String uploadPath) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(new URL(baseUrl), uploadPath);
            String sha256 = sha256(file);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(30000);
            connection.setDoOutput(true);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "image/jpeg");
            connection.setRequestProperty("X-SHA256", sha256);
            String cookie = CookieManager.getInstance().getCookie(url.toString());
            if (cookie != null && !cookie.isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }
            try (OutputStream out = connection.getOutputStream(); FileInputStream in = new FileInputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }
            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) {
                dispatchCameraPosted();
            } else {
                dispatchCameraError("Camera upload failed.");
            }
        } catch (Exception error) {
            dispatchCameraError("Camera upload failed.");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
            clearBridgeCameraState();
        }
    }

    private String sha256(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) {
            hex.append(String.format(Locale.US, "%02x", value));
        }
        return hex.toString();
    }

    private void dispatchCameraPosted() {
        runOnUiThread(() -> webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('euthersync-camera-posted'))",
            null
        ));
    }

    private void dispatchCameraError(String message) {
        String escaped = message.replace("\\", "\\\\").replace("'", "\\'");
        runOnUiThread(() -> webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('euthersync-camera-error',{detail:{message:'" + escaped + "'}}))",
            null
        ));
    }

    private void clearBridgeCameraState() {
        pendingCameraUploadPath = null;
        pendingCameraBaseUrl = null;
        cameraOutputUri = null;
        cameraOutputFile = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}

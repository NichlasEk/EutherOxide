package com.nichlasek.euthersync;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
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

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 42;

    private WebView webView;
    private TextView statusView;
    private ValueCallback<Uri[]> fileCallback;
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
        loadSelectedUrl();
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

                Intent intent = fileChooserParams.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
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

    private void loadSelectedUrl() {
        String url = candidateUrls.get(selectedUrlIndex);
        statusView.setVisibility(android.view.View.VISIBLE);
        statusView.setText("Connecting to EutherSync...\n" + url);
        webView.loadUrl(url);
    }

    private void loadNextUrlOrShowError() {
        if (selectedUrlIndex + 1 < candidateUrls.size()) {
            selectedUrlIndex += 1;
            loadSelectedUrl();
            return;
        }
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
            return;
        }

        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        fileCallback.onReceiveValue(result);
        fileCallback = null;
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

# Notes For Future Agents

This repo contains more than one app. For EutherSync Android/feed work, edit the
right app first.

## EutherSync App Boundary

- The EutherSync Android APK is a WebView wrapper.
- The wrapper loads:
  - `http://192.168.32.186:3000`
  - `https://apothictech.se/euthersync/`
- Those endpoints serve the nested repo at:
  - `apps/euthersync`
- The root EutherHost UI at `webview/main.ts` is not what the EutherSync APK
  displays.

If the user asks for Family feed, comments, camera upload, EutherSync settings,
skins, user permissions, or APK-visible changes, start in `apps/euthersync`.

## EutherSync Files

Frontend:

- `apps/euthersync/public/index.html`
  - Static page shell.
  - Asset query versions live here, for example `app.js?v=...`.
  - Bump the query string after JS/CSS changes so Android WebView does not keep
    stale files.
- `apps/euthersync/public/app.js`
  - Main app logic.
  - Feed rendering, camera posts, comments, image viewer, admin settings, theme
    and skin behavior.
- `apps/euthersync/public/styles.css`
  - EutherSync visual styling, themes, skins, feed layout, comments, modal image
    viewer.

Backend:

- `apps/euthersync/server/index.js`
  - Node HTTP server.
  - Auth/session handling.
  - Feed APIs.
  - Comment APIs.
  - Admin permission APIs.
  - User settings read/write.

Storage:

- Feed posts: `/home/nichlas/euthersync-storage/feed/posts`
- Feed media: `/home/nichlas/euthersync-storage/feed/media`
- Feed comments: `/home/nichlas/euthersync-storage/feed/comments`
- EutherHost users: `/home/nichlas/EutherOxide/.euther-host/users.toml`
- Per-user settings: `/home/nichlas/EutherOxide/.euther-host/user-data/<user>/settings.toml`

## EutherSync Permissions

EutherSync permissions are exposed to the frontend as:

- `feed_read`
- `feed_post`
- `media_backup`
- `admin`

The Node server maps host users from `.euther-host/users.toml`.

Explicit EutherSync host fields:

```toml
euthersync_media_backup = true
euthersync_feed_post = true
```

Admin is still the host `admin = true` field. The user `nichlas` is treated as
the super user and should not be allowed to lose the last active admin path.

The root Rust host also knows about the EutherSync fields so it preserves them
when saving host users:

- `src/main.rs`
- `HostUser`
- `load_host_users`
- `save_host_users`

## Current Feed Features

Relevant code is in `apps/euthersync/public/app.js` and
`apps/euthersync/server/index.js`.

Feed behavior:

- Feed refreshes when the view is opened, focused, or pulled/scrolled at top.
- Feed image/camera posts require `feed_post`.
- All users with `feed_read` can read the feed.
- Users without `feed_post` can read but cannot post or comment.
- Admin can delete any feed post.
- Post authors can delete their own posts.

Comments:

- API:
  - `GET /api/feed/posts/:postId/comments`
  - `POST /api/feed/posts/:postId/comments`
  - `DELETE /api/feed/posts/:postId/comments/:commentId`
- Comments are loaded lazily when expanded.
- Comment author or admin can delete a comment.
- Comments are stored separately from posts in `feed/comments`.

Images:

- Feed images should open in the in-app media viewer.
- Do not use normal anchor navigation to the original image inside the Android
  WebView, because it can strand the user away from the feed.

## Services

After changing `apps/euthersync/server/index.js` or public assets, restart:

```sh
sudo -S systemctl restart euthersync
```

Verify:

```sh
systemctl is-active euthersync
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/index.html
```

If curl from the sandbox is unreliable, run curl with escalation or verify via
`http://192.168.32.186:3000`.

The systemd unit must allow EutherSync to write:

- `/home/nichlas/euthersync-storage`
- `/home/nichlas/EutherOxide/.euther-host/users.toml`
- `/home/nichlas/EutherOxide/.euther-host/user-data`

Service example:

- `deploy/euthersync.service.example`

## APK Build

Build the signed EutherSync APK from repo root:

```sh
npm run android:euthersync
```

Output paths:

- `/home/nichlas/EutherSync-release-signed.apk`
- `/home/nichlas/EutherOxide/apps/euthersync/releases/EutherSync-release-signed.apk`

Most web-only EutherSync changes do not technically need an APK rebuild because
the APK loads server content. Rebuild anyway when the user asks, when the wrapper
changes, or when there is confusion about whether the downloadable APK is fresh.

## Git Layout

There are two repos involved:

- Root repo: `/home/nichlas/EutherOxide`
- Nested EutherSync repo: `/home/nichlas/EutherOxide/apps/euthersync`

Commit and push both only when both changed.

Useful status checks:

```sh
git status --short --branch
git -C apps/euthersync status --short --branch
```

## Safe Iteration Checklist

1. Identify whether the change belongs to root EutherHost or `apps/euthersync`.
2. Edit the smallest relevant files.
3. Bump `index.html` asset query string after EutherSync JS/CSS changes.
4. Run:
   ```sh
   node --check apps/euthersync/server/index.js
   node --check apps/euthersync/public/app.js
   ```
5. If `src/main.rs` changed, run:
   ```sh
   cargo check
   cargo build --release
   sudo -S systemctl restart eutherhost
   ```
6. Restart EutherSync:
   ```sh
   sudo -S systemctl restart euthersync
   ```
7. Verify service health and the served asset version.
8. Commit and push the repo or repos that changed, if requested.

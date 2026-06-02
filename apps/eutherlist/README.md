# EutherList

Mobile-first family shopping list app for the EutherOxide host.

The app opens directly to the active shared shopping list after the first login. First login uses the normal EutherHost username and password, then the server returns a long app token that is stored locally on the phone.

## Features

- Opens directly to the cached list.
- One-tap add, check, delete, and clear checked.
- Swedish grocery categories: Kyl, Skafferi, Bröd, Frukt & grönt, Frys, Hushåll.
- Optimistic local updates with retry sync.
- Offline cache in `localStorage`.
- Syncs to the existing server Markdown endpoint:
  - `GET /api/interaction/shopping-list`
  - `POST /api/interaction/shopping-list`
- First-login app token endpoint:
  - `POST /api/app/login`
- Themes:
  - `joanna-light` default
  - `euther`
  - `apothecary-dark`

## Development

From this folder:

```bash
npm install
npm run dev
```

The app defaults to `https://apothictech.se`. Change server URL on the first login screen or later in settings.

## Android

Install the Android SDK/NDK requirements for Tauri 2 first. Then:

```bash
npm install
npm run android:init
npm run android:dev
npm run android:build
```

The APK/AAB output is produced by Tauri under `src-tauri/gen/android/app/build/outputs/`.

## Server Notes

EutherHost stores the generated app token in `.euther-host/users.toml`:

```toml
[[user]]
name = "joanna"
password_hash = "$argon2id$..."
app_token = "..."
```

The phone should not store the password. It stores only:

- server URL
- username
- app token
- selected theme
- cached list document

## Icon

The icon source files are:

- `src/assets/eutherlist-icon-light.svg`
- `src/assets/eutherlist-icon-dark.svg`
- `src-tauri/icons/icon.svg`
- `src-tauri/icons/icon.png`

The visual language is intentionally bright and calm in the default theme, with a molecule, apothecary bowl, and small lock motif.

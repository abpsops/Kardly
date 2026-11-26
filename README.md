# Kardly

A visiting card wallet. Photograph a card and Kardly finds the edges, straightens it and crops it to its exact size, front and (optionally) back. It reads the details, records where you met, and keeps everything searchable by name, company or event, with clickable websites, calls, WhatsApp and email.

## Get the APK

Every push to `main` builds the app on GitHub:

1. Open the **Actions** tab, then the latest **Build Android APK** run.
2. Download the **Kardly-…** file under *Artifacts*, unzip it and install the `.apk` on your phone.

To publish a version on the **Releases** page, push a tag:

```bash
git tag v1.1.0
```

```bash
git push origin v1.1.0
```

### Signed releases (recommended)

Without a signing key, CI builds a *debug* APK. Every debug build is signed with a different throwaway key, so you must uninstall the old app (and lose its cards) before installing a new build. Add your release key once and every build becomes a signed release that installs as an update.

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `KARDLY_KEYSTORE_BASE64` | `base64 -w0 kardly-release.jks` (on macOS: `base64 -i kardly-release.jks`) |
| `KARDLY_KEYSTORE_PASSWORD` | `storePassword` from `keystore.properties` |
| `KARDLY_KEY_ALIAS` | `kardly` |
| `KARDLY_KEY_PASSWORD` | `keyPassword` from `keystore.properties` |

The key files are in `Kardly-signing-key.zip`. Keep that zip safe and **never commit it**. If the key is lost, installed copies of Kardly can't be updated.

## Project layout

| Path | What it is |
|---|---|
| `src/kardly.html` | The app itself: UI, card detection, perspective crop, storage. The same file runs as the web version. |
| `app/native/native.js` | Android bridge for camera, share sheet, links, haptics, back button and card reading. |
| `app/native/parse.js` | Turns on-phone OCR text into name, title, company, phones, emails, website and address. |
| `app/build-web.mjs` | Builds `app/www` with offline copies of OpenCV, Tesseract OCR and the fonts. |
| `app/android/` | Capacitor 8 Android project, including the icon, splash screen and signing config. |
| `.github/workflows/build-apk.yml` | The cloud build. |

## Build on your own computer

You need Node 22, JDK 21 and the Android SDK (`ANDROID_HOME`).

```bash
cd app && npm ci && node build-web.mjs && npx cap sync android
```

```bash
cd app/android && ./gradlew assembleDebug
```

For a signed release, put `kardly-release.jks` and `keystore.properties` in `app/` and run `./gradlew assembleRelease`.

## Card reading in the app

- **On this phone** (default): Tesseract OCR. It works offline, is free and reads English.
- **Claude**: switch to it under *More → Card reading* and add an Anthropic API key, which is stored only on the phone. It uses `claude-opus-5-5`, reads any language, and falls back to on-phone reading when offline.

# EutherBooks Player alpha 3 publication

The Apps card and version-specific download routes now select the already deployed native Kotlin 0.2.0-alpha.3 release (versionCode 1080). Older immutable version links retain their original APK bytes. The stable artifact is also alpha 3.

Published files are preserved under apps/eutherbooks-player/releases. Alpha 3 SHA-256: e282043feb14802b3eaebe68a8e2b90c439510a23aa80685d3cd57ac0c489629. Package com.nichlasek.eutherbooksplayer; signing certificate SHA-256 b9ff592d5c8b183c339836537b43e2b0f6b7e65618db084f4e84631ef9fd9c3c.

The original release was deployed on 2026-09-04. This preservation commit was assembled on 2026-09-05 from the server's live source changes, rebased onto the current published admin branch. It does not require a server restart.

Caddy serves the APKs before Rust from /srv/eutheroxide-downloads. Versioned paths must strip /downloads but preserve the version-specific filename; only legacy stable aliases should map to the generic APK. Keep versioned files immutable. The deployed Caddyfile is host configuration; do not replace it wholesale with a repository example.

Validation: existing release report records Android tests, signed upgrade, public/LAN hash checks and two Rust route tests. During preservation, Android JVM test/lint tasks passed using the repository Gradle cache; immutable APK signatures and hashes were rechecked. The deployed server's release/web builds also passed earlier on 2026-09-05. No real audiobook or server-state data is included.

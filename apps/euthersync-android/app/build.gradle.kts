plugins {
    id("com.android.application")
}

android {
    namespace = "com.nichlasek.euthersync"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nichlasek.euthersync"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        val eutherSyncUrls = providers.gradleProperty("eutherSyncUrls")
            .orElse(providers.gradleProperty("eutherSyncUrl"))
            .orElse("http://192.168.32.186:3000,https://apothictech.se/euthersync/")
            .get()
        buildConfigField("String", "EUTHERSYNC_URLS", "\"${eutherSyncUrls}\"")
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
        getByName("debug") {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
}

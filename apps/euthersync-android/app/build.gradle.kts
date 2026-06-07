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

        val eutherSyncUrl = providers.gradleProperty("eutherSyncUrl")
            .orElse("http://eutheroxide.local:3000")
            .get()
        buildConfigField("String", "EUTHERSYNC_URL", "\"${eutherSyncUrl}\"")
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

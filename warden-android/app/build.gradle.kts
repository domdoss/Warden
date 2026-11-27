plugins {
    id("com.android.application")
}

android {
    namespace = "com.warden.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.warden.app"
        // The embedded Tailscale AAR (gomobile) requires API 26.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Debug keys so `assembleRelease` produces an installable APK.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The bundled AAR ships arm64-v8a and armeabi-v7a only.
    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    // In-process Tailscale (tsnet) built with gomobile from
    // eyes_ears/dockbox_voice/tsnetproxy/proxy.go. Runs a userspace WireGuard
    // node inside the app, so no separate Tailscale app is required.
    implementation(files("libs/tailscale.aar"))
}

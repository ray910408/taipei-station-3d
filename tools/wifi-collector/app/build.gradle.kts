plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "com.taipeistation.wififp"
  compileSdk = 35
  defaultConfig {
    applicationId = "com.taipeistation.wififp"
    minSdk = 29
    targetSdk = 34
    versionCode = 1
    versionName = "0.2.4"
  }
  buildFeatures { compose = true }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation(platform("androidx.compose:compose-bom:2024.12.01"))
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.json:json:20240303")
}

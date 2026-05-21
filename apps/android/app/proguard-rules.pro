# ProGuard rules for pw-book
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keepattributes Signature
-keepattributes Exceptions

# Room
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# Hilt
-keepclassmembers,allowobfuscation class * {
    @javax.inject.* <fields>;
    @javax.inject.* <init>(...);
}

# Kotlin serialization
-keepattributes RuntimeVisibleAnnotations
-keepclassmembers class * {
    @kotlinx.serialization.Serializable <fields>;
}

# Ktor
-dontwarn io.ktor.**

# BouncyCastle
-dontwarn org.bouncycastle.**

# Google Tink / errorprone annotations (release build only, not required at runtime)
-dontwarn com.google.errorprone.annotations.**

# Unmuzzled for Android

The same private chat, running the model **on the phone itself**. No laptop, no server and no internet after the one-time model download.

> **Status: beta.** Built and type-checked; first real-device testing is in progress on a Galaxy S25 Ultra.

## What it does

- Runs GGUF models on-device with [llama.rn](https://github.com/mybigday/llama.rn) (llama.cpp). The engine uses CPU builds tuned for modern ARM cores (dotprod/i8mm), with optional OpenCL offload on Adreno 700+ GPUs.
- First-run setup checks your phone's memory and free storage, then downloads the default model (5.63 GB) with pause/resume. You can also import a `.gguf` file already on the phone.
- Streaming replies with Markdown, a collapsible reasoning view and a **Think** toggle to skip reasoning for quick answers.
- Chat history, system prompt, temperature, response length and context window settings. Everything is stored only on the device.

## Requirements

- Android 7+ on a 64-bit ARM phone
- **About 12 GB of RAM** for the default 9B model. Phones with less can import a smaller GGUF.
- About 6 GB of free storage

## Install

An APK will be published on the [Releases](https://github.com/rahulagarwal18/unmuzzled/releases) page once on-device testing is complete. Until then, build it yourself (below). To install, open the APK on the phone and allow installs from that source when Android asks.

The app is distributed as an APK rather than through Google Play. The default model has had its refusal training removed, which doesn't fit Play's AI-content policy.

## Build from source

Requires Node 20+, JDK 17–21 and the Android SDK.

```bash
cd mobile
npm install
npm run build:apk
# → android/app/build/outputs/apk/release/app-release.apk
```

### Notes for Windows

- Build from a short path **without spaces** (for example `C:\um`). The NDK toolchain and some generated C++ paths break on long or spaced paths.
- If Gradle downloads time out on networks with broken IPv6, set `JAVA_OPTS=-Djava.net.preferIPv4Stack=true`.
- The app avoids `react-native-safe-area-context`: its generated C++ paths exceed Windows' 260-character limit with Android's bundled Ninja 1.10. A small local module, `modules/system-insets`, provides the same system-bar measurements.

## Project layout

```
App.tsx                      setup → chat routing
src/screens/Setup.tsx        device checks, model download/import
src/screens/Chat.tsx         chat, composer, drawer
src/components/              message rendering, settings sheet, icons
src/engine.ts                llama.rn wrapper (load, stream, stop)
src/model.ts                 model download (pause/resume), import, RAM checks
modules/system-insets/       native module for status/navigation bar insets
```

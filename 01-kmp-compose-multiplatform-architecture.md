---
title: >-
  Structuring a Kotlin Multiplatform App as a Library Ecosystem: Lessons from
  Building Finio
published: true
description: >-
  How Finio splits a KMP + Compose Multiplatform app into independently
  published libraries, and the module-naming trap that leaks into iOS artifact
  IDs.
tags: 'kotlin, kmp, androiddev, architecture'
canonical_url: null
id: 4122040
devto_url: >-
  https://dev.to/dgbarreto/structuring-a-kotlin-multiplatform-app-as-a-library-ecosystem-lessons-from-building-finio-4f95
---

# Structuring a Kotlin Multiplatform App as a Library Ecosystem: Lessons from Building Finio

When most tutorials talk about Kotlin Multiplatform (KMP), they show you a single repo with a `shared` module and call it a day. That works for a demo. It falls apart the moment you're building a real product with a backend team, a design system that needs to evolve independently, and features that ship on different cadences.

While building **Finio**, a personal finance app for Android and iOS, I split the codebase into six repositories instead of one monolith: a Node.js/TypeScript API, five independently published KMP library modules, and a Compose Multiplatform app shell that consumes all of them. Here's why, and what it actually takes to make that work.

## The shape of the ecosystem

Finio is composed of:

- **`finio-api`** — a Node.js/TypeScript backend on Railway. Routes live inside feature modules (`src/modules/budget`, `src/modules/transaction`, etc.) rather than a separate `routes/` folder, and request/response contracts are validated with Zod schemas in `src/schemas/`.
- **Five KMP library modules**, each published independently via Maven to GitHub Packages: `finio-design-system`, `finio-auth`, `finio-transaction`, `finio-budget`, `finio-insights`.
- **`finio-app`** — the Compose Multiplatform shell, split into `androidApp`, `iosApp`, `sharedLogic`, and `sharedUI`, which pulls in every library module as a dependency.

The app shell doesn't own business logic. It owns navigation, composition, and platform wiring (Koin DI graph, FCM registration, deep link handling). Everything else — auth flows, transaction parsing, budget calculations, insights — lives in a module that can be versioned, tested, and consumed on its own.

## Why split it this way

The obvious question: why not just use Gradle's multi-module setup inside one repo? Two reasons drove the decision.

**Independent versioning.** When `finio-auth` gets a bug fix, I don't want to force a new release of `finio-budget` or touch anything in the app shell's build graph. Publishing each module as its own Maven artifact means `finio-app`'s `build.gradle.kts` just bumps a version string:

```kotlin
dependencies {
    implementation("dev.finio:auth:1.4.2")
    implementation("dev.finio:transaction:2.1.0")
}
```

**Forcing a real API boundary.** When a module only exists as source inside a monorepo, it's tempting to reach across module boundaries "just this once." When a module is a compiled artifact pulled from GitHub Packages, that's not possible — you're forced to design a public API surface deliberately, the same discipline you'd apply to any external SDK.

The tradeoff is real: cross-module changes now require publishing a new version and bumping it downstream, which is slower than editing a file in a monorepo. For a solo/small-team project this is a deliberate cost, taken on because it mirrors how larger organizations actually structure multiplatform codebases once more than one team touches the code.

## The `build.gradle.kts` template that makes this repeatable

Every KMP library module in Finio follows the same Gradle template, based on `finio-design-system`. A few details matter more than they look:

```kotlin
val localProperties = ... // read before the plugins block
val publishVersion = ...

plugins {
    alias(libs.plugins.kotlinMultiplatform) // must come before androidMultiplatformLibrary
    alias(libs.plugins.androidMultiplatformLibrary)
    id("maven-publish")
}

kotlin {
    androidLibrary { /* ... */ }
    iosArm64()
    iosSimulatorArm64()

    listOf(iosArm64(), iosSimulatorArm64()).forEach {
        it.binaries.framework {
            baseName = "auth" // matches the internal module name — see below
        }
    }
}

// publishing block lives OUTSIDE the kotlin { } block
publishing {
    publications.withType<MavenPublication> {
        groupId = "dev.finio"
        artifactId = project.name
        // pom { ... }
    }
    repositories {
        maven {
            credentials {
                username = System.getenv("GITHUB_ACTOR") ?: ""
                password = System.getenv("GITHUB_TOKEN") ?: ""
            }
        }
    }
}
```

Two ordering rules aren't cosmetic: the `kotlinMultiplatform` plugin has to be applied before `androidMultiplatformLibrary`, and the `publishing` block has to sit outside the `kotlin { }` block. Get either wrong and you get Gradle configuration errors that don't obviously point back to ordering.

## The naming trap: internal module name vs. artifact ID

The single most expensive lesson from this project: **the internal module name determines the generated iOS framework/artifact ID**, and it has to match the domain, not be something generic like `shared`.

Early on, `finio-auth`'s internal module was named `shared` — a leftover from scaffolding. That name propagated into the generated iOS artifact ID, producing a framework that didn't clearly correspond to what it was (auth), and colliding conceptually with any other module that also defaulted to `shared`. The same issue showed up in `finio-transaction`, where the Android artifact was published as `dev.finio:finio-transaction-android` instead of the intended `dev.finio:transaction-android` — traced back to the `artifactId` assignment inside `withType<MavenPublication>` not matching `project.name`.

The fix in both cases was the same: rename the internal module to match its domain (`auth`, `transactions`) and verify the `artifactId` block explicitly rather than relying on Gradle defaults. If you're setting up a similar structure, check this on day one — renaming a published artifact after consumers depend on it is a breaking change.

## Where this leaves the app shell

Because business logic lives in versioned libraries, `finio-app` stays thin: Compose screens, Voyager navigation, Koin wiring, and platform-specific glue (push notification registration, deep link routing). Before wiring a new feature into the shell, the practice that's paid off is a **DTO contract review** — checking that the fields a KMP module expects (e.g., `finio-transaction`, `finio-budget`) actually match what `finio-api`'s Zod schemas return, before writing a single line of UI code against them. Contract mismatches caught at this stage are a diff; caught after UI is built, they're a rewrite.

## Takeaways

If you're structuring a KMP product for more than a weekend project:

1. Treat each domain (auth, transactions, budget) as a library with a real public API, not a folder.
2. Get the internal module naming right before you publish — it leaks into iOS artifact IDs and is expensive to rename later.
3. Keep the `publishing` block and plugin ordering consistent across every module via a shared template; copy-pasting Gradle config by hand invites drift.
4. Validate backend/client contracts before building UI on top of them, not after.

None of this is exotic — it's the same modular discipline backend teams have applied to microservices for years, applied to a mobile codebase that happens to target two platforms from one Kotlin source tree.

---

*This article is part of a series on the engineering decisions behind Finio, a Kotlin Multiplatform personal finance app. Full series and notes: [github.com/dgbarreto/tech-writing](https://github.com/dgbarreto/tech-writing).*

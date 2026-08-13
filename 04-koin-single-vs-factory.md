---
title: The Koin Scope Bug That Teaches You What single vs. factory Actually Means
published: true
description: >-
  A real Koin scoping bug from Finio: AuthViewModel registered as factory{}
  produced two out-of-sync instances, and how to decide single vs. factory per
  dependency.
tags: 'kotlin, androiddev, dependencyinjection, koin'
canonical_url: null
id: 4391650
devto_url: >-
  https://dev.to/dgbarreto/the-koin-scope-bug-that-teaches-you-what-single-vs-factory-actually-means-3992
---

# The Koin Scope Bug That Teaches You What `single` vs. `factory` Actually Means

Dependency injection frameworks make a promise: ask for a dependency, get an instance, don't worry about how it was constructed. Koin's `single {}` and `factory {}` definitions look interchangeable in a quick glance at the DI module — both are one-liners, both resolve the same type. They are not interchangeable, and building Finio produced a bug that makes the difference impossible to forget.

## The bug

`AuthViewModel` was originally registered in Koin as:

```kotlin
val appModule = module {
    factory { AuthViewModel(get(), get()) }
}
```

`factory {}` means: every time something injects `AuthViewModel`, Koin constructs a **new instance**. That's fine for something stateless and cheap to build. It is not fine for a ViewModel holding observable auth state, because in Finio, `MainActivity` injected `AuthViewModel` directly (via `koinInject`, to call `saveFcmToken` after a successful login) while Compose screens injected their own `AuthViewModel` through `by viewModel()` for UI state observation.

With `factory {}`, those were **two different objects**. `MainActivity` held one instance of `AuthViewModel`; the login screen's composable held another. When the login screen updated its instance's state (successful auth, user profile loaded), `MainActivity`'s separate instance had no idea anything happened — it was still holding the old, unauthenticated state. Symptoms like "the FCM token doesn't get saved after login" or "the UI doesn't reflect the login I just did, depending on which part of the app checks state" trace directly back to this: two objects that look like one shared source of truth to the code reading them, but aren't.

## The fix, and why it's correct

```kotlin
val appModule = module {
    single { AuthViewModel(get(), get()) }
}
```

`single {}` means Koin constructs the instance once and returns that same instance for every subsequent injection request, for the lifetime of the Koin container. Now `MainActivity` and every Compose screen injecting `AuthViewModel` are looking at the same object. State mutated in one place is visible everywhere, which is the entire point of a ViewModel meant to represent shared session state.

## When each one is actually correct

The rule isn't "always use `single`" — that would just trade one class of bug for a different one (unbounded memory retention, state leaking across contexts that shouldn't share it). The distinguishing question is: **does this dependency represent shared state that multiple consumers need to observe consistently, or is it a stateless/cheap operation that's fine to reconstruct on demand?**

- `single {}` fits shared, long-lived state: `AuthViewModel` (session state), a database instance, a network client, anything acting as a source of truth that more than one part of the app reads or writes.
- `factory {}` fits short-lived, stateless, or intentionally-isolated instances: a use case class with no internal state, a mapper, or a ViewModel that's genuinely scoped to one screen instance and shouldn't be shared even if injected from two places.

## The open question this raised for the rest of the app

Fixing `AuthViewModel` surfaced a broader review that's still in progress in Finio: `TransactionViewModel`, `BudgetViewModel`, and `InsightsViewModel` are currently all registered as `factory {}`. Whether that's correct depends on the same question above, applied per-ViewModel, not assumed globally:

- If a screen and, say, a widget or notification handler both need to observe the *same* transaction list state, `factory {}` will silently produce the same bug `AuthViewModel` had — two instances, one seeing stale data.
- If each ViewModel is genuinely scoped to exactly one screen instance, with no other consumer expected to share its state, `factory {}` is correct and arguably safer — it avoids holding a screen's state in memory after the screen itself is gone, and avoids one screen instance's data leaking into a re-visit of the same screen.

The honest answer, before "fix it" makes sense as an action: audit each ViewModel for whether it currently has, or is ever likely to have, more than one consumer that needs consistent shared state. `AuthViewModel` failed that test because `MainActivity` needed to observe/act on auth state outside the Compose tree that owned the "main" `AuthViewModel` instance. `TransactionViewModel` might genuinely not have that requirement yet — but "yet" is doing a lot of work in that sentence, and it's the kind of assumption worth writing down as a comment next to the Koin definition, not just carrying in your head.

## The generalizable lesson

Koin's `single` vs. `factory` distinction is really Koin's syntax for a much older DI concept — singleton scope vs. transient/prototype scope, present in Spring, Dagger, and virtually every DI framework under different names. The bug pattern this produces (two objects both believed to be "the" instance, one of them silently stale) isn't specific to Koin or even to Kotlin — it's what happens any time a DI container's scope configuration doesn't match the actual sharing requirements of the code consuming it. The fix is never "use single by default" or "use factory by default" — it's asking, for each registration, who else reads this, and do they need to see the same object I just mutated.

## Takeaways

1. `factory {}` gives every injection a new instance; `single {}` gives every injection the same instance. Treat this as a correctness decision, not a style preference.
2. Any dependency injected from more than one place that needs to observe consistent state — a ViewModel read by both an Activity/Controller and a Compose/UI layer — almost always needs `single {}`.
3. When you find a `factory {}`-scoped dependency injected in multiple places, that's the exact shape of bug to check for before assuming the issue is elsewhere in your state management.
4. Audit DI scope decisions per-dependency, not as a blanket default — and write down *why* a scope was chosen when it's not obvious, because "obviously scoped to one screen" today can quietly become "actually needs to be shared" after the next feature is added.

---

*This article is part of a series on the engineering decisions behind Finio, a Kotlin Multiplatform personal finance app. Full series and notes: [github.com/dgbarreto/tech-writing](https://github.com/dgbarreto/tech-writing).*

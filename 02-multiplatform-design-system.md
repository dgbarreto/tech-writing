---
title: "Building a Design System That Actually Gets Used: Tokens, Components, and the AGP 9 Gotcha That Almost Broke It"
published: false
description: "How Finio's design system encodes decisions (not just colors) into component APIs, and an AGP 9.x packaging bug that silently strips resources from published KMP libraries."
tags: androiddev, compose, designsystem, kotlin
canonical_url:
---

# Building a Design System That Actually Gets Used: Tokens, Components, and the AGP 9 Gotcha That Almost Broke It

A design system is only as good as its adoption rate. It's easy to publish a beautiful `FinioButton` component and watch half the codebase quietly reach for raw `Material3` `Button` anyway because it was faster in the moment. The real engineering problem isn't drawing the components — it's making the design system the path of least resistance.

Here's how `finio-design-system`, one of five KMP libraries behind the Finio personal finance app, is structured to make that true, plus a packaging bug that silently strips your design system's resources out of production builds if you don't know to look for it.

## Tokens first, components second

Everything in the design system is built on four token categories, each its own object in `dev.finio.designsystem.theme`:

**Colors** (`FinioColors.kt`) — semantic, not literal. `primary = #6C63FF`, but also purpose-built tokens like `success = #4CAF50`, `error = #B00020`, `subtle = #8A8AA8`, `disabled` / `onDisabled` pairs. The naming convention pairs every "on-X" color with its background (`onPrimary`, `onSurface`, `onError`), following the same pattern Material Design uses internally — which makes the token set easy to reason about even if you've never seen Finio's code before.

**Spacing** (`FinioSpacing.kt`) — a linear scale from `xxxs = 2.dp` to `xxxl = 64.dp`, in nine steps. Having nine named steps instead of arbitrary `dp` values everywhere means a spacing audit is a search for raw `.dp` literals, not a design review.

**Typography** (`FinioTypography.kt`) — a full type scale from `displayLarge` (57sp) down to `labelSmall` (11sp), each with explicit `lineHeight` and `letterSpacing`, mirroring Material 3's type scale but scoped to the app's own object so it can diverge later without touching Material internals.

**Shape** (`FinioShape.kt`) — seven corner radius steps from `none` to `full` (a pill shape via `RoundedCornerShape(50)`).

The rule enforced across the entire `finio-app` codebase: **no screen uses a hardcoded color, spacing, shape, or raw Material3 component.** Every value traces back to one of these four token objects, and every interactive element is a DS component (`FinioButton`, `FinioTextField`, `FinioCard`) rather than `Button`, `OutlinedTextField`, or `Card` directly.

## Designing components around variants, not props explosion

`FinioButton` is a useful example of API design under constraint:

```kotlin
@Composable
fun FinioButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: FinioButtonVariant = FinioButtonVariant.Primary,
    enabled: Boolean = true
)

enum class FinioButtonVariant { Primary, Secondary, Destructive, Ghost }
```

Internally, `FinioButton` dispatches to `FinioPrimaryButton`, `FinioSecondayButton` (yes, that typo is load-bearing now — renaming it is a breaking API change for existing call sites, a reminder that public API surfaces accumulate small debts you choose to live with), `FinioDestructiveButton`, and `FinioGhostButton`. Each of those internal implementations pulls its colors, shape, and typography from tokens — `FinioColors.primary` / `onPrimary` for the primary variant, `FinioColors.error` for destructive, `FinioShape.sm`, `FinioTypography.labelLarge` throughout.

The pattern generalizes across the component set:

- `FinioCardTransaction` encodes an `enum class FinioTransactionType { Income, Expense }` and maps it directly to `FinioColors.success` / `FinioColors.error` for the amount text — so "is this money coming in or going out" is a type-level decision, not a color chosen ad hoc at each call site.
- `FinioText` ships as semantic wrappers (`FinioHeadline`, `FinioBody`, `FinioLabel`) rather than exposing raw `Text(style = ...)` calls, so a copy change to "what does body text look like app-wide" is one edit, not a find-and-replace across every screen.
- `FinioDialog` bundles the interaction pattern itself (`isDestructive: Boolean` swaps the confirm button to the `Destructive` variant automatically) so a screen author can't accidentally ship a "delete this transaction" dialog with a primary-colored confirm button.

The common thread: the component API encodes the *decision* (is this a destructive action? is this income or expense?), and the token/variant mapping happens once, inside the design system, instead of being re-derived by every screen that needs it.

## The AGP 9 packaging bug that ships an app with no design system resources

This is the kind of bug that doesn't show up until it's too late to catch in a code review: on AGP 9.x with `com.android.kotlin.multiplatform.library`, Compose resources (`composeResources`) are **excluded from the published `.aar` by default** unless you explicitly opt in:

```kotlin
androidLibrary {
    androidResources {
        enable = true
    }
}
```

Without this line, `finio-design-system` builds fine locally, publishes fine to GitHub Packages, and then throws `MissingResourceException` at runtime in `finio-app` — but only for whatever resources the design system bundles (icons, fonts) that got silently dropped from the artifact. It's a gap between "the library compiles" and "the library actually works when consumed," and it only surfaces once you try to run the consuming app, not when you build the library itself.

If you're on AGP 9 with a KMP library module and you see resource-not-found exceptions that make no sense given the resource clearly exists in the source tree, check this flag first.

## Making adoption the easy path, not the enforced path

None of the token discipline above is enforced by a linter in Finio yet — it's a convention, reinforced by code review and by the fact that DS components are simply less code to write than reaching for Material3 directly and re-deriving colors and spacing by hand. That's a deliberate bet: a design system wins when using it correctly is less typing than not using it, not only when a CI check blocks the PR. The next step on the roadmap is exactly the enforcement layer — extracting `FinioNavigationBar` as a standalone DS component instead of leaving it inlined in the app shell, and adding semantic income/expense color tokens to `FinioTheme` to eliminate the last hardcoded `Color(0xFF2E7D32)` / `Color(0xFFC62828)` pair still living in `TransactionItem`.

## Takeaways

1. Build the token layer (color, spacing, typography, shape) before the component layer — components should consume tokens, never define values themselves.
2. Encode decisions in the component API (destructive vs. primary, income vs. expense) rather than leaving color/style choices to whoever writes the screen.
3. On AGP 9.x KMP library modules, explicitly enable `androidResources` or your published artifact silently loses its bundled resources.
4. Treat every hardcoded color or raw Material3 usage found in review as a design system gap to close, not a one-off exception to allow.

---

*This article is part of a series on the engineering decisions behind Finio, a Kotlin Multiplatform personal finance app. Full series and notes: [github.com/dgbarreto/tech-writing](https://github.com/dgbarreto/tech-writing).*

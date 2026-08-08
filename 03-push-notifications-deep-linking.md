---
title: >-
  FCM Push Notifications and Deep Linking in Compose Multiplatform: The Payload
  Choice That Breaks Everything
published: true
description: >-
  Why data-only FCM payloads are non-negotiable for background delivery, and how
  Finio routes push taps into Voyager navigation via a DeepLinkEventBus.
tags: 'android, firebase, kotlin, mobile'
canonical_url: null
id: 4348886
devto_url: >-
  https://dev.to/dgbarreto/fcm-push-notifications-and-deep-linking-in-compose-multiplatform-the-payload-choice-that-breaks-jpl
---

# FCM Push Notifications and Deep Linking in Compose Multiplatform: The Payload Choice That Breaks Everything

There's a single decision in Firebase Cloud Messaging that determines whether your Android push notification handling code runs at all when the app is backgrounded: whether you send a `notification` payload or a `data`-only payload. Get it wrong and your carefully written `onMessageReceived` handler simply never fires — no crash, no error, just silence. This is one of the sharper lessons from building push notifications and deep linking for Finio, a Compose Multiplatform personal finance app.

## Why data-only payloads are not optional

FCM supports two payload shapes. A `notification` payload is rendered by the OS notification tray automatically, which sounds convenient — until the app is backgrounded or killed, at which point Android intercepts it before it ever reaches your app's `onMessageReceived` callback. Your `FinioMessagingService` never runs, so any custom logic — routing data into the right screen, marking a budget alert as read, deep link payload construction — is skipped entirely.

The fix is to always send **data-only payloads**:

```json
{
  "message": {
    "token": "...",
    "data": {
      "type": "budget_alert",
      "budgetId": "abc123",
      "title": "Budget Alert",
      "body": "You've spent 90% of your Groceries budget"
    }
  }
}
```

With a data-only payload, `onMessageReceived` fires in every app state — foreground, background, or killed — and you take full responsibility for constructing the notification yourself, including navigating the intent when the user taps it. It's more code up front, but it's the only path that gives you control over what happens on tap, which is exactly what deep linking needs.

## Routing the tap: `DeepLinkEventBus`

Once a push notification is tapped, the app needs to know it should open directly to a specific screen — in Finio's case, tapping a budget alert should land the user on the Budget tab, not the default home screen. The mechanism connecting "Android `Intent` received in `MainActivity`" to "Voyager navigator changes screen" is a `DeepLinkEventBus`: a shared event stream that platform-specific entry points publish to, and that the Compose navigation layer subscribes to.

The flow looks like this:

1. `FinioMessagingService.onMessageReceived` builds a local `Notification` from the data payload, attaching a `PendingIntent` that carries the deep link target (e.g., `budgetId` and a route identifier) as `Intent` extras.
2. When the user taps the notification, `MainActivity.onNewIntent` (or `onCreate`, if the app was killed) reads those extras and publishes an event onto `DeepLinkEventBus`.
3. A composable observing the bus — typically hoisted near the root `Navigator` — reacts to the event and calls into Voyager to push the Budget tab's screen onto the stack.

This indirection matters because `MainActivity` shouldn't know about Voyager's navigation API directly, and the Compose navigation layer shouldn't know about Android's `Intent` system. The event bus is the seam between "platform delivered a signal" and "UI reacted to it," which keeps the platform-specific code (`MainActivity`, the `FinioMessagingService`) decoupled from the shared Compose navigation logic — important in a KMP codebase where the iOS side needs the equivalent flow (APNs → deep link) to funnel into the *same* shared navigation reaction, not a parallel implementation.

## A rendering trap that looks unrelated but isn't

One easy-to-miss detail on the Voyager side: a `Navigator` composable requires calling `navigator.lastItem.Content()` — not just referencing `navigator.lastItem`. It's a one-token difference that fails silently: the screen state changes, the navigator's internal stack updates correctly, but nothing visibly renders, because `lastItem` on its own is just a `Screen` reference, not a call to its `Content` composable. If a deep link event correctly updates navigation state but the UI doesn't visibly change, this is the first thing worth checking before assuming the event bus itself is broken.

## The bug hiding in "why did I get this notification twice?"

A concrete debugging example from Finio: the app was displaying two duplicate notifications on launch, even with no new pushes sent from the server. There are two candidate explanations worth separating before touching code:

1. `FinioMessagingService` itself firing twice for a single message (a service lifecycle or registration issue), or
2. `getBudgetWithProgress` — the endpoint that evaluates whether a budget threshold was crossed — being called multiple times during initial load, each call independently deciding "this budget is over threshold, fire a notification."

These have different fixes. The first is a client-side FCM registration bug. The second is a backend logic gap: if budget alert evaluation happens as a side effect of a read endpoint, then anything that causes that endpoint to be called twice (a retry, a duplicate screen mount triggering the same ViewModel fetch, a race between cache and network) produces a duplicate alert, because there's no idempotency guard around "have I already alerted for this state."

That second failure mode is really a design gap, not a bug: alert-firing is currently coupled to every evaluation of budget progress, with no memory of whether an alert was already sent. The options under consideration to fix this properly:

- **`lastAlertSentAt` with a 24-hour throttle** — simple, but can suppress a legitimate second alert if the user makes several large purchases in one day and crosses further thresholds.
- **An `alertSent` boolean that resets on budget renewal** — cleaner semantically (one alert per budget period), but requires the budget renewal job to explicitly reset the flag.
- **Fire only when the percentage crosses a threshold for the first time** — the most precise, but requires persisting the last-known percentage to detect a crossing rather than a static state.

None of these is implemented yet in Finio; the point worth taking away isn't which one is "correct" in the abstract, but that duplicate-notification bugs are frequently a decoupling problem — a side effect (sending an alert) fired from something that has no concept of "have I done this already" (a stateless progress calculation) — rather than a duplicate-registration bug, and it's worth ruling out the simpler client-side explanation before redesigning the alert logic.

## Takeaways

1. Always use data-only FCM payloads if you need custom logic to run in the background or killed app states — `notification` payloads bypass your handler entirely outside the foreground.
2. Keep an event bus (`DeepLinkEventBus` or equivalent) as the seam between platform-specific intent handling and shared Compose navigation — it keeps both sides testable and keeps Android/iOS deep link entry points converging on one reaction path.
3. With Voyager, remember `navigator.lastItem.Content()`, not `navigator.lastItem` — a common one-token bug that silently fails to render.
4. When you see duplicate side effects (notifications, alerts, emails), check whether the side effect is coupled to a stateless read operation before assuming it's a registration or delivery bug — idempotency is usually the real fix.

---

*This article is part of a series on the engineering decisions behind Finio, a Kotlin Multiplatform personal finance app. Full series and notes: [github.com/dgbarreto/tech-writing](https://github.com/dgbarreto/tech-writing).*

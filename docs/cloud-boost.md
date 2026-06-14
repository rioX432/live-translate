# Cloud Boost: Azure Translator F0 + API Rotation

Live Translate runs **fully offline by default** — the local HY-MT1.5 1.8B
translator handles JA↔EN in ~180 ms with no network access. "Cloud boost" is
the optional opt-in path that adds a hosted translator on top, transparently
falls back to the local engine when the cloud quota is exhausted, and
disappears entirely if you choose not to configure a key.

This document covers the **recommended single-provider setup** (Azure
Translator F0) and explains how the `ApiRotationController` orchestrates the
fallback. For the enterprise (MDM-managed) variant, see
[mdm-config.md](mdm-config.md).

## Why Azure F0 is the recommended boost

We deliberately recommend **one** cloud key, not four, to keep the setup
simple:

| Provider | Free tier | Notes |
|---|---|---|
| **Azure Translator F0** | **2,000,000 chars / month** | One Azure account, free tier, no credit card required up to the limit. |
| Google Cloud Translation | 480,000 chars / month | Requires a Google Cloud project with billing enabled (free tier credits cover normal use). |
| DeepL Free | 500,000 chars / month | EU account required for some flows; rate-limited per minute. |
| Gemini | Generous free tier | Subject to Google AI Studio policy changes. |

A 2 M / month allowance covers ~1,500 minutes of typical meeting subtitles,
which is more than enough for individual use. Stacking the others is
supported (see "Stacking multiple providers" below) but is **not required**.

If you do not want any cloud usage, simply skip this entire document — the
default install translates everything locally.

## Step 1: Create an Azure Translator resource (F0 tier)

Estimated time: 5 minutes.

1. Sign in to the [Azure portal](https://portal.azure.com/) (free account is
   fine).
2. Click **Create a resource** → search for **Translator** → choose the one
   published by Microsoft and click **Create**.
3. Fill in the form:
   - **Subscription** — your Azure subscription
   - **Resource group** — create a new one (e.g. `live-translate`)
   - **Region** — pick the region closest to your meetings, e.g.
     `japaneast` for Japan, `eastus` for the US East coast. Note: the region
     value is part of the request URL, so it must match what you paste into
     the app.
   - **Name** — any unique name, e.g. `live-translate-xxxxxx`
   - **Pricing tier** — **F0 (Free)** — this is the critical choice. F0 is
     hard-capped at 2 M characters / month and never bills.
4. Click **Review + Create** → **Create**. Provisioning takes ~1 minute.
5. Open the resource → **Keys and Endpoint**.
6. Copy **KEY 1** and **Location/Region** (the latter is what you pasted in
   step 3, e.g. `japaneast`).

You are done with Azure. The key is yours; nothing about your subscription is
shared with Live Translate's developers.

> Microsoft documents the Translator pricing and quotas at
> <https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/>.
> Verify the F0 limit against the current page before relying on it for
> production-scale workloads.

## Step 2: Plug the key into Live Translate

1. Open Live Translate → **Settings** → **Translator**.
2. Set **Engine** to `Auto` or `API Rotation` so the controller is in charge.
3. Under **Cloud providers**, paste:
   - **Azure Translator key** — KEY 1 from step 1.6
   - **Azure region** — e.g. `japaneast` (must match the Azure resource
     region exactly).
4. Optionally add Google / DeepL / Gemini keys in the same panel if you want
   to stack providers.
5. Click **Start**. The status bar reads `Azure → Google → DeepL → Gemini —
   up to 4M+ chars/month free` when rotation is active.

Keys are stored via `electron-store`, which encrypts the persisted JSON; they
are never transmitted to the Live Translate repository or maintainers.

## Step 3: Verify the rotation in action

- **Normal usage** — the active provider is shown in the overlay status. For
  a fresh month, this is Azure.
- **Quota approaching** — when a provider reaches 90% of its monthly limit,
  a warning is logged (`{providerId}: 90% quota used (1800000/2000000)`).
- **Quota exhausted** — once a provider hits its monthly cap, rotation
  silently advances to the next. If you only configured Azure, rotation
  hands off to the **local** fallback engine and the overlay continues
  without interruption.
- **Network drop or 429 rate-limit** — short-window rate-limit errors put
  the provider on a 60-second cooldown but do not consume the failure
  budget. Hard errors (>5 in a row) put the provider on a 5-minute cooldown.

You can inspect the quota state at any time via the rotation summary in the
status panel; raw counters are persisted across app restarts.

## How the rotation logic works (#703)

The `ApiRotationController`
(`src/engines/translator/ApiRotationController.ts`) wraps an ordered list of
`TranslatorEngine` instances:

```ts
new ApiRotationController(
  [
    { engine: azureEngine,  monthlyCharLimit: 2_000_000 }, // QUOTA_LIMITS.microsoft
    { engine: googleEngine, monthlyCharLimit:   480_000 }, // QUOTA_LIMITS.google
    { engine: deeplEngine,  monthlyCharLimit:   500_000 }, // QUOTA_LIMITS.deepl
    { engine: geminiEngine, monthlyCharLimit: 1_000_000 }  // QUOTA_LIMITS.gemini
  ],
  persistence,
  onStatusUpdate,
  { fallbackEngine: localTranslator } // #703: drops back to local when exhausted
)
```

On each `translate(text, from, to)` call:

1. The controller iterates providers in order, skipping any that:
   - Failed to initialize (e.g. missing key)
   - Have exceeded their monthly character cap
   - Are within the 5-minute consecutive-failure cooldown
   - Are within the 60-second 429 rate-limit cooldown
2. The first eligible provider runs the translation. On success the
   character count is incremented and persisted.
3. On failure, the error is classified:
   - **Quota exceeded / HTTP 456** → mark the provider exhausted for the
     current month; do not count against the failure budget.
   - **Rate limit** → 60-second cooldown; do not count against the failure
     budget.
   - **Other transient errors** → increment the per-provider failure
     counter; 5 in a row trips the 5-minute cooldown.
4. When **every** cloud provider is skipped or has failed and a
   `fallbackEngine` is configured, the controller lazily initializes the
   local translator and uses it — the user sees `All cloud providers
   exhausted, using local fallback` in the status bar but the overlay
   continues without dropping a sentence.

Monthly counters are keyed on `YYYY-MM` and reset automatically at the
boundary; there is no manual rollover step.

## Stacking multiple providers (optional)

If you want to push the combined free allowance past 4 M characters / month,
add Google, DeepL, and Gemini keys in the same Settings panel. The rotation
order is fixed today: **Azure → Google → DeepL → Gemini → local fallback**.
Azure is first because its F0 tier has by far the largest free quota, so
draining it first minimizes the chance of ever hitting the smaller per-month
ceilings on the others.

## Enterprise / MDM-managed deployment

For organizations that want to push a corporate Azure key to every machine
**without** the user typing it in, Live Translate honors a managed-preference
plist on macOS (`/Library/Managed Preferences/com.live-translate.app.plist`):

```xml
<key>managedMicrosoftApiKey</key>
<string>YOUR-AZURE-TRANSLATOR-KEY</string>
<key>managedMicrosoftRegion</key>
<string>japaneast</string>
```

This was added in [#704](https://github.com/rioX432/live-translate/issues/704)
and is **strictly opt-in** — it only ships if your organization deploys the
configuration profile. End users still see the same UI; the keys are simply
prefilled and (if `lockedEngine` is set) cannot be changed.

See [mdm-config.md](mdm-config.md) for the full list of supported keys.

## FAQ

**Do I have to configure any cloud key?**
No. The default install is fully offline. This document is only relevant if
you want to opt in to cloud-quality translation.

**What happens when Azure quota is exhausted?**
The rotation controller automatically falls back to the local HY-MT1.5 1.8B
translator. You will see a one-time status message; subtitles continue.

**Are my API keys uploaded anywhere?**
No. Keys are stored locally via `electron-store` and sent only to the
provider whose key it is (Azure, Google, etc.) when that provider is the
active one in the rotation.

**Can I use a paid Azure S1 tier instead of F0?**
Yes. The app only cares about the key + region; it does not check the
pricing tier. The `monthlyCharLimit` setting in code is a soft client-side
counter to avoid surprise bills on free tiers — adjust it (or remove the
provider from rotation) if you intentionally want to exceed 2 M chars on a
paid tier.

**Why not OpenAI / Anthropic / Claude as a cloud booster?**
Cost. The four providers in the rotation all have free tiers usable for
real-time meeting subtitles; the LLM APIs do not, and even with caching
they would be 10-100× more expensive per minute of speech.

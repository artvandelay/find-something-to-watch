# India OTT Home — User Guide

An agentic home for what to watch, built around the streaming services you actually subscribe to in
India — Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, MUBI, and twenty more services.

## Opening the app

Open the live site: https://artvandelay.github.io/india-ott-byok/

Everything runs in your browser. There is no account and no sign-up. Your subscriptions, LLM key,
You.md, watch history, and current conversation are all stored only in this browser (the key in
`localStorage`, everything else in IndexedDB). Whenever you send a message, the message and a bounded
slice of your mood/You.md/recent-watch context go directly to the model endpoint you configured, along
with your key to authenticate the request. The catalog search and filtering work runs locally in browser
Workers, so the model does not receive your watch URLs or poster URLs.

(Running a local copy instead? From the project folder run `npm install` once, then
`python3 -m http.server --directory docs` and open http://localhost:8000.)

## First visit: onboarding

The first time you open the app you'll see a single onboarding screen:

1. **Your subscriptions** — tick every service you actually pay for. Results are always restricted to
   these; you can change the selection later from **Settings**.
2. **Your model** (optional, but unlocks the conversational agent) — a base URL (OpenRouter,
   `https://openrouter.ai/api/v1`, is pre-filled), your API key, and a model name. Without a key you can
   still browse with plain keyword search. Web search is disabled by default and can be enabled later
   only when this endpoint is OpenRouter.
3. **Your taste** (optional) — a free-form You.md note and/or your Netflix viewing-history CSV (Netflix
   Account → Profile → Viewing activity → Download all).
4. **How this works** — the privacy summary described above.

Click **Continue** to enter the app. This screen only appears once; reopen the subscriptions/key from
**Settings** and the You.md/history from **Profile & context** at any time afterward.

## The three-region layout

- **Sidebar (left)** — start a **New chat**, see your one saved conversation, your subscribed services,
  and buttons for Profile & context, Settings, and trace/exports/catalog info, plus Export backup, Import
  backup, and Clear local data. On narrow screens this collapses into a drawer behind a menu button.
- **Chat (top right)** — your conversation transcript and the composer. Type what you're in the mood
  for, optionally narrow it with the mood/language/genre/provider dropdowns, and send.
- **Recommendations (bottom right)** — up to 20 titles, six at a time in a grid you page through with
  the arrows (or swipe on mobile). Before you send your first message, this is seeded instantly from your
  subscriptions' highest-rated unwatched titles — no model call needed. Each agent reply may replace this
  list; turns that are just clarifying questions leave it exactly as it was.

## Having a conversation

Type what you're in the mood for, the way you'd say it to a friend:

- "Something short and funny for tonight — nothing I've already seen"
- "A feel-good Malayalam movie under two hours"
- "A slow-burn thriller like the ones I loved last year"
- "Actually, make it shorter than that" (the agent remembers the last few turns)

The agent replies in the chat with a short, specific note about what it picked and why, and may update
the recommendation tray below. It analyses the complete catalog that is within your subscription scope;
recommendations are saved only after the app verifies that their IDs came from that turn's catalog
results and can still be resolved for your services. The more you say about mood, time available,
language, and what to avoid, the better the picks — and adding a You.md and your viewing history under
**Profile & context** helps even more.

## Narrowing things down with the dropdowns

Under the composer you'll find four optional filters:

- **Mood** — comfort, intense, funny, thoughtful, background, or surprise.
- **Language** — the original language of the title (Hindi, Malayalam, Tamil, English, and so on).
- **Genre** — drama, comedy, thriller, documentary, and more.
- **Provider** — only your subscribed services are listed here.

## Understanding the recommendation cards

Each card shows the title, year, runtime, a rating, and a watch link — labelled to match what it
actually is:

- **"Watch on ..."** — a true per-title deep link that should open the title directly.
- **"Find on ..."** — a link to that service's own search results for the title.
- **"See where to watch (TMDB)"** — TMDB's own watch page, which lists the real providers itself.

Two things worth knowing:

- **Ratings are TMDB audience scores** (out of 10), not IMDb ratings.
- **Availability is a snapshot.** Streaming lineups change constantly, so a title may have moved
  services since the catalog was last built — the exact build date is in the sidebar and in "Trace,
  exports & catalog info." Click through to confirm before movie night.

## Optional web search

In **Settings**, OpenRouter users can explicitly turn on web search for conversational turns. Leave it
off to use only the local catalog. When it is on, OpenRouter may pass the applicable prompt and model
context to web-search providers, retrieve current web content, and charge for that extra work. The app
will not enable this option for a non-OpenRouter base URL. This setting does not alter the catalog or
relax the rule that recommendations must be available through one of your subscriptions.

## New chat

**New chat** in the sidebar clears only your current conversation and the recommendation tray and
re-seeds the tray from your subscriptions. It does not touch your subscriptions, LLM key, You.md, or
watch history — there is only ever one saved conversation at a time, by design; nothing is archived.

## Exporting your results

Open **Trace, exports & catalog info** from the sidebar to:

- Export the current recommendation tray as **Markdown**, **JSON**, or **CSV**.
- Export an updated **You.md**.
- See the catalog's build date/source and this turn's agent trace (which tools it called and how many
  results each returned).

## Backing up and clearing your data

From the sidebar:

- **Export backup** downloads a `memory.json` snapshot of your profile, conversation, queue, You.md, and
  watch history (never your LLM key). **Import backup** restores from that file.
- **Clear local data** permanently deletes everything above from this browser, including your LLM key,
  after you confirm. This cannot be undone — export a backup first if you want to keep anything.

## The TMDB note in the footer

The footer says: *"This product uses the TMDB API but is not endorsed or certified by TMDB."*

The catalog's titles, ratings, posters, and availability information come from TMDB (The Movie
Database), and their terms require that line wherever their data is shown. It simply means the data
is theirs while the app itself is independent — TMDB didn't make it and doesn't vouch for it.

## Privacy in one paragraph

Your LLM key, subscriptions, taste note, watch history, and conversation live in this browser's local
storage/IndexedDB — never on our server, and never synced anywhere. Sending a message sends the message,
a bounded slice of your mood/You.md/recent-watch context, and your key directly to the model endpoint in
Settings. Catalog execution stays local. If you explicitly enable OpenRouter web search, OpenRouter may
also disclose the applicable prompt/context to search providers and bill for it; leave the setting off
to avoid that additional disclosure and cost. Clearing your browser's site data — or using **Clear local
data** in the sidebar — removes everything, completely and irreversibly; this is not encrypted storage
and is not a backup, so export a backup first if that matters to you.

## Troubleshooting

- **"auth" error** — your key is wrong, revoked, or pasted with extra spaces. Re-enter it in Settings.
- **"credit" error** — your model provider account is out of credit. Top it up or switch models.
- **"rate" error** — you're sending requests too quickly for your plan. Wait a moment and retry.
- **Web search is unavailable** — it is an optional OpenRouter-only setting. Set the model endpoint to
  OpenRouter or turn the setting off.
- **Picks feel generic** — add a You.md and your viewing history under **Profile & context**.
- **The catalog line says it's still preparing** — search starts as soon as the basic catalog is ready.
  A later "refining with synopses" note means rich, plot-aware catalog analysis is still loading; basic
  title and metadata analysis remains available.
- **A recommended title has no working link** — your subscriptions changed since it was added to the
  tray, or the snapshot's link for it is stale; send a new message or start a **New chat** to refresh.

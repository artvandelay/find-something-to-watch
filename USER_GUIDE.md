# Watch agent — User Guide

**A hobby watch-decision tool with deliberate bring-your-own-model friction.**

An agentic home for what to watch, built around the streaming services you actually subscribe to in
India — Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, MUBI, and twenty more services.

## Opening the app

Open the live site: https://artvandelay.github.io/india-ott-byok/

Stored in this browser. Relevant context is sent to the model endpoint you configure. There is no account
or sign-up. Your subscriptions, LLM key, You.md, watch history, conversations, ranked decisions, learned
preferences, and playlists stay in this browser (the key in `localStorage`, everything else in IndexedDB).
For a watch-history import, bounded filenames, structural metadata, and deterministic samples are sent to
the configured model endpoint to infer the file layout. The complete export remains in the browser; there
is no server, account, or cloud sync.

Model-generated catalog analysis runs in a disposable Worker for fault containment; it is not a
hostile-code security sandbox. The main thread keeps the trusted records used for recommendation cards,
playlists, and no-key keyword search; the model does not receive watch URLs or poster URLs.

(Running a local copy instead? From the project folder run
`python3 -m http.server --directory docs` and open http://localhost:8000.)

## First visit: onboarding

The first time you open the app, complete these three short steps:

1. **Your subscriptions** — tick every service you actually pay for. Results are always restricted to
   these; you can change the selection later from **Settings**.
2. **Compatible model** — enter a nonempty OpenRouter key. The app starts with its default OpenRouter
   endpoint and model; bring your preferred compatible model later in **Settings**.
3. **Watch-history export** (optional) — import one `.csv`, `.json`, or `.zip` export. ZIP files may
   contain CSV or JSON candidates. If an import fails, remove it and retry, or explicitly continue
   without history.

Click **Continue** to enter the app. This flow appears once; reopen subscriptions and key settings from
**Settings**, and edit You.md or replace history from **Profile & context** later. You.md is deliberately
not an onboarding field.

## Settings and optional web search

**Settings** lets you change subscriptions, model endpoint, API key, and model name. It also has an
**Allow web search with OpenRouter (can add cost)** checkbox. The checkbox is available only when the
base URL hostname is exactly `openrouter.ai`; changing to any other endpoint clears and disables it.

Web search is off by default and does not appear in onboarding. When enabled, OpenRouter may process
relevant queries with web search and may charge for that extra work. It does not change the local catalog,
the subscription gate, or the rule that recommendations must be grounded in catalog results.

## The three-panel layout

- **Sidebar (left)** — start a **New chat**, see active and recent conversations plus your subscribed
  services, and open **Playlists**, **Profile & context**, and **Settings**. Use the arrow beside the
  temporary mark to collapse it to an icon rail; that choice is remembered. Below about 1280px it
  collapses on its own, and on narrow screens it becomes a drawer behind the menu button.
- **Chat (middle)** — your conversation transcript with the composer pinned to the bottom of the
  column. Message text is capped at a comfortable reading width. Describe what you want in natural
  language and send.
- **Your picks (right)** — a ranked decision: one **Top pick**, two **Alternatives**, then optional
  **More options** from a maximum of 20 titles. Before you send your first message, this is seeded
  instantly from your subscriptions' highest-rated unwatched titles — no model call needed. Each agent
  reply may replace this list; turns that are just clarifying questions leave it exactly as it was. On
  narrow screens it moves below the chat column.

## Having a conversation

Type what you're in the mood for, the way you'd say it to a friend:

- "Something short and funny for tonight — nothing I've already seen"
- "A feel-good Malayalam movie under two hours"
- "A slow-burn thriller like the ones I loved last year"
- "Actually, make it shorter than that" (the agent remembers the last few turns)

The agent first shows `PLANNING`, `SEARCHING CATALOG`, `ANALYZING MATCHES`, and `WRITING`, then streams
the answer. Mention mood, time available, language, genre, a provider, or what to avoid directly in your
message. **Stop** cancels an active turn. After 20 seconds without meaningful progress, the activity row
says `TAKING LONGER THAN USUAL` and keeps Stop available. Completed turns show latency, token totals, and
either provider-reported cost or **Cost unavailable**; reported cost is not an estimate.

Selected subscriptions still gate every candidate and normal watch link. Adding You.md, watch history, or
enabled learned preferences under **Profile & context** can make picks more personal. The model receives
results from one local catalog analysis tool; only IDs observed in that tool's output (or already
displayed in the tray) can become new recommendations after the app resolves them against current
subscriptions.

## Understanding the recommendation cards

Each card shows the title, year, runtime, rating, a short synopsis, and a watch link — labelled to match
what it actually is:

- **"Watch on ..."** — a true per-title deep link that should open the title directly.
- **"Find on ..."** — a link to that service's own search results for the title.
- **"See where to watch (TMDB)"** — TMDB's own watch page, which lists the real providers itself.

Open a title's details to see its catalog record and its providers in two groups: **On your subscriptions**
and **Other known platforms**. This details view is the only place that shows providers outside your
subscriptions. It is not exhaustive live availability.

Two things worth knowing:

- **Ratings are TMDB audience scores** (out of 10), not IMDb ratings.
- **Availability is a snapshot.** Streaming lineups change constantly, so a title may have moved
  services since the catalog was last built — the exact build date is at the foot of the picks rail.
  Click through to
  confirm before movie night. Some links are provider searches or TMDB fallback links rather than direct
  title pages.

Use the `+` button on a card to save it to a playlist — that opens a compact checklist, nothing more.
**Watch later** is always present and cannot be renamed or deleted.

**Playlists** in the sidebar opens your library: every playlist as a row with its saved count, plus one
**New playlist** action. Selecting a playlist opens its own view, where you can remove saved items and
see any title that is no longer available on your current subscriptions. Rename, Delete, and Export live
behind **More** there, and Export asks for Markdown, JSON, or CSV only once you choose it. Creating a
playlist is its own step with a single name field.

## New chat

**New chat** archives a non-empty current conversation and its ranked decision, then starts another and
re-seeds the tray from your subscriptions. It does not touch subscriptions, LLM key, You.md, watch
history, learned preferences, or playlists. The sidebar retains up to 20 recent conversations; selecting
one restores its transcript and decision rail.

## Learned preferences

The app learns only explicit, durable entertainment preferences from the latest request. It does not
store the evidence text. The model decides whether a statement is an explicit, durable preference;
ordinary requests such as “horror recommendations” are not learned. In **Profile & context**, you can
inspect, edit, remove, clear, or disable learned preferences. Disabling them prevents their use in future
model requests; manual You.md remains separate.

## Exporting your results

From **Playlists**, export any saved list as **Markdown**, **JSON**, or **CSV**. Your profile and
conversation data can also be preserved with an encrypted-storage-free browser backup, described below.

## Backing up and clearing your data

From **Settings**, under **Local data**:

- **Export backup** downloads a `memory.json` snapshot of your profile, conversation, queue, You.md,
  watch history, learned preferences, and playlists (never your LLM key). Backup import is not available
  in this version.
- **Clear local data** permanently deletes everything above from this browser, including your LLM key,
  after you confirm. This cannot be undone — export a backup first if you want to keep anything.

## The TMDB note in the footer

The footer says: *"This product uses the TMDB API but is not endorsed or certified by TMDB."*

The catalog's titles, ratings, posters, and availability information come from TMDB (The Movie
Database), and their terms require that line wherever their data is shown. It simply means the data
is theirs while the app itself is independent — TMDB didn't make it and doesn't vouch for it.

## Privacy in one paragraph

Stored in this browser. Relevant context is sent to the model endpoint you configure. Chat sends your
message plus bounded You.md, learned-preference, and recent-watch context; an import sends bounded
filenames, structural metadata, and samples to infer CSV/JSON/ZIP layout. Full files stay local. Clearing
browser site data — or using **Clear local data** in Settings — removes everything, completely and
irreversibly; this is not encrypted storage and is not a backup, so export a backup first if that matters
to you.

## Troubleshooting

- **"auth" error** — your key is wrong, revoked, or pasted with extra spaces. Re-enter it in Settings.
- **"credit" error** — your model provider account is out of credit. Top it up or switch models.
- **"rate" error** — you're sending requests too quickly for your plan. Wait a moment and retry.
- **Web search is unavailable** — it is a Settings-only OpenRouter option. Set the base URL to an
  OpenRouter URL or leave web search off.
- **Picks feel generic** — add a You.md and your viewing history under **Profile & context**.
- **The catalog line says it's still preparing** — search is blocked until the title index finishes
  building (usually under a second); a second note about "refining with synopses" may linger briefly
  after that while the fuller, synopsis-aware index finishes in the background.
- **Catalog analysis is still preparing** — no-key keyword search and playlists continue to work. Wait
  a moment before retrying a keyed agent request.
- **A recommended title has no working link** — your subscriptions changed since it was added to the
  tray, or the snapshot's link for it is stale; send a new message or start a **New chat** to refresh.

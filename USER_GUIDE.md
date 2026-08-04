# India OTT Home — User Guide

An agentic home for what to watch, built around the streaming services you actually subscribe to in
India — Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, MUBI, and twenty more services.

## Opening the app

Open the live site: https://artvandelay.github.io/india-ott-byok/

Everything runs in your browser. There is no account and no sign-up. Your subscriptions, LLM key,
You.md, watch history, current conversation, and playlists are all stored only in this browser (the key
in `localStorage`, everything else in IndexedDB) — except that whenever you send a message, that message
and a bounded slice of your You.md/recent-watch context are sent directly from your browser to the model
endpoint you configured, along with your key to authenticate the request. For a watch-history import,
only filenames, structural metadata, and deterministic bounded sample rows or records are sent directly
to OpenRouter to infer the file layout. The complete export remains in your browser; there is no server,
account, or cloud sync.

(Running a local copy instead? From the project folder run
`python3 -m http.server --directory docs` and open http://localhost:8000.)

## First visit: onboarding

The first time you open the app, complete these three short steps:

1. **Your subscriptions** — tick every service you actually pay for. Results are always restricted to
   these; you can change the selection later from **Settings**.
2. **OpenRouter key** — enter a nonempty API key. The app uses its default OpenRouter endpoint and model;
   compatible endpoint and model settings are available later in **Settings**.
3. **Watch-history export** (optional) — import one `.csv`, `.json`, or `.zip` export. ZIP files may
   contain CSV or JSON candidates. If an import fails, remove it and retry, or explicitly continue
   without history.

Click **Continue** to enter the app. This flow appears once; reopen subscriptions and key settings from
**Settings**, and edit You.md or replace history from **Profile & context** later. You.md is deliberately
not an onboarding field.

## The three-region layout

- **Sidebar (left)** — start a **New chat**, see your one saved conversation, your subscribed services,
  and buttons for **Playlists**, **Profile & context**, and **Settings**, plus Export backup, Import
  backup, and Clear local data. On narrow screens this collapses into a drawer behind a menu button.
- **Chat (top right)** — your conversation transcript and a minimal composer. Describe what you want in
  natural language and send.
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

The agent replies with short paragraphs or simple lists and may update the recommendation tray below.
Mention mood, time available, language, genre, a provider, or what to avoid directly in your message.
Selected subscriptions still gate every candidate and watch link. Adding You.md and watch history under
**Profile & context** can make picks more personal.

## Understanding the recommendation cards

Each card shows the title, year, runtime, rating, a short synopsis, and a watch link — labelled to match
what it actually is:

- **"Watch on ..."** — a true per-title deep link that should open the title directly.
- **"Find on ..."** — a link to that service's own search results for the title.
- **"See where to watch (TMDB)"** — TMDB's own watch page, which lists the real providers itself.

Two things worth knowing:

- **Ratings are TMDB audience scores** (out of 10), not IMDb ratings.
- **Availability is a snapshot.** Streaming lineups change constantly, so a title may have moved
  services since the catalog was last built — the exact build date is in the sidebar. Click through to
  confirm before movie night. Some links are provider searches or TMDB fallback links rather than direct
  title pages.

Use the `+` button on a card to save it to a playlist. **Watch later** is always present and cannot be
renamed or deleted. Open **Playlists** to create, rename, or delete your own named lists, remove saved
items, inspect unavailable saved titles, or export a list as Markdown, JSON, or CSV.

## New chat

**New chat** in the sidebar clears only your current conversation and the recommendation tray and
re-seeds the tray from your subscriptions. It does not touch your subscriptions, LLM key, You.md, or
watch history — or any playlists. There is only ever one saved conversation at a time, by design; nothing
is archived.

## Exporting your results

From **Playlists**, export any saved list as **Markdown**, **JSON**, or **CSV**. Your profile and
conversation data can also be preserved with an encrypted-storage-free browser backup, described below.

## Backing up and clearing your data

From the sidebar:

- **Export backup** downloads a `memory.json` snapshot of your profile, conversation, queue, You.md,
  watch history, and playlists (never your LLM key). **Import backup** restores from that file.
- **Clear local data** permanently deletes everything above from this browser, including your LLM key,
  after you confirm. This cannot be undone — export a backup first if you want to keep anything.

## The TMDB note in the footer

The footer says: *"This product uses the TMDB API but is not endorsed or certified by TMDB."*

The catalog's titles, ratings, posters, and availability information come from TMDB (The Movie
Database), and their terms require that line wherever their data is shown. It simply means the data
is theirs while the app itself is independent — TMDB didn't make it and doesn't vouch for it.

## Privacy in one paragraph

Your LLM key, subscriptions, taste note, watch history, and conversation live in this browser's local
storage/IndexedDB — never on a server, and never synced anywhere. The exceptions are direct requests to
your configured model endpoint: chat sends your message plus bounded You.md/recent-watch context, and an
import sends only filenames, structural metadata, and deterministic bounded sample rows or records to
OpenRouter so it can infer a CSV/JSON/ZIP layout. Full files stay local. Clearing your browser's site
data — or using **Clear local data** in the sidebar — removes everything, completely and irreversibly;
this is not encrypted storage and is not a backup, so export a backup first if that matters to you.

## Troubleshooting

- **"auth" error** — your key is wrong, revoked, or pasted with extra spaces. Re-enter it in Settings.
- **"credit" error** — your model provider account is out of credit. Top it up or switch models.
- **"rate" error** — you're sending requests too quickly for your plan. Wait a moment and retry.
- **Picks feel generic** — add a You.md and your viewing history under **Profile & context**.
- **The catalog line says it's still preparing** — search is blocked until the title index finishes
  building (usually under a second); a second note about "refining with synopses" may linger briefly
  after that while the fuller, synopsis-aware index finishes in the background.
- **A recommended title has no working link** — your subscriptions changed since it was added to the
  tray, or the snapshot's link for it is stale; send a new message or start a **New chat** to refresh.

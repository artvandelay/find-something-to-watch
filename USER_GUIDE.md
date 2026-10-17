# Find Something to Watch — User Guide

**A hobby watch-decision tool with deliberate bring-your-own-model friction.**

An agentic home for what to watch, built around the streaming services you actually subscribe to in
India — Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, MUBI, and twenty more services.

## Opening the app

Open the live site: https://artvandelay.github.io/find-something-to-watch/

Stored in this browser. Relevant context is sent to the model endpoint you configure. There is no account
or sign-up. Your subscriptions, LLM key, You.md, watch history, conversations, ranked decisions, learned
preferences, and playlists stay in this browser (the key in `localStorage`, everything else in IndexedDB).
A watch-history file is attached in the chat. A bounded sample of its filename, headers, and a few
rows is sent to the model, which returns a layout. The app generates a reader from that layout and
runs it locally. The complete export remains in the browser; there is no server, account, or cloud sync.

Model-generated catalog analysis runs in a disposable Worker for fault containment; it is not a
hostile-code security sandbox. The main thread keeps the trusted records used for recommendation cards,
playlists, and the initial queue; the model does not receive watch URLs or poster URLs.

(Running a local copy instead? From the project folder run
`python3 -m http.server --directory docs` and open http://localhost:8000.)

## First visit: configure the app

The app opens directly into the main workspace. Before you can use chat:

1. Open **Settings**.
2. Select every streaming service you subscribe to. Results are always restricted to these services.
3. Under **Your model**, enter a nonempty OpenRouter key. You can also change the compatible endpoint
   and model.
4. Select **Save**.

To personalize results, open **Profile & context** and add a You.md taste profile. Add watch history
from the chat box, with the paperclip or by dropping the file. The model describes the layout from a
bounded sample. The app then generates a reader and runs it in this browser. An API key in Settings is
required.

## Settings and optional web search

**Settings** lets you change subscriptions, your region, model endpoint, API key, and model name. It also has an
**Allow web search with OpenRouter (can add cost)** checkbox. The checkbox is available only when the
base URL hostname is exactly `openrouter.ai`; changing to any other endpoint clears and disables it.

Web search is off by default. When enabled, OpenRouter may process relevant queries with web search and
may charge for that extra work. It does not change the local catalog, the subscription gate, or the rule
that recommendations must be grounded in catalog results. With it on, a published list you name (such as
an IMDb or NYT list) can be looked up, then limited to titles that are actually in your subscriptions.

## The three-panel layout

- **Sidebar (left)** — start a **New chat**, see active and recent conversations plus your subscribed
  services, and open **Playlists**, **Profile & context**, and **Settings**. Use the arrow beside the
  brand mark to collapse it to an icon rail; that choice is remembered. Below about 1280px it collapses
  on its own, and on narrow screens it becomes a drawer behind the menu button.
- **Chat (middle)** — your conversation transcript with the composer pinned to the bottom of the
  column. Message text is capped at a comfortable reading width. Describe what you want in natural
  language and send.
- **Your picks (right)** — the titles the assistant chose, up to 20. A short list shows every title.
  A longer one shows the first five, then **Show N more**. **Ask for more picks** sends "More, please"
  and lets the assistant decide whether to add titles or replace the list. Before you send your first
  message, the rail is seeded from your subscriptions' highest-rated unwatched titles. On desktop, drag
  the divider to resize this panel or use its arrow to hide it. On narrow screens it moves below the chat.

## Having a conversation

Type what you're in the mood for, the way you'd say it to a friend:

- "Something short and funny for tonight — nothing I've already seen"
- "A feel-good Malayalam movie under two hours"
- "A slow-burn thriller like the ones I loved last year"
- "Actually, make it shorter than that" (the agent remembers the last few turns)

The agent first shows "Seeing what you can watch", "Looking for a good fit", "Narrowing it down", and
"Choosing a few to watch", then streams the answer. Mention mood, time available, language, genre, a provider, or what to avoid directly in your
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

## What it remembers

The chat is one long conversation. It stays in this browser, up to 400 messages. After a gap of about
six hours, a date line separates the older messages. When you come back, the end of the chat can show
a short line about the last visit and a few suggestions.

A new chat also says what the app remembers, for example a like, an avoid, a habit, and how many titles
are marked seen. **See all** opens **What I remember**. That panel lists learned facts, which you can
edit or remove, and titles you marked seen or **Can't open it**, which you can remove. Imported history
is shown as counts only. Removing an imported file does not remove titles you marked in chat.

The app can remember a viewing habit you state in your own words, such as weeknights under 90 minutes.
If you say you already watched a title, that title is marked seen and is not recommended again. A later
message can use a short recall of earlier requests. Profile & context is still where you review, edit,
disable, or clear what was learned. New chats share this memory. They do not start from a blank taste profile.

## Importing history

Add the file in the chat. Use the paperclip on the message box, or drop a `.csv`, `.json`, `.html`, or
`.zip` file onto it. The filename is your message. Profile & context is not where you import the file.

The app sends a bounded sample — the filename, the shape, and a few rows — to the model. The model
returns a layout, not a parser. The app generates a reader from that layout and runs it in a disposable
worker over the file. The reader only turns rows into titles and dates. A successful reply looks like
“Read NetflixViewingHistory.csv. Marked 1,732 titles seen,” with the series, movie, other, and seen
counts from that file. Those titles are marked seen, so they are not recommended again.

If the layout is invalid, the reader fails, or the file has no titles, the reply is that error. Saved
history is left as it was. Full files stay in this browser. Reading a file needs the API key from Settings.

**Profile & context** shows the imported counts and can remove that import. It does not ask for the file.

You can also set the region or your subscriptions in the same box, for example `region US`, `I watch in
India`, or `I subscribe to Netflix and Prime Video`. A normal watch request is left to the assistant.

## Region

Settings, the first-run screen, and a clear chat command (`region US`, `I watch in India`) set the region.
The default is India. Free links known to fail
in that region are hidden. Apple Podcasts and Books links open in that region's store. Links with no
region data stay visible. **Can't open it** is still the backup when a link fails for you. Changing the
region updates the free links without a reload.

## Free sources

Besides your subscriptions, the catalog includes free podcasts, films, and audiobooks gathered from
Open Culture. Ask for something free, for audio, or for a commute. Free cards are marked Free and link
straight to the source. If a link does not open where you are, select the unlink icon on that card
(**Can't open it**). That title stays hidden in this browser.

## Exporting your results

From **Playlists**, export any saved list as **Markdown**, **JSON**, or **CSV**. Your profile and
conversation data can also be preserved with an encrypted-storage-free browser backup, described below.

## Backing up and clearing your data

From **Settings**, under **Local data**:

- **Export backup** downloads a `memory.json` snapshot of your profile, conversation, queue, You.md,
  watch history, learned preferences, and playlists (never your LLM key). Backup import is not available
  in this version.
- **Start over (keep API key)** removes conversations, the queue, learned facts, seen and blocked
  titles, imported history, You.md, region, subscriptions, and layout. The API key, model, and base URL
  stay. Opening the page with `?reset` does the same thing after you confirm.
- **Clear everything** permanently deletes everything above from this browser, including your API key,
  after you confirm. This cannot be undone — export a backup first if you want to keep anything.

## Where the data comes from

The footer credits the sources. Titles, ratings, posters, and availability come from TMDB (The Movie
Database). The free picks come from Open Culture. The app is independent of both.

## Privacy in one paragraph

Stored in this browser. Relevant context is sent to the model endpoint you configure. Chat sends your
message plus bounded You.md, learned-preference, and recent-watch context. A history file sends a
bounded sample so the model can describe the layout; the generated reader runs locally. Full files stay
local. Clearing
browser site data — or using **Clear everything** in Settings — removes everything, completely and
irreversibly; this is not encrypted storage and is not a backup, so export a backup first if that matters
to you.

## Troubleshooting

- **"auth" error** — your key is wrong, revoked, or pasted with extra spaces. Re-enter it in Settings.
- **"credit" error** — your model provider account is out of credit. Top it up or switch models.
- **"rate" error** — you're sending requests too quickly for your plan. Wait a moment and retry.
- **Web search is unavailable** — it is a Settings-only OpenRouter option. Set the base URL to an
  OpenRouter URL or leave web search off.
- **Picks feel generic** — add a You.md under **Profile & context**, and add a history file in the chat.
- **The catalog line says it's still preparing** — search is blocked until the title index finishes
  building (usually under a second); a second note about "refining with synopses" may linger briefly
  after that while the fuller, synopsis-aware index finishes in the background.
- **Catalog analysis is still preparing** — playlists continue to work. Wait a moment before retrying
  chat.
- **A recommended title has no working link** — your subscriptions changed since it was added to the
  tray, or the snapshot's link for it is stale; send a new message or start a **New chat** to refresh.

# India OTT Search — User Guide

Find something to watch by describing it. This app searches the streaming catalogs available in
India — Netflix, Prime Video, JioHotstar, ZEE5, SonyLIV, MUBI, and twenty more services — using
plain language instead of exact titles.

## Opening the app

Open the live site: https://artvandelay.github.io/india-ott-byok/

Everything runs in your browser. There is no account, no sign-up, and nothing is uploaded to a
server.

(Running a local copy instead? From the project folder run
`python3 -m http.server --directory docs` and open http://localhost:8000.)

## Setting up your LLM key (one time)

The app thinks with an AI model, and you bring your own key for that — like bringing your own SIM
card to a phone.

1. Click **Settings** (top right).
2. **Base URL** is pre-filled with OpenRouter (`https://openrouter.ai/api/v1`), which works well and
   lets you pick from many models. If you use a different compatible provider, paste its URL instead.
3. Paste your **API key**. If you don't have one, create it at your provider's site (for OpenRouter,
   that's openrouter.ai/keys).
4. Pick a **model** (the default is a good balance of cost and quality).
5. Click **Save**.

Your key is stored only in this browser and is sent only to the endpoint you configured — never
anywhere else. That's the whole point of the app: the catalog is free and built in; the only thing
you pay for is your own model usage.

No key? You can still search — the app falls back to plain keyword matching. It just won't understand
nuance as well.

## Asking questions

Type what you're in the mood for, the way you'd say it to a friend:

- "Something short and funny for tonight — nothing I've already seen"
- "A feel-good Malayalam movie under two hours"
- "A slow-burn thriller like the ones I loved last year"
- "A documentary I can half-watch while cooking"

The more you say about mood, time available, language, and what to avoid, the better the picks.

## Narrowing things down with the dropdowns

Under the question box you'll find four optional filters:

- **Mood** — comfort, intense, funny, thoughtful, background, or surprise.
- **Language** — the original language of the title (Hindi, Malayalam, Tamil, English, and so on).
- **Genre** — drama, comedy, thriller, documentary, and more.
- **Provider** — only show things on a service you actually subscribe to.

These combine with your question, so "a mystery, in Malayalam, on Netflix" works exactly as you'd
expect.

## Adding your taste context (optional)

Click **Your context** to make the picks personal:

- **You.md** — a free-form note about your taste: directors you love, moods you're in, things you
  never want to see again. Write it however you like.
- **Netflix viewing history** — the CSV Netflix gives you under
  Netflix Account → Profile → Viewing activity → Download all. The app uses it to skip things you've
  already seen and to learn what you actually finish.

Both are parsed and stored in your browser only. Nothing is uploaded.

## Understanding the results

Each pick shows the title, year, runtime, a rating, and which services carry it — with links to open
it there.

Two things worth knowing:

- **Ratings are TMDB audience scores** (out of 10), not IMDb ratings.
- **Availability is a snapshot.** Streaming lineups change constantly, so a title may have moved
  services since the catalog was last built. Click through to confirm before movie night.

## Exporting your results

Use the **Export** buttons to take your picks with you:

- **Markdown** — a readable list, good for notes apps and sharing.
- **JSON** — structured data, good for other tools.
- **CSV** — opens in any spreadsheet.
- **You.md** — an updated version of your taste profile.

## The TMDB note in the footer

The footer says: *"This product uses the TMDB API but is not endorsed or certified by TMDB."*

The catalog's titles, ratings, posters, and availability information come from TMDB (The Movie
Database), and their terms require that line wherever their data is shown. It simply means the data
is theirs while the app itself is independent — TMDB didn't make it and doesn't vouch for it.

## Privacy in one paragraph

Your LLM key, your taste note, and your viewing history live in your browser's local storage. The
only network request the app makes with your information is the search request sent directly from
your browser to the model endpoint you chose in Settings. Clearing your browser's site data removes
everything, completely.

## Troubleshooting

- **"auth" error** — your key is wrong, revoked, or pasted with extra spaces. Re-enter it in
  Settings.
- **"credit" error** — your model provider account is out of credit. Top it up or switch models.
- **"rate" error** — you're sending requests too quickly for your plan. Wait a moment and retry.
- **Picks feel generic** — add a You.md and your viewing history under **Your context**.
- **The catalog line says it failed to load** — check your connection and reload; the catalog is a
  static file and should always be reachable.

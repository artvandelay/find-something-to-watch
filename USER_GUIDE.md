# Netflix uNoGS Search — User Guide

This project includes a **personal Cursor Skill** plus a **Python CLI** that queries Netflix catalog availability via **uNoGSNG on RapidAPI**.

## What you get

- **Cursor Skill**: `~/.cursor/skills/netflix-unogs-search/`
- **CLI script**: `~/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py`
- **Netflix links**: results include `https://www.netflix.com/title/<netflixid>`

## Prerequisites

- `python3` available on your machine
- RapidAPI key in **this repo’s root** `.env`:

```bash
RAPIDAPI="your_rapidapi_key_here"
```

## Quick start

Run these commands **from this repo root** (so the script can find `.env`).

### 1) Sanity check (lists a few countries)

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" countries | head
```

### 2) “Fantasy movies on Netflix India”

This does a “browse by filters” query (country + genre + type).

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" search \
  --country India \
  --genre Fantasy \
  --type movie \
  --limit 10
```

### 3) “Which countries have Seinfeld?”

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" where "Seinfeld"
```

## CLI commands

### List reference data

- **Countries** (uNoGS country IDs + codes):

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" countries
```

- **Genres** (Netflix genre IDs):

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" genres
```

### Search titles

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" search \
  --country India \
  --type movie \
  --query "fantasy" \
  --limit 10
```

Notes:
- If you provide filters like `--country/--genre/--type`, `--query` is optional (the CLI will browse using filters).
- Use `--orderby` if you want ordering (e.g. `rating`, `dateDesc`, `title`).
- Use `--json` to print the raw API response.

### Find availability by country (“where”)

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" where "Some Title"
```

What it does:
- Searches by the given title text
- Picks the best match
- Calls the title availability endpoint
- Prints the country list + country code (e.g. `India (IN)`)

### Title details (optional)

```bash
python3 "/Users/jigar/.cursor/skills/netflix-unogs-search/scripts/unogs_cli.py" details --netflixid 70153373
```

## Using it inside Cursor (as a Skill)

The personal skill is named **`netflix-unogs-search`** and lives at:

- `~/.cursor/skills/netflix-unogs-search/SKILL.md`

When you ask Cursor questions like:
- “fantasy movie on netflix india”
- “which country netflix has seinfeld”

…the skill instructs the agent to run the CLI commands above and format results with Netflix links.

## Troubleshooting

### “Could not find a `.env` …”

You’re not running the command from inside the repo (or any subfolder of it). Re-run from the project root:

```bash
cd "/Users/jigar/projects/messing-around/llm-search-netflix"
```

### “Missing RAPIDAPI key…”

Ensure the repo root `.env` contains:

```bash
RAPIDAPI="..."
```

### “HTTP 4xx/5xx …”

This usually means RapidAPI subscription/limits, a temporary outage, or a bad key. Try again, then check your RapidAPI plan/usage for uNoGSNG.


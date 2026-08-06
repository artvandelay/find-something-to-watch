# Latency targets and validation matrix

Private, key-free phase timings are retained on completed turns and shown in the
developer trace/export. There is no analytics backend.

## Browser prep targets

| Phase | Target |
| --- | --- |
| Submit → first model request | No serial IndexedDB-then-manifest wait; both start together |
| Warm catalog reload | Normal HTTP cache; main thread does not rebuild BM25 |
| Real-catalog startup | `node scripts/stress_catalog_startup.mjs` |

## Turn classes

| Class | When | Planner steps | Model requests |
| --- | --- | --- | --- |
| `direct` | Short factual follow-up about the current queue | 0 | 1 streamed answer |
| `normal` | Typical recommendation / refinement | ≤ 4 | planner/tool loop + write |
| `complex` | Compare / research / long multi-part asks | ≤ 8 | deeper bounded loop + write |

Slow waits after the first model request are usually provider queue time or token
throughput for the selected BYOK model, not browser prep.

## Live stress matrix

Run with a root `.env` `OPENROUTER_API_KEY` (never print the key):

```bash
node scripts/stress_agent_live.mjs --limit 5
node scripts/stress_agent_live.mjs --matrix
```

| Scenario | What to verify |
| --- | --- |
| Short follow-up | `direct` class, one request, early first token |
| Fresh recommendation | `normal` class, grounded queue IDs |
| Slow provider | UI shows user-facing milestones + honest elapsed; Stop works |
| Cancellation | Stop clears progress; late events ignored |
| Long conversation | Compacted older assistant prose; recent turns + queue retained |

### Documented live baselines

Capture median TTFT, total ms, and request count per selected model when a key is
available. Treat results as snapshots, not SLAs — OpenRouter/provider variability
dominates. If the key is missing, deterministic checks still run and live baseline
collection is skipped.

Snapshot from `stress_agent_live.mjs --matrix` against the app default OpenRouter
model (key never printed):

| Scenario | Class | Requests | TTFT | Total |
| --- | --- | --- | --- | --- |
| Short follow-up | direct | 1 | ~4.5s | ~4.6s |
| Fresh recommendation | normal | 4 | ~28s | ~28s |
| Complex compare | complex | 4 | ~46s | ~46s |

Most of the wait after browser prep is provider/model time, which matches the
honest speed trade-off in Settings.

## Model speed trade-off

Settings copy states that model speed is user-configurable and that the static
BYOK app cannot guarantee Claude-like latency across arbitrary models or endpoints.

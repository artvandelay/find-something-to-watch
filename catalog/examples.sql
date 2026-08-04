-- Example queries against catalog.db
-- Change tracking: first_seen = run date that first saw the row (new arrivals),
-- last_seen = most recent run date that still saw it (gone/leaving otherwise).

-- 1. New this week: availability rows that first appeared in the last 7 days.
SELECT t.name, a.media_type, p.name AS provider, a.first_seen
FROM availability a
JOIN title t    ON t.tmdb_id = a.tmdb_id AND t.media_type = a.media_type
JOIN provider p ON p.provider_id = a.provider_id
WHERE a.first_seen >= date('now', '-7 days')
ORDER BY t.popularity DESC;

-- 2. Leaving soon: rows not seen in the latest snapshot.
SELECT t.name, a.media_type, p.name AS provider, a.last_seen
FROM availability a
JOIN title t    ON t.tmdb_id = a.tmdb_id AND t.media_type = a.media_type
JOIN provider p ON p.provider_id = a.provider_id
WHERE a.last_seen < (SELECT MAX(snapshot_date) FROM snapshot)
ORDER BY a.last_seen DESC, t.popularity DESC;

-- 3. Titles available on more than one provider (flatrate, as of the latest
--    snapshot -- excludes rows that have since left, i.e. last_seen is stale).
SELECT t.name, t.media_type, COUNT(DISTINCT a.provider_id) AS providers,
       GROUP_CONCAT(p.name, ', ') AS where_to_watch
FROM availability a
JOIN title t    ON t.tmdb_id = a.tmdb_id AND t.media_type = a.media_type
JOIN provider p ON p.provider_id = a.provider_id
WHERE a.monetization = 'flatrate'
  AND a.last_seen = (SELECT MAX(snapshot_date) FROM snapshot)
GROUP BY t.tmdb_id, t.media_type
HAVING COUNT(DISTINCT a.provider_id) > 1
ORDER BY providers DESC, t.popularity DESC;

-- 4. Catalog size by provider, as of the latest snapshot.
SELECT p.name, a.media_type, a.monetization, COUNT(*) AS titles
FROM availability a
JOIN provider p ON p.provider_id = a.provider_id
WHERE a.last_seen = (SELECT MAX(snapshot_date) FROM snapshot)
GROUP BY a.provider_id, a.media_type, a.monetization
ORDER BY titles DESC;

-- 5. Catalog size by original language, as of the latest snapshot.
SELECT t.original_language, COUNT(DISTINCT t.tmdb_id || '-' || t.media_type) AS titles
FROM title t
JOIN availability a ON a.tmdb_id = t.tmdb_id AND a.media_type = t.media_type
WHERE a.last_seen = (SELECT MAX(snapshot_date) FROM snapshot)
GROUP BY t.original_language
ORDER BY titles DESC;

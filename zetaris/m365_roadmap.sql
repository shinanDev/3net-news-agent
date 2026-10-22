-- Microsoft 365 Roadmap as a Zetaris Lightning REST table
-- Source: https://www.microsoft.com/releasecommunications/api/v2/m365
--         (public JSON API, no authentication)
--
-- Run each statement separately in the Zetaris SQL Editor and wait for it to finish.
-- Tested on a local Zetaris install (Docker) on 2026-10-22.
--
-- Notes:
-- * The HEADER values are required. Without them, Microsoft answers with
--   HTTP 400 and the table only contains `_corrupt_record` = "Bad Request".
-- * CREATE SCHEMASTORE VIEW on top of this table currently fails with
--   "Bad Request" (open question to the Zetaris mentors). The agent therefore
--   sends the SELECT with LATERAL VIEW explode(...) directly.
-- * The REST table fetches the full response (about 2.4 MB) on every query.

-- 1) Register the source
CREATE LIGHTNING DATABASE M365_ROADMAP_REST DESCRIBE BY "Microsoft 365 Roadmap public API v2";

-- 2) Optional: test the request without creating a table
-- TEST REST REQUEST (
--     endpoint "https://www.microsoft.com/releasecommunications/api/v2/m365",
--     method "get",
--     response_type "json",
--     http_encoding "URLENCODED"
-- ) HEADER (
--     accept "application/json",
--     user-agent "3net-news-agent/0.1 (+https://github.com/shinanDev/3net-news-agent)"
-- ) BODY ();

-- 3) REST table (one row with the raw response: @odata.context, value)
CREATE LIGHTNING REST TABLE roadmap_raw2 FROM M365_ROADMAP_REST REQUEST(
    endpoint "https://www.microsoft.com/releasecommunications/api/v2/m365",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
    accept "application/json",
    user-agent "3net-news-agent/0.1 (+https://github.com/shinanDev/3net-news-agent)"
) BODY ();

-- 4) Query used by the agent: one row per roadmap item
SELECT item.id, item.title, item.status, item.created, item.modified,
       item.generalAvailabilityDate, item.products, item.description
FROM m365_roadmap_rest.roadmap_raw2
LATERAL VIEW explode(value) AS item;

-- 5) Check: row count should match the item count of the API response
SELECT COUNT(*)
FROM m365_roadmap_rest.roadmap_raw2
LATERAL VIEW explode(value) AS item;
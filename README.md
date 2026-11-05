# IDS standard tables

**Live page: https://www.parulagarwal.com/ids-standard-tables/**

A static page that rebuilds the [International Debt Statistics](https://www.worldbank.org/en/programs/debt-statistics/ids)
standard tables for countries, regions and income groups from the World Bank API.
Data is fetched live in the browser, so there is no build step or server code.
It mirrors the published [country](https://datatopics.worldbank.org/debt/ids/country/AFG) and
[regional](https://datatopics.worldbank.org/debt/ids/region/SSA) standard tables.

The analytical tables live in the [ids-analytical-tables](https://github.com/polk54/ids-analytical-tables) repo.

## Files

- `index.html`: the page
- `table-definition.js`: the standard table's rows
- `ids-core.js`, `ids-dashboard.js`, `ids-dashboard.css`: shared with the analytical tables repo, and identical there. Copy any change to the other repo.
- `tools/verify.mjs`: compares the table with the published pages

Link to a country or group by adding `?country=KEN` or `?country=SSA`.

## Check against the published pages

Rerun after each data release (requires Node). It takes a few minutes:

```bash
node tools/verify.mjs
```

## Notes

- The API's data endpoint sends no CORS header, so the page uses JSONP.
- "Reserves to imports (months)" shows the API value. The published table shows 0.0 for this row.
- The table requests all series in one call, because its 455 series codes would not fit in a URL.
- API responses can be cached for up to 24 hours. To force fresh data after a release, change `DATA_VERSION` in `ids-dashboard.js`, then change `?v=` as below.
- Browsers can keep the JS and CSS files for 4 hours. After changing any of them, raise the `?v=` number everywhere in `index.html`, or visitors can end up with mismatched files.

Built with Claude Code

// Compares this repo's table with the published World Bank pages.
//
//   node tools/verify.mjs              every published country and group
//   node tools/verify.mjs KEN BRA SSA  only these
//
// Rerun after every data release. Exits with 1 if anything differs.
// Identical in the ids-analytical-tables and ids-standard-tables repos.
import '../ids-core.js';
import '../table-definition.js';

const IDS = globalThis.IDS;
const PAGE = 'https://datatopics.worldbank.org/debt/ids/';
const CONCURRENCY = 3;

async function text(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ids-table-verify' }, signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
}

const clean = (html) => html
  .replace(/<[^>]+>/g, '').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function parsePage(html) {
  const years = [...html.matchAll(/cell-separator header"><div>(\d{4})/g)].map((m) => m[1]);
  const rows = [];
  const headings = [];
  for (const m of html.matchAll(/<tr class="(rowdata|custom-row)[^"]*">(.*?)<\/tr>/gs)) {
    const cells = [...m[2].matchAll(/<td([^>]*)>(.*?)<\/td>/gs)];
    const id = cells[0][1].match(/cell-(R\d+)/);
    if (m[1] === 'custom-row') {
      if (id) headings.push(clean(cells[0][2]));
    } else {
      rows.push({ id: id[1], label: clean(cells[0][2]), values: cells.slice(1).map((c) => clean(c[2])) });
    }
  }
  const select = html.match(/<select[^>]*id="ddp-Country".*?<\/select>/s);
  const countries = select ? [...select[0].matchAll(/&\[([A-Z0-9]+)\]/g)].map((m) => m[1]) : [];
  return { years, rows, headings, countries };
}

async function apiData(table, country, years) {
  const url = `${IDS.API_BASE}${IDS.tablePath(table, country, years)}?format=json&per_page=${IDS.PER_PAGE}`;
  const res = IDS.parseResponse(JSON.parse(await text(url)));
  if (res.pages !== 1) throw new Error('Response was split across pages');
  return res.series;
}

async function check(table, country) {
  const path = IDS.GROUPS.includes(country) ? table.publishedGroupPath : table.publishedPath;
  const page = parsePage(await text(PAGE + path + '/' + country));
  if (!page.rows.length) throw new Error('No table rows on the page');
  const data = await apiData(table, country, page.years);
  const issues = [];
  const defined = IDS.rowsOf(table);

  const pageOrder = page.rows.map((r) => r.id).join();
  if (pageOrder !== defined.map((r) => r.id).join()) issues.push(`row order differs: ${pageOrder}`);
  const ourHeadings = table.entries.filter((e) => e.heading).map((e) => e.label);
  if (page.headings.join('|') !== ourHeadings.join('|')) issues.push(`headings differ: ${page.headings.join(' | ')}`);

  let cells = 0;
  let groupGaps = 0;
  const roundingDiffs = [];
  for (const pub of page.rows) {
    const row = defined.find((r) => r.id === pub.id);
    if (!row) { issues.push(`${pub.id} "${pub.label}" is not in the dashboard`); continue; }
    if (row.label !== pub.label) issues.push(`${pub.id} label: page "${pub.label}", dashboard "${row.label}"`);
    if (table.knownDifferences?.[pub.id]) continue;
    pub.values.forEach((value, i) => {
      cells++;
      const ours = IDS.cellText(row, data, page.years[i]);
      if (ours === value) return;
      const number = (s) => Number(s.replace(/,/g, ''));
      if (IDS.GROUPS.includes(country) && value === '..' && table.knownGroupGaps?.includes(pub.id)) {
        groupGaps++;
      } else if (Array.isArray(row.source) && Math.abs(number(ours) - number(value)) < 0.11) {
        roundingDiffs.push(`${country} ${pub.id} ${page.years[i]}: page ${value}, dashboard ${ours}`);
      } else {
        issues.push(`${pub.id} ${row.label} ${page.years[i]}: page ${value}, dashboard ${ours}`);
      }
    });
  }
  return { country, cells, issues, groupGaps, roundingDiffs, years: page.years, countries: page.countries };
}

async function verifyTable(table, requested) {
  const apiCountries = JSON.parse(await text(`${IDS.API_BASE}/sources/6/country?format=json&per_page=500`))
    .source[0].concept[0].variable.map((c) => c.id).filter((id) => !IDS.AGGREGATES.includes(id));

  const firstCode = requested[0] ?? 'AFG';
  const first = await check(table, firstCode);
  // A run limited to named countries doesn't compare the dropdown.
  const published = requested.length ? apiCountries : first.countries;
  const missingFromApi = published.filter((c) => !apiCountries.includes(c));
  const extraInApi = apiCountries.filter((c) => !published.includes(c));
  const queue = requested.length ? requested.slice(1) : published.filter((c) => c !== firstCode);

  const results = [first];
  const failures = [];
  let publishedGroups = null;
  if (!requested.length) {
    const firstGroup = await check(table, IDS.GROUPS[0]);
    results.push(firstGroup);
    publishedGroups = firstGroup.countries;
    queue.push(...publishedGroups.filter((c) => c !== IDS.GROUPS[0]));
  }
  const groupsDiffer = publishedGroups && [...publishedGroups].sort().join() !== [...IDS.GROUPS].sort().join();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const country = queue.shift();
      try { results.push(await check(table, country)); }
      catch (err) { failures.push(`${country}: ${err.message}`); }
    }
  }));

  const withIssues = results.filter((r) => r.issues.length);
  const cells = results.reduce((n, r) => n + r.cells, 0);
  const issueCount = withIssues.reduce((n, r) => n + r.issues.length, 0);

  console.log(`\n=== ${table.name} table ===`);
  console.log(`Years: ${first.years[0]}-${first.years.at(-1)}`);
  console.log(`Dropdown: published ${published.length}, dashboard ${apiCountries.length}`);
  if (missingFromApi.length) console.log('  on published page only:', missingFromApi.join(', '));
  if (extraInApi.length) console.log('  in dashboard only:', extraInApi.join(', '));
  if (publishedGroups) console.log(`Regional and income groups: published ${publishedGroups.length}, dashboard ${IDS.GROUPS.length}`);
  if (groupsDiffer) console.log(`  published groups differ: ${publishedGroups.join(', ')}`);
  console.log(`Tables compared: ${results.length}. Cells compared: ${cells}. Differences: ${issueCount}.`);
  const groupGaps = results.reduce((n, r) => n + r.groupGaps, 0);
  const roundingDiffs = results.flatMap((r) => r.roundingDiffs);
  if (groupGaps) console.log(`Known differences: ${groupGaps} regional cells where the published page shows ".." and the dashboard shows a calculated value.`);
  if (roundingDiffs.length) console.log(`Calculated cells differing by 0.1 from rounding: ${roundingDiffs.length}\n  ${roundingDiffs.slice(0, 10).join('\n  ')}`);
  Object.values(table.knownDifferences ?? {}).forEach((reason) => console.log(`Not compared: ${reason}`));
  if (failures.length) console.log(`Could not compare ${failures.length}:\n  ${failures.join('\n  ')}`);
  for (const r of withIssues) {
    console.log(`\n${r.country} (${r.issues.length})`);
    r.issues.slice(0, 15).forEach((issue) => console.log('  ' + issue));
  }
  return !(issueCount || failures.length || missingFromApi.length || extraInApi.length || groupsDiffer);
}

process.exit((await verifyTable(IDS.table, process.argv.slice(2))) ? 0 : 1);

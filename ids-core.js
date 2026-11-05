/*
 * Shared logic for the IDS table pages: number formatting, API paths and response parsing.
 * No browser dependencies, so tools/verify.mjs tests the same logic the page uses.
 *
 * This file is identical in the ids-analytical-tables and ids-standard-tables repos.
 * A change here should be copied to the other repo.
 *
 * A row's source is either:
 *   'SERIES.CODE'                 shown directly; a missing value shows as ".."
 *   [[+1, 'CODE'], [-1, 'CODE']]  calculated; missing values count as 0
 */
(function (root) {
  'use strict';

  // Regional and income groups the API lists as countries.
  var AGGREGATES = ['EAP', 'ECA', 'IDA', 'IDX', 'LAC', 'LDC', 'LIC', 'LMC', 'LMY', 'MIC', 'MNA', 'SAS', 'SSA', 'UMC'];
  // The ones with published regional tables, which are the ones the dropdowns offer.
  var GROUPS = ['EAP', 'ECA', 'LAC', 'LIC', 'LMY', 'MIC', 'MNA', 'SAS', 'SSA'];

  function rowsOf(table) {
    return table.entries.filter(function (entry) { return !entry.heading; });
  }

  function seriesOf(table) {
    var codes = new Set();
    rowsOf(table).forEach(function (r) {
      if (typeof r.source === 'string') codes.add(r.source);
      else r.source.forEach(function (term) { codes.add(term[1]); });
    });
    return Array.from(codes);
  }

  // Half-up, away from zero, on the number's shortest decimal form. toFixed works on
  // the binary value instead, and would turn a published 4.05 into 4.0.
  function formatOneDecimal(value) {
    var text = String(Math.abs(value));
    if (text.includes('e')) text = Math.abs(value).toFixed(20);
    var parts = text.split('.');
    var tenths = Number(parts[0] + (parts[1] || '0').charAt(0));
    if ((parts[1] || '').charAt(1) >= '5') tenths += 1;
    var digits = String(tenths).padStart(2, '0');
    var whole = digits.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // A value that rounds to zero prints as 0.0, never -0.0.
    var sign = value < 0 && tenths !== 0 ? '-' : '';
    return sign + whole + '.' + digits.slice(-1);
  }

  function cellValue(r, bySeries, year) {
    var raw;
    if (typeof r.source === 'string') {
      raw = (bySeries[r.source] || {})[year];
      if (raw === null || raw === undefined) return null;
      // US$ series show in millions; ratios, years and months show as they are.
      return /\.CD(\.DT)?$/.test(r.source) ? raw / 1e6 : raw;
    }
    raw = r.source.reduce(function (total, term) {
      return total + term[0] * ((bySeries[term[1]] || {})[year] || 0);
    }, 0);
    return raw / 1e6;
  }

  function cellText(r, bySeries, year) {
    var value = cellValue(r, bySeries, year);
    return value === null ? '..' : formatOneDecimal(value);
  }

  // API response -> { series: { code: { year: value } }, lastUpdated, pages }
  function parseResponse(response) {
    var source = response && response.source;
    if (!source || !Array.isArray(source.data)) throw new Error('Unexpected API response');
    var series = {};
    source.data.forEach(function (item) {
      var dims = {};
      item.variable.forEach(function (v) { dims[v.concept] = v.id; });
      (series[dims.Series] = series[dims.Series] || {})[dims.Time.replace('YR', '')] = item.value;
    });
    return { series: series, lastUpdated: response.lastupdated, pages: response.pages };
  }

  // series and years are arrays, or 'all'.
  function dataPath(country, series, years) {
    return '/sources/6/country/' + country +
      '/series/' + (series === 'all' ? 'all' : series.join(';')) +
      '/counterpart-area/WLD/time/' + (years === 'all' ? 'all' : years.map(function (y) { return 'YR' + y; }).join(';'));
  }

  function tablePath(table, country, years) {
    return dataPath(country, table.allSeries ? 'all' : seriesOf(table), years);
  }

  root.IDS = {
    API_BASE: 'https://api.worldbank.org/v2',
    AGGREGATES: AGGREGATES,
    GROUPS: GROUPS,
    YEARS_SHOWN: 11,
    PER_PAGE: 10000,
    // Set by table-definition.js.
    table: null,
    rowsOf: rowsOf,
    seriesOf: seriesOf,
    formatOneDecimal: formatOneDecimal,
    cellText: cellText,
    parseResponse: parseResponse,
    dataPath: dataPath,
    tablePath: tablePath,
  };
})(globalThis);


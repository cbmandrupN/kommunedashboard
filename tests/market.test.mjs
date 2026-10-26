import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  latestCompleteMonth, marketCount, marketCsv, marketRows, parseMarketActivity,
} from '../src/market-data.ts'

function fixture() {
  return {
    schemaVersion: 1, generatedAt: '2026-10-26T06:00:00Z', asOf: '2026-10-26',
    startDate: '2025-01-01', dateBasis: 'ValidFrom',
    months: [...Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, '0')}`),
      ...Array.from({ length: 10 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`)],
    companies: [
      { id: '1', name: 'Firma A', aliases: ['Tidligere A'], counts: {
        '2025-01': { SingleFamily: 1 }, '2026-08': { SingleFamily: 5 },
        '2026-09': { SingleFamily: 2, MultiFamily: 4 }, '2026-10': { SingleFamily: 3 },
      } },
      { id: '2', name: 'Firma B', aliases: [], counts: { '2026-09': { SingleFamily: 2 } } },
      { id: '__unknown__', name: 'Firma ikke identificeret', aliases: [], counts: { '2026-09': { Unknown: 2 } } },
    ],
    quality: {
      includedReports: 19, unidentifiedCompanyReports: 2,
      scannedBuildingRows: 30, paginationComplete: true, historicalProductionComplete: false,
    },
  }
}

test('latest complete month defaults to September, with all months back to January 2025', () => {
  const data = parseMarketActivity(fixture())
  assert.equal(data.months.length, 22)
  assert.equal(data.months[0], '2025-01')
  assert.equal(latestCompleteMonth(data), '2026-09')
  assert.equal(marketRows(data, '2025-01', '__all__').rows[0].previous, null)
  assert.throws(() => marketRows(data, '2024-12', '__all__'))
})

test('firm totals, type filters and shares partition exactly including unknown firms', () => {
  const data = parseMarketActivity(fixture())
  const all = marketRows(data, '2026-09', '__all__')
  assert.equal(all.total, 10)
  assert.equal(all.rows[0].current, 6)
  assert.equal(all.rows[0].previous, 5)
  assert.equal(all.rows[0].share, 0.6)
  assert.equal(all.rows.reduce((sum, row) => sum + row.share, 0), 1)
  const family = marketRows(data, '2026-09', 'SingleFamily')
  assert.equal(family.total, 4)
  assert.equal(family.rows[0].share, 0.5)
  assert.equal(marketCount(data.companies[0], '2025-02', '__all__'), 0)
  assert.equal(marketRows(data, '2026-09', 'Nonexistent').total, 0)
})

test('incomplete, duplicate and invalid counts fail instead of displaying false market data', () => {
  for (const mutate of [
    (data) => { data.dateBasis = 'DateOfSubmission' },
    (data) => { data.quality.paginationComplete = false },
    (data) => { data.quality.includedReports++ },
    (data) => { data.quality.unidentifiedCompanyReports-- },
    (data) => { data.months.splice(1, 1) },
    (data) => { data.companies[1].id = '1' },
    (data) => { data.companies[0].counts['2026-09'].SingleFamily = -1 },
  ]) {
    const data = fixture()
    mutate(data)
    assert.throws(() => parseMarketActivity(data))
  }
})

test('CSV names its date basis and prevents spreadsheet formulas', () => {
  const raw = fixture()
  raw.companies[0].name = '=HYPERLINK("test")'
  const csv = marketCsv(parseMarketActivity(raw), '2026-09', '__all__')
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes(`"'=HYPERLINK(""test"")"`))
  assert.ok(csv.includes('Gyldig fra'))
  assert.ok(csv.includes('2026-10-26'))
})

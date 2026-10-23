import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  combineMapSummaries, MAP_COLORS, mapColor, mapShare, parseMapShapes, summarizeMapBuildings,
} from '../src/map-data.ts'

test('area-weighted shares include valid labels beyond the dashboard horizon', () => {
  const summary = summarizeMapBuildings([
    { area: 600, status: 'valid', validTo: '2040-01-01' },
    { area: 100, status: 'valid', validTo: '2027-01-01' },
    { area: 200, status: 'expired', validTo: '2025-01-01' },
    { area: 100, status: 'unlabelled', validTo: '' },
  ])
  assert.equal(summary.total.buildings, 4)
  assert.equal(summary.total.area, 1000)
  assert.equal(summary.years['2040'].area, 600)
  assert.equal(mapShare(summary), 0.7)
  assert.equal(summary.valid.buildings / summary.total.buildings, 0.5)
  assert.equal(summary.valid.area + summary.expired.area + summary.unlabelled.area, summary.total.area)
  assert.equal(mapShare(summarizeMapBuildings([])), null)
  assert.deepEqual(combineMapSummaries([summary, summary]).total, { buildings: 8, area: 2000 })
  assert.equal(combineMapSummaries([summary, summary]).years['2040'].area, 1200)
  assert.throws(() => summarizeMapBuildings([{ area: -1, status: 'valid', validTo: '' }]))
  assert.throws(() => summarizeMapBuildings([{ area: 1, status: 'valid', validTo: '' }]))
  assert.throws(() => summarizeMapBuildings([{ area: 1, status: 'unknown', validTo: '' }]))
})

test('legend includes exact interval boundaries and distinguishes no data from zero percent', () => {
  for (let index = 0; index < 5; index++) {
    assert.equal(mapColor(index / 5), MAP_COLORS[index])
    assert.equal(mapColor((index + 1) / 5 - 0.000001), MAP_COLORS[index])
  }
  assert.equal(mapColor(1), MAP_COLORS[4])
  assert.equal(mapColor(null), '#e2e8f0')
  assert.notEqual(mapColor(0), mapColor(null))
})

test('geometry covers every current municipality exactly once, including Copenhagen and islands', async () => {
  const geometry = JSON.parse(await readFile(new URL('../data/municipalities.geojson', import.meta.url), 'utf8'))
  const dashboard = JSON.parse(await readFile(new URL('../src/data/dashboard-data.json', import.meta.url), 'utf8'))
  const shapes = parseMapShapes(geometry, dashboard.municipalities)
  assert.equal(shapes.length, 98)
  assert.deepEqual(new Set(shapes.map((row) => row.code)), new Set(dashboard.municipalities.map((row) => row.municipalityCode)))
  for (const code of ['101', '400', '320', '779', '480', '820']) {
    assert.ok(shapes.find((row) => row.code === code)?.path.startsWith('M'))
  }
  assert.throws(() => parseMapShapes({}, dashboard.municipalities))
  assert.throws(() => parseMapShapes(geometry, dashboard.municipalities.slice(1)))
})

test('Polygon and MultiPolygon retain holes and reject non-geographic coordinates', () => {
  const ring = [[8, 55], [9, 55], [9, 56], [8, 55]]
  const municipalities = [{ name: 'Test Kommune', municipalityCode: '123' }]
  const payload = { type: 'FeatureCollection', features: [
    { properties: { shapeName: 'Test' }, geometry: { type: 'Polygon', coordinates: [ring, ring] } },
  ] }
  assert.equal(parseMapShapes(payload, municipalities)[0].path.split('M').length, 3)
  payload.features[0].geometry = { type: 'MultiPolygon', coordinates: [[ring], [ring]] }
  assert.equal(parseMapShapes(payload, municipalities)[0].path.split('M').length, 3)
  payload.features[0].geometry = { type: 'Polygon', coordinates: [[[8000, 55], ...ring]] }
  assert.throws(() => parseMapShapes(payload, municipalities))
})

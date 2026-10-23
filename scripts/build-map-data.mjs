import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseMapShapes, summarizeMapBuildings } from '../src/map-data.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (...parts) => JSON.parse(await readFile(path.join(root, ...parts), 'utf8'))
const dashboard = await readJson('src', 'data', 'dashboard-data.json')
const geometry = await readJson('data', 'municipalities.geojson')
const scopes = [
  ['', dashboard],
  ['-with-coowners', dashboard.coOwnedScope],
  ['-from-60', dashboard.expandedAreaScope],
  ['-from-60-with-coowners', dashboard.expandedAreaAndCoOwnedScope],
  ['-60-250', dashboard.area60To250Scope],
  ['-60-250-with-coowners', dashboard.area60To250AndCoOwnedScope],
]
const summaries = {}
const expectedCvrs = new Set(dashboard.municipalities.map((row) => row.cvr))
for (const [suffix, scope] of scopes) {
  if (!scope) continue
  if (scope.municipalities.length !== expectedCvrs.size
    || new Set(scope.municipalities.map((row) => row.cvr)).size !== expectedCvrs.size
    || scope.municipalities.some((row) => !expectedCvrs.has(row.cvr))) {
    throw new Error(`Map scope does not contain all municipalities: buildings${suffix}`)
  }
  const municipalities = {}
  for (const municipality of scope.municipalities) {
    const payload = await readJson('public', `buildings${suffix}`, `${municipality.cvr}.json`)
    if (payload.asOf !== dashboard.asOf || payload.municipality.cvr !== municipality.cvr) {
      throw new Error(`Map data has a different snapshot: ${suffix}/${municipality.cvr}`)
    }
    const summary = summarizeMapBuildings(payload.buildings)
    if (summary.total.buildings !== municipality.eligibleBuildings
      || summary.valid.buildings !== municipality.validLabelBuildings
      || summary.expired.buildings !== municipality.metrics.buildings.expired
      || summary.unlabelled.buildings !== municipality.unlabelled.buildings) {
      throw new Error(`Map totals differ from dashboard: ${suffix}/${municipality.cvr}`)
    }
    municipalities[municipality.cvr] = summary
  }
  summaries[`buildings${suffix}`] = municipalities
}
const shapes = parseMapShapes(geometry, dashboard.municipalities)
if (shapes.length !== 98) throw new Error('Expected all 98 Danish municipalities')
await writeFile(path.join(root, 'public', 'map-summary.json'), JSON.stringify({
  asOf: dashboard.asOf,
  generatedAt: dashboard.generatedAt,
  shapes,
  scopes: summaries,
}))
console.log(`Generated map summaries: ${shapes.length} municipalities, ${Object.keys(summaries).length} scopes.`)

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseUpdateReport } from '../src/update-report.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (...parts) => JSON.parse(await readFile(path.join(root, ...parts), 'utf8'))
const dashboard = await readJson('src', 'data', 'dashboard-data.json')
const report = parseUpdateReport(await readJson('public', 'update-report.json'))
if (report.current.generatedAt !== dashboard.generatedAt || report.current.asOf !== dashboard.asOf) {
  throw new Error('Update report is from a different municipal snapshot')
}
const scopes = {
  buildings: dashboard,
  'buildings-with-coowners': dashboard.coOwnedScope,
  'buildings-from-60': dashboard.expandedAreaScope,
  'buildings-from-60-with-coowners': dashboard.expandedAreaAndCoOwnedScope,
  'buildings-60-250': dashboard.area60To250Scope,
  'buildings-60-250-with-coowners': dashboard.area60To250AndCoOwnedScope,
}
for (const [directory, scope] of Object.entries(scopes)) {
  if (!scope) continue
  if (!Object.hasOwn(report.scopes, directory)) throw new Error(`Missing report scope: ${directory}`)
  const rows = report.scopes[directory]
  if (rows === null) continue
  if (rows.length !== scope.municipalities.length || scope.municipalities.some((municipality) => {
    const row = rows.find((value) => value.cvr === municipality.cvr)
    return !row || row.currentBuildings !== municipality.eligibleBuildings
  })) throw new Error(`Report coverage differs from dashboard: ${directory}`)
}
console.log(`Validated municipal update report: ${report.previous.asOf} → ${report.current.asOf}.`)

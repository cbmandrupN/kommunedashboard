export const CHANGE_LABELS = {
  found: 'Først fundet mærke',
  replaced: 'Skiftet mærke',
  expired: 'Blevet udløbet',
  missing: 'Mærke ikke længere fundet',
  added: 'Tilføjet til udtrækket',
  removed: 'Udgået af udtrækket',
  updated: 'Øvrige dataændringer',
} as const
export type ChangeKind = keyof typeof CHANGE_LABELS
export type ChangeState = {
  address: string
  postalCode: string
  area: number
  energyLabel: string
  validTo: string
  companyName: string
  status: 'valid' | 'expired' | 'unlabelled'
  ownershipType: string
  primaryOwner: string
}
export type BuildingChange = {
  key: string
  kind: ChangeKind
  before: ChangeState | null
  after: ChangeState | null
}
type MunicipalityChanges = {
  cvr: string
  name: string
  previousBuildings: number
  currentBuildings: number
  changes: BuildingChange[]
}
type Snapshot = { asOf: string; generatedAt: string }
export type UpdateReportData = {
  schemaVersion: 1
  previous: Snapshot
  current: Snapshot
  scopes: Record<string, MunicipalityChanges[] | null>
}
export type ReportChange = BuildingChange & { cvr: string; municipality: string }

const invalid = () => new Error('Ændringsrapporten har et ukendt eller ufuldstændigt format.')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isKind = (value: unknown): value is ChangeKind =>
  typeof value === 'string' && Object.hasOwn(CHANGE_LABELS, value)
function snapshot(value: unknown): Snapshot {
  if (!record(value) || typeof value.asOf !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf))
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) throw invalid()
  return { asOf: value.asOf, generatedAt: value.generatedAt }
}
function state(value: unknown, asOf: string): ChangeState | null {
  if (value === null) return null
  if (!record(value) || typeof value.address !== 'string' || typeof value.postalCode !== 'string'
    || !count(value.area) || typeof value.energyLabel !== 'string' || typeof value.validTo !== 'string'
    || typeof value.companyName !== 'string' || typeof value.ownershipType !== 'string'
    || typeof value.primaryOwner !== 'string'
    || !['valid', 'expired', 'unlabelled'].includes(String(value.status))) throw invalid()
  if (value.status === 'unlabelled'
    ? value.energyLabel !== '' || value.validTo !== ''
    : !/^\d+$/.test(value.energyLabel) || !/^\d{4}-\d{2}-\d{2}$/.test(value.validTo)
      || !Number.isFinite(Date.parse(value.validTo))) throw invalid()
  if (value.status !== 'unlabelled' && (value.validTo < asOf) !== (value.status === 'expired')) throw invalid()
  return {
    address: value.address, postalCode: value.postalCode, area: value.area,
    energyLabel: value.energyLabel, validTo: value.validTo, companyName: value.companyName,
    ownershipType: value.ownershipType, primaryOwner: value.primaryOwner,
    status: value.status === 'valid' ? 'valid' : value.status === 'expired' ? 'expired' : 'unlabelled',
  }
}
export function parseUpdateReport(payload: unknown): UpdateReportData {
  if (!record(payload) || payload.schemaVersion !== 1 || !record(payload.scopes)) throw invalid()
  const previous = snapshot(payload.previous)
  const current = snapshot(payload.current)
  if (previous.asOf > current.asOf || Date.parse(previous.generatedAt) >= Date.parse(current.generatedAt)) throw invalid()
  const scopes: UpdateReportData['scopes'] = {}
  for (const [directory, values] of Object.entries(payload.scopes)) {
    if (values === null) { scopes[directory] = null; continue }
    if (!Array.isArray(values) || !values.length) throw invalid()
    const cvrs = new Set<string>()
    scopes[directory] = values.map((value): MunicipalityChanges => {
      if (!record(value) || typeof value.cvr !== 'string' || !/^\d{8}$/.test(value.cvr)
        || cvrs.has(value.cvr) || typeof value.name !== 'string' || !value.name
        || !count(value.previousBuildings) || !count(value.currentBuildings)
        || !Array.isArray(value.changes)) throw invalid()
      cvrs.add(value.cvr)
      const keys = new Set<string>()
      const changes = value.changes.map((change): BuildingChange => {
        if (!record(change) || typeof change.key !== 'string' || !change.key
          || keys.has(change.key) || !isKind(change.kind)) throw invalid()
        keys.add(change.key)
        const before = state(change.before, previous.asOf), after = state(change.after, current.asOf)
        const expected = before === null ? 'added' : after === null ? 'removed'
          : before.energyLabel !== after.energyLabel
            ? !before.energyLabel ? 'found' : !after.energyLabel ? 'missing' : 'replaced'
            : before.status === 'valid' && after.status === 'expired' ? 'expired' : 'updated'
        if ((!before && !after) || expected !== change.kind
          || JSON.stringify(before) === JSON.stringify(after)) throw invalid()
        return { key: change.key, kind: change.kind, before, after }
      })
      const added = changes.filter((change) => change.kind === 'added').length
      const removed = changes.filter((change) => change.kind === 'removed').length
      if (removed > value.previousBuildings || added > value.currentBuildings
        || value.previousBuildings + added - removed !== value.currentBuildings
        || changes.length - added - removed > value.previousBuildings - removed) throw invalid()
      return {
        cvr: value.cvr, name: value.name, previousBuildings: value.previousBuildings,
        currentBuildings: value.currentBuildings, changes,
      }
    })
  }
  return { schemaVersion: 1, previous, current, scopes }
}
export function selectReportChanges(data: UpdateReportData, directory: string, cvr: string | null): ReportChange[] | null {
  if (!Object.hasOwn(data.scopes, directory)) throw new Error('Rapporten mangler den valgte afgrænsning.')
  const rows = data.scopes[directory]
  if (rows === null) return null
  if (cvr && !rows.some((row) => row.cvr === cvr)) throw new Error('Rapporten mangler den valgte kommune.')
  return rows.filter((row) => !cvr || row.cvr === cvr)
    .flatMap((row) => row.changes.map((change) => ({ ...change, cvr: row.cvr, municipality: row.name })))
}
export function summarizeChanges(changes: ReportChange[]) {
  const counts: Record<ChangeKind, number> = { found: 0, replaced: 0, expired: 0, missing: 0, added: 0, removed: 0, updated: 0 }
  const companies = new Map<string, { name: string; reports: Set<string>; buildings: number }>()
  for (const change of changes) {
    counts[change.kind]++
    if ((change.kind !== 'found' && change.kind !== 'replaced') || !change.after) continue
    const name = change.after.companyName || 'Firma ikke oplyst'
    const company = companies.get(name) ?? { name, reports: new Set<string>(), buildings: 0 }
    company.reports.add(change.after.energyLabel)
    company.buildings++
    companies.set(name, company)
  }
  return {
    counts,
    companies: [...companies.values()].map((company) => ({
      name: company.name, reports: company.reports.size, buildings: company.buildings,
    })).sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name, 'da')),
  }
}

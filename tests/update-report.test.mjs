import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUpdateReport, selectReportChanges, summarizeChanges } from '../src/update-report.ts'

const state = (serial, extra = {}) => ({
  address: 'Testvej 1', postalCode: '7800', area: 300,
  energyLabel: serial, validTo: serial ? '2030-01-01' : '',
  companyName: serial ? 'Firma A' : '', status: serial ? 'valid' : 'unlabelled',
  ownershipType: 'direct', primaryOwner: 'Test Kommune', ...extra,
})
const fixture = () => ({
  schemaVersion: 1,
  previous: { asOf: '2026-10-01', generatedAt: '2026-10-01T06:00:00Z' },
  current: { asOf: '2026-10-19', generatedAt: '2026-10-19T06:00:00Z' },
  scopes: {
    buildings: [
      { cvr: '12345678', name: 'Test Kommune', previousBuildings: 3, currentBuildings: 3, changes: [
        { key: '1', kind: 'found', before: state(''), after: state('456') },
        { key: '2', kind: 'replaced', before: state('123'), after: state('456') },
        { key: '3', kind: 'expired', before: state('789', { validTo: '2026-10-10' }), after: state('789', { validTo: '2026-10-10', status: 'expired' }) },
      ] },
      { cvr: '87654321', name: 'Anden Kommune', previousBuildings: 1, currentBuildings: 1, changes: [] },
    ],
    'buildings-from-60': null,
  },
})

test('compares the update period and respects municipality and scope selections', () => {
  const data = parseUpdateReport(fixture())
  assert.equal(selectReportChanges(data, 'buildings', null).length, 3)
  assert.equal(selectReportChanges(data, 'buildings', '12345678').length, 3)
  assert.deepEqual(selectReportChanges(data, 'buildings', '87654321'), [])
  assert.equal(selectReportChanges(data, 'buildings-from-60', null), null)
  assert.throws(() => selectReportChanges(data, 'missing-scope', null), /afgrænsning/)
  assert.throws(() => selectReportChanges(data, 'buildings', '11111111'), /kommune/)
})
test('counts buildings separately and deduplicates report numbers for each firm', () => {
  const changes = selectReportChanges(parseUpdateReport(fixture()), 'buildings', null)
  const result = summarizeChanges(changes)
  assert.equal(result.counts.found, 1)
  assert.equal(result.counts.replaced, 1)
  assert.equal(result.counts.expired, 1)
  assert.deepEqual(result.companies, [{ name: 'Firma A', reports: 1, buildings: 2 }])
  const amended = [...changes, { ...changes[0], kind: 'added' }, { ...changes[0], kind: 'updated' }]
  assert.equal(summarizeChanges(amended).companies[0].reports, 1)
})
test('rejects false zeroes, duplicate identities, incorrect kinds and inconsistent counts', () => {
  const cases = [
    (data) => { delete data.current },
    (data) => { data.previous = { ...data.current } },
    (data) => { data.scopes.buildings[0].changes.push(data.scopes.buildings[0].changes[0]) },
    (data) => { data.scopes.buildings[0].changes[0].kind = 'replaced' },
    (data) => { data.scopes.buildings[0].currentBuildings = 5 },
    (data) => { data.scopes.buildings[0].changes[0].before = null },
    (data) => { data.scopes.buildings[0].changes[0].after.area = -1 },
    (data) => { data.scopes.buildings[0].changes[2].after.status = 'valid' },
  ]
  for (const mutate of cases) {
    const data = fixture()
    mutate(data)
    assert.throws(() => parseUpdateReport(data), /format/)
  }
})

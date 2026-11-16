import test from 'node:test'
import assert from 'node:assert/strict'
import { groupProperties, summarizeProperties, parsePropertySummaries } from '../src/properties.ts'

const building = (overrides = {}) => ({
  municipalityCode: '671', address: 'Skolegade 8', postalCode: '7600',
  bfe: '1', buildingNumber: '1', area: 300, status: 'valid', validTo: '2034-01-01',
  ...overrides,
})

test('groups normalized addresses, not BFE; keeps postcodes, municipalities and unknown addresses separate', () => {
  const groups = groupProperties([
    building(), building({ address: ' SKOLEGADE   8 ', bfe: '2', buildingNumber: '2' }),
    building({ postalCode: '7800' }), building({ municipalityCode: '661' }),
    building({ address: '' }), building({ address: '' }), building({ postalCode: '' }),
  ])
  assert.equal(groups.length, 6)
  assert.equal(groups.find((group) => group.buildings.length === 2).area, 600)
})

test('each address has exactly one priority: missing, expired, then earliest valid expiry', () => {
  const records = [
    building(), building({ status: 'unlabelled', validTo: '' }),
    building({ status: 'expired', validTo: '2025-01-01' }),
    building({ address: 'Skolegade 9', status: 'expired', validTo: '2024-01-01' }),
    building({ address: 'Skolegade 9' }),
    building({ address: 'Skolegade 10', validTo: '2030-01-01' }),
    building({ address: 'Skolegade 10', validTo: '2029-01-01' }),
    building({ address: 'Skolegade 11', validTo: '2040-01-01' }),
  ]
  const groups = groupProperties(records)
  assert.equal(groups.find((group) => group.address === 'Skolegade 8').status, 'unlabelled')
  assert.equal(groups.find((group) => group.address === 'Skolegade 9').status, 'expired')
  assert.equal(groups.find((group) => group.address === 'Skolegade 10').validTo, '2029-01-01')
  assert.deepEqual(summarizeProperties(records), {
    total: 4, valid: 2, expired: 1, unlabelled: 1, expiry: { 2029: 1, 2040: 1 },
  })
  assert.deepEqual(summarizeProperties([]), { total: 0, valid: 0, expired: 0, unlabelled: 0, expiry: {} })
})

test('rejects invalid grouping input and stale, incomplete or inconsistent summaries', () => {
  assert.throws(() => groupProperties([building({ validTo: '' })]), /Ugyldige/)
  const expected = { asOf: '2026-11-16', generatedAt: 'now', directory: 'buildings', cvrs: ['1'] }
  const row = summarizeProperties([building()])
  const payload = { ...expected, scopes: { buildings: { 1: row } } }
  assert.deepEqual(parsePropertySummaries(payload, expected), { 1: row })
  assert.throws(() => parsePropertySummaries({ ...payload, asOf: 'old' }, expected), /opdatering/)
  assert.throws(() => parsePropertySummaries({ ...payload, scopes: { buildings: {} } }, expected), /kommuner/)
  row.total = 99
  assert.throws(() => parsePropertySummaries(payload, expected), /summer/)
})

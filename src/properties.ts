export type PropertyBuilding = {
  municipalityCode: string
  address: string
  postalCode: string
  bfe: string
  buildingNumber: string
  area: number
  status: 'valid' | 'expired' | 'unlabelled'
  validTo: string
}

export type PropertyGroup<T extends PropertyBuilding = PropertyBuilding> = {
  key: string
  address: string
  postalCode: string
  buildings: T[]
  area: number
  status: PropertyBuilding['status']
  validTo: string
}

export type PropertySummary = {
  total: number
  valid: number
  expired: number
  unlabelled: number
  expiry: Record<string, number>
}

const normalize = (value: string) => value.normalize('NFC').trim()
  .replace(/\s+/g, ' ').toLocaleLowerCase('da-DK')

export function groupProperties<T extends PropertyBuilding>(buildings: T[]): PropertyGroup<T>[] {
  const groups = new Map<string, PropertyGroup<T>>()
  buildings.forEach((building, index) => {
    if (!['valid', 'expired', 'unlabelled'].includes(building.status)
      || !Number.isFinite(building.area) || building.area < 0
      || (building.status !== 'unlabelled' && !/^\d{4}-\d{2}-\d{2}$/.test(building.validTo))) {
      throw new Error('Ugyldige bygningsdata til ejendomsgruppering')
    }
    // Unknown addresses cannot safely be merged, even if they share a BFE.
    const key = normalize(building.address) && normalize(building.postalCode)
      ? JSON.stringify([building.municipalityCode, normalize(building.postalCode), normalize(building.address)])
      : `unknown:${index}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key, address: building.address, postalCode: building.postalCode,
        buildings: [], area: 0, status: 'valid', validTo: '',
      }
      groups.set(key, group)
    }
    group.buildings.push(building)
    group.area += building.area
  })
  for (const group of groups.values()) {
    group.status = group.buildings.some((building) => building.status === 'unlabelled')
      ? 'unlabelled'
      : group.buildings.some((building) => building.status === 'expired') ? 'expired' : 'valid'
    group.validTo = group.status === 'unlabelled' ? '' : group.buildings
      .filter((building) => building.status === group.status)
      .map((building) => building.validTo).sort()[0]
  }
  return [...groups.values()].sort((a, b) => (
    a.address.localeCompare(b.address, 'da-DK') || a.postalCode.localeCompare(b.postalCode)
  ))
}

export function summarizeProperties(buildings: PropertyBuilding[]): PropertySummary {
  const summary: PropertySummary = { total: 0, valid: 0, expired: 0, unlabelled: 0, expiry: {} }
  for (const property of groupProperties(buildings)) {
    summary.total += 1
    summary[property.status] += 1
    if (property.status === 'valid') {
      const year = property.validTo.slice(0, 4)
      summary.expiry[year] = (summary.expiry[year] ?? 0) + 1
    }
  }
  return summary
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePropertySummaries(
  value: unknown,
  expected: { asOf: string; generatedAt: string; directory: string; cvrs: string[] },
): Record<string, PropertySummary> {
  if (!object(value) || value.asOf !== expected.asOf || value.generatedAt !== expected.generatedAt
    || !object(value.scopes) || !object(value.scopes[expected.directory])) {
    throw new Error('Ejendomsdata matcher ikke dashboardets opdatering')
  }
  const scope = value.scopes[expected.directory]
  if (!object(scope)) throw new Error('Ejendomsdata mangler den valgte afgrænsning')
  const result: Record<string, PropertySummary> = {}
  const count = (number: unknown): number => {
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) {
      throw new Error('Ugyldigt antal i ejendomsdata')
    }
    return number
  }
  if (Object.keys(scope).length !== expected.cvrs.length) {
    throw new Error('Ejendomsdata mangler kommuner')
  }
  for (const cvr of expected.cvrs) {
    const row = scope[cvr]
    if (!object(row) || !object(row.expiry)) throw new Error('Ejendomsdata mangler kommuner')
    const expiry: Record<string, number> = {}
    for (const [year, value] of Object.entries(row.expiry)) {
      if (!/^\d{4}$/.test(year)) throw new Error('Ugyldigt udløbsår i ejendomsdata')
      expiry[year] = count(value)
    }
    const summary = {
      total: count(row.total), valid: count(row.valid), expired: count(row.expired),
      unlabelled: count(row.unlabelled), expiry,
    }
    if (summary.total !== summary.valid + summary.expired + summary.unlabelled
      || summary.valid !== Object.values(expiry).reduce((sum, value) => sum + value, 0)) {
      throw new Error('Ejendomsdata har modstridende summer')
    }
    result[cvr] = summary
  }
  return result
}

export type MapMeasure = { buildings: number; area: number }
export type MapSummary = {
  total: MapMeasure
  valid: MapMeasure
  expired: MapMeasure
  unlabelled: MapMeasure
  years: Record<string, MapMeasure>
}
export type MapBuilding = {
  area: number
  status: 'valid' | 'expired' | 'unlabelled'
  validTo: string
}
export type MapShape = { code: string; path: string }
export type MapData = {
  asOf: string
  generatedAt: string
  shapes: MapShape[]
  scopes: Record<string, Record<string, MapSummary>>
}

export const MAP_COLORS = ['#edf8f1', '#b6e2cd', '#76c6aa', '#329f88', '#005b52']

export function summarizeMapBuildings(buildings: MapBuilding[]): MapSummary {
  const summary: MapSummary = {
    total: { buildings: 0, area: 0 },
    valid: { buildings: 0, area: 0 },
    expired: { buildings: 0, area: 0 },
    unlabelled: { buildings: 0, area: 0 },
    years: {},
  }
  for (const building of buildings) {
    if (!Number.isFinite(building.area) || building.area < 0
      || !['valid', 'expired', 'unlabelled'].includes(building.status)) {
      throw new Error('Ugyldige bygningsdata til kortet')
    }
    summary.total.buildings += 1
    summary.total.area += building.area
    summary[building.status].buildings += 1
    summary[building.status].area += building.area
    if (building.status === 'valid') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(building.validTo)) {
        throw new Error('Gyldigt mærke mangler udløbsdato')
      }
      const year = building.validTo.slice(0, 4)
      const bucket = summary.years[year] ??= { buildings: 0, area: 0 }
      bucket.buildings += 1
      bucket.area += building.area
    }
  }
  return summary
}

export function combineMapSummaries(summaries: MapSummary[]): MapSummary {
  const total = summarizeMapBuildings([])
  for (const summary of summaries) {
    for (const key of ['total', 'valid', 'expired', 'unlabelled'] as const) {
      total[key].buildings += summary[key].buildings
      total[key].area += summary[key].area
    }
    for (const [year, value] of Object.entries(summary.years)) {
      const bucket = total.years[year] ??= { buildings: 0, area: 0 }
      bucket.buildings += value.buildings
      bucket.area += value.area
    }
  }
  return total
}

export function mapShare(summary: MapSummary): number | null {
  return summary.total.area > 0 ? summary.valid.area / summary.total.area : null
}

export function mapColor(share: number | null) {
  if (share === null) return '#e2e8f0'
  return MAP_COLORS[Math.min(4, Math.max(0, Math.floor(share * 5)))]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseMapShapes(
  payload: unknown,
  municipalities: { name: string; municipalityCode: string }[],
): MapShape[] {
  if (!record(payload) || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('Kortkilden returnerede et ukendt format')
  }
  const aliases: Record<string, string> = {
    Copenhagen: 'Københavns',
    Bornholm: 'Bornholms',
    Nordfyn: 'Nordfyns',
    Vesthimmerland: 'Vesthimmerlands',
  }
  const normalize = (name: string) => name.replace(/\s+(regions)?kommune$/i, '').toLocaleLowerCase('da-DK')
  const codes = new Map(municipalities.map((row) => [normalize(row.name), row.municipalityCode]))
  const shapes = payload.features.map((feature: unknown) => {
    if (!record(feature) || !record(feature.properties) || !record(feature.geometry)
      || typeof feature.properties.shapeName !== 'string') {
      throw new Error('Kortkilden mangler kommunegrænser')
    }
    const name = feature.properties.shapeName
    const code = codes.get(normalize(aliases[name] ?? name))
    if (!code) throw new Error(`Kommunegrænsen kunne ikke matches: ${name}`)
    const geometry = feature.geometry
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) ? geometry.coordinates : null
    if (!polygons) throw new Error('Ukendt type kommunegrænse')
    const paths: string[] = []
    for (const polygon of polygons) {
      if (!Array.isArray(polygon)) throw new Error('Ugyldig kommunegrænse')
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Ugyldig kommunegrænse')
        const points = ring.map((point: unknown, index: number) => {
          if (!Array.isArray(point) || point.length < 2
            || typeof point[0] !== 'number' || typeof point[1] !== 'number'
            || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
            || point[0] < 7 || point[0] > 16 || point[1] < 54 || point[1] > 59) {
            throw new Error('Kortkilden bruger ukendte koordinater')
          }
          return `${index === 0 ? 'M' : 'L'}${((point[0] - 7.7) * 128).toFixed(2)},${((58.1 - point[1]) * 220).toFixed(2)}`
        })
        paths.push(`${points.join('')}Z`)
      }
    }
    return { code, path: paths.join('') }
  })
  if (shapes.length !== municipalities.length
    || new Set(shapes.map((shape) => shape.code)).size !== municipalities.length) {
    throw new Error('Kortet skal dække hver kommune præcis én gang')
  }
  return shapes
}

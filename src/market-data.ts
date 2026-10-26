export type MarketCompany = {
  id: string
  name: string
  aliases: string[]
  counts: Record<string, Record<string, number>>
}
export type MarketActivityData = {
  schemaVersion: 1
  generatedAt: string
  asOf: string
  startDate: '2025-01-01'
  dateBasis: 'ValidFrom'
  months: string[]
  companies: MarketCompany[]
  quality: {
    includedReports: number
    unidentifiedCompanyReports: number
    scannedBuildingRows: number
    paginationComplete: true
    historicalProductionComplete: false
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseMarketActivity(payload: unknown): MarketActivityData {
  const invalid = () => new Error('Markedsdata har et ukendt eller ufuldstændigt format.')
  if (!record(payload) || payload.schemaVersion !== 1
    || payload.startDate !== '2025-01-01' || payload.dateBasis !== 'ValidFrom'
    || typeof payload.generatedAt !== 'string' || !Number.isFinite(Date.parse(payload.generatedAt))
    || typeof payload.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.asOf)
    || !Array.isArray(payload.months) || !payload.months.length
    || !Array.isArray(payload.companies) || !record(payload.quality)) throw invalid()
  const months: string[] = []
  for (const month of payload.months) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid()
    const previous = months.at(-1)
    if (previous) {
      const next = new Date(`${previous}-01T00:00:00Z`)
      next.setUTCMonth(next.getUTCMonth() + 1)
      if (next.toISOString().slice(0, 7) !== month) throw invalid()
    }
    months.push(month)
  }
  if (months[0] !== '2025-01' || months.at(-1) !== payload.asOf.slice(0, 7)) throw invalid()
  const quality = payload.quality
  if (!count(quality.includedReports) || !count(quality.unidentifiedCompanyReports)
    || !count(quality.scannedBuildingRows) || quality.paginationComplete !== true
    || quality.historicalProductionComplete !== false) throw invalid()
  const companies: MarketCompany[] = []
  const ids = new Set<string>()
  let total = 0
  let unknown = 0
  for (const company of payload.companies) {
    if (!record(company) || typeof company.id !== 'string' || !company.id
      || ids.has(company.id) || typeof company.name !== 'string' || !company.name
      || !Array.isArray(company.aliases) || !company.aliases.every((name) => typeof name === 'string')
      || !record(company.counts)) throw invalid()
    ids.add(company.id)
    const aliases: string[] = company.aliases.filter((name): name is string => typeof name === 'string')
    const counts: MarketCompany['counts'] = {}
    for (const [month, values] of Object.entries(company.counts)) {
      if (!months.includes(month) || !record(values)) throw invalid()
      counts[month] = {}
      for (const [usage, value] of Object.entries(values)) {
        if (!usage || !count(value)) throw invalid()
        counts[month][usage] = value
        total += value
        if (company.id === '__unknown__') unknown += value
      }
    }
    companies.push({ id: company.id, name: company.name, aliases, counts })
  }
  if (total !== quality.includedReports || unknown !== quality.unidentifiedCompanyReports
    || total > quality.scannedBuildingRows) throw invalid()
  return {
    schemaVersion: 1,
    generatedAt: payload.generatedAt,
    asOf: payload.asOf,
    startDate: '2025-01-01',
    dateBasis: 'ValidFrom',
    months, companies,
    quality: {
      includedReports: total, unidentifiedCompanyReports: unknown,
      scannedBuildingRows: quality.scannedBuildingRows,
      paginationComplete: true, historicalProductionComplete: false,
    },
  }
}

export function marketCount(company: MarketCompany, month: string, usage: string): number {
  const values = company.counts[month]
  if (!values) return 0
  return usage === '__all__' ? Object.values(values).reduce((sum, value) => sum + value, 0)
    : values[usage] ?? 0
}

export function marketRows(data: MarketActivityData, month: string, usage: string) {
  const index = data.months.indexOf(month)
  if (index < 0) throw new Error('Måneden findes ikke i markedsdata.')
  const previousMonth = data.months[index - 1]
  const rows = data.companies.map((company) => ({
    company,
    current: marketCount(company, month, usage),
    previous: previousMonth ? marketCount(company, previousMonth, usage) : null,
  }))
  const total = rows.reduce((sum, row) => sum + row.current, 0)
  return {
    total,
    previousMonth,
    rows: rows.filter((row) => row.current || row.previous)
      .sort((a, b) => b.current - a.current || a.company.name.localeCompare(b.company.name, 'da'))
      .map((row) => ({ ...row, share: total ? row.current / total : 0 })),
  }
}

export function latestCompleteMonth(data: MarketActivityData) {
  return data.months.at(-2) ?? data.months[0]
}

export function marketCsv(data: MarketActivityData, month: string, usage: string) {
  const cell = (value: string | number) => {
    const text = String(value)
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`
  }
  const { rows } = marketRows(data, month, usage)
  const values = [
    ['Måned', 'Månedsstatus', 'Firma-ID (EMOData)', 'Firma', 'Fundne rapporter', 'Forrige måned', 'Andel af fundne rapporter (%)', 'Mærketype', 'Datogrundlag', 'Opgjort pr.', 'Dækning'],
    ...rows.map((row) => [
      month, month === data.asOf.slice(0, 7) ? 'Foreløbig' : 'Afsluttet kalendermåned',
      row.company.id, row.company.name, row.current, row.previous ?? '',
      (row.share * 100).toFixed(2).replace('.', ','), usage === '__all__' ? 'Alle typer' : usage,
      'Gyldig fra', data.asOf, 'Aktuelt fundne gyldige rapporter, ikke komplet historisk produktion',
    ]),
  ]
  return `\uFEFF${values.map((row) => row.map(cell).join(';')).join('\r\n')}`
}

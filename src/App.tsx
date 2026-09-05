import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Download,
  MapPin,
  Search,
} from 'lucide-react'
import { Badge, Button, Card, Input, Select, cn } from './components/ui'
import dashboardJson from './data/dashboard-data.json'

const YEARS = [
  '2026', '2027', '2028', '2029', '2030', '2031',
  '2032', '2033', '2034', '2035', '2036', '2037',
] as const

type Year = typeof YEARS[number]
type Horizon = Year
type ChartBucket = Horizon | 'expired' | 'unlabelled'
type Bucket = 'expired' | Year
type Metric = Record<Bucket, number>
type SortKey = 'name' | 'selected' | 'share' | 'valid' | 'expired' | 'unlabelled' | 'eligible'
type TableMode = 'year' | 'expired' | 'unlabelled'
type BuildingStatus = 'valid' | 'expired' | 'unlabelled'
type BuildingFilter = 'all' | BuildingStatus | Year

type BuildingRecord = {
  municipalityCode: string
  address: string
  postalCode: string
  bfe: string
  buildingNumber: string
  area: number
  energyLabel: string
  validTo: string
  status: BuildingStatus
}

type MunicipalityBuildingData = {
  schemaVersion: number
  asOf: string
  municipality: { name: string; cvr: string }
  buildings: BuildingRecord[]
}

type Municipality = {
  name: string
  cvr: string
  municipalityCode: string
  metrics: {
    labels: Metric
    buildings: Metric
    area: Metric
  }
  unlabelled: { buildings: number; area: number }
  missingLabel: { buildings: number; area: number }
  eligibleBuildings: number
  validLabelBuildings: number
}

type DashboardData = {
  schemaVersion: number
  generatedAt: string
  asOf: string
  source: string
  years: Year[]
  totals: {
    labels: Metric
    buildings: Metric
    area: Metric
  }
  totalsMissingLabel: { buildings: number; area: number }
  municipalities: Municipality[]
  quality: {
    municipalityCount: number
    uniqueEnergyLabels: number
    inventoryBuildings: number
    municipalInventoryBuildings: number
    exemptUseCodeBuildings: number
    outsidePublicAreaThresholdBuildings: number
    noHeatingInstallationBuildings: number
    protectedBuildings: number
    sourceLabelFallbackBuildings?: number
    unmatchedEnergyLabels?: number
    unmatchedGeographicEnergyLabels?: number
  }
}

const dashboard = dashboardJson as DashboardData
const municipalities = dashboard.municipalities
const numberFormat = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })
const compactFormat = new Intl.NumberFormat('da-DK', { notation: 'compact', maximumFractionDigits: 1 })
const percentageFormat = new Intl.NumberFormat('da-DK', { style: 'percent', maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat('da-DK')
const BUILDING_PAGE_SIZE = 100

const horizonLabels: Record<Horizon, string> = {
  '2026': 'Udløber i 2026',
  '2027': 'Udløber i 2027',
  '2028': 'Udløber i 2028',
  '2029': 'Udløber i 2029',
  '2030': 'Udløber i 2030',
  '2031': 'Udløber i 2031',
  '2032': 'Udløber i 2032',
  '2033': 'Udløber i 2033',
  '2034': 'Udløber i 2034',
  '2035': 'Udløber i 2035',
  '2036': 'Udløber i 2036',
  '2037': 'Udløber i 2037',
}

const chartColors: Record<Horizon, string> = {
  '2026': '#f97316',
  '2027': '#eab308',
  '2028': '#65a30d',
  '2029': '#16a34a',
  '2030': '#059669',
  '2031': '#0d9488',
  '2032': '#0891b2',
  '2033': '#0284c7',
  '2034': '#2563eb',
  '2035': '#4f46e5',
  '2036': '#7c3aed',
  '2037': '#9333ea',
}

function valueFor(row: Municipality, horizon: Horizon) {
  return row.metrics.buildings[horizon]
}

function shareFor(row: Municipality, horizon: Horizon) {
  return row.eligibleBuildings === 0
    ? 0
    : valueFor(row, horizon) / row.eligibleBuildings
}

function expiredFor(row: Municipality) {
  return row.metrics.buildings.expired
}

function unlabelledFor(row: Municipality) {
  return row.unlabelled.buildings
}

function formatBuildings(value: number) {
  return `${numberFormat.format(value)} bygninger`
}

function formatExpiryDate(value: string) {
  return value ? shortDateFormat.format(new Date(`${value}T12:00:00`)) : '—'
}

function buildingMatchesFilter(building: BuildingRecord, filter: BuildingFilter) {
  if (filter === 'all') return true
  if (filter === 'valid' || filter === 'expired' || filter === 'unlabelled') {
    return building.status === filter
  }
  return building.status === 'valid' && building.validTo.startsWith(filter)
}

function downloadMunicipalityExport(municipality: Municipality) {
  const anchor = document.createElement('a')
  anchor.href = `${import.meta.env.BASE_URL}exports/${municipality.cvr}.xlsx`
  anchor.download = `${municipality.name.toLocaleLowerCase('da-DK').replaceAll(' ', '-')}-bygninger.xlsx`
  anchor.click()
}

function downloadCsv(rows: Municipality[]) {
  const header = ['Kommune', 'CVR', 'Kommunekode', ...YEARS]
  const lines = rows.map((row) => [
    row.name,
    row.cvr,
    row.municipalityCode,
    ...YEARS.map((year) => row.metrics.buildings[year]),
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';'))
  const blob = new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `udloebsplan-bygninger-${dashboard.asOf}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [horizon, setHorizon] = useState<Horizon>('2026')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('selected')
  const [sortDescending, setSortDescending] = useState(true)
  const [selectedCvr, setSelectedCvr] = useState<string | null>(null)
  const [tableMode, setTableMode] = useState<TableMode>('year')
  const [buildingRows, setBuildingRows] = useState<BuildingRecord[]>([])
  const [buildingQuery, setBuildingQuery] = useState('')
  const [buildingFilter, setBuildingFilter] = useState<BuildingFilter>('2026')
  const [visibleBuildingCount, setVisibleBuildingCount] = useState(BUILDING_PAGE_SIZE)
  const [buildingLoading, setBuildingLoading] = useState(false)
  const [buildingError, setBuildingError] = useState<string | null>(null)
  const totals = dashboard.totals.buildings
  const selectedMunicipality = municipalities.find((row) => row.cvr === selectedCvr)
  const chartMetrics = selectedMunicipality?.metrics.buildings ?? totals

  useEffect(() => {
    if (!selectedCvr) {
      setBuildingRows([])
      setBuildingError(null)
      setBuildingLoading(false)
      return
    }

    const controller = new AbortController()
    setBuildingRows([])
    setBuildingQuery('')
    setBuildingLoading(true)
    setBuildingError(null)
    fetch(`${import.meta.env.BASE_URL}buildings/${selectedCvr}.json`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Bygningsdata kunne ikke hentes (${response.status})`)
        }
        return response.json() as Promise<MunicipalityBuildingData>
      })
      .then((payload) => setBuildingRows(payload.buildings))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setBuildingRows([])
        setBuildingError(
          error instanceof Error ? error.message : 'Bygningsdata kunne ikke hentes',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setBuildingLoading(false)
      })

    return () => controller.abort()
  }, [selectedCvr])

  useEffect(() => {
    setVisibleBuildingCount(BUILDING_PAGE_SIZE)
  }, [buildingFilter, buildingQuery, selectedCvr])

  const selectHorizon = (value: Horizon) => {
    setHorizon(value)
    setTableMode('year')
    setBuildingFilter(value)
    setSortKey('selected')
    setSortDescending(true)
  }

  const selectExpiredLabels = () => {
    setTableMode('expired')
    setBuildingFilter('expired')
    setSortKey('expired')
    setSortDescending(true)
  }

  const selectUnlabelled = () => {
    setTableMode('unlabelled')
    setBuildingFilter('unlabelled')
    setSortKey('unlabelled')
    setSortDescending(true)
  }

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('da-DK')
    return municipalities
      .filter((row) => {
        const matchesQuery = !normalizedQuery
          || row.name.toLocaleLowerCase('da-DK').includes(normalizedQuery)
          || row.cvr.includes(normalizedQuery)
        const hasRelevantBuildings = tableMode === 'expired'
          ? expiredFor(row) > 0
          : tableMode === 'unlabelled'
            ? unlabelledFor(row) > 0
            : valueFor(row, horizon) > 0
        return matchesQuery && hasRelevantBuildings
      })
      .sort((a, b) => {
        let result = 0
        if (sortKey === 'name') result = a.name.localeCompare(b.name, 'da')
        if (sortKey === 'selected') result = valueFor(a, horizon) - valueFor(b, horizon)
        if (sortKey === 'share') result = shareFor(a, horizon) - shareFor(b, horizon)
        if (sortKey === 'valid') result = a.validLabelBuildings - b.validLabelBuildings
        if (sortKey === 'expired') result = expiredFor(a) - expiredFor(b)
        if (sortKey === 'unlabelled') result = unlabelledFor(a) - unlabelledFor(b)
        if (sortKey === 'eligible') result = a.eligibleBuildings - b.eligibleBuildings
        return sortDescending ? -result : result
      })
  }, [horizon, query, sortDescending, sortKey, tableMode])

  const filteredBuildingRows = useMemo(() => {
    const normalizedQuery = buildingQuery.trim().toLocaleLowerCase('da-DK')
    return buildingRows.filter((building) => {
      if (!buildingMatchesFilter(building, buildingFilter)) return false
      if (!normalizedQuery) return true
      return [
        building.address,
        building.postalCode,
        building.bfe,
        building.buildingNumber,
        building.energyLabel,
      ].some((value) => value.toLocaleLowerCase('da-DK').includes(normalizedQuery))
    })
  }, [buildingFilter, buildingQuery, buildingRows])

  const totalUnlabelledBuildings = municipalities.reduce(
    (sum, row) => sum + unlabelledFor(row),
    0,
  )
  const timelineData: Array<{
    name: string
    bucket: ChartBucket
    value: number
    color: string
  }> = [
    ...YEARS.map((bucket) => ({
      name: bucket,
      bucket,
      value: chartMetrics[bucket],
      color: tableMode === 'year' && bucket === horizon ? '#0f172a' : chartColors[bucket],
    })),
    {
      name: 'Udløbet',
      bucket: 'expired',
      value: selectedMunicipality
        ? expiredFor(selectedMunicipality)
        : totals.expired,
      color: tableMode === 'expired' ? '#0f172a' : '#ea580c',
    },
    {
      name: 'Mangler',
      bucket: 'unlabelled',
      value: selectedMunicipality
        ? unlabelledFor(selectedMunicipality)
        : totalUnlabelledBuildings,
      color: tableMode === 'unlabelled' ? '#0f172a' : '#dc2626',
    },
  ]

  const affectedMunicipalities = municipalities.filter(
    (row) => valueFor(row, horizon) > 0,
  ).length
  const municipalitiesWithExpiredLabels = municipalities.filter(
    (row) => expiredFor(row) > 0,
  ).length
  const municipalitiesWithoutLabels = municipalities.filter(
    (row) => unlabelledFor(row) > 0,
  ).length
  const nextPeak = YEARS.reduce((best, year) => (
    dashboard.totals.buildings[year] > dashboard.totals.buildings[best] ? year : best
  ), YEARS[0])
  const sourceDate = dateFormat.format(new Date(`${dashboard.asOf}T12:00:00`))
  const selectedLabel = tableMode === 'expired'
    ? 'Udløbet mærke'
    : tableMode === 'unlabelled'
      ? 'Mangler mærke'
      : horizonLabels[horizon]
  const tableTitle = tableMode === 'expired'
    ? 'Kommuner med bygninger, hvor energimærket er udløbet'
    : tableMode === 'unlabelled'
      ? 'Kommuner med bygninger uden fundet energimærke'
      : 'Kommuner med udløb i den valgte periode'
  const tableSummary = tableMode === 'expired'
    ? `${municipalitiesWithExpiredLabels} kommuner · ${formatBuildings(totals.expired)} · mærket er udløbet`
    : tableMode === 'unlabelled'
      ? `${municipalitiesWithoutLabels} kommuner · ${formatBuildings(totalUnlabelledBuildings)} · intet mærke fundet`
      : `${affectedMunicipalities} kommuner · ${formatBuildings(totals[horizon])} · Andel af alle mærkningspligtige bygninger`

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDescending((value) => !value)
    else {
      setSortKey(key)
      setSortDescending(key !== 'name')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
              <Building2 size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-950">Kommunedashboard</div>
              <div className="text-[11px] text-slate-500">Planlægning af bygningers energimærker</div>
            </div>
          </div>
          <div className="hidden text-xs text-slate-500 sm:block">Datagrundlag · {sourceDate}</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
        <section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-sm">
          <div className="relative px-5 py-6 sm:px-7">
            <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.35),transparent_70%)] lg:block" />
            <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
                  <MapPin size={14} /> National udløbsplan
                </div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hvornår udløber bygningernes energimærker?</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  Klik på et år og se de kommuner, der har flest bygninger, hvor energimærket udløber.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => downloadCsv(filteredRows)}>
                  <Download size={14} /> Eksportér plan
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløber i 2026"
            value={formatBuildings(dashboard.totals.buildings['2026'])}
            note={`${municipalities.filter((row) => row.metrics.buildings['2026'] > 0).length} kommuner`}
            tone="orange"
            active={tableMode === 'year' && horizon === '2026'}
            onClick={() => selectHorizon('2026')}
          />
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløber i 2027"
            value={formatBuildings(dashboard.totals.buildings['2027'])}
            note={`${municipalities.filter((row) => row.metrics.buildings['2027'] > 0).length} kommuner`}
            tone="yellow"
            active={tableMode === 'year' && horizon === '2027'}
            onClick={() => selectHorizon('2027')}
          />
          <DeadlineCard
            icon={<CheckCircle2 size={18} />}
            label="Største kommende år"
            value={`${nextPeak} · ${numberFormat.format(dashboard.totals.buildings[nextPeak])}`}
            note="bygninger, hvor energimærket udløber"
            tone="green"
            active={tableMode === 'year' && horizon === nextPeak}
            onClick={() => selectHorizon(nextPeak)}
          />
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløbet mærke"
            value={formatBuildings(totals.expired)}
            note={`${municipalitiesWithExpiredLabels} kommuner`}
            tone="orange"
            active={tableMode === 'expired'}
            onClick={selectExpiredLabels}
          />
          <DeadlineCard
            icon={<CircleAlert size={18} />}
            label="Mangler mærke"
            value={formatBuildings(totalUnlabelledBuildings)}
            note={`${municipalitiesWithoutLabels} kommuner · intet mærke fundet`}
            tone="red"
            active={tableMode === 'unlabelled'}
            onClick={selectUnlabelled}
          />
        </section>

        <Card className="border-blue-200 bg-blue-50/60 px-5 py-4 text-xs leading-5 text-slate-600">
          <span className="font-semibold text-slate-800">Automatisk afgrænsning:</span>{' '}
          {numberFormat.format(dashboard.quality.inventoryBuildings)} kommunale bygninger over 250 m² er medtaget.
          Anvendelseskoder, fredede bygninger og bygninger registreret uden varmeinstallation er frasorteret efter{' '}
          <a className="font-medium text-blue-700 underline" href="https://www.hbemo.dk/vejledning/faq/bekendtgoerelse-om-energimaerkning-af-bygninger" target="_blank" rel="noreferrer">HBEMO</a>
          {' '}og den gældende{' '}
          <a className="font-medium text-blue-700 underline" href="https://www.retsinformation.dk/eli/lta/2023/549" target="_blank" rel="noreferrer">bekendtgørelse</a>.
          {dashboard.quality.sourceLabelFallbackBuildings
            ? ` For ${numberFormat.format(dashboard.quality.sourceLabelFallbackBuildings)} bygninger uden EMOData-match anvendes mærket fra det oprindelige kommunale udtræk.`
            : ''}
          {' '}Forhold som nedrivningshensigt, opvarmet delareal og mangler i klimaskærmen kræver manuel kontrol.
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">
                {selectedMunicipality
                  ? `${selectedMunicipality.name}: udløb og manglende energimærker`
                  : 'Udløb og manglende gyldige energimærker frem til 2037'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selectedMunicipality
                  ? 'Grafen viser kun den valgte kommune. Klik på et år, Udløbet eller Mangler.'
                  : 'Klik på en kommune i tabellen for at vise dens bygninger i grafen.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedMunicipality && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => downloadMunicipalityExport(selectedMunicipality)}>
                    <Download size={14} /> Hent Excel-udtræk
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedCvr(null)}>
                    Vis alle kommuner
                  </Button>
                </>
              )}
              <div className="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                Valgt: {selectedLabel}
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={390}>
            <BarChart data={timelineData} margin={{ top: 18, right: 8, left: 12, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" interval={0} fontSize={11} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tickFormatter={(value) => compactFormat.format(Number(value))} width={54} fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value) => formatBuildings(Number(value))}
                labelFormatter={(label) => label === 'Udløbet'
                  ? 'Udløbet mærke'
                  : label === 'Mangler'
                    ? 'Mangler mærke'
                    : `Udløber i ${label}`}
              />
              <Bar
                dataKey="value"
                name="Bygninger"
                radius={[5, 5, 0, 0]}
                maxBarSize={72}
                minPointSize={3}
              >
                {timelineData.map((item) => (
                  <Cell
                    key={item.name}
                    fill={item.color}
                    className="cursor-pointer"
                    onClick={() => item.bucket === 'expired'
                      ? selectExpiredLabels()
                      : item.bucket === 'unlabelled'
                        ? selectUnlabelled()
                        : selectHorizon(item.bucket)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {selectedMunicipality && (
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center">
              <div className="mr-auto">
                <h2 className="text-[15px] font-semibold text-slate-900">
                  {selectedMunicipality.name}: bygningsliste
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {buildingLoading
                    ? 'Henter bygninger…'
                    : `${numberFormat.format(filteredBuildingRows.length)} af ${numberFormat.format(buildingRows.length)} bygninger`}
                </p>
              </div>
              <div className="relative w-full lg:w-80">
                <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={15} />
                <Input
                  value={buildingQuery}
                  onChange={(event) => setBuildingQuery(event.target.value)}
                  placeholder="Søg adresse, BFE eller EM-nummer"
                  className="w-full pl-9"
                />
              </div>
              <Select
                value={buildingFilter}
                onChange={(event) => setBuildingFilter(event.target.value as BuildingFilter)}
              >
                <option value="all">Alle bygninger</option>
                <option value="unlabelled">Mangler mærke</option>
                <option value="expired">Udløbet mærke</option>
                <option value="valid">Alle gyldige mærker</option>
                {YEARS.map((year) => (
                  <option key={year} value={year}>Udløber i {year}</option>
                ))}
              </Select>
            </div>

            {buildingError && (
              <div className="border-b border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                {buildingError}. Excel-udtrækket kan stadig hentes ovenfor.
              </div>
            )}

            {!buildingError && (
              <>
                <div className="max-h-[620px] overflow-auto">
                  <table className="min-w-[1050px]">
                    <thead>
                      <tr>
                        <th>Adresse</th>
                        <th>Status</th>
                        <th>Gyldig til</th>
                        <th>EM-nummer</th>
                        <th>BFE-nummer</th>
                        <th className="num">Bygning</th>
                        <th className="num">Areal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBuildingRows
                        .slice(0, visibleBuildingCount)
                        .map((building, index) => (
                          <tr key={`${building.bfe}-${building.buildingNumber}-${index}`}>
                            <td>
                              <div className="font-medium text-slate-900">
                                {building.address || 'Adresse ikke oplyst'}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {building.postalCode || 'Postnr. ikke oplyst'}
                              </div>
                            </td>
                            <td><BuildingStatusBadge status={building.status} /></td>
                            <td className="whitespace-nowrap text-slate-600">
                              {formatExpiryDate(building.validTo)}
                            </td>
                            <td className="text-slate-600">{building.energyLabel || '—'}</td>
                            <td className="text-slate-600">{building.bfe || '—'}</td>
                            <td className="num text-slate-600">{building.buildingNumber || '—'}</td>
                            <td className="num text-slate-600">{numberFormat.format(building.area)} m²</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!buildingLoading && filteredBuildingRows.length === 0 && (
                  <div className="px-5 py-12 text-center text-sm text-slate-500">
                    Ingen bygninger matcher søgningen og det valgte filter.
                  </div>
                )}
                {visibleBuildingCount < filteredBuildingRows.length && (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
                    <span className="text-xs text-slate-500">
                      Viser {numberFormat.format(visibleBuildingCount)} af {numberFormat.format(filteredBuildingRows.length)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setVisibleBuildingCount((count) => count + BUILDING_PAGE_SIZE)}
                    >
                      Vis flere
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center">
            <div className="mr-auto">
              <h2 className="text-[15px] font-semibold text-slate-900">
                {tableTitle}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {tableSummary}
              </p>
            </div>
            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={15} />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Søg kommune eller CVR"
                className="w-full pl-9"
              />
            </div>
            <Select value={horizon} onChange={(event) => selectHorizon(event.target.value as Horizon)}>
              {Object.entries(horizonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>

          <div className="max-h-[650px] overflow-auto">
            <table className="min-w-[1100px]">
              <thead>
                <tr>
                  <SortableHeader label="Kommune" active={sortKey === 'name'} descending={sortDescending} onClick={() => setSort('name')} />
                  <SortableHeader label={`Bygninger · ${horizon}`} active={sortKey === 'selected'} descending={sortDescending} onClick={() => setSort('selected')} align="right" />
                  <SortableHeader label={`Andel · ${horizon}`} active={sortKey === 'share'} descending={sortDescending} onClick={() => setSort('share')} align="right" />
                  <SortableHeader label="Gyldige mærker" active={sortKey === 'valid'} descending={sortDescending} onClick={() => setSort('valid')} align="right" />
                  <SortableHeader label="Udløbet mærke" active={sortKey === 'expired'} descending={sortDescending} onClick={() => setSort('expired')} align="right" />
                  <SortableHeader label="Mangler mærke" active={sortKey === 'unlabelled'} descending={sortDescending} onClick={() => setSort('unlabelled')} align="right" />
                  <SortableHeader label="Bygninger omfattet af energimærkningsloven" active={sortKey === 'eligible'} descending={sortDescending} onClick={() => setSort('eligible')} align="right" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  return (
                    <tr
                      key={row.cvr}
                      className={cn('cursor-pointer', selectedCvr === row.cvr && 'selected-municipality')}
                      onClick={() => setSelectedCvr(row.cvr)}
                    >
                      <td>
                        <button
                          className="font-medium text-slate-900 underline-offset-2 hover:text-blue-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                          onClick={() => setSelectedCvr(row.cvr)}
                          aria-pressed={selectedCvr === row.cvr}
                        >
                          {row.name}
                        </button>
                        <div className="text-[11px] text-slate-400">CVR {row.cvr} · kommunekode {row.municipalityCode}</div>
                      </td>
                      <td className="num font-semibold text-slate-950">{formatBuildings(valueFor(row, horizon))}</td>
                      <td className="num font-semibold text-blue-700">{percentageFormat.format(shareFor(row, horizon))}</td>
                      <td className="num text-slate-500">{formatBuildings(row.validLabelBuildings)}</td>
                      <td className="num font-semibold text-orange-700">{formatBuildings(expiredFor(row))}</td>
                      <td className="num font-semibold text-red-700">{formatBuildings(unlabelledFor(row))}</td>
                      <td className="num font-semibold text-slate-700">{formatBuildings(row.eligibleBuildings)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredRows.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              {tableMode === 'expired'
                ? 'Ingen kommuner har bygninger med et udløbet energimærke.'
                : tableMode === 'unlabelled'
                  ? 'Ingen kommuner har bygninger uden et fundet energimærke.'
                  : 'Ingen kommuner har bygninger, hvor energimærket udløber i den valgte periode.'}
            </div>
          )}
        </Card>
      </main>

      <footer className="mx-auto flex max-w-[1500px] flex-wrap justify-between gap-2 px-6 pb-8 pt-2 text-xs text-slate-400">
        <span>Kilde: kommunalt bygningsudtræk og EMOData</span>
        <span>Opgjort pr. {sourceDate}</span>
      </footer>
    </div>
  )
}

function BuildingStatusBadge({ status }: { status: BuildingStatus }) {
  if (status === 'unlabelled') return <Badge color="red">Mangler mærke</Badge>
  if (status === 'expired') return <Badge color="amber">Udløbet</Badge>
  return <Badge color="green">Gyldigt</Badge>
}

function DeadlineCard({
  icon,
  label,
  value,
  note,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  note: string
  tone: 'orange' | 'yellow' | 'green' | 'red'
  active: boolean
  onClick: () => void
}) {
  const tones = {
    orange: 'bg-orange-50 text-orange-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
  }
  return (
    <button onClick={onClick} className="text-left">
      <Card className={cn('h-full p-4 transition-all sm:p-5', active ? 'border-blue-500 ring-2 ring-blue-500/15' : 'hover:border-slate-300 hover:shadow-md')}>
        <div className={cn('mb-3 flex h-9 w-9 items-center justify-center rounded-lg', tones[tone])}>{icon}</div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{value}</div>
        <div className="mt-1 line-clamp-2 text-[11px] text-slate-400">{note}</div>
      </Card>
    </button>
  )
}

function SortableHeader({
  label,
  active,
  descending,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  descending: boolean
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th className={align === 'right' ? 'num' : undefined}>
      <button
        onClick={onClick}
        className={cn('inline-flex items-center gap-1 hover:text-slate-900', align === 'right' && 'ml-auto')}
      >
        {label}
        <span className={active ? 'text-blue-600' : 'text-slate-300'}>{active ? (descending ? '↓' : '↑') : '↕'}</span>
      </button>
    </th>
  )
}

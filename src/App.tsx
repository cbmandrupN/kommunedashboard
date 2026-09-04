import { useMemo, useState } from 'react'
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
  Download,
  MapPin,
  Search,
} from 'lucide-react'
import { Button, Card, Input, Select, cn } from './components/ui'
import dashboardJson from './data/dashboard-data.json'

const YEARS = [
  '2026', '2027', '2028', '2029', '2030', '2031',
  '2032', '2033', '2034', '2035', '2036', '2037',
] as const

type Year = typeof YEARS[number]
type Horizon = Year
type Bucket = 'expired' | Year
type Basis = 'labels' | 'buildings' | 'area'
type Metric = Record<Bucket, number>
type SortKey = 'name' | 'selected' | 'total'

type Municipality = {
  name: string
  cvr: string
  municipalityCode: string
  metrics: Record<Basis, Metric>
  unlabelled: { buildings: number; area: number }
}

type DashboardData = {
  schemaVersion: number
  generatedAt: string
  asOf: string
  source: string
  years: Year[]
  totals: Record<Basis, Metric>
  municipalities: Municipality[]
  quality: {
    municipalityCount: number
    uniqueEnergyLabels: number
    inventoryBuildings: number
    unmatchedEnergyLabels?: number
    unmatchedGeographicEnergyLabels?: number
  }
}

const dashboard = dashboardJson as DashboardData
const municipalities = dashboard.municipalities
const numberFormat = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })
const compactFormat = new Intl.NumberFormat('da-DK', { notation: 'compact', maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })

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

const basisLabels: Record<Basis, string> = {
  labels: 'Energimærker',
  buildings: 'Bygninger',
  area: 'Kvadratmeter',
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

function valueFor(row: Municipality, basis: Basis, horizon: Horizon) {
  return row.metrics[basis][horizon]
}

function totalFor(row: Municipality, basis: Basis) {
  return YEARS.reduce(
    (sum, bucket) => sum + row.metrics[basis][bucket],
    0,
  )
}

function formatValue(value: number, basis: Basis) {
  if (basis === 'area') return `${numberFormat.format(value)} m²`
  if (basis === 'buildings') return `${numberFormat.format(value)} byg.`
  return `${numberFormat.format(value)} mærker`
}

function downloadCsv(rows: Municipality[]) {
  const header = ['Kommune', 'CVR', 'Kommunekode', ...YEARS]
  const lines = rows.map((row) => [
    row.name,
    row.cvr,
    row.municipalityCode,
    ...YEARS.map((year) => row.metrics.labels[year]),
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';'))
  const blob = new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `udloebsplan-energimaerker-${dashboard.asOf}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [basis, setBasis] = useState<Basis>('labels')
  const [horizon, setHorizon] = useState<Horizon>('2026')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('selected')
  const [sortDescending, setSortDescending] = useState(true)
  const totals = dashboard.totals[basis]

  const selectHorizon = (value: Horizon) => {
    setHorizon(value)
    setSortKey('selected')
    setSortDescending(true)
  }

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('da-DK')
    return municipalities
      .filter((row) => {
        const matchesQuery = !normalizedQuery
          || row.name.toLocaleLowerCase('da-DK').includes(normalizedQuery)
          || row.cvr.includes(normalizedQuery)
        return matchesQuery && valueFor(row, basis, horizon) > 0
      })
      .sort((a, b) => {
        let result = 0
        if (sortKey === 'name') result = a.name.localeCompare(b.name, 'da')
        if (sortKey === 'selected') result = valueFor(a, basis, horizon) - valueFor(b, basis, horizon)
        if (sortKey === 'total') result = totalFor(a, basis) - totalFor(b, basis)
        return sortDescending ? -result : result
      })
  }, [basis, horizon, query, sortDescending, sortKey])

  const timelineData = YEARS.map((bucket) => ({
    name: bucket,
    bucket,
    value: totals[bucket],
    color: bucket === horizon ? '#0f172a' : chartColors[bucket],
  }))

  const affectedMunicipalities = municipalities.filter(
    (row) => valueFor(row, basis, horizon) > 0,
  ).length
  const nextPeak = YEARS.reduce((best, year) => (
    dashboard.totals.labels[year] > dashboard.totals.labels[best] ? year : best
  ), YEARS[0])
  const sourceDate = dateFormat.format(new Date(`${dashboard.asOf}T12:00:00`))

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
              <div className="text-[11px] text-slate-500">Planlægning af energimærker</div>
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
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hvornår skal kommunerne have nye energimærker?</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  Klik på et år og se de kommuner, der har flest energimærker til fornyelse.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
                  {(Object.keys(basisLabels) as Basis[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => setBasis(value)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                        basis === value ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white',
                      )}
                    >
                      {basisLabels[value]}
                    </button>
                  ))}
                </div>
                <Button variant="secondary" size="sm" onClick={() => downloadCsv(filteredRows)}>
                  <Download size={14} /> Eksportér plan
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløber i 2026"
            value={formatValue(dashboard.totals.labels['2026'], 'labels')}
            note={`${municipalities.filter((row) => row.metrics.labels['2026'] > 0).length} kommuner`}
            tone="orange"
            active={horizon === '2026'}
            onClick={() => selectHorizon('2026')}
          />
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløber i 2027"
            value={formatValue(dashboard.totals.labels['2027'], 'labels')}
            note={`${municipalities.filter((row) => row.metrics.labels['2027'] > 0).length} kommuner`}
            tone="yellow"
            active={horizon === '2027'}
            onClick={() => selectHorizon('2027')}
          />
          <DeadlineCard
            icon={<CheckCircle2 size={18} />}
            label="Største kommende år"
            value={`${nextPeak} · ${numberFormat.format(dashboard.totals.labels[nextPeak])}`}
            note="unikke energimærker"
            tone="green"
            active={horizon === nextPeak}
            onClick={() => selectHorizon(nextPeak)}
          />
        </section>

        <Card className="p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">Udløb af energimærker frem til 2037</h2>
              <p className="mt-1 text-xs text-slate-500">Klik på en søjle for at filtrere kommunerne og sortere efter flest udløb.</p>
            </div>
            <div className="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              Valgt: {horizonLabels[horizon]}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={390}>
            <BarChart data={timelineData} margin={{ top: 18, right: 8, left: 12, bottom: 0 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" interval={0} fontSize={11} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tickFormatter={(value) => compactFormat.format(Number(value))} width={54} fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value) => formatValue(Number(value), basis)}
                labelFormatter={(label) => `Udløber i ${label}`}
              />
              <Bar
                dataKey="value"
                name={basisLabels[basis]}
                radius={[5, 5, 0, 0]}
                maxBarSize={72}
                minPointSize={3}
              >
                {timelineData.map((item) => (
                  <Cell
                    key={item.name}
                    fill={item.color}
                    className="cursor-pointer"
                    onClick={() => selectHorizon(item.bucket)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center">
            <div className="mr-auto">
              <h2 className="text-[15px] font-semibold text-slate-900">Kommuner med udløb i den valgte periode</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {affectedMunicipalities} kommuner · {formatValue(totals[horizon], basis)} · {horizonLabels[horizon]}
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
            <table className="min-w-[900px]">
              <thead>
                <tr>
                  <SortableHeader label="Kommune" active={sortKey === 'name'} descending={sortDescending} onClick={() => setSort('name')} />
                  <SortableHeader label={`${basisLabels[basis]} · ${horizon}`} active={sortKey === 'selected'} descending={sortDescending} onClick={() => setSort('selected')} align="right" />
                  {basis !== 'labels' && <th className="num">Energimærker</th>}
                  {basis !== 'buildings' && <th className="num">Bygninger</th>}
                  {basis !== 'area' && <th className="num">Areal</th>}
                  <SortableHeader label="Alle perioder" active={sortKey === 'total'} descending={sortDescending} onClick={() => setSort('total')} align="right" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  return (
                    <tr key={row.cvr}>
                      <td>
                        <div className="font-medium text-slate-900">{row.name}</div>
                        <div className="text-[11px] text-slate-400">CVR {row.cvr} · kommunekode {row.municipalityCode}</div>
                      </td>
                      <td className="num font-semibold text-slate-950">{formatValue(valueFor(row, basis, horizon), basis)}</td>
                      {basis !== 'labels' && <td className="num">{numberFormat.format(row.metrics.labels[horizon])}</td>}
                      {basis !== 'buildings' && <td className="num">{numberFormat.format(row.metrics.buildings[horizon])}</td>}
                      {basis !== 'area' && <td className="num">{numberFormat.format(row.metrics.area[horizon])} m²</td>}
                      <td className="num text-slate-500">{formatValue(totalFor(row, basis), basis)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredRows.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-slate-500">Ingen kommuner har energimærker i den valgte periode.</div>
          )}
        </Card>
      </main>

      <footer className="mx-auto flex max-w-[1500px] flex-wrap justify-between gap-2 px-6 pb-8 pt-2 text-xs text-slate-400">
        <span>Kilde: kommunalt bygningsudtræk · {numberFormat.format(dashboard.quality.uniqueEnergyLabels)} unikke energimærker</span>
        <span>Opgjort pr. {sourceDate}</span>
      </footer>
    </div>
  )
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
  tone: 'orange' | 'yellow' | 'green'
  active: boolean
  onClick: () => void
}) {
  const tones = {
    orange: 'bg-orange-50 text-orange-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    green: 'bg-green-50 text-green-700',
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

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
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Download,
  MapPin,
  Search,
} from 'lucide-react'
import { Button, Card, Input, Select, cn } from './components/ui'
import municipalitiesJson from './data/municipalities.json'

type Measure = {
  total: number
  labelled: number
  unlabelled: number
  expired: number
  expires2026: number
  expires2027: number
  expiresLater: number
  recent: number
}

type Municipality = {
  name: string
  cvr: string
  buildings: Measure
  area: Measure
}

type Basis = 'buildings' | 'area'
type Horizon = 'expired' | '2026' | '2027' | '2028' | '2029' | '2030' | '2031' | '2032' | '2033' | '2034' | '2035' | '2036' | '2037'
type SortKey = 'name' | 'selected' | 'expired' | 'expires2026' | 'expires2027'

const municipalities = municipalitiesJson as Municipality[]
const numberFormat = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })
const compactFormat = new Intl.NumberFormat('da-DK', { notation: 'compact', maximumFractionDigits: 1 })

const sourceTotals: Record<Basis, Measure> = {
  buildings: {
    total: 20094,
    labelled: 16043,
    unlabelled: 4051,
    expired: 2181,
    expires2026: 448,
    expires2027: 1799,
    expiresLater: 11615,
    recent: 7947,
  },
  area: {
    total: 30004287,
    labelled: 25359747,
    unlabelled: 4644540,
    expired: 3165353,
    expires2026: 660912,
    expires2027: 2632973,
    expiresLater: 18900509,
    recent: 13023640,
  },
}

const horizonLabels: Record<Horizon, string> = {
  expired: 'Allerede udløbet',
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

const colors = {
  expired: '#dc2626',
  expires2026: '#f97316',
  expires2027: '#eab308',
  expiresLater: '#16a34a',
}

function amount(row: Municipality, basis: Basis, horizon: Horizon) {
  const data = row[basis]
  if (horizon === 'expired') return data.expired
  if (horizon === '2026') return data.expires2026
  if (horizon === '2027') return data.expires2027
  return 0
}

function formatValue(value: number, basis: Basis) {
  return basis === 'area' ? `${numberFormat.format(value)} m²` : `${numberFormat.format(value)} byg.`
}

function nextDeadline(data: Measure) {
  if (data.expired > 0) return { label: 'Udløbet', className: 'border-red-200 bg-red-50 text-red-700' }
  if (data.expires2026 > 0) return { label: '2026', className: 'border-orange-200 bg-orange-50 text-orange-700' }
  if (data.expires2027 > 0) return { label: '2027', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' }
  if (data.expiresLater > 0) return { label: '2028+', className: 'border-green-200 bg-green-50 text-green-700' }
  return { label: 'Intet mærke', className: 'border-slate-200 bg-slate-100 text-slate-600' }
}

function downloadCsv(rows: Municipality[], basis: Basis) {
  const header = [
    'Kommune',
    'CVR',
    'Udløbet',
    'Udløber 2026',
    'Udløber 2027',
    'Udløber 2028+',
    'Uden energimærke',
  ]
  const lines = rows.map((row) => {
    const data = row[basis]
    return [
      row.name,
      row.cvr,
      data.expired,
      data.expires2026,
      data.expires2027,
      data.expiresLater,
      data.unlabelled,
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')
  })
  const blob = new Blob([`\uFEFF${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `udloebsplan-kommuner-${basis}-2026-09-03.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [basis, setBasis] = useState<Basis>('buildings')
  const [horizon, setHorizon] = useState<Horizon>('expired')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('selected')
  const [sortDescending, setSortDescending] = useState(true)
  const totals = sourceTotals[basis]

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('da-DK')
    return municipalities
      .filter((row) => {
        const matchesQuery = !normalizedQuery
          || row.name.toLocaleLowerCase('da-DK').includes(normalizedQuery)
          || row.cvr.includes(normalizedQuery)
        return matchesQuery && amount(row, basis, horizon) > 0
      })
      .sort((a, b) => {
        let result = 0
        if (sortKey === 'name') result = a.name.localeCompare(b.name, 'da')
        if (sortKey === 'selected') result = amount(a, basis, horizon) - amount(b, basis, horizon)
        if (sortKey === 'expired') result = a[basis].expired - b[basis].expired
        if (sortKey === 'expires2026') result = a[basis].expires2026 - b[basis].expires2026
        if (sortKey === 'expires2027') result = a[basis].expires2027 - b[basis].expires2027
        return sortDescending ? -result : result
      })
  }, [basis, horizon, query, sortDescending, sortKey])

  const timelineData = (Object.keys(horizonLabels) as Horizon[]).map((year) => ({
    name: year === 'expired' ? 'Udløbet' : year,
    year,
    value: year === 'expired'
      ? totals.expired
      : year === '2026'
        ? totals.expires2026
        : year === '2027'
          ? totals.expires2027
          : 0,
    color: year === horizon
      ? '#2563eb'
      : year === 'expired'
        ? colors.expired
        : year === '2026'
          ? colors.expires2026
          : year === '2027'
            ? colors.expires2027
            : '#cbd5e1',
  }))

  const municipalityCount = municipalities.filter((row) => amount(row, basis, horizon) > 0).length
  const selectedTotal = horizon === 'expired'
    ? totals.expired
    : horizon === '2026'
      ? totals.expires2026
      : horizon === '2027'
        ? totals.expires2027
        : 0

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
          <div className="hidden text-xs text-slate-500 sm:block">Datagrundlag · 3. september 2026</div>
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
                  Find de kommuner, hvor energimærker allerede er udløbet eller udløber i de kommende år.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
                  <button
                    onClick={() => setBasis('buildings')}
                    className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors', basis === 'buildings' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white')}
                  >
                    Bygninger
                  </button>
                  <button
                    onClick={() => setBasis('area')}
                    className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition-colors', basis === 'area' ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white')}
                  >
                    Kvadratmeter
                  </button>
                </div>
                <Button variant="secondary" size="sm" onClick={() => downloadCsv(filteredRows, basis)}>
                  <Download size={14} /> Eksportér plan
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DeadlineCard
            icon={<AlertTriangle size={18} />}
            label="Allerede udløbet"
            value={formatValue(totals.expired, basis)}
            note={`${municipalities.filter((row) => row[basis].expired > 0).length} kommuner`}
            tone="red"
            active={horizon === 'expired'}
            onClick={() => setHorizon('expired')}
          />
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløber i 2026"
            value={formatValue(totals.expires2026, basis)}
            note={`${municipalities.filter((row) => row[basis].expires2026 > 0).length} kommuner`}
            tone="orange"
            active={horizon === '2026'}
            onClick={() => setHorizon('2026')}
          />
          <DeadlineCard
            icon={<CalendarClock size={18} />}
            label="Udløber i 2027"
            value={formatValue(totals.expires2027, basis)}
            note={`${municipalities.filter((row) => row[basis].expires2027 > 0).length} kommuner`}
            tone="yellow"
            active={horizon === '2027'}
            onClick={() => setHorizon('2027')}
          />
          <DeadlineCard
            icon={<CheckCircle2 size={18} />}
            label="Efter 2027 · år mangler"
            value={formatValue(totals.expiresLater, basis)}
            note="Afventer detaljeret datagrundlag"
            tone="green"
            active={Number(horizon) >= 2028}
            onClick={() => setHorizon('2028')}
          />
        </section>

        <Card className="p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">Udløb af energimærker frem til 2037</h2>
              <p className="mt-1 text-xs text-slate-500">Klik på en søjle for at se kommunerne, sorteret efter flest udløb i det valgte år.</p>
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
                labelFormatter={(label) => label === 'Udløbet' ? 'Allerede udløbet' : `Udløber i ${label}`}
              />
              <Bar dataKey="value" name={basis === 'buildings' ? 'Bygninger' : 'Areal'} radius={[5, 5, 0, 0]} maxBarSize={72}>
                {timelineData.map((item) => (
                  <Cell
                    key={item.name}
                    fill={item.color}
                    className="cursor-pointer"
                    onClick={() => setHorizon(item.year)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
            <CalendarClock className="mt-0.5 shrink-0" size={15} />
            <span>
              2028–2037 står foreløbigt på nul, fordi det nuværende ark kun har én samlet kolonne for “efter 2027”.
              De udfyldes og bliver klikbare med faktiske kommuner, når data med præcist udløbsår tilføjes.
            </span>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center">
            <div className="mr-auto">
              <h2 className="text-[15px] font-semibold text-slate-900">Kommuner med udløb i den valgte periode</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {municipalityCount} kommuner · {formatValue(selectedTotal, basis)} · {horizonLabels[horizon]}
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
            <Select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}>
              {Object.entries(horizonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>

          <div className="max-h-[650px] overflow-auto">
            <table className="min-w-[1000px]">
              <thead>
                <tr>
                  <SortableHeader label="Kommune" active={sortKey === 'name'} descending={sortDescending} onClick={() => setSort('name')} />
                  <th>Næste frist</th>
                  <SortableHeader label="Udløbet" active={sortKey === 'expired'} descending={sortDescending} onClick={() => setSort('expired')} align="right" />
                  <SortableHeader label="2026" active={sortKey === 'expires2026'} descending={sortDescending} onClick={() => setSort('expires2026')} align="right" />
                  <SortableHeader label="2027" active={sortKey === 'expires2027'} descending={sortDescending} onClick={() => setSort('expires2027')} align="right" />
                  <th className="num">2028+</th>
                  <th className="num">Uden mærke</th>
                  <SortableHeader label="Valgt periode" active={sortKey === 'selected'} descending={sortDescending} onClick={() => setSort('selected')} align="right" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const data = row[basis]
                  const deadline = nextDeadline(data)
                  return (
                    <tr key={row.cvr}>
                      <td>
                        <div className="font-medium text-slate-900">{row.name}</div>
                        <div className="text-[11px] text-slate-400">CVR {row.cvr}</div>
                      </td>
                      <td>
                        <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', deadline.className)}>
                          {deadline.label}
                        </span>
                      </td>
                      <td className="num font-medium text-red-700">{formatValue(data.expired, basis)}</td>
                      <td className="num text-orange-700">{formatValue(data.expires2026, basis)}</td>
                      <td className="num text-yellow-700">{formatValue(data.expires2027, basis)}</td>
                      <td className="num text-green-700">{formatValue(data.expiresLater, basis)}</td>
                      <td className="num text-slate-500">{formatValue(data.unlabelled, basis)}</td>
                      <td className="num font-semibold text-slate-950">{formatValue(amount(row, basis, horizon), basis)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredRows.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-slate-500">Ingen kommuner matcher den valgte periode.</div>
          )}
        </Card>
      </main>

      <footer className="mx-auto max-w-[1500px] px-6 pb-8 pt-2 text-xs text-slate-400">
        Kilde: Kommunedata_2026-09-03.xlsx
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
  tone: 'red' | 'orange' | 'yellow' | 'green'
  active: boolean
  onClick: () => void
}) {
  const tones = {
    red: 'bg-red-50 text-red-700',
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

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Search } from 'lucide-react'
import { Badge, Button, Card, Input, Select, cn } from './components/ui'
import { fetchDashboardAsset } from './dashboard-assets'
import {
  latestCompleteMonth, marketCount, marketCsv, marketRows, parseMarketActivity,
  type MarketActivityData,
} from './market-data'

const numbers = new Intl.NumberFormat('da-DK')
const percent = new Intl.NumberFormat('da-DK', { style: 'percent', maximumFractionDigits: 1 })
const months = new Intl.DateTimeFormat('da-DK', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dates = new Intl.DateTimeFormat('da-DK', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Copenhagen',
})
const monthLabel = (value: string) => months.format(new Date(`${value}-01T00:00:00Z`))
const usageLabels: Record<string, string> = {
  SingleFamily: 'Enfamiliehuse',
  MultiFamily: 'Flerfamiliebygninger',
  NonResidental: 'Ikke-boligbygninger',
  TradeAndService: 'Handel og service',
  Unknown: 'Type ikke oplyst',
}
const usageLabel = (value: string) => usageLabels[value] ?? value

export default function MarketActivity() {
  const [data, setData] = useState<MarketActivityData | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [monthSelection, setMonthSelection] = useState('')
  const [usage, setUsage] = useState('__all__')
  const [companyId, setCompanyId] = useState('')
  const [chartYear, setChartYear] = useState('__all__')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setData(null)
    fetchDashboardAsset('market-activity.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Markedsdata kunne ikke hentes (${response.status}).`)
        const result = parseMarketActivity(await response.json())
        if (!controller.signal.aborted) setData(result)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Markedsdata kunne ikke hentes.')
      })
    return () => controller.abort()
  }, [attempt])
  const usages = useMemo(() => data
    ? [...new Set(data.companies.flatMap((company) =>
      Object.values(company.counts).flatMap((values) => Object.keys(values))))].sort()
    : [], [data])
  if (error) return (
    <Card className="p-6">
      <p role="alert" className="text-sm text-red-700">{error} Ingen markedsandele vises uden et gyldigt datagrundlag.</p>
      <Button className="mt-4" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Prøv igen</Button>
    </Card>
  )
  if (!data) return <Card role="status" className="p-8 text-sm text-slate-600">Henter markedsaktivitet…</Card>

  const month = data.months.includes(monthSelection) ? monthSelection : latestCompleteMonth(data)
  const { rows, total, previousMonth } = marketRows(data, month, usage)
  const partial = month === data.asOf.slice(0, 7)
  const selectedCompany = data.companies.find((company) => company.id === companyId)
  const normalized = query.trim().toLocaleLowerCase('da-DK')
  const visible = rows.filter((row) => !normalized
    || [row.company.name, row.company.id, ...row.company.aliases]
      .some((name) => name.toLocaleLowerCase('da-DK').includes(normalized)))
  const unknown = rows.find((row) => row.company.id === '__unknown__')?.current ?? 0
  const chartCompanies = selectedCompany ? [selectedCompany] : data.companies
  const years = [...new Set(data.months.map((key) => key.slice(0, 4)))]
  const chartData = data.months.filter((key) => chartYear === '__all__' || key.startsWith(`${chartYear}-`)).map((key) => ({
    month: key,
    label: key.slice(2).replace('-', '/'),
    reports: chartCompanies.reduce((sum, company) => sum + marketCount(company, key, usage), 0),
  }))
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([marketCsv(data, month, usage)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `markedsaktivitet-${month}-${data.asOf}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section aria-label="Markedsaktivitet" className="flex min-w-0 flex-col gap-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Nye gyldige energimærker pr. måned</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Hele Danmark · alle ejerformer og arealstørrelser · fra 1. januar 2025.
              Opgørelsen følger mærkets <strong>gyldighedsstart</strong>, ikke indberetningsdatoen.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={exportCsv}><Download size={14} aria-hidden="true" /> Eksportér måned</Button>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <label className="min-w-0 text-xs font-semibold text-slate-700">
            Måned
            <Select aria-label="Vælg aktivitetsmåned" className="mt-1.5 block max-w-full" value={month} onChange={(event) => setMonthSelection(event.target.value)}>
              {[...data.months].reverse().map((key) => <option key={key} value={key}>{monthLabel(key)}{key === data.asOf.slice(0, 7) ? ' · foreløbig' : ''}</option>)}
            </Select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-slate-700">
            Mærkets anvendelsestype
            <Select aria-label="Vælg mærketype" className="mt-1.5 block max-w-full" value={usage} onChange={(event) => setUsage(event.target.value)}>
              <option value="__all__">Alle typer</option>
              {usages.map((value) => <option key={value} value={value}>{usageLabel(value)}</option>)}
            </Select>
          </label>
          {partial && <Badge color="amber">Foreløbig måned til og med {data.asOf}</Badge>}
        </div>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-t border-slate-200 pt-4 text-sm">
          <div><dt className="text-xs text-slate-600">Fundne rapporter i måneden</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-950" data-testid="market-total">{numbers.format(total)}</dd></div>
          <div><dt className="text-xs text-slate-600">Identificerede firmaer med aktivitet</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{numbers.format(rows.filter((row) => row.current > 0 && row.company.id !== '__unknown__').length)}</dd></div>
          <div><dt className="text-xs text-slate-600">Rapporter uden identificeret firma</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{numbers.format(unknown)}</dd></div>
        </dl>
        <p className="mt-4 text-xs leading-5 text-slate-600">
          Markedsdata opdateret <time dateTime={data.generatedAt}>{dates.format(new Date(data.generatedAt))}</time> (dansk tid).
          {' '}Opdatering planlagt den 1. og 15. i hver måned.
        </p>
      </Card>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950" role="note">
        <strong>Markedsindikator — ikke komplet historisk produktion.</strong>
        {' '}Vi tæller hver fundet rapport én gang. Kun mærker, som datakilden aktuelt returnerer som gyldige,
        indgår. Mærker uden brugbare koordinater samt senere annullerede eller erstattede mærker kan mangle.
        En ny rapport, der retter en tidligere rapport, kan ikke sikkert skelnes fra en ny opgave.
        Tallene viser hverken omsætning, antal opgaver eller en dokumenteret andel af hele markedet.
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{selectedCompany?.name ?? 'Alle firmaer'} · månedlig udvikling</h3>
            <p className="mt-1 text-xs text-slate-600">
              Antal rapporter med gyldighedsstart i måneden. Klik på en søjle for at vælge måned.
              {chartData.at(-1)?.month === data.asOf.slice(0, 7) && ' Sidste viste måned er foreløbig.'}
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-end gap-3">
            <label className="min-w-0 text-xs font-semibold text-slate-700">
              År i graf
              <Select aria-label="Vælg år i aktivitetsgraf" className="mt-1.5 block max-w-full" value={chartYear} onChange={(event) => setChartYear(event.target.value)}>
                <option value="__all__">Alle år</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </Select>
            </label>
            <label className="min-w-0 max-w-full text-xs font-semibold text-slate-700">
              Vis firma i graf
              <Select aria-label="Vælg firma i aktivitetsgraf" className="mt-1.5 block max-w-full sm:max-w-80" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
                <option value="">Alle firmaer</option>
                {data.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </Select>
            </label>
          </div>
        </div>
        <div className="h-[280px] w-full" role="img" aria-label={`Månedlig aktivitet ${chartYear === '__all__' ? 'fra januar 2025' : `i ${chartYear}`} for ${selectedCompany?.name ?? 'alle firmaer'}. De præcise tal findes i tabellen nedenfor.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={15} />
              <YAxis allowDecimals={false} width={50} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={(_label, payload) => {
                const key = payload[0]?.payload?.month
                return typeof key === 'string' ? monthLabel(key) : ''
              }} formatter={(value) => [numbers.format(Number(value)), 'Rapporter']} />
              <Bar dataKey="reports" name="Rapporter" onClick={(_entry, index) => {
                const key = chartData[index]?.month
                if (key) setMonthSelection(key)
              }} cursor="pointer">
                {chartData.map((row) => <Cell key={row.month} fill={row.month === month ? '#1d4ed8' : row.month === data.asOf.slice(0, 7) ? '#94a3b8' : '#60a5fa'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-4 text-xs text-slate-600">
          <summary className="w-fit cursor-pointer font-medium text-blue-700">Vis grafens månedstal som tabel</summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table aria-label="Månedstal for aktivitetsgraf">
              <thead><tr><th>Måned</th><th className="num">Rapporter</th></tr></thead>
              <tbody>{chartData.map((row) => <tr key={row.month}><td>{monthLabel(row.month)}{row.month === data.asOf.slice(0, 7) ? ' (foreløbig)' : ''}</td><td className="num">{numbers.format(row.reports)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Firmaernes aktivitet · {monthLabel(month)}</h3>
            <p className="mt-1 text-xs text-slate-600">Andel af fundne rapporter i den valgte måned og mærketype. Søgning ændrer ikke andelens grundlag.</p>
          </div>
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Søg firma eller firma-ID</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-500" />
            <Input aria-label="Søg firma eller firma-ID" placeholder="Søg firma eller firma-ID" className="w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="max-h-[620px] overflow-auto">
          <table className="min-w-[740px]" aria-label="Firmaernes månedlige markedsaktivitet">
            <thead><tr><th>Firma</th><th className="num">Rapporter</th><th className="num">Andel af fundne</th><th className="num">{previousMonth ? monthLabel(previousMonth) : 'Forrige måned'}</th><th className="num">Ændring</th></tr></thead>
            <tbody>{visible.map((row) => (
              <tr key={row.company.id} className={cn(companyId === row.company.id && 'selected-company')}>
                <td>
                  <button className="text-left font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" onClick={() => setCompanyId(row.company.id)}>{row.company.name}</button>
                  <div className="mt-0.5 text-[11px] text-slate-500">{row.company.id === '__unknown__' ? 'Ikke henført til et kendt firma' : `EMOData firma-ID ${row.company.id}`}</div>
                </td>
                <td className="num">{numbers.format(row.current)}</td>
                <td className="num">{percent.format(row.share)}</td>
                <td className="num">{row.previous === null ? '—' : numbers.format(row.previous)}</td>
                <td className="num">{partial || row.previous === null ? '—' : `${row.current - row.previous > 0 ? '+' : ''}${numbers.format(row.current - row.previous)}`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {!visible.length && <p className="p-6 text-center text-sm text-slate-600">{query ? 'Ingen firmaer matcher søgningen.' : 'Ingen fundne rapporter i den valgte afgrænsning.'}</p>}
        <p className="border-t border-slate-200 px-5 py-3 text-xs leading-5 text-slate-600">
          {partial ? 'Ingen ændring beregnes for den foreløbige måned.' : 'Ændring er forskellen i antal rapporter fra måneden før.'}
          {' '}Firmaer samles efter EMOData-firma-ID, ikke navn eller verificeret CVR.
          {month === data.months[0] && ' December 2024 er uden for dataperioden og sammenlignes ikke.'}
        </p>
      </Card>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Card, Select } from './components/ui'
import { fetchDashboardAsset } from './dashboard-assets'
import {
  CHANGE_LABELS, parseUpdateReport, selectReportChanges, summarizeChanges,
  type ChangeKind, type UpdateReportData,
} from './update-report'

const numbers = new Intl.NumberFormat('da-DK')
const dates = new Intl.DateTimeFormat('da-DK', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Copenhagen',
})
const statusLabels = { valid: 'Gyldigt', expired: 'Udløbet', unlabelled: 'Intet mærke fundet' }
const primaryKinds = ['found', 'replaced', 'expired', 'missing'] as const

export default function UpdateReport({ directory, selectedCvr, municipalityName, generatedAt, asOf }: {
  directory: string
  selectedCvr: string | null
  municipalityName?: string
  generatedAt: string
  asOf: string
}) {
  const [data, setData] = useState<UpdateReportData | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [kind, setKind] = useState<string>('all')
  const [visibleCount, setVisibleCount] = useState(50)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    fetchDashboardAsset('update-report.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Ændringsrapporten kunne ikke hentes (${response.status}).`)
        const report = parseUpdateReport(await response.json())
        if (report.current.generatedAt !== generatedAt || report.current.asOf !== asOf) {
          throw new Error('Ændringsrapporten og kommunedata er fra forskellige opdateringer.')
        }
        if (!controller.signal.aborted) setData(report)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Ændringsrapporten kunne ikke hentes.')
      })
    return () => controller.abort()
  }, [attempt, asOf, generatedAt])
  useEffect(() => { setVisibleCount(50) }, [directory, selectedCvr, kind])

  let changes = null
  let selectionError = ''
  if (data) {
    try {
      changes = selectReportChanges(data, directory, selectedCvr)
    } catch (reason: unknown) {
      selectionError = reason instanceof Error ? reason.message : 'Afgrænsningen kunne ikke læses.'
    }
  }
  const problem = error || selectionError
  if (problem) return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold text-slate-900">Siden sidste opdatering</h2>
      <p role="alert" className="mt-2 text-sm text-red-700">{problem} Ændringer vises ikke uden et sammenligneligt datagrundlag.</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAttempt((value) => value + 1)}>Prøv igen</Button>
    </Card>
  )
  if (!data) return <Card role="status" className="p-5 text-sm text-slate-600">Henter rapporten fra sidste opdatering…</Card>
  if (changes === null) return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold text-slate-900">Siden sidste opdatering</h2>
      <p className="mt-2 text-sm text-slate-600">Der findes endnu ikke et sammenligneligt tidligere udtræk for denne afgrænsning. Det er ikke det samme som ingen ændringer.</p>
    </Card>
  )
  const { counts, companies } = summarizeChanges(changes)
  const visible = changes.filter((change) => kind === 'all' || change.kind === kind)
  const formatDate = (value: string) => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString('da-DK', { timeZone: 'UTC' }) : '—'
  return (
    <Card className="p-5">
      <section aria-label="Siden sidste opdatering">
        <details className="group/report">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Siden sidste opdatering</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              <time dateTime={data.previous.generatedAt}>{dates.format(new Date(data.previous.generatedAt))}</time>
              {' → '}<time dateTime={data.current.generatedAt}>{dates.format(new Date(data.current.generatedAt))}</time> (dansk tid)
              {' · '}{municipalityName ?? 'Alle kommuner'} · valgte ejer- og arealfilter.
            </p>
          </div>
          <span className="flex items-center gap-3">
            <span className="text-xs text-slate-600" data-testid="update-report-total">{numbers.format(changes.length)} bygninger med ændringer</span>
            <ChevronDown size={16} className="shrink-0 text-blue-700 group-open/report:rotate-180" aria-hidden="true" />
          </span>
        </summary>
        <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4 border-t border-slate-200 pt-4">
          {primaryKinds.map((value) => (
            <div key={value}>
              <dt className="text-xs text-slate-600">{CHANGE_LABELS[value]}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-950" data-testid={`update-report-${value}`}>{numbers.format(counts[value])}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-5 text-slate-600">
          Datagrundlag: {numbers.format(counts.added)} bygninger tilføjet, {numbers.format(counts.removed)} udgået
          {' og '}{numbers.format(counts.updated)} med øvrige dataændringer.
          {changes.length === 0 && ' Ingen registrerede ændringer i den valgte afgrænsning.'}
        </p>
        <p className="mt-2 max-w-5xl text-xs leading-5 text-slate-600">
          Tallene er ændringer i kommunernes bygningsudtræk, ikke aktivitet i hele markedet.
          Et først fundet eller skiftet mærke er ikke nødvendigvis en ny kundeopgave; det kan også skyldes en rettelse eller et nyt datamatch.
          Et mærke, der ikke længere findes i udtrækket, er ikke nødvendigvis annulleret.
          Rapportperioden følger opdateringerne, ikke det valgte udløbsår.
        </p>
        <details className="mt-4 border-t border-slate-200 pt-3">
          <summary className="w-fit cursor-pointer text-xs font-medium text-blue-700">Se ændringer og firmaer</summary>
          {companies.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-900">Firmaer på først fundne og skiftede mærker</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">Hver rapport tælles én gang pr. firma, selv om den dækker flere bygninger. Firmaer grupperes efter det registrerede navn — ikke verificeret CVR.</p>
              <div className="mt-2 max-h-64 overflow-auto">
                <table aria-label="Firmaer bag ændrede mærker">
                  <thead><tr><th>Firma</th><th className="num">Forskellige rapporter</th><th className="num">Bygninger</th></tr></thead>
                  <tbody>{companies.map((company) => <tr key={company.name}><td>{company.name}</td><td className="num">{numbers.format(company.reports)}</td><td className="num">{numbers.format(company.buildings)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Ændrede bygninger</h3>
            <label className="text-xs font-semibold text-slate-700">
              Vis ændringstype
              <Select aria-label="Vælg ændringstype i opdateringsrapport" className="ml-2" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="all">Alle ændringer</option>
                {(Object.keys(CHANGE_LABELS) as ChangeKind[]).map((value) => <option key={value} value={value}>{CHANGE_LABELS[value]} ({numbers.format(counts[value])})</option>)}
              </Select>
            </label>
          </div>
          <div className="mt-3 max-h-[520px] overflow-auto">
            <table className="min-w-[1000px]" aria-label="Bygningsændringer siden sidste opdatering">
              <thead><tr><th>Kommune / adresse</th><th>Ændring</th><th>Før</th><th>Nu</th><th>Firma nu</th></tr></thead>
              <tbody>{visible.slice(0, visibleCount).map((change) => {
                const building = change.after ?? change.before
                return <tr key={`${change.cvr}/${change.key}`}>
                  <td><span className="font-medium text-slate-900">{building?.address || 'Adresse ikke oplyst'}</span><div className="mt-0.5 text-xs text-slate-500">{building?.postalCode} · {change.municipality}</div><div className="text-xs text-slate-500">Bygnings-ID: {change.key}</div></td>
                  <td>{CHANGE_LABELS[change.kind]}</td>
                  {[change.before, change.after].map((value, index) => <td key={index}>
                    {value ? <>
                      <span>{value.energyLabel ? `EM ${value.energyLabel}` : 'Intet mærke'}</span>
                      <div className="mt-0.5 text-xs text-slate-500">{statusLabels[value.status]} · udløb {formatDate(value.validTo)}</div>
                      <div className="text-xs text-slate-500">{numbers.format(value.area)} m² · {value.companyName || 'Firma ikke oplyst'}</div>
                      {(change.before?.address !== change.after?.address || change.before?.postalCode !== change.after?.postalCode)
                        && <div className="text-xs text-slate-500">{value.address} · {value.postalCode}</div>}
                      {(change.before?.ownershipType !== change.after?.ownershipType || change.before?.primaryOwner !== change.after?.primaryOwner)
                        && <div className="text-xs text-slate-500">{value.ownershipType === 'direct' ? 'Direkte ejer' : value.ownershipType === 'co-owner' ? 'Medejer' : value.ownershipType || 'Ejerskab ikke oplyst'} · {value.primaryOwner || 'Ejer ikke oplyst'}</div>}
                    </> : 'Ikke i udtrækket'}
                  </td>)}
                  <td>{change.after?.companyName || '—'}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
          {visible.length === 0 && <p className="py-4 text-sm text-slate-600">Ingen registrerede ændringer af den valgte type.</p>}
          {visibleCount < visible.length && <Button variant="secondary" size="sm" className="mt-3" onClick={() => setVisibleCount((value) => value + 50)}>Vis 50 flere ({numbers.format(visible.length - visibleCount)} tilbage)</Button>}
        </details>
        </details>
      </section>
    </Card>
  )
}

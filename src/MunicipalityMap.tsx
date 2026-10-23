import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button, Card, Select } from './components/ui'
import { fetchDashboardAsset } from './dashboard-assets'
import {
  combineMapSummaries,
  MAP_COLORS,
  mapColor,
  mapShare,
  type MapData,
} from './map-data'

type Municipality = { name: string; cvr: string; municipalityCode: string }
type Props = {
  municipalities: Municipality[]
  selectedCvr: string | null
  directory: string
  asOf: string
  generatedAt: string
  onSelect: (cvr: string | null) => void
  onBuildings: () => void
}
const numbers = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })
const percentages = new Intl.NumberFormat('da-DK', { style: 'percent', maximumFractionDigits: 1 })
const MAP_WIDTH = 1000
const MAP_HEIGHT = 850

export default function MunicipalityMap({
  municipalities, selectedCvr, directory, asOf, generatedAt, onSelect, onBuildings,
}: Props) {
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [hoveredCvr, setHoveredCvr] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; centerX: number; centerY: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    fetchDashboardAsset('map-summary.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Kortdata kunne ikke hentes (${response.status})`)
        const payload: MapData = await response.json()
        if (payload.asOf !== asOf || payload.generatedAt !== generatedAt
          || !Array.isArray(payload.shapes) || payload.shapes.length !== 98 || !payload.scopes) {
          throw new Error('Kortdata og dashboard har ikke samme datagrundlag. Genindlæs siden.')
        }
        if (!controller.signal.aborted) setData(payload)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'Kortdata kunne ikke hentes')
      })
    return () => controller.abort()
  }, [asOf, generatedAt, attempt])

  const summaries = data?.scopes[directory]
  const selected = municipalities.find((row) => row.cvr === selectedCvr)
  const summary = useMemo(() => summaries
    ? selected ? summaries[selected.cvr] : combineMapSummaries(Object.values(summaries))
    : undefined, [summaries, selected])
  const municipalitiesByCode = new Map(municipalities.map((row) => [row.municipalityCode, row]))
  const hovered = municipalities.find((row) => row.cvr === hoveredCvr)
  const hoveredSummary = hovered && summaries?.[hovered.cvr]
  const share = summary ? mapShare(summary) : null
  const width = MAP_WIDTH / zoom
  const height = MAP_HEIGHT / zoom
  const constrainedCenter = {
    x: Math.max(width / 2, Math.min(MAP_WIDTH - width / 2, center.x)),
    y: Math.max(height / 2, Math.min(MAP_HEIGHT - height / 2, center.y)),
  }
  const resetMap = () => {
    setZoom(1)
    setCenter({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 })
  }
  const chooseMunicipality = (cvr: string) => {
    if (!suppressClick.current) onSelect(cvr)
  }
  const missingData = data && (!summaries
    || municipalities.some((row) => !summaries[row.cvr])
    || data.shapes.some((shape) => !municipalitiesByCode.has(shape.code)))

  if (error || missingData) {
    return (
      <Card className="p-6">
        <p role="alert" className="text-sm text-red-700">
          {error || 'Kortet mangler kommuner i den valgte afgrænsning.'}
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igen
        </Button>
      </Card>
    )
  }
  if (!data || !summaries || !summary) {
    return <Card className="p-8 text-sm text-slate-600" role="status">Henter Danmarkskort…</Card>
  }

  return (
    <Card className="overflow-hidden" aria-label="Danmarkskort over energimærker">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">Energimærker på tværs af Danmark</h2>
        <p className="mt-1 text-sm text-slate-600">
          Farven viser andelen af opvarmet BBR-areal med gyldigt energimærke. Vælg en kommune på kortet eller i listen.
        </p>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_350px]">
        <div className="flex min-w-0 flex-col bg-slate-50">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-600">98 kommuner · Zoom ind for at vælge små kommuner</p>
            <div className="flex items-center gap-1" role="group" aria-label="Kortets zoom">
              <Button variant="secondary" size="sm" aria-label="Zoom ud" disabled={zoom === 1} onClick={() => setZoom((value) => Math.max(1, value - 1))}>
                <Minus size={15} aria-hidden="true" />
              </Button>
              <Button variant="secondary" size="sm" aria-label="Zoom ind" disabled={zoom === 5} onClick={() => setZoom((value) => Math.min(5, value + 1))}>
                <Plus size={15} aria-hidden="true" />
              </Button>
              <Button variant="secondary" size="sm" onClick={resetMap}>
                <RotateCcw size={13} aria-hidden="true" /> Nulstil kort
              </Button>
            </div>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`${constrainedCenter.x - width / 2} ${constrainedCenter.y - height / 2} ${width} ${height}`}
              className="municipality-map h-[430px] w-full sm:h-[600px] lg:h-[640px]"
              style={{ touchAction: zoom > 1 ? 'none' : 'pan-y', cursor: zoom > 1 ? 'grab' : undefined }}
              role="group"
              aria-label="Vælg kommune. Brug tabulatortasten og Enter, eller kommunelisten."
              onPointerDown={(event) => {
                suppressClick.current = false
                if (zoom <= 1 || event.button !== 0) return
                drag.current = { x: event.clientX, y: event.clientY, centerX: constrainedCenter.x, centerY: constrainedCenter.y, moved: false }
              }}
              onPointerMove={(event) => {
                const start = drag.current
                const svg = svgRef.current
                if (!start || !svg) return
                const dx = event.clientX - start.x
                const dy = event.clientY - start.y
                if (Math.abs(dx) + Math.abs(dy) < 5 && !start.moved) return
                start.moved = true
                suppressClick.current = true
                svg.setPointerCapture(event.pointerId)
                const rect = svg.getBoundingClientRect()
                const scale = Math.min(rect.width / width, rect.height / height)
                setCenter({ x: start.centerX - dx / scale, y: start.centerY - dy / scale })
              }}
              onPointerUp={(event) => {
                drag.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { drag.current = null }}
            >
              {data.shapes.map((shape) => {
                const municipality = municipalitiesByCode.get(shape.code)!
                const value = summaries[municipality.cvr]
                const percent = mapShare(value)
                const label = `${municipality.name}: ${percent === null ? 'ingen bygninger med opvarmet areal' : `${percentages.format(percent)} af arealet med gyldigt mærke`}`
                return (
                  <path
                    key={shape.code}
                    d={shape.path}
                    fill={mapColor(percent)}
                    fillRule="evenodd"
                    vectorEffect="non-scaling-stroke"
                    stroke={selectedCvr === municipality.cvr ? '#1d4ed8' : '#475569'}
                    strokeWidth={selectedCvr === municipality.cvr ? 2.5 : 0.7}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    aria-pressed={selectedCvr === municipality.cvr}
                    className="municipality-shape"
                    onMouseEnter={() => setHoveredCvr(municipality.cvr)}
                    onMouseLeave={() => setHoveredCvr(null)}
                    onFocus={() => setHoveredCvr(municipality.cvr)}
                    onBlur={() => setHoveredCvr(null)}
                    onClick={() => chooseMunicipality(municipality.cvr)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(municipality.cvr)
                      }
                    }}
                  >
                    <title>{label}</title>
                  </path>
                )
              })}
            </svg>
            {hovered && hoveredSummary && (
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 w-fit max-w-[calc(100%-1.5rem)] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm" role="status">
                <strong>{hovered.name}</strong>
                <span className="ml-2">
                  {mapShare(hoveredSummary) === null ? 'Ingen bygninger med opvarmet areal'
                    : `${percentages.format(mapShare(hoveredSummary)!)} af arealet med gyldigt mærke`}
                </span>
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <h3 className="text-xs font-semibold text-slate-800">Andel af m² med gyldigt mærke</h3>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
              {MAP_COLORS.map((color, index) => (
                <li key={color} className="flex items-center gap-1.5">
                  <span className="h-3 w-5 rounded-sm border border-slate-500/30" style={{ backgroundColor: color }} />
                  {index * 20}–{(index + 1) * 20} %
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="h-3 w-5 rounded-sm border border-slate-300 bg-slate-200" /> Intet opvarmet areal
              </li>
            </ul>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              20, 40, 60 og 80 % hører til næste interval. 100 % er med i sidste interval.
              {' '}Kort: <a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer" className="underline">geoBoundaries</a>
              {' '}/ Wikimedia Commons, kommunegrænser fra 2018 (Public Domain).
            </p>
          </div>
        </div>
        <aside className="min-w-0 border-t border-slate-200 bg-white p-5 lg:border-l lg:border-t-0" aria-label="Oplysninger om valgt kommune">
          <label htmlFor="map-municipality" className="mb-1.5 block text-xs font-semibold text-slate-700">Vælg kommune</label>
          <Select id="map-municipality" className="w-full" value={selectedCvr ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
            <option value="">Alle kommuner</option>
            {municipalities.map((row) => <option key={row.cvr} value={row.cvr}>{row.name}</option>)}
          </Select>
          <div className="mt-6" aria-live="polite" aria-atomic="true">
            <h3 className="flex items-start gap-2 text-base font-semibold text-slate-950">
              <MapPin size={18} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
              {selected?.name ?? 'Alle kommuner'}
            </h3>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-800">
              {share === null ? 'Intet areal' : percentages.format(share)}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {share === null ? 'Ingen bygninger med opvarmet areal i denne afgrænsning.'
                : 'af det opvarmede BBR-areal har et gyldigt energimærke.'}
            </p>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table aria-label="Energimærkestatus i valgt kommune">
              <thead><tr><th className="pl-0">Status</th><th className="num">Bygninger</th><th className="num pr-0">m²</th></tr></thead>
              <tbody>
                {([['valid', 'Gyldigt'], ['expired', 'Udløbet'], ['unlabelled', 'Mangler']] as const).map(([key, label]) => (
                  <tr key={key}><td className="pl-0">{label}</td><td className="num">{numbers.format(summary[key].buildings)}</td><td className="num pr-0">{numbers.format(summary[key].area)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="pl-0">I alt</td><td className="num">{numbers.format(summary.total.buildings)}</td><td className="num pr-0">{numbers.format(summary.total.area)}</td></tr>
              </tbody>
            </table>
          </div>
          <h4 className="mb-2 mt-6 text-xs font-semibold text-slate-800">Udløb af gyldige mærker</h4>
          {Object.keys(summary.years).length ? (
            <div className="max-h-56 overflow-auto">
              <table aria-label="Udløbsår for gyldige energimærker">
                <thead><tr><th className="pl-0">År</th><th className="num">Bygninger</th><th className="num pr-0">m²</th></tr></thead>
                <tbody>{Object.entries(summary.years).sort(([a], [b]) => a.localeCompare(b)).map(([year, value]) => (
                  <tr key={year}><td className="pl-0">{year}</td><td className="num">{numbers.format(value.buildings)}</td><td className="num pr-0">{numbers.format(value.area)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-600">Ingen gyldige mærker i denne afgrænsning.</p>}
          <Button className="mt-5 w-full" disabled={!selected} onClick={onBuildings}>
            <MapPin size={14} aria-hidden="true" /> Vis bygningsliste
          </Button>
          {!selected && <p className="mt-2 text-xs text-slate-600">Vælg en kommune for at åbne dens bygninger.</p>}
          <p className="mt-4 text-[11px] leading-5 text-slate-600">
            Areal = BBR-boligareal + erhvervsareal. Procenten er arealvægtet, ikke andelen af bygninger.
            Mangler betyder, at intet mærke er fundet i kilderne, ikke et fastslået lovbrud.
          </p>
        </aside>
      </div>
    </Card>
  )
}

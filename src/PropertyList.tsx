import { Badge } from './components/ui'
import type { PropertyGroup, PropertyBuilding } from './properties'

type DetailBuilding = PropertyBuilding & {
  energyLabel: string
  companyName?: string
  primaryOwner?: string
  ownershipType?: 'direct' | 'co-owner'
  reportUrl: string
}

const number = new Intl.NumberFormat('da-DK')
const date = new Intl.DateTimeFormat('da-DK')
const statusLabels = { valid: 'Alle har gyldigt mærke', expired: 'Udløbet mærke', unlabelled: 'Mangler mærke' }
const dateLabel = (value: string) => value ? date.format(new Date(`${value}T12:00:00`)) : '—'

export default function PropertyList({ properties }: { properties: PropertyGroup<DetailBuilding>[] }) {
  return (
    <div className="max-h-[620px] overflow-auto">
      <table className="min-w-[1100px]" aria-label="Ejendomme grupperet efter adresse">
        <thead>
          <tr>
            <th>Adresse · fold ud for bygninger</th>
            <th>Status for adressen</th>
            <th>Styrende udløb</th>
            <th className="num">Bygninger</th>
            <th className="num">Opvarmet BBR-areal</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((property) => (
            <tr key={property.key}>
              <td className="whitespace-normal">
                <details>
                  <summary className="cursor-pointer rounded-sm font-medium text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">
                    {property.address || 'Adresse ikke oplyst'} · {property.postalCode || 'Postnr. ikke oplyst'}
                  </summary>
                  <ul className="mt-3 space-y-3 text-xs text-slate-600">
                    {property.buildings.map((building, index) => (
                      <li key={`${building.bfe}-${building.buildingNumber}-${index}`}>
                        <p className="font-semibold text-slate-900">
                          Bygning {building.buildingNumber || 'ikke oplyst'} · {number.format(building.area)} m²
                        </p>
                        <p>BFE: {building.bfe || 'ikke oplyst'} · {building.ownershipType === 'co-owner' ? `Medejer · primær ejer: ${building.primaryOwner || 'ikke oplyst'}` : 'Direkte ejer'}</p>
                        <p>
                          {building.status === 'valid' ? 'Gyldigt mærke' : statusLabels[building.status]}
                          {' · '}Gyldig til: {dateLabel(building.validTo)}
                          {' · '}EM: {building.energyLabel || 'ikke fundet'}
                        </p>
                        <p>{building.companyName || 'Firma ikke oplyst'}{building.reportUrl && (
                          <> · <a className="font-medium text-blue-700 underline" href={building.reportUrl} target="_blank" rel="noreferrer">Åbn rapport</a></>
                        )}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              </td>
              <td><Badge color={property.status === 'valid' ? 'green' : property.status === 'expired' ? 'amber' : 'red'}>{statusLabels[property.status]}</Badge></td>
              <td>{dateLabel(property.validTo)}</td>
              <td className="num">{number.format(property.buildings.length)}</td>
              <td className="num">{number.format(property.area)} m²</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

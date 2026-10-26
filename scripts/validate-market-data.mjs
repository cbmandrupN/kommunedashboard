import { readFile } from 'node:fs/promises'
import { parseMarketActivity } from '../src/market-data.ts'

const data = parseMarketActivity(JSON.parse(await readFile(
  new URL('../public/market-activity.json', import.meta.url), 'utf8',
)))
if (!data.quality.includedReports || !data.companies.some((company) => company.id !== '__unknown__')) {
  throw new Error('Refusing to publish a market snapshot without identifiable firm activity')
}
console.log(`Validated market activity: ${data.months.length} months, ${data.companies.length} firms, ${data.quality.includedReports} reports.`)

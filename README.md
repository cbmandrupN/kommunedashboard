# Kommunedashboard

Selvstændigt dashboard baseret på `Kommunedata_2026-09-03.xlsx`. Appen har ingen kobling
til Ressourceplatformens frontend eller backend.

```powershell
cd kommunedashboard
npm install
npm run dev
```

Opret en produktionsversion med `npm run build`. Den færdige statiske app ligger i
`dist` og kan deles via eksempelvis GitHub Pages, Azure Static Web Apps eller en intern
webserver.

## Datagrundlag

Dashboardet tæller unikke energimærker og viser deres udløbsår. Den reducerede
`data/municipality-inventory.json.gz` indeholder kun kommune, CVR, kommunekode, BFE,
bygningsnummer og areal. Adresser og øvrige råfelter offentliggøres ikke.

Et nyt ejerudtræk importeres lokalt:

```powershell
python scripts\pipeline.py --as-of 2026-09-04 import-workbook `
  C:\sti\til\building-list.xlsx `
  --municipalities data\municipalities.json `
  --inventory data\municipality-inventory.json.gz `
  --dashboard src\data\dashboard-data.json
```

Den manuelle GitHub Action **Update EMOData** henter derefter seneste energimærker,
matcher dem mod inventaret og genudgiver dashboardet. Repositoryet skal have de
krypterede secrets `EMODATA_USERNAME` og `EMODATA_PASSWORD`.

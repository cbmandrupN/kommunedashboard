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

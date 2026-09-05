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

Dashboardet tæller bygninger, hvor energimærket udløber, og viser deres udløbsår. Det viser
også bygninger, der mangler et gyldigt mærke: bygninger uden et fundet mærke plus bygninger
med et udløbet mærke.

Inventaret er afgrænset til kommunalt ejede bygninger med mere end 250 m² samlet bolig- og
erhvervsareal, jf. § 19 i
[lovbekendtgørelse nr. 1253 af 22. oktober 2025](https://www.retsinformation.dk/eli/lta/2025/1253).
Følgende frasorteres automatisk:

- BBR-anvendelseskoderne 211-219, 221-223, 229, 231-234, 239, 414, 510, 540, 585, 910, 920 og 930.
- Bygninger markeret som fredede.
- Bygninger registreret uden varmeinstallation.
- Bygninger på 250 m² eller derunder, som ikke er omfattet af den regelmæssige mærkningspligt for offentlige bygninger.

Reglerne følger §§ 3-5 i
[bekendtgørelse nr. 549 af 15. maj 2023](https://www.retsinformation.dk/eli/lta/2023/549)
og [Energistyrelsens HBEMO-vejledning](https://www.hbemo.dk/vejledning/faq/bekendtgoerelse-om-energimaerkning-af-bygninger).
Registreringen "ingen varmeinstallation" bruges som proxy for, at der ikke anvendes energi
til rumklima; eventuel køling kan ikke udledes af kildedata.

Nedrivningshensigt, opvarmet areal under 60 m²/højst 25 %, væsentlige mangler i varmeanlæg
eller klimaskærm og andre konkrete undtagelser kan ikke afgøres af udtrækket og kræver manuel
kontrol. Overblikket er derfor et screeningsværktøj og ikke en juridisk afgørelse.

Den reducerede
`data/municipality-inventory.json.gz` indeholder kun kommune, CVR, kommunekode, BFE,
bygningsnummer og areal. Adresser og øvrige råfelter offentliggøres ikke.

Et nyt ejerudtræk importeres lokalt:

```powershell
python scripts\pipeline.py --as-of 2026-09-04 import-workbook `
  C:\sti\til\building-list.xlsx `
  --municipalities data\municipalities.json `
  --inventory data\municipality-inventory.json.gz `
  --dashboard src\data\dashboard-data.json `
  --exports public\exports
```

Den manuelle GitHub Action **Update EMOData** henter derefter seneste energimærker,
matcher dem mod inventaret, opdaterer de kommunevise Excel-udtræk og genudgiver
dashboardet. Excel-filerne indeholder adresse, postnummer, BFE, bygningsnummer,
areal, EM-nummer, udløbsdato og status. Repositoryet skal have de
krypterede secrets `EMODATA_USERNAME` og `EMODATA_PASSWORD`.

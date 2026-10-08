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

## Adgangskode

GitHub Pages-publiceringen viser først en kodeside. Deploy-workflowet kræver
repository-secret `DASHBOARD_PASSWORD` og stopper, hvis den mangler. Koden må ikke
gemmes i kildekode, JSON eller en `VITE_`-variabel.

Efter det normale build krypterer `node scripts/protect-site.mjs` alle dashboardets
filer, inklusive bygnings-JSON og Excel-udtræk, med AES-256-GCM og en nøgle afledt
med PBKDF2-SHA-256 (600.000 iterationer og tilfældigt salt). Browseren dekrypterer
kun efter korrekt kode; kommunefiler hentes efter behov. Koden gemmes ikke i
browserlager. Genindlæsning, lukning eller **Lås dashboard** kræver koden igen.
Lokale udviklingsbuild er uændrede og ikke kodebeskyttede.

**Begrænsning:** Kildedata og tidligere versioner ligger i et offentligt
GitHub-repository. Kodesiden beskytter den publicerede sides aktuelle filer,
ikke offentlige repository-filer, gamle downloads eller tidligere klonede data.
Fortrolige data kræver privat kildeopbevaring og hosting med serverbaseret
adgangskontrol. En fælles kode giver heller ikke individuel adgang eller
serverbaseret begrænsning af kodeforsøg.

## Datagrundlag

Dashboardet tæller bygninger, hvor energimærket udløber, og viser deres udløbsår. Det viser
også bygninger, der mangler et gyldigt mærke: bygninger uden et fundet mærke plus bygninger
med et udløbet mærke.

Standardvisningen er afgrænset til kommunalt ejede bygninger med mere end 250 m² opvarmet
BBR-areal. Dashboardet beregner dette som summen af registreret boligareal og erhvervsareal,
jf. § 19 i
[lovbekendtgørelse nr. 1253 af 22. oktober 2025](https://www.retsinformation.dk/eli/lta/2025/1253).
Dashboardets arealvælger kan desuden vise et foreløbigt scenarie fra 60 m², så bygninger
på 60–250 m² kan indgå i planlægningen frem mod en mulig regelændring. Scenariet er ikke
en angivelse af gældende ret. Valget **60–250 m²** viser kun bygninger i dette interval,
inklusive begge grænser, mens **Fra 60 m²** fortsat medtager de større bygninger.
Valget gælder grafer, kommuneoversigt, firmaanalyse, bygningsliste og begge eksporttyper.
En separat ejerskabsvælger kan medtage bygninger, hvor
kommunen står under øvrige ejere i kildedata. Begge valg kan slås til og fra uafhængigt.
Følgende frasorteres automatisk:

- BBR-anvendelseskoderne 211-219, 221-223, 229, 231-234, 239, 414, 510, 540, 585, 910, 920 og 930.
- Bygninger markeret som fredede.
- Bygninger registreret uden varmeinstallation.
- Bygninger under den valgte grænse for opvarmet BBR-areal.

Reglerne følger §§ 3-5 i
[bekendtgørelse nr. 549 af 15. maj 2023](https://www.retsinformation.dk/eli/lta/2023/549)
og [Energistyrelsens HBEMO-vejledning](https://www.hbemo.dk/vejledning/faq/bekendtgoerelse-om-energimaerkning-af-bygninger).
Registreringen "ingen varmeinstallation" bruges som proxy for, at der ikke anvendes energi
til rumklima; eventuel køling kan ikke udledes af kildedata.

Nedrivningshensigt, opvarmet areal under 60 m²/højst 25 %, væsentlige mangler i varmeanlæg
eller klimaskærm og andre konkrete undtagelser kan ikke afgøres af udtrækket og kræver manuel
kontrol. Overblikket er derfor et screeningsværktøj og ikke en juridisk afgørelse.

Den komprimerede `data/municipality-inventory.json.gz` indeholder kun de felter, der skal
bruges til matchning og udtræk: kommune, CVR, kommunekode, BFE, bygningsnummer, opvarmet
BBR-areal (boligareal plus erhvervsareal),
adresse, ejerskabstype, primær ejer samt kildens seneste EM-nummer og udløbsdato.
Ejerandele og øvrige råfelter offentliggøres ikke. En bygning medtages både, når kommunen
står som direkte ejer med sit eget CVR, og når kommunen er anført under øvrige ejere.
Fællesejede bygninger kan derfor optræde hos mere end én kommune.
Inventaret indeholder alle tre arealscenarier, mens de kommunevise filer skrives separat til
`public/buildings`/`public/exports`, `public/buildings-from-60`/`public/exports-from-60`,
`public/buildings-with-coowners`/`public/exports-with-coowners` og
`public/buildings-from-60-with-coowners`/`public/exports-from-60-with-coowners`,
`public/buildings-60-250`/`public/exports-60-250` og
`public/buildings-60-250-with-coowners`/`public/exports-60-250-with-coowners`.

Et nyt ejerudtræk importeres lokalt:

```powershell
python scripts\pipeline.py --as-of 2026-09-04 import-workbook `
  C:\sti\til\building-list.xlsx `
  --municipalities data\municipalities.json `
  --inventory data\municipality-inventory.json.gz `
  --dashboard src\data\dashboard-data.json `
  --exports public\exports `
  --building-data public\buildings
```

GitHub Action **Update EMOData** kører automatisk den første dag i hver måned
kl. 03.17 UTC og kan også startes manuelt. Den henter seneste energimærker,
matcher dem mod inventaret og slår energimærkningsfirmaet op via Energistyrelsens
offentlige Tjek Energimærke. Derefter opdateres de kommunevise Excel-udtræk, og
dashboardet genudgives. Den kompakte note "Data sidst opdateret" i sidens topbjælke
viser datasættets `generatedAt` i dansk tid på både mobil og desktop, mens `asOf`
viser energimærkernes opgørelsesdato i sidefoden.
Noten ændres automatisk ved publicering af et nyt datasæt; den viser
ikke tidspunktet for sidebesøget. Ejer- og BBR-oplysninger følger fortsat det
importerede kommunale udtræk.
Excel-filerne indeholder adresse, postnummer, BFE,
bygningsnummer, opvarmet BBR-areal, EM-nummer, energimærkningsfirma, udløbsdato og status.
De samme bygningsoplysninger genereres som kommunevise JSON-filer til den
søgbare bygningsliste i dashboardet. Rapporten kan åbnes direkte fra
bygningslisten, og kommunevisningen opsummerer antal rapporter og omfattede
bygninger pr. energimærkningsfirma. Den landsdækkende firmaanalyse viser
desuden firmaernes markedsandel blandt sikkert matchede rapporter, antal
rapporter, omfattede bygninger og m², udløbsfordeling samt kommunevis
aktivitet. Fra kommuneoversigten kan den valgte kommunes bygningsliste åbnes
med et præcist filter på firmaet.
Hvis en bygning ikke kan matches i EMOData, bruges energimærket fra det
oprindelige kommunale udtræk som fallback.
Repositoryet skal have de
krypterede secrets `EMODATA_USERNAME` og `EMODATA_PASSWORD`.

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

Standardvisningen er afgrænset til kommunalt ejede bygninger med mere end 250 m² opvarmet
BBR-areal. Dashboardet beregner dette som summen af registreret boligareal og erhvervsareal,
jf. § 19 i
[lovbekendtgørelse nr. 1253 af 22. oktober 2025](https://www.retsinformation.dk/eli/lta/2025/1253).
Dashboardets arealvælger kan desuden vise et foreløbigt scenarie fra 60 m², så bygninger
på 60–250 m² kan indgå i planlægningen frem mod en mulig regelændring. Scenariet er ikke
en angivelse af gældende ret. En separat ejerskabsvælger kan medtage bygninger, hvor
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
Inventaret indeholder begge arealscenarier, mens de kommunevise filer skrives separat til
`public/buildings`/`public/exports`, `public/buildings-from-60`/`public/exports-from-60`,
`public/buildings-with-coowners`/`public/exports-with-coowners` og
`public/buildings-from-60-with-coowners`/`public/exports-from-60-with-coowners`.

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
offentlige Tjek Energimærke. Den tilknyttede energikonsulent hentes fra EMOData
på rapportens EM-nummer. Derefter opdateres de kommunevise Excel-udtræk, og
dashboardet genudgives. Excel-filerne indeholder adresse, postnummer, BFE,
bygningsnummer, opvarmet BBR-areal, EM-nummer, energimærkningsfirma, energikonsulent,
udløbsdato og status.
De samme bygningsoplysninger genereres som kommunevise JSON-filer til den
søgbare bygningsliste i dashboardet. Rapporten kan åbnes direkte fra
bygningslisten, og kommunevisningen opsummerer antal rapporter og omfattede
bygninger pr. energimærkningsfirma. Den landsdækkende firmaanalyse viser
desuden firmaernes markedsandel blandt sikkert matchede rapporter, antal
rapporter, omfattede bygninger og m², udløbsfordeling samt kommunevis
aktivitet. Analysen kan skiftes til konsulentniveau, hvor samme opgørelser vises
for den enkelte konsulent og det tilknyttede firma. Fra kommuneoversigten kan den
valgte kommunes bygningsliste åbnes med et præcist filter på firma eller konsulent.
Hvis en bygning ikke kan matches i EMOData, bruges energimærket fra det
oprindelige kommunale udtræk som fallback.
Repositoryet skal have de
krypterede secrets `EMODATA_USERNAME` og `EMODATA_PASSWORD`.

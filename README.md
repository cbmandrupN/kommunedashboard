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
browserlager. Genindlæsning eller genåbning af siden kræver koden igen.
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
Den valgte afgrænsning og antal bygninger vises kompakt over grafen.
**Om datagrundlaget** kan foldes ud for beregningsregler, kilder og forbehold.
De fem nøgletal følger den valgte kommune og areal-/ejerskabsfiltrene, ligesom grafen.
**Vis alle kommuner** skifter nøgletallene tilbage til landstal.

Fanen **Kort** viser alle 98 kommuner på et Danmarkskort. Farverne angiver gyldigt
energimærket opvarmet BBR-areal divideret med hele det medtagne opvarmede BBR-areal,
ikke andelen af bygninger. Areal og ejerskab følger de samme filtre som **Oversigt**.
Vælg en kommune med mus, tastatur eller kommunelisten for at se status i antal og m²
samt udløbsår. **Vis bygningsliste** åbner kommunens bygninger i oversigten uden
års- eller firmafilter. Zoomknapper og træk i det forstørrede kort gør små kommuner
tilgængelige. Grå angiver, at der ikke er opvarmet areal i den valgte afgrænsning.

Kortsummerne genereres automatisk før udviklingsserver og build fra de samme
kommunevise bygningsfiler som bygningslisten. Også gyldige mærker efter 2037 indgår.
Build afbrydes ved uoverensstemmelse mellem dashboardets snapshot/antal og filerne.
`public/map-summary.json` er genereret og krypteres sammen med resten af siden.
Ingen kortdata hentes fra en tredjepart, når en kollega åbner dashboardet.
Kommunegrænserne i `data/municipalities.geojson` er
[geoBoundaries DNK ADM2, release 9469f09](https://github.com/wmgeolab/geoBoundaries/tree/9469f09/releaseData/gbOpen/DNK/ADM2),
repræsenterer 2018 og er forenklet til oversigtsbrug, ikke ejendomsafgrænsning.
[Kildens metadata](https://www.geoboundaries.org/api/current/gbOpen/DNK/ADM2/)
angiver Public Domain og geoBoundaries/Wikimedia Commons som kilde.
Importen matcher de 98 navne entydigt til dashboardets kommunekoder, med eksplicitte
navnevarianter for København, Bornholm, Nordfyn og Vesthimmerland. Alle efterfølgende
joins mellem kort og dashboard bruger kommunekode. `npm run test:map` kontrollerer
beregninger, intervalgrænser og geometri.

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

GitHub Action **Update EMOData** kører automatisk den 1. og 15. i hver måned
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

### Afgrænset prøve af markedsaktivitet

`scripts/market_activity_pilot.py` undersøger datadækning uden at ændre dashboardet
eller dets opdateringsjob. Den undersøger første og sidste dag i seneste afsluttede
kalendermåned, højst otte forskellige rapporter, fordelt på ændringstyper, og højst
to fulde inputopslag. Der bruges ingen ejer- eller arealfiltre. Resultatet indeholder
kun udvalgte rapport-/firmafelter, ikke adresser eller konsulentnavne. Det er en
stikprøve, ikke månedstal eller en markedsandelsberegning.

Kør med EMOData-adgang i miljøvariabler:

```powershell
python scripts\market_activity_pilot.py --as-of 2026-10-26 --output market-pilot.json
python -m unittest discover -s tests -p test_market_activity_pilot.py -v
```

Liveprøven den 26. oktober 2026 fandt firmanavn og firma-ID på alle fire aktive
rapporter i den stratificerede stikprøve. Fire andre rapporter var ikke længere
tilgængelige i BBR-søgningen; ét fuldt opslag bekræftede, at rapporten var erstattet.
Det aktive fulde opslag havde `ValidFrom`, men ingen udfyldt `DateOfSubmission`.
Alle fire aktive rapporter var `SingleFamily`; erhvervsdækning er ikke verificeret
af denne lille stikprøve. Firma-ID er tjenestens identifikator, ikke et verificeret CVR.

En kommende markedsfane skal derfor vælge og tydeligt navngive sin datodefinition.
`ValidFrom` må ikke stiltiende bruges som indberetningsdato. Ændringsloggens poster
må heller ikke tælles direkte som ny aktivitet, da de inkluderer erstatninger og
flere bygningsposter pr. rapport. Fuld månedstælling, historisk dækning,
ændringstyper, annulleringer og revisionskæder er ikke afklaret af prøven.

### Markedsaktivitet fra januar 2025

Den tredje fane **Markedsaktivitet** er uafhængig af kommunale ejer- og arealfiltre.
Den viser månedlige rapporttal, andel af de fundne rapporter, forskel fra forrige
måned, anvendelsestype, firmasøgning, firmagraf og CSV. Seneste afsluttede måned
er standard; den igangværende måned markeres foreløbig og får ingen beregnet
ændring mod en hel måned. Januar 2025 sammenlignes ikke med december 2024.
Grafens årsvælger viser enten alle år eller et enkelt år fra dataperioden.
Valget gælder både søjlerne og grafens månedstabel og bevarer firma- og typevalget.

Datogrundlaget er **ValidFrom (gyldig fra)**, aldrig en antaget indberetningsdato.
`scripts/market_activity.py` gennemgår EMOData-geografisøgningen for Danmark
(54–59° N, 7–16° Ø) i 90 felter på 0,5 kvadratgrader, under tjenestens arealgrænse.
Alle sider gennemgås, og hver rapport tælles kun én gang efter EM-nummer, også når
den omfatter flere bygninger eller findes ved en feltgrænse. Indsamlingen bruger
højst fire samtidige forespørgsler med pause mellem sider. Fejl, modstridende
rapportdata, gentagne sider og overskredet sidegrænse afbryder publiceringen.

Kun fundne rapporter med status `VALID` og gyldighedsstart fra **1. januar 2025**
til opgørelsesdatoen medtages. Firmaer samles efter `SubmitterCompanyIdentifier`;
det er et EMOData-firma-ID, ikke et verificeret CVR. Navnevarianter under samme ID
kan søges, og seneste fundne navn vises. Rapporterne uden både navn og firma-ID
står i en særskilt ukendt-gruppe og indgår i andelenes nævner.

**Dette er en markedsindikator, ikke en komplet historisk produktionstælling.**
Tidligere mærker, der senere er annulleret eller erstattet, kan mangle i det aktuelle
udtræk. Geografisøgningen kan også mangle mærker uden brugbare koordinater.
En ny rapport kan være en rettelse og er ikke nødvendigvis en ny kundeopgave.
Også tidligere måneders tal kan derfor ændre sig ved senere opdateringer.
Forbeholdene vises i fanen og i CSV. Der vises ikke omsætning eller en påstået
andel af alle historisk udstedte energimærker.

`public/market-activity.json` indeholder kun firma-/månedsaggregater, ingen adresser
eller konsulentnavne. Filen krypteres sammen med dashboardet. Dens opdateringsdato
vises særskilt fra kommunedatas dato. **Update market activity** kører den 1. og 15.
kl. 04.17 UTC, opdaterer kun denne fil og genudgiver siden efter en vellykket kørsel.
Kommunedataenes job og tidsplan er uændret.

```powershell
python scripts\market_activity.py --output public\market-activity.json
python -m unittest discover -s tests -p test_market_activity.py -v
npm run test:market
```

### Rapport siden sidste kommuneopdatering

Modulet **Siden sidste opdatering** i Oversigt sammenligner de to seneste
kommunale dataudtræk og følger kommune-, ejer- og arealvalget, ikke udløbsåret.
Det tæller bygninger med først fundet mærke, skiftet rapportnummer, ændring fra
gyldigt til udløbet samt mærker, der ikke længere findes i udtrækket. Tilføjede
og udgåede bygninger og øvrige dataændringer vises særskilt, ikke som nye opgaver.
Detaljerne viser før/nu og firmaerne på først fundne og skiftede mærker.
Rapportnumre deduplikeres pr. registreret firmanavn i firmatabellen.

Det er observerede ændringer i kommunernes registreringer, **ikke** nye opgaver,
vundne udbud eller aktivitet i hele markedet. Nye datamatch og rettelser kan ændre
en bygnings mærke uden en ny energimærkning. En forsvundet registrering er ikke
en dokumenteret annullering. Firmaoplysninger uden nyt rapportnummer er øvrige
dataændringer, ikke firmaaktivitet. Sammenligningsdatoer vises med dansk tid.

`scripts/update_report.py` matcher bygninger på kommunenummer, normaliseret
BFE-liste og bygningsnummer inden for hver kommunes CVR og afgrænsning.
Manglende eller dublerede nøgler, forkert snapshot, ændret kommunedækning eller
uoverensstemmende bygningstal afbryder genereringen. Et nyt scope uden historik
markeres som ikke sammenligneligt; det vises ikke som nul ændringer.

**Update EMOData** gemmer forrige snapshot midlertidigt før indhentning og
genererer derefter `public/update-report.json`. Kun forskellene og de to
snapshotdatoer gemmes permanent. Rapporten committes sammen med kommunedata
og krypteres ved publicering; markedsopdateringen ændrer ikke kommunerapporten.
Buildet afviser en rapport, der ikke matcher de aktuelle kommunedata.
Første rapport sammenligner de faktiske udtræk fra 1. og 19. oktober 2026.

```powershell
python scripts\update_report.py --previous tidligere-snapshot --output public\update-report.json
python -m unittest discover -s tests -p test_update_report.py -v
npm run test:report
```

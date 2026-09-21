// Source table for the canonical country registry (data/countries.json is generated from it by
// scripts/build-country-registry.mjs). ISO 3166-1 identity, capital and UN-geoscheme subregion are
// static facts; borders and missing centroids are derived from Natural Earth geometry (world-atlas).
// Region uses Vigil's own five-way taxonomy (plus Oceania) so it matches Conflict.region.
export const TABLE = `
AF|AFG|Afghanistan|Asia|Southern Asia|Kabul
AL|ALB|Albania|Europe|Southern Europe|Tirana
DZ|DZA|Algeria|Africa|Northern Africa|Algiers
AD|AND|Andorra|Europe|Southern Europe|Andorra la Vella
AO|AGO|Angola|Africa|Middle Africa|Luanda
AG|ATG|Antigua and Barbuda|Americas|Caribbean|Saint John's
AR|ARG|Argentina|Americas|South America|Buenos Aires
AM|ARM|Armenia|Asia|Western Asia|Yerevan
AU|AUS|Australia|Oceania|Australia and New Zealand|Canberra
AT|AUT|Austria|Europe|Western Europe|Vienna
AZ|AZE|Azerbaijan|Asia|Western Asia|Baku
BS|BHS|Bahamas|Americas|Caribbean|Nassau
BH|BHR|Bahrain|Middle East|Western Asia|Manama
BD|BGD|Bangladesh|Asia|Southern Asia|Dhaka
BB|BRB|Barbados|Americas|Caribbean|Bridgetown
BY|BLR|Belarus|Europe|Eastern Europe|Minsk
BE|BEL|Belgium|Europe|Western Europe|Brussels
BZ|BLZ|Belize|Americas|Central America|Belmopan
BJ|BEN|Benin|Africa|Western Africa|Porto-Novo
BT|BTN|Bhutan|Asia|Southern Asia|Thimphu
BO|BOL|Bolivia|Americas|South America|Sucre
BA|BIH|Bosnia and Herzegovina|Europe|Southern Europe|Sarajevo
BW|BWA|Botswana|Africa|Southern Africa|Gaborone
BR|BRA|Brazil|Americas|South America|Brasília
BN|BRN|Brunei|Asia|South-eastern Asia|Bandar Seri Begawan
BG|BGR|Bulgaria|Europe|Eastern Europe|Sofia
BF|BFA|Burkina Faso|Africa|Western Africa|Ouagadougou
BI|BDI|Burundi|Africa|Eastern Africa|Gitega
CV|CPV|Cabo Verde|Africa|Western Africa|Praia
KH|KHM|Cambodia|Asia|South-eastern Asia|Phnom Penh
CM|CMR|Cameroon|Africa|Middle Africa|Yaoundé
CA|CAN|Canada|Americas|Northern America|Ottawa
CF|CAF|Central African Republic|Africa|Middle Africa|Bangui
TD|TCD|Chad|Africa|Middle Africa|N'Djamena
CL|CHL|Chile|Americas|South America|Santiago
CN|CHN|China|Asia|Eastern Asia|Beijing
CO|COL|Colombia|Americas|South America|Bogotá
KM|COM|Comoros|Africa|Eastern Africa|Moroni
CG|COG|Republic of the Congo|Africa|Middle Africa|Brazzaville
CD|COD|DR Congo|Africa|Middle Africa|Kinshasa
CR|CRI|Costa Rica|Americas|Central America|San José
CI|CIV|Côte d'Ivoire|Africa|Western Africa|Yamoussoukro
HR|HRV|Croatia|Europe|Southern Europe|Zagreb
CU|CUB|Cuba|Americas|Caribbean|Havana
CY|CYP|Cyprus|Europe|Western Asia|Nicosia
CZ|CZE|Czechia|Europe|Eastern Europe|Prague
DK|DNK|Denmark|Europe|Northern Europe|Copenhagen
DJ|DJI|Djibouti|Africa|Eastern Africa|Djibouti
DM|DMA|Dominica|Americas|Caribbean|Roseau
DO|DOM|Dominican Republic|Americas|Caribbean|Santo Domingo
EC|ECU|Ecuador|Americas|South America|Quito
EG|EGY|Egypt|Africa|Northern Africa|Cairo
SV|SLV|El Salvador|Americas|Central America|San Salvador
GQ|GNQ|Equatorial Guinea|Africa|Middle Africa|Malabo
ER|ERI|Eritrea|Africa|Eastern Africa|Asmara
EE|EST|Estonia|Europe|Northern Europe|Tallinn
SZ|SWZ|Eswatini|Africa|Southern Africa|Mbabane
ET|ETH|Ethiopia|Africa|Eastern Africa|Addis Ababa
FJ|FJI|Fiji|Oceania|Melanesia|Suva
FI|FIN|Finland|Europe|Northern Europe|Helsinki
FR|FRA|France|Europe|Western Europe|Paris
GA|GAB|Gabon|Africa|Middle Africa|Libreville
GM|GMB|Gambia|Africa|Western Africa|Banjul
GE|GEO|Georgia|Asia|Western Asia|Tbilisi
DE|DEU|Germany|Europe|Western Europe|Berlin
GH|GHA|Ghana|Africa|Western Africa|Accra
GR|GRC|Greece|Europe|Southern Europe|Athens
GD|GRD|Grenada|Americas|Caribbean|Saint George's
GT|GTM|Guatemala|Americas|Central America|Guatemala City
GN|GIN|Guinea|Africa|Western Africa|Conakry
GW|GNB|Guinea-Bissau|Africa|Western Africa|Bissau
GY|GUY|Guyana|Americas|South America|Georgetown
HT|HTI|Haiti|Americas|Caribbean|Port-au-Prince
HN|HND|Honduras|Americas|Central America|Tegucigalpa
HU|HUN|Hungary|Europe|Eastern Europe|Budapest
IS|ISL|Iceland|Europe|Northern Europe|Reykjavík
IN|IND|India|Asia|Southern Asia|New Delhi
ID|IDN|Indonesia|Asia|South-eastern Asia|Jakarta
IR|IRN|Iran|Middle East|Southern Asia|Tehran
IQ|IRQ|Iraq|Middle East|Western Asia|Baghdad
IE|IRL|Ireland|Europe|Northern Europe|Dublin
IL|ISR|Israel|Middle East|Western Asia|Jerusalem
IT|ITA|Italy|Europe|Southern Europe|Rome
JM|JAM|Jamaica|Americas|Caribbean|Kingston
JP|JPN|Japan|Asia|Eastern Asia|Tokyo
JO|JOR|Jordan|Middle East|Western Asia|Amman
KZ|KAZ|Kazakhstan|Asia|Central Asia|Astana
KE|KEN|Kenya|Africa|Eastern Africa|Nairobi
KI|KIR|Kiribati|Oceania|Micronesia|Tarawa
XK|XKX|Kosovo|Europe|Southern Europe|Pristina
KW|KWT|Kuwait|Middle East|Western Asia|Kuwait City
KG|KGZ|Kyrgyzstan|Asia|Central Asia|Bishkek
LA|LAO|Laos|Asia|South-eastern Asia|Vientiane
LV|LVA|Latvia|Europe|Northern Europe|Riga
LB|LBN|Lebanon|Middle East|Western Asia|Beirut
LS|LSO|Lesotho|Africa|Southern Africa|Maseru
LR|LBR|Liberia|Africa|Western Africa|Monrovia
LY|LBY|Libya|Africa|Northern Africa|Tripoli
LI|LIE|Liechtenstein|Europe|Western Europe|Vaduz
LT|LTU|Lithuania|Europe|Northern Europe|Vilnius
LU|LUX|Luxembourg|Europe|Western Europe|Luxembourg
MG|MDG|Madagascar|Africa|Eastern Africa|Antananarivo
MW|MWI|Malawi|Africa|Eastern Africa|Lilongwe
MY|MYS|Malaysia|Asia|South-eastern Asia|Kuala Lumpur
MV|MDV|Maldives|Asia|Southern Asia|Malé
ML|MLI|Mali|Africa|Western Africa|Bamako
MT|MLT|Malta|Europe|Southern Europe|Valletta
MH|MHL|Marshall Islands|Oceania|Micronesia|Majuro
MR|MRT|Mauritania|Africa|Western Africa|Nouakchott
MU|MUS|Mauritius|Africa|Eastern Africa|Port Louis
MX|MEX|Mexico|Americas|Central America|Mexico City
FM|FSM|Micronesia|Oceania|Micronesia|Palikir
MD|MDA|Moldova|Europe|Eastern Europe|Chișinău
MC|MCO|Monaco|Europe|Western Europe|Monaco
MN|MNG|Mongolia|Asia|Eastern Asia|Ulaanbaatar
ME|MNE|Montenegro|Europe|Southern Europe|Podgorica
MA|MAR|Morocco|Africa|Northern Africa|Rabat
MZ|MOZ|Mozambique|Africa|Eastern Africa|Maputo
MM|MMR|Myanmar|Asia|South-eastern Asia|Naypyidaw
NA|NAM|Namibia|Africa|Southern Africa|Windhoek
NR|NRU|Nauru|Oceania|Micronesia|Yaren
NP|NPL|Nepal|Asia|Southern Asia|Kathmandu
NL|NLD|Netherlands|Europe|Western Europe|Amsterdam
NZ|NZL|New Zealand|Oceania|Australia and New Zealand|Wellington
NI|NIC|Nicaragua|Americas|Central America|Managua
NE|NER|Niger|Africa|Western Africa|Niamey
NG|NGA|Nigeria|Africa|Western Africa|Abuja
KP|PRK|North Korea|Asia|Eastern Asia|Pyongyang
MK|MKD|North Macedonia|Europe|Southern Europe|Skopje
NO|NOR|Norway|Europe|Northern Europe|Oslo
OM|OMN|Oman|Middle East|Western Asia|Muscat
PK|PAK|Pakistan|Asia|Southern Asia|Islamabad
PW|PLW|Palau|Oceania|Micronesia|Ngerulmud
PS|PSE|Palestinian Territories|Middle East|Western Asia|Ramallah
PA|PAN|Panama|Americas|Central America|Panama City
PG|PNG|Papua New Guinea|Oceania|Melanesia|Port Moresby
PY|PRY|Paraguay|Americas|South America|Asunción
PE|PER|Peru|Americas|South America|Lima
PH|PHL|Philippines|Asia|South-eastern Asia|Manila
PL|POL|Poland|Europe|Eastern Europe|Warsaw
PT|PRT|Portugal|Europe|Southern Europe|Lisbon
QA|QAT|Qatar|Middle East|Western Asia|Doha
RO|ROU|Romania|Europe|Eastern Europe|Bucharest
RU|RUS|Russia|Europe|Eastern Europe|Moscow
RW|RWA|Rwanda|Africa|Eastern Africa|Kigali
KN|KNA|Saint Kitts and Nevis|Americas|Caribbean|Basseterre
LC|LCA|Saint Lucia|Americas|Caribbean|Castries
VC|VCT|Saint Vincent and the Grenadines|Americas|Caribbean|Kingstown
WS|WSM|Samoa|Oceania|Polynesia|Apia
SM|SMR|San Marino|Europe|Southern Europe|San Marino
ST|STP|São Tomé and Príncipe|Africa|Middle Africa|São Tomé
SA|SAU|Saudi Arabia|Middle East|Western Asia|Riyadh
SN|SEN|Senegal|Africa|Western Africa|Dakar
RS|SRB|Serbia|Europe|Southern Europe|Belgrade
SC|SYC|Seychelles|Africa|Eastern Africa|Victoria
SL|SLE|Sierra Leone|Africa|Western Africa|Freetown
SG|SGP|Singapore|Asia|South-eastern Asia|Singapore
SK|SVK|Slovakia|Europe|Eastern Europe|Bratislava
SI|SVN|Slovenia|Europe|Southern Europe|Ljubljana
SB|SLB|Solomon Islands|Oceania|Melanesia|Honiara
SO|SOM|Somalia|Africa|Eastern Africa|Mogadishu
ZA|ZAF|South Africa|Africa|Southern Africa|Pretoria
KR|KOR|South Korea|Asia|Eastern Asia|Seoul
SS|SSD|South Sudan|Africa|Eastern Africa|Juba
ES|ESP|Spain|Europe|Southern Europe|Madrid
LK|LKA|Sri Lanka|Asia|Southern Asia|Sri Jayawardenepura Kotte
SD|SDN|Sudan|Africa|Northern Africa|Khartoum
SR|SUR|Suriname|Americas|South America|Paramaribo
SE|SWE|Sweden|Europe|Northern Europe|Stockholm
CH|CHE|Switzerland|Europe|Western Europe|Bern
SY|SYR|Syria|Middle East|Western Asia|Damascus
TW|TWN|Taiwan|Asia|Eastern Asia|Taipei
TJ|TJK|Tajikistan|Asia|Central Asia|Dushanbe
TZ|TZA|Tanzania|Africa|Eastern Africa|Dodoma
TH|THA|Thailand|Asia|South-eastern Asia|Bangkok
TL|TLS|Timor-Leste|Asia|South-eastern Asia|Dili
TG|TGO|Togo|Africa|Western Africa|Lomé
TO|TON|Tonga|Oceania|Polynesia|Nuku'alofa
TT|TTO|Trinidad and Tobago|Americas|Caribbean|Port of Spain
TN|TUN|Tunisia|Africa|Northern Africa|Tunis
TR|TUR|Turkey|Europe|Western Asia|Ankara
TM|TKM|Turkmenistan|Asia|Central Asia|Ashgabat
TV|TUV|Tuvalu|Oceania|Polynesia|Funafuti
UG|UGA|Uganda|Africa|Eastern Africa|Kampala
UA|UKR|Ukraine|Europe|Eastern Europe|Kyiv
AE|ARE|United Arab Emirates|Middle East|Western Asia|Abu Dhabi
GB|GBR|United Kingdom|Europe|Northern Europe|London
US|USA|United States|Americas|Northern America|Washington, D.C.
UY|URY|Uruguay|Americas|South America|Montevideo
UZ|UZB|Uzbekistan|Asia|Central Asia|Tashkent
VU|VUT|Vanuatu|Oceania|Melanesia|Port Vila
VA|VAT|Vatican City|Europe|Southern Europe|Vatican City
VE|VEN|Venezuela|Americas|South America|Caracas
VN|VNM|Vietnam|Asia|South-eastern Asia|Hanoi
YE|YEM|Yemen|Middle East|Western Asia|Sana'a
ZM|ZMB|Zambia|Africa|Eastern Africa|Lusaka
ZW|ZWE|Zimbabwe|Africa|Eastern Africa|Harare
`;

// Other names people search for (Latin script; native-language names where they are the common one).
export const ALIASES = {
  FI: ["Suomi", "Finlandia"], SE: ["Sverige", "Sweden"], NO: ["Norge", "Noreg"], DK: ["Danmark"], IS: ["Ísland"], EE: ["Eesti"], LV: ["Latvija"], LT: ["Lietuva"],
  DE: ["Deutschland"], FR: ["République française"], ES: ["España"], IT: ["Italia"], PT: ["Portugal"], NL: ["Nederland", "Holland"], BE: ["België", "Belgique"], CH: ["Schweiz", "Suisse", "Svizzera"], AT: ["Österreich"],
  GR: ["Hellas", "Ellada"], PL: ["Polska"], CZ: ["Czech Republic", "Česko"], SK: ["Slovensko"], HU: ["Magyarország"], RO: ["România"], BG: ["Bălgarija"], HR: ["Hrvatska"], RS: ["Srbija"], UA: ["Ukraina", "Україна"], BY: ["Belarus", "Byelorussia"], RU: ["Russian Federation", "Rossiya", "Россия"], MD: ["Moldavia"],
  GB: ["UK", "Britain", "Great Britain", "England"], IE: ["Éire"], US: ["USA", "United States of America", "America", "U.S."], CA: ["Canada"], MX: ["México"], BR: ["Brasil"],
  CN: ["PRC", "People's Republic of China", "Zhongguo"], JP: ["Nippon", "Nihon"], KR: ["Republic of Korea", "Korea"], KP: ["DPRK", "Democratic People's Republic of Korea"], TW: ["Republic of China", "Chinese Taipei"], MM: ["Burma"], VN: ["Viet Nam"], LA: ["Lao PDR"], TH: ["Siam"], KH: ["Kampuchea"],
  TR: ["Türkiye", "Turkiye"], IR: ["Islamic Republic of Iran", "Persia"], SY: ["Syrian Arab Republic"], PS: ["Palestine", "State of Palestine", "West Bank", "Gaza"], IL: ["Yisrael"], AE: ["UAE", "Emirates"], SA: ["KSA"], YE: ["Yemen Arab Republic"],
  CD: ["Democratic Republic of the Congo", "DRC", "Congo-Kinshasa", "Congo Kinshasa"], CG: ["Congo", "Congo-Brazzaville", "Congo Brazzaville"], CI: ["Ivory Coast", "Cote d'Ivoire"], SZ: ["Swaziland"], CV: ["Cape Verde"], TL: ["East Timor"], MK: ["Macedonia"], ST: ["Sao Tome and Principe"], GM: ["The Gambia"], BS: ["The Bahamas"], VA: ["Holy See"],
  EG: ["Misr"], SD: ["As-Sudan"], ZA: ["RSA"], NG: ["Naija"],
};

// The double-landlocked and landlocked states (no sea coast): maritime sections are not shown for them.
export const LANDLOCKED = "AF AD AM AT AZ BY BT BO BW BF BI CF TD CZ SZ ET HU XK LA LS LI LU MW ML MD MN NP NE MK PY RW SM RS SK SS CH TJ TM UG UZ VA ZM ZW KZ KG".split(" ");

// Natural Earth (world-atlas 110m) names that differ from the registry's canonical names.
export const ATLAS_NAMES = {
  "United States of America": "US", "Dem. Rep. Congo": "CD", Congo: "CG", "Central African Rep.": "CF", "Bosnia and Herz.": "BA", "Czechia": "CZ", "Dominican Rep.": "DO", "Eq. Guinea": "GQ", "Côte d'Ivoire": "CI", "eSwatini": "SZ", "N. Cyprus": "CY", "S. Sudan": "SS", Somaliland: "SO", "Solomon Is.": "SB", Kosovo: "XK", "Timor-Leste": "TL", "North Macedonia": "MK", Macedonia: "MK", "W. Sahara": null, Palestine: "PS", "Fr. S. Antarctic Lands": null, "Falkland Is.": null, Greenland: null, "New Caledonia": null, "Puerto Rico": null, Antarctica: null, Taiwan: "TW", "South Korea": "KR", "North Korea": "KP", Laos: "LA", Brunei: "BN", Myanmar: "MM", Russia: "RU", Vietnam: "VN", Syria: "SY", Iran: "IR", Moldova: "MD", Tanzania: "TZ", Bolivia: "BO", Venezuela: "VE",
};

// Land borders the 110m geometry cannot show (micro-states) or that are widely recognised but sub-resolution.
export const EXTRA_BORDERS = [["AD", "FR"], ["AD", "ES"], ["MC", "FR"], ["SM", "IT"], ["VA", "IT"], ["LI", "CH"], ["LI", "AT"], ["LU", "FR"], ["LU", "BE"], ["LU", "DE"], ["GM", "SN"], ["BN", "MY"], ["XK", "RS"], ["XK", "AL"], ["XK", "MK"], ["XK", "ME"], ["PS", "IL"], ["PS", "EG"], ["PS", "JO"], ["QA", "SA"]];

// Label points for states too small for the Natural Earth 110m geometry (capital / main island).
export const SMALL_CENTROIDS = { AD: [42.55, 1.58], AG: [17.06, -61.8], BH: [26.03, 50.55], BB: [13.19, -59.54], CV: [16.0, -24.01], KM: [-11.65, 43.33], DM: [15.42, -61.35], GD: [12.12, -61.68], KI: [1.87, -157.4], LI: [47.14, 9.55], MV: [3.2, 73.22], MT: [35.94, 14.38], MH: [7.13, 171.18], MU: [-20.35, 57.55], FM: [6.92, 158.16], MC: [43.74, 7.42], NR: [-0.53, 166.93], PW: [7.51, 134.58], KN: [17.36, -62.78], LC: [13.91, -60.98], VC: [12.98, -61.29], WS: [-13.76, -172.1], SM: [43.94, 12.46], ST: [0.19, 6.61], SC: [-4.68, 55.49], SG: [1.35, 103.82], TO: [-21.18, -175.2], TV: [-7.11, 177.65], VA: [41.9, 12.45] };

// Curated land-border pairs that impact scoring relied on before the registry existed (kept; the registry is a superset).
export const CURATED_BORDERS = [["FI", "NO"], ["FI", "SE"], ["FI", "RU"], ["UA", "RU"], ["UA", "BY"], ["UA", "PL"], ["UA", "SK"], ["UA", "HU"], ["UA", "RO"], ["UA", "MD"], ["RU", "NO"], ["RU", "EE"], ["RU", "LV"], ["RU", "LT"], ["RU", "PL"], ["RU", "BY"], ["RU", "GE"], ["RU", "AZ"], ["RU", "KZ"], ["RU", "MN"], ["RU", "CN"], ["RU", "KP"], ["PL", "DE"], ["PL", "CZ"], ["PL", "SK"], ["PL", "LT"], ["DE", "DK"], ["DE", "CZ"], ["DE", "AT"], ["DE", "CH"], ["DE", "FR"], ["DE", "LU"], ["DE", "BE"], ["DE", "NL"], ["GB", "IE"], ["US", "CA"], ["US", "MX"], ["IL", "LB"], ["IL", "SY"], ["IL", "JO"], ["IL", "EG"], ["IL", "PS"], ["PS", "EG"], ["PS", "JO"], ["LB", "SY"], ["SY", "TR"], ["SY", "IQ"], ["SY", "JO"], ["IR", "TR"], ["IR", "IQ"], ["IR", "AF"], ["IR", "PK"], ["IR", "TM"], ["IR", "AZ"], ["IR", "AM"], ["SA", "JO"], ["SA", "IQ"], ["SA", "KW"], ["SA", "QA"], ["SA", "AE"], ["SA", "OM"], ["SA", "YE"], ["YE", "OM"], ["SD", "EG"], ["SD", "LY"], ["SD", "TD"], ["SD", "CF"], ["SD", "SS"], ["SD", "ET"], ["SD", "ER"], ["CD", "CG"], ["CD", "CF"], ["CD", "SS"], ["CD", "UG"], ["CD", "RW"], ["CD", "BI"], ["CD", "ZM"], ["CD", "AO"], ["SO", "ET"], ["SO", "KE"], ["SO", "DJ"], ["ML", "DZ"], ["ML", "NE"], ["ML", "BF"], ["ML", "CI"], ["ML", "GN"], ["ML", "SN"], ["ML", "MR"], ["NG", "BJ"], ["NG", "NE"], ["NG", "TD"], ["NG", "CM"], ["EG", "LY"], ["MM", "IN"], ["MM", "BD"], ["MM", "CN"], ["MM", "LA"], ["MM", "TH"], ["IN", "PK"], ["IN", "CN"], ["IN", "NP"], ["IN", "BT"], ["IN", "BD"], ["PK", "AF"], ["PK", "CN"], ["KR", "KP"], ["KP", "CN"], ["CN", "MN"], ["CN", "AF"], ["CN", "TJ"], ["CN", "KG"], ["CN", "KZ"], ["CN", "NP"], ["CN", "BT"], ["CN", "LA"], ["CN", "VN"], ["TR", "GR"], ["TR", "BG"], ["TR", "GE"], ["TR", "AM"], ["TR", "AZ"], ["TR", "IQ"]];

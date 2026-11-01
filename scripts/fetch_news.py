#!/usr/bin/env python3
"""EUROPOOR - The Wire.

Fetches European economic news from Google News RSS (plus a few direct feeds),
classifies it, scores it, and builds "The Decline League".

Outputs:
  data/news.json
  data/news.js         (window.EP_NEWS = {...};)
  data/news_archive.json  (raw item cache, keeps ~35 days of history so the
                           league form is stable between runs)

Python 3 standard library only.

Usage:
  python3 scripts/fetch_news.py            # single run
  python3 scripts/fetch_news.py --loop 15  # refresh every 15 minutes forever
"""

import argparse
import concurrent.futures
import email.utils
import hashlib
import html
import json
import math
import os
import random
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
OUT_JSON = os.path.join(DATA_DIR, "news.json")
OUT_JS = os.path.join(DATA_DIR, "news.js")
ARCHIVE = os.path.join(DATA_DIR, "news_archive.json")

HISTORY_DAYS = 35
MAX_ITEMS = 250
WIRE_DAYS = 7         # setbacks kept on the public wire
MAX_SETBACKS = 320
MAX_NEUTRAL = 80
NEXT_REFRESH_MINUTES = int(os.environ.get("EP_REFRESH_MINUTES", "15"))  # how often the host re-runs this sweep
USER_AGENT = ("Mozilla/5.0 (compatible; EuropoorWire/1.0; "
              "+https://github.com/ satirical news aggregator)")
TIMEOUT = 15
RETRIES = 2
WORKERS = 4
DELAY = 0.35  # seconds between requests per worker

GN = "https://news.google.com/rss/search?q={q}&hl=en-GB&gl=GB&ceid=GB:en"

# ---------------------------------------------------------------------------
# Countries
# ---------------------------------------------------------------------------
# code, slug, name, query term, detection patterns (regex, case-insensitive
# unless noted). Patterns cover names, demonyms, capitals, institutions,
# leaders and a few bellwether companies.
COUNTRIES = [
    ("AT", "austria", "Austria", "Austria",
     [r"austria\w*", r"vienna", r"oenb", r"wifo"]),
    ("BE", "belgium", "Belgium", "Belgium",
     [r"belgi\w*", r"antwerp", r"flanders", r"flemish", r"wallonia\w*",
      r"de wever"]),
    ("BG", "bulgaria", "Bulgaria", "Bulgaria",
     [r"bulgaria\w*"]),
    ("HR", "croatia", "Croatia", "Croatia",
     [r"croatia\w*", r"zagreb"]),
    ("CY", "cyprus", "Cyprus", "Cyprus",
     [r"cyprus", r"cypriot\w*", r"nicosia"]),
    ("CZ", "czechia", "Czechia", "Czech",
     [r"czech\w*", r"prague", r"babi[sš]"]),
    ("DK", "denmark", "Denmark", "Denmark",
     [r"denmark", r"danish", r"danes", r"copenhagen", r"maersk",
      r"novo nordisk"]),
    ("EE", "estonia", "Estonia", "Estonia",
     [r"estonia\w*", r"tallinn"]),
    ("FI", "finland", "Finland", "Finland",
     [r"finland", r"finnish", r"finns", r"helsinki", r"nokia", r"orpo"]),
    ("FR", "france", "France", "France",
     [r"france", r"french", r"paris", r"macron\w*", r"[eé]lys[eé]e",
      r"matignon", r"banque de france", r"insee", r"cac 40", r"cac40",
      r"renault", r"michelin", r"totalenergies", r"lecornu", r"bayrou",
      r"le pen", r"bardella", r"oat spreads?"]),
    ("DE", "germany", "Germany", "Germany",
     [r"germany", r"german\w*", r"berlin", r"bundesbank", r"bundestag",
      r"bund", r"bunds", r"ifo", r"destatis", r"merz",
      r"scholz", r"klingbeil", r"volkswagen", r"basf", r"siemens",
      r"thyssenkrupp", r"bosch", r"daimler", r"mercedes(?:-benz)?", r"bmw",
      r"porsche", r"lufthansa", r"deutsche bank", r"commerzbank",
      r"deutsche bahn", r"bavaria\w*", r"saxony", r"frankfurt",
      r"munich", r"hamburg", r"cologne", r"stuttgart", r"wolfsburg"]),
    ("GR", "greece", "Greece", "Greece",
     [r"greece", r"greek", r"hellenic", r"athens", r"mitsotakis"]),
    ("HU", "hungary", "Hungary", "Hungary",
     [r"hungar\w*", r"budapest", r"orb[aá]n", r"forint", r"magyar"]),
    ("IE", "ireland", "Ireland", "Ireland",
     [r"(?<!northern )ireland", r"irish", r"dublin", r"taoiseach", r"d[aá]il",
      r"central bank of ireland"]),
    ("IT", "italy", "Italy", "Italy",
     [r"italy", r"italian\w*", r"rome", r"milan", r"meloni", r"istat",
      r"banca d'italia", r"bank of italy", r"btp\w*", r"ftse mib",
      r"fiat", r"giorgetti"]),
    ("LV", "latvia", "Latvia", "Latvia",
     [r"latvia\w*", r"riga"]),
    ("LT", "lithuania", "Lithuania", "Lithuania",
     [r"lithuania\w*", r"vilnius"]),
    ("LU", "luxembourg", "Luxembourg", "Luxembourg",
     [r"luxembourg\w*"]),
    ("MT", "malta", "Malta", "Malta",
     [r"malta", r"maltese", r"valletta"]),
    ("NL", "netherlands", "Netherlands", "Netherlands",
     [r"netherlands", r"dutch", r"holland", r"amsterdam", r"the hague",
      r"rotterdam", r"de nederlandsche bank", r"asml", r"philips",
      r"ing group", r"schiphol"]),
    ("PL", "poland", "Poland", "Poland",
     [r"poland", r"polish", r"poles", r"warsaw", r"tusk", r"nawrocki",
      r"zloty", r"z[łl]oty"]),
    ("PT", "portugal", "Portugal", "Portugal",
     [r"portugal", r"portuguese", r"lisbon", r"banco de portugal"]),
    ("RO", "romania", "Romania", "Romania",
     [r"romania\w*", r"bucharest", r"leu"]),
    ("SK", "slovakia", "Slovakia", "Slovakia",
     [r"slovakia\w*", r"slovak", r"bratislava", r"fico"]),
    ("SI", "slovenia", "Slovenia", "Slovenia",
     [r"slovenia\w*", r"slovene", r"ljubljana"]),
    ("ES", "spain", "Spain", "Spain",
     [r"spain", r"spanish", r"madrid", r"barcelona", r"catalonia\w*",
      r"s[aá]nchez", r"banco de espa[nñ]a", r"bank of spain", r"ibex",
      r"andalusia\w*", r"valencia"]),
    ("SE", "sweden", "Sweden", "Sweden",
     [r"sweden", r"swedish", r"swedes", r"stockholm", r"riksbank",
      r"ericsson", r"volvo", r"northvolt", r"h&m", r"kristersson",
      r"krona"]),
    ("GB", "united-kingdom", "United Kingdom", "UK",
     [r"u\.k\.", r"britain", r"british(?! columbia)", r"brits",
      r"(?<!new )england", r"scotland", r"scottish", r"(?<!south )wales", r"welsh",
      r"northern ireland", r"london", r"westminster", r"downing street",
      r"no 10", r"whitehall", r"bank of england",
      r"ftse", r"gilt\w*", r"sterling", r"starmer", r"reeves",
      r"badenoch", r"farage", r"burnham", r"healey", r"reform uk", r"tory", r"tories", r"labour's",
      r"thames water", r"british steel",
      r"jaguar land rover", r"manchester", r"birmingham",
      r"glasgow", r"edinburgh", r"cardiff", r"belfast"]),
    ("NO", "norway", "Norway", "Norway",
     [r"norway", r"norwegian\w*", r"oslo", r"norges bank", r"equinor",
      r"st[oø]re"]),
    ("CH", "switzerland", "Switzerland", "Switzerland",
     [r"switzerland", r"swiss", r"zurich", r"geneva", r"bern",
      r"nestl[eé]", r"franc"]),
    ("IS", "iceland", "Iceland", "Iceland",
     [r"iceland(?:ic|er|ers)?(?! foods| boss| supermarket| chairman| founder| stores?)",
      r"reykjavik", r"sedlabanki"]),
]
COUNTRY_BY_CODE = {c[0]: c for c in COUNTRIES}
COUNTRY_RE = [
    (c[0], re.compile(r"(?<![\w-])(?:" + "|".join(c[4]) + r")(?![\w-])", re.I))
    for c in COUNTRIES
]
# Case-sensitive acronyms that would collide with ordinary words in lower case
ACRONYM_RE = [
    ("GB", re.compile(r"\b(?:UK|ONS|BoE|BOE|OBR|HMRC|NHS|JLR)\b")),
    ("DE", re.compile(r"\b(?:VW|ZEW|DAX|AfD|IFO|Ifo)\b")),
    ("NL", re.compile(r"\bING\b")),
    ("CH", re.compile(r"\b(?:SNB|UBS)\b")),
]
# Pattern hits that only count when capitalised (ordinary words otherwise)
CAP_REQUIRED = {"franc", "bern", "rome", "reeves", "tusk", "magyar", "fico",
                "leu", "bund", "bunds", "valencia", "orpo", "ifo", "ons"}

EU_RE = re.compile(
    r"(?<![\w-])(?:ecb|eurozone|euro zone|euro area|euro-area|brussels|eurostat|"
    r"european commission|european union|european parliament|european central bank|"
    r"eu|e\.u\.|eu's|lagarde|von der leyen|europe|european|europe's|euro|"
    r"eib|stoxx|eu27|single market|schengen)(?![\w-])", re.I)

NON_EUROPE_RE = re.compile(
    r"(?<![\w-])(?:us|u\.s\.|usa|america|american|americans|fed|federal reserve|"
    r"wall street|washington|trump|white house|china|chinese|beijing|japan|"
    r"japanese|tokyo|boj|india|indian|canada|canadian|australia|australian|"
    r"new zealand|brazil|brazilian|mexico|mexican|argentina|argentine|russia|"
    r"russian|kremlin|moscow|turkey|turkish|t[uü]rkiye|nigeria|kenya|"
    r"south africa|egypt|pakistan|bangladesh|indonesia|philippines|vietnam|"
    r"korea|korean|taiwan|singapore|hong kong|saudi|uae|dubai|qatar|israel|"
    r"iran|ukraine|ukrainian|sri lanka|ghana|zimbabwe|malaysia|thailand|"
    r"georgia|serbia|montenegro|bosnia|albania|kosovo|moldova|belarus|"
    r"armenia|azerbaijan|kazakhstan|colombia|chile|peru|venezuela|belarus\w*|"
    r"ontario|toronto|quebec|alberta|british columbia|vancouver|brisbane|"
    r"sydney|melbourne|queensland|new south wales|auckland|california|texas|"
    r"florida|new york|ohio|michigan|illinois|chicago|pennsylvania|virginia|"
    r"carolina|arizona|nevada|colorado|oregon|vermont|massachusetts|boston|"
    r"new jersey|maryland|minnesota|wisconsin|tennessee|kentucky|louisiana|"
    r"alabama|missouri|indiana|iowa|kansas|utah|seattle|los angeles|"
    r"san francisco|houston|dallas|atlanta|miami|detroit|philadelphia|"
    r"new england|medicaid|medicare|congress|senate|gop|democrats|"
    r"republicans|lagos|nairobi|johannesburg|cairo|karachi|mumbai|delhi|"
    r"shanghai|shenzhen|manila|jakarta|bangkok|seoul|riyadh|tehran|kyiv|"
    r"kiev|ankara|istanbul|minsk|tbilisi|belgrade|sarajevo|tirana|skopje|"
    r"north macedonia|chisinau|microsoft|"
    r"google|alphabet|amazon|apple|meta|tesla|nvidia|openai|anthropic|boeing|"
    r"walmart|intel|ford|general motors|gm|starbucks|mcdonald's|toyota|byd|"
    r"huawei|tiktok|samsung|sony|honda|nissan|hyundai|xiaomi)(?![\w-])",
    re.I)
# "us" lowercase collides with the pronoun; check it case-sensitively.
US_CASE_RE = re.compile(r"\b(?:US|U\.S\.|USA)\b")

# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------
# Topic queries carry a country hint only when the query names one country;
# Europe-wide queries rely on the headline itself naming somewhere European.
TOPIC_QUERIES = [
    ("eurozone inflation", None),
    ("ECB interest rates", None),
    ("EU recession", None),
    ("eurozone growth contraction", None),
    ("eurozone economy", None),
    ("European unemployment", None),
    ("layoffs job cuts Europe factory", None),
    ("European industry decline", None),
    ("energy prices Europe electricity gas", None),
    ("government budget deficit Europe", None),
    ("debt downgrade rating Europe", None),
    ("bond yields Europe spread", None),
    ("cost of living Europe", None),
    ("Eurostat", None),
    ("European Commission economic forecast", None),
    ("insolvencies bankruptcies Europe", None),
    ("Germany economy", "DE"),
    ("German industry job cuts", "DE"),
    ("France budget", "FR"),
    ("France government", "FR"),
    ("UK economy", "GB"),
    ("UK inflation", "GB"),
    ("UK budget Reeves", "GB"),
    ("Italy debt", "IT"),
    ("Spain housing", "ES"),
    ("Netherlands housing crisis", "NL"),
    ("Poland economy", "PL"),
    ("Nordic economy", None),
    ("strike workers Europe wages", None),
    ("European car industry", None),
]
COUNTRY_QUERY_A = "{c} economy OR inflation OR budget OR unemployment"
COUNTRY_QUERY_B = "{c} recession OR layoffs OR deficit OR \"cost of living\" OR \"energy prices\""

DIRECT_FEEDS = [
    ("https://www.euronews.com/rss?level=vertical&name=business", "Euronews", None),
    ("https://www.politico.eu/section/economy/feed/", "POLITICO Europe", None),
    ("https://www.politico.eu/feed/", "POLITICO Europe", None),
    ("https://www.ecb.europa.eu/rss/press.html", "European Central Bank", "EU"),
    ("https://ec.europa.eu/eurostat/en/search?p_p_id=estatsearchportlet_WAR_"
     "estatsearchportlet&p_p_lifecycle=2&p_p_state=maximized&p_p_mode=view&"
     "p_p_resource_id=atom&_estatsearchportlet_WAR_estatsearchportlet_"
     "collection=CAT_EURNEWREL", "Eurostat", "EU"),
    ("https://www.theguardian.com/business/economics/rss", "The Guardian", None),
    ("https://feeds.bbci.co.uk/news/business/rss.xml", "BBC News", None),
]

# ---------------------------------------------------------------------------
# HTTP + parsing
# ---------------------------------------------------------------------------

def http_get(url):
    last = None
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                "Accept-Language": "en-GB,en;q=0.8",
            })
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1) + random.random())
    raise last


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    except Exception:  # noqa: BLE001
        pass
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    except Exception:  # noqa: BLE001
        return None


def clean_text(s):
    s = html.unescape(s or "")
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_feed(raw, default_source=None):
    """Return list of dicts: title, source, url, published (datetime)."""
    out = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return out
    atom = "{http://www.w3.org/2005/Atom}"
    items = root.iter("item")
    entries = list(items)
    if entries:
        for it in entries:
            title = clean_text(it.findtext("title"))
            link = (it.findtext("link") or "").strip()
            pub = parse_date(it.findtext("pubDate") or it.findtext(
                "{http://purl.org/dc/elements/1.1/}date"))
            src_el = it.find("source")
            source = clean_text(src_el.text) if src_el is not None and src_el.text else None
            if source and title.endswith(" - " + source):
                title = title[: -len(" - " + source)].strip()
            elif not source and default_source is None and " - " in title:
                title, source = title.rsplit(" - ", 1)
            source = source or default_source or "Unknown"
            out.append({"title": title, "source": source.strip(),
                        "url": link, "published": pub})
    else:
        for it in root.iter(atom + "entry"):
            title = clean_text(it.findtext(atom + "title"))
            link_el = it.find(atom + "link")
            link = link_el.get("href") if link_el is not None else ""
            pub = parse_date(it.findtext(atom + "published") or it.findtext(atom + "updated"))
            out.append({"title": title, "source": default_source or "Unknown",
                        "url": link, "published": pub})
    return out


def fetch_job(job):
    url, default_source, hint, delay = job
    time.sleep(delay)
    try:
        raw = http_get(url)
    except Exception as e:  # noqa: BLE001
        return job, [], str(e)
    items = parse_feed(raw, default_source)
    for it in items:
        it["hints"] = [hint] if hint else []
    return job, items, None


def build_jobs():
    jobs = []
    for q, hint in TOPIC_QUERIES:
        jobs.append((GN.format(q=urllib.parse.quote_plus(q + " when:7d")), None, hint))
    for code, slug, name, term, _ in COUNTRIES:
        for tmpl in (COUNTRY_QUERY_A, COUNTRY_QUERY_B):
            q = tmpl.format(c=term) + " when:35d"
            jobs.append((GN.format(q=urllib.parse.quote_plus(q)), None, code))
    for url, src, hint in DIRECT_FEEDS:
        jobs.append((url, src, hint))
    # stagger: each worker waits DELAY between its requests
    return [(u, s, h, DELAY + random.random() * 0.3)
            for i, (u, s, h) in enumerate(jobs)]


def fetch_all(log):
    jobs = build_jobs()
    results, failed = [], 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for job, items, err in ex.map(fetch_job, jobs):
            if err:
                failed += 1
                log(f"  ! skip {job[0][:90]}: {err}")
            results.extend(items)
    log(f"  fetched {len(results)} raw items from {len(jobs) - failed}/{len(jobs)} feeds")
    return results


# ---------------------------------------------------------------------------
# Relevance
# ---------------------------------------------------------------------------

ECON_RE = re.compile(r"(?<![\w-])(?:" + "|".join([
    r"econom\w*", r"inflation\w*", r"deflation", r"disinflation", r"prices?",
    r"pricing", r"cpi", r"hicp", r"gdp", r"growth", r"recession\w*",
    r"stagnat\w*", r"budget\w*", r"deficits?", r"debts?", r"bonds?",
    r"yields?", r"gilts?", r"bunds?", r"btps?", r"spreads?", r"borrowing",
    r"tax\w*", r"tariffs?", r"unemploy\w*", r"jobless\w*", r"jobs?",
    r"job cuts", r"lay ?offs?", r"layoffs", r"redundanc\w*", r"workers?",
    r"workforce", r"employ\w*", r"labou?r market", r"wages?", r"salar\w*",
    r"pay", r"pensions?", r"energy", r"electricity", r"power prices",
    r"gas", r"lng", r"oil", r"fuel", r"petrol", r"diesel", r"heating",
    r"housing", r"house prices", r"homes?", r"rents?", r"rental", r"mortgages?",
    r"property", r"landlords?", r"interest rates?", r"rates?", r"rate cuts?",
    r"rate hikes?", r"central bank", r"monetary", r"fiscal", r"austerity",
    r"spending", r"industr\w*", r"manufactur\w*", r"factor(?:y|ies)",
    r"plants?", r"exports?", r"imports?", r"trade", r"pmi", r"output",
    r"production", r"investment", r"investors?", r"banks?", r"banking",
    r"markets?", r"stocks?", r"shares", r"currency", r"euro", r"sterling",
    r"krona", r"forint", r"zloty", r"franc", r"credit", r"rating\w*",
    r"downgrad\w*", r"upgrad\w*", r"moody'?s", r"fitch", r"s&p",
    r"insolvenc\w*", r"bankrupt\w*", r"cost of living", r"poverty",
    r"purchasing power", r"households?", r"consumers?", r"consumer",
    r"retail", r"sales", r"business\w*", r"compan(?:y|ies)", r"firms?",
    r"profits?", r"revenue", r"losses", r"coalition", r"elections?",
    r"government", r"parliament", r"minister\w*", r"chancellor",
    r"no-confidence", r"confidence vote", r"reforms?", r"strikes?",
    r"subsid\w*", r"bailout", r"benefits?", r"welfare", r"minimum wage",
    r"car ?makers?", r"automakers?", r"steel", r"chemicals?", r"supply chain",
    r"competitiveness", r"productivity", r"treasury", r"finance minister",
    r"finances", r"public finances", r"eurobonds?", r"stimulus",
    r"forecasts?", r"outlook", r"imf", r"oecd", r"wealth", r"rich",
    r"billionaires?", r"tourism", r"construction", r"car industry",
    r"tariff", r"sanctions", r"regulation", r"cuts?",
]) + r")(?![\w-])", re.I)

GOV_ONLY_RE = re.compile(r"(?<![\w-])(?:coalition|elections?|government|parliament|"
                         r"minister\w*|chancellor|no-confidence|confidence vote|"
                         r"reforms?)(?![\w-])", re.I)

DROP_RE = re.compile(r"(?<![\w-])(?:" + "|".join([
    # sport
    r"football", r"soccer", r"premier league", r"champions league",
    r"europa league", r"la liga", r"serie a", r"bundesliga", r"ligue 1",
    r"world cup", r"euro 2028", r"uefa", r"fifa", r"rugby", r"cricket",
    r"tennis", r"golf", r"formula 1", r"formula one", r"f1", r"grand prix",
    r"olympic\w*", r"cycling", r"tour de france", r"marathon", r"nba", r"nfl",
    r"transfer window", r"striker", r"midfielder", r"goalkeeper",
    r"manager sacked", r"fixtures?", r"kick-off", r"match", r"derby",
    r"vs\.?", r"v\.?", r"semi-final", r"quarter-final", r"eurovision",
    r"ryder cup", r"six nations", r"handball", r"skiing", r"snooker",
    r"stadium", r"squad", r"footballers?", r"golden boy", r"kane", r"sabotage", r"arson",
    # celebrity / lifestyle / crime
    r"celebrity", r"royal family", r"prince", r"princess", r"king charles",
    r"kardashian", r"taylor swift", r"oscars?", r"netflix", r"recipe",
    r"horoscope", r"murder\w*", r"stabbing", r"stabbed", r"killed",
    r"killing", r"shooting", r"rape", r"arrested", r"jailed", r"sentenced",
    r"court hears", r"police hunt", r"dies",
    r"died", r"obituary", r"weather forecast",
    # reviews / spam / promo
    r"review:", r"hands-on", r"unboxing", r"live:", r"live updates", r"best deals", r"deal of the day",
    r"black friday", r"coupon", r"discount code", r"stock to buy",
    r"stocks to buy", r"shares to buy", r"should you buy", r"buy rating",
    r"price target", r"target price", r"dividend\w*", r"etf", r"crypto\w*", r"stocks? to watch",
    r"bitcoin", r"ethereum", r"market size", r"cagr", r"market report",
    r"market research", r"market share analysis", r"forecast to 20\d\d",
    r"20\d\d-20[3-9]\d", r"nyse", r"nasdaq", r"lon:", r"insider",
    r"holdings? (?:raised|lowered|trimmed|boosted)",
    r"acquires? shares", r"position in", r"podcast", r"live blog",
    r"as it happened", r"quiz", r"crossword", r"travel guide",
    r"holiday deals", r"cheap flights", r"things to do", r"ncap",
    # war-only framing (kept if economically framed - see below)
]) + r")(?![\w-])", re.I)
WAR_RE = re.compile(r"(?<![\w-])(?:missiles?|drones?|troops|airstrikes?|"
                    r"shelling|frontline|battlefield|ceasefire|offensive|"
                    r"invasion|nato|military|army|soldiers?|weapons?|defen[cs]e|arms)(?![\w-])", re.I)
STRONG_ECON_RE = re.compile(r"(?<![\w-])(?:econom\w*|inflation|gdp|recession|"
                            r"budget\w*|deficits?|debt|bonds?|yields?|tax\w*|"
                            r"unemploy\w*|jobs?|wages?|energy|electricity|gas prices|"
                            r"oil prices|housing|rents?|mortgages?|prices|"
                            r"industr\w*|manufactur\w*|exports?|tariffs?|"
                            r"spending|fiscal|growth|markets?|cost of living|"
                            r"insolvenc\w*|bankrupt\w*|layoffs|job cuts|"
                            r"interest rates?|investment)(?![\w-])", re.I)

SOURCE_BLOCKLIST = re.compile(
    r"marketbeat|simply wall|openpr|ein presswire|globenewswire|pr newswire|"
    r"prnewswire|business wire|accesswire|market\.us|zacks|tipranks|motley fool|"
    r"fool\.|benzinga|seeking alpha|ainvest|stocktitan|stock titan|"
    r"investing\.com india|marketscreener|gurufocus|defense world|"
    r"etf daily news|the globe and mail|tickerreport|dailypolitical|"
    r"thecryptobasic|coinpedia|newsbreak|msn|yahoo! voices|cointelegraph|"
    r"fxstreet|fxempire|forex|dailyfx|ig\b|finbold|economies\.com",
    re.I)


def is_relevant(title, source, countries):
    if SOURCE_BLOCKLIST.search(source or ""):
        return False
    if len(title) < 25 or len(title.split()) < 5:
        return False
    if not ECON_RE.search(title):
        return False
    if DROP_RE.search(title):
        return False
    if WAR_RE.search(title) and not STRONG_ECON_RE.search(title):
        return False
    # Politics-only items need a fiscal/economic hook or a government crisis
    if not STRONG_ECON_RE.search(title):
        if GOV_ONLY_RE.search(title) and not re.search(
                r"collapse|falls|resign|snap election|no-confidence|confidence vote|"
                r"coalition|budget|reform|crisis|toppl|ousted|deadlock", title, re.I):
            return False
    if not countries:
        return False
    # Mostly non-English titles
    non_ascii = sum(1 for ch in title if ord(ch) > 0x24F)
    if non_ascii > 3:
        return False
    return True


# ---------------------------------------------------------------------------
# Country detection
# ---------------------------------------------------------------------------

def detect_countries(title):
    hits = {}
    for code, rx in COUNTRY_RE:
        for m in rx.finditer(title):
            tok = m.group(0)
            if tok.lower() in CAP_REQUIRED and not tok[:1].isupper():
                continue
            hits[code] = m.start()
            break
    for code, rx in ACRONYM_RE:
        m = rx.search(title)
        if m and (code not in hits or m.start() < hits[code]):
            hits[code] = m.start()
    found = sorted(hits, key=hits.get)
    eu = False
    for m in EU_RE.finditer(title):
        tok = m.group(0)
        if tok.lower() in ("eu", "eu's") and not tok.startswith("EU"):
            continue
        eu = True
        break
    if eu:
        found.append("EU")
    return found


def has_non_europe(title):
    for m in NON_EUROPE_RE.finditer(title):
        tok = m.group(0)
        if tok.lower() == "us":
            if US_CASE_RE.search(tok):
                return True
            continue
        if tok.lower() == "fed" and tok != "Fed":
            continue
        return True
    return bool(US_CASE_RE.search(title))


# Outlets known to cover one country, so a headline with no place name in it
# (e.g. "Budget 2027: pensions to rise") can be trusted to be about the country
# whose query surfaced it. Supplemented at runtime by outlets learned from the
# data (sources whose place-named headlines are mostly about one country).
LOCAL_SOURCES = {
    "AT": r"austria|der standard|vindobona|kurier|die presse|orf",
    "BE": r"brussels times|belga|vrt|rtbf|belgi|l'echo|de tijd",
    "BG": r"novinite|bnr|бнр|bta|fakti|sofia|bulgaria|burgasmedia",
    "HR": r"croatia|hina|index\.hr|jutarnji",
    "CY": r"cyprus|philenews|in-cyprus|politis",
    "CZ": r"prague|czech|expats\.cz|[čc]tk|oenergetice",
    "DK": r"denmark|danish|energywatch|b[øo]rsen|copenhagen|the local dk|dr\.dk",
    "EE": r"\berr\b|postimees|estonia|delfi\.ee",
    "FI": r"\byle\b|helsinki|finland|finnish|talouselama|kauppalehti",
    "FR": r"france|french|le monde|connexion|\brfi\b|les echos|le figaro|lib[ée]ration",
    "DE": r"german|\bdw\b|deutsche welle|spiegel|handelsblatt|clean energy wire|tagesschau|faz|zeit|bild",
    "GR": r"greek|greece|kathimerini|tovima|to vima|keep talking greece|ertnews|naftemporiki",
    "HU": r"hungar|budapest|telex|portfolio\.hu|444|hvg|daily news hungary",
    "IE": r"irish|\brte|thejournal|business post|silicon republic|independent\.ie|ireland|department of",
    "IT": r"\bansa\b|italy|italian|wanted in rome|sole 24|corriere|repubblica|decode39|milano finanza",
    "LV": r"\blsm\b|latvia|\bbnn\b|baltic news|delfi\.lv",
    "LT": r"\blrt\b|lithuania|\bbns\b|delfi\.lt|15min",
    "LU": r"luxembourg|\bwort\b|rtl today|delano|chronicle\.lu",
    "MT": r"malta|maltatoday|lovin malta|\btvm|newsbook|the shift",
    "NL": r"nl times|dutchnews|dutch|centraal bureau|\bcbs\b|\bnos\b|nrc|volkskrant|iamexpat|netherlands",
    "PL": r"poland|polish|\btvp|notes from poland|\bpap\b|business insider polska|rzeczpospolita|ceo magazyn",
    "PT": r"portugal|portuguese|p[uú]blico|\beco\b|observador|expresso|idealista/pt",
    "RO": r"romania|agerpres|actmedia|business review|bursa|ziarul|digi24|hotnews|economica\.net",
    "SK": r"slovak|spectator\.sme|tasr|\bsme\b|aktuality",
    "SI": r"slovenia|\bsta\b|gov\.si|total slovenia|rtv slo|seenews",
    "ES": r"olive press|spain|spanish|el pa[ií]s|sur in english|majorca|idealista|thinkspain|euro weekly|el confidencial|expansi[oó]n|cinco d[ií]as|the corner|catalan news",
    "SE": r"sweden|swedish|the local se|\bsvt|sveriges|dagens industri|aftonbladet|\bdn\b",
    "GB": r"\bbbc|guardian|telegraph|\btimes\b|independent|i paper|sky news|city a\.?m|this is money|evening standard|\blbc|mirror|express|metro|daily mail|financial times|echo|herald|scotsman|belfast|wales ?online|yorkshire|manchester|chronicle|gazette|\bitv|channel 4|spectator|new statesman|cityam|money ?week|which\?|gov\.uk",
    "NO": r"norway|norwegian|\bnrk|\be24|the local no|newsinenglish|aftenposten|dagens n[æa]ringsliv|\bdn\.no",
    "CH": r"swissinfo|\bswi\b|swiss|\bnzz|\bsrf|switzerland|le temps|tages-anzeiger",
    "IS": r"iceland|r[uú]v|\bmbl|v[ií]sir|reykjavik|grapevine",
}
LOCAL_SOURCES_RX = {k: re.compile(v, re.I) for k, v in LOCAL_SOURCES.items()}


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------
# (category, [(regex, weight)]) - priority order is the list order for ties.
CATEGORY_RULES = [
    ("inflation", [
        (r"inflation\w*", 4), (r"deflation", 4), (r"disinflation", 4),
        (r"cpi", 4), (r"hicp", 4), (r"consumer prices", 4),
        (r"price (?:growth|rises|increases|pressures?)", 3),
        (r"prices? (?:rise|rises|rose|surge|soar|jump|climb)\w*", 2),
        (r"shop prices", 3), (r"core prices", 3)]),
    ("debt", [
        (r"bonds?", 3), (r"yields?", 3), (r"gilts?", 4), (r"bunds?", 4),
        (r"btps?", 4), (r"oats", 3), (r"spreads?", 2),
        (r"credit rating\w*", 5), (r"ratings?", 3), (r"downgrad\w*", 2),
        (r"upgrad\w*", 1), (r"moody'?s", 4), (r"fitch", 4), (r"s&p", 3),
        (r"scope ratings", 4), (r"dbrs", 4), (r"debt", 3),
        (r"sovereign", 3), (r"borrowing costs?", 4), (r"debt-to-gdp", 4),
        (r"eurobonds?", 4), (r"default", 3), (r"bond market", 4)]),
    ("jobs", [
        (r"unemploy\w*", 5), (r"jobless\w*", 5), (r"job cuts", 5),
        (r"job losses", 5), (r"lay ?offs?", 5), (r"layoffs", 5),
        (r"redundanc\w*", 5), (r"jobs?", 3), (r"workers?", 2),
        (r"workforce", 3), (r"staff", 2), (r"employ\w*", 3),
        (r"labou?r market", 4), (r"hiring", 3), (r"payrolls?", 4),
        (r"strikes?", 3), (r"unions?", 2), (r"axe\w*", 2),
        (r"(?:cut|cuts|cutting|shed|sheds|slash\w*) [\d,.]+ (?:jobs|roles|positions)", 5),
        (r"lays? off", 5), (r"laid off", 5), (r"buyouts?", 3)]),
    ("energy", [
        (r"energy", 4), (r"electricity", 5), (r"power (?:prices|bills|grid|plants?)", 5),
        (r"gas", 4), (r"natural gas", 5), (r"lng", 5), (r"oil", 3),
        (r"fuel", 3), (r"petrol", 4), (r"diesel", 4), (r"nuclear", 3),
        (r"renewables?", 4), (r"wind", 2), (r"solar", 3), (r"grid", 3),
        (r"blackouts?", 5), (r"heating", 3), (r"energy bills", 6),
        (r"opec", 4), (r"brent", 4)]),
    ("housing", [
        (r"housing", 5), (r"house prices", 6), (r"home prices", 6),
        (r"homes?", 2), (r"rents?", 4), (r"rental", 4), (r"renters", 5),
        (r"tenants?", 4), (r"mortgages?", 5), (r"property (?:market|prices)", 5),
        (r"landlords?", 4), (r"homebuyers?", 5), (r"first-time buyers?", 5),
        (r"housebuild\w*", 5), (r"real estate", 4), (r"evictions?", 5),
        (r"homeless\w*", 4), (r"affordable homes", 5)]),
    ("living", [
        (r"cost of living", 6), (r"cost-of-living", 6), (r"wages?", 3),
        (r"pay (?:rise|rises|growth|freeze|deal|gap)", 4), (r"salar\w*", 3),
        (r"poverty", 5), (r"purchasing power", 6), (r"food prices", 5),
        (r"grocer\w*", 4), (r"supermarket", 3), (r"households?", 3),
        (r"pensioners?", 3), (r"pensions?", 2), (r"minimum wage", 5),
        (r"benefits?", 2), (r"welfare", 3), (r"food banks?", 5),
        (r"living standards", 6), (r"real incomes?", 5), (r"squeeze\w*", 2),
        (r"consumer (?:confidence|spending|sentiment)", 3), (r"bills", 2),
        (r"inequality", 4), (r"childcare", 3)]),
    ("government", [
        (r"budget\w*", 5), (r"deficits?", 3), (r"tax\w*", 3),
        (r"coalition", 4), (r"elections?", 4), (r"snap election", 6),
        (r"government", 3), (r"parliament", 3), (r"minister\w*", 2),
        (r"chancellor", 2), (r"prime minister", 3), (r"no-confidence", 6),
        (r"confidence vote", 6), (r"austerity", 4), (r"spending cuts", 4),
        (r"public spending", 4), (r"fiscal", 3), (r"reforms?", 2),
        (r"policy", 1), (r"subsid\w*", 2), (r"treasury", 2), (r"obr", 3),
        (r"spending review", 5), (r"debt brake", 5), (r"resign\w*", 3),
        (r"cabinet", 3), (r"vote", 2), (r"lawmakers", 3), (r"senate", 2),
        (r"parties", 2), (r"president", 1), (r"stability pact", 4),
        (r"fiscal rules", 5), (r"public finances", 5)]),
    ("economy", [
        (r"gdp", 5), (r"growth", 3), (r"recession\w*", 5), (r"econom\w*", 3),
        (r"industr\w*", 4), (r"manufactur\w*", 4), (r"factor(?:y|ies)", 4),
        (r"pmi", 5), (r"exports?", 3), (r"tariffs?", 3), (r"trade", 2),
        (r"business\w*", 2), (r"insolvenc\w*", 4), (r"bankrupt\w*", 4),
        (r"output", 3), (r"production", 3), (r"investment", 2),
        (r"interest rates?", 3), (r"rate cuts?", 3), (r"rate hikes?", 3),
        (r"rates", 2), (r"ecb", 2), (r"central bank", 2), (r"stagnat\w*", 4),
        (r"contraction", 4), (r"car ?makers?", 4), (r"automakers?", 4),
        (r"steel", 4), (r"chemical\w*", 3), (r"competitiveness", 4),
        (r"productivity", 3), (r"forecasts?", 2), (r"outlook", 2),
        (r"profits?", 2), (r"sales", 2), (r"retail", 2), (r"orders", 3),
        (r"markets?", 1), (r"stocks?", 1)]),
]
CATEGORY_RX = [(cat, [(re.compile(r"(?<![\w-])" + p + r"(?![\w-])", re.I), w) for p, w in rules])
               for cat, rules in CATEGORY_RULES]


def categorise(title):
    best, best_score = "economy", 0
    for cat, rules in CATEGORY_RX:
        score = 0
        for rx, w in rules:
            if rx.search(title):
                score += w
        if score > best_score:
            best, best_score = cat, score
    return best


# ---------------------------------------------------------------------------
# Severity / direction
# ---------------------------------------------------------------------------
BAD_UP = {
    "inflation", "prices", "price", "cpi", "hicp", "costs", "cost", "bills",
    "unemployment", "jobless", "joblessness", "debt", "debts", "deficit",
    "deficits", "borrowing", "yields", "yield", "spreads", "spread", "rents",
    "rent", "insolvencies", "insolvency", "bankruptcies", "layoffs",
    "redundancies", "arrears", "evictions", "poverty", "defaults", "tariffs",
    "tariff", "taxes", "tax", "rates", "rate", "premiums", "losses", "loss",
    "homelessness", "fares", "tolls", "levy", "levies", "vat", "fees",
    "charges", "risk", "risks", "claims", "closures", "oil", "fuel",
    "energy", "gas", "electricity", "petrol", "diesel", "mortgage",
    "mortgages", "premium", "fears", "burden",
}
GOOD_UP = {
    "growth", "gdp", "economy", "output", "production", "confidence",
    "sentiment", "sales", "exports", "wages", "wage", "pay", "employment",
    "jobs", "job", "investment", "orders", "pmi", "activity", "surplus",
    "profits", "profit", "earnings", "demand", "lending", "revenue",
    "revenues", "shares", "stocks", "productivity", "morale", "outlook",
    "forecast", "forecasts", "manufacturing", "industry", "services",
    "construction", "retail", "tourism", "spending", "workforce", "staff",
    "roles", "positions", "workers", "income", "incomes", "savings",
    "purchasing", "hiring", "expansion", "economic", "industrial",
    "pensions", "pension", "cola", "factories", "plants", "firms",
    "companies", "businesses", "fertility", "births", "population",
    "startups", "lending", "loans", "credit", "approvals", "tourists",
}
UP_VERBS = {
    "rise", "rises", "rising", "rose", "risen", "climb", "climbs", "climbed",
    "climbing", "jump", "jumps", "jumped", "soar", "soars", "soared",
    "soaring", "surge", "surges", "surged", "surging", "increase",
    "increases", "increased", "increasing", "accelerate", "accelerates",
    "accelerated", "accelerating", "higher", "up", "spike", "spikes",
    "spiked", "rebound", "rebounds", "rebounded", "grow", "grows", "grew",
    "growing", "expand", "expands", "expanded", "expanding", "high", "highs",
    "highest", "peak", "peaks", "beats", "tops", "boost", "boosts", "boosted",
    "doubles", "doubled", "rocket", "rockets", "rocketed", "balloon",
    "balloons", "ballooned", "swell", "swells", "swelled", "raise", "raises",
    "raised", "raising", "lift", "lifts", "lifted", "hike", "hikes",
    "hiked", "hiking", "strengthens", "strengthened", "improve", "improves",
    "improved", "improving", "recover", "recovers", "recovered", "gains",
    "gain", "gained", "widen", "widens", "widened", "widening", "hotter",
    "sticky", "persistent", "stubborn", "spiral", "spiralling", "spiraling",
    "skyrocket", "skyrockets", "skyrocketing", "upturn", "picks",
    "elevated",
}
DOWN_VERBS = {
    "fall", "falls", "fell", "falling", "fallen", "drop", "drops", "dropped",
    "dropping", "decline", "declines", "declined", "declining", "slow",
    "slows", "slowed", "slowing", "slowdown", "ease", "eases", "eased",
    "easing", "cool", "cools", "cooled", "cooling", "slump", "slumps",
    "slumped", "plunge", "plunges", "plunged", "plummet", "plummets",
    "plummeted", "sink", "sinks", "sank", "tumble", "tumbles", "tumbled",
    "lower", "down", "low", "lowest", "shrink", "shrinks", "shrank",
    "shrinking", "contract", "contracts", "contracted", "contracting",
    "contraction", "dip", "dips", "dipped", "weaken", "weakens", "weakened",
    "weakening", "slide", "slides", "slid", "retreat", "retreats", "cut",
    "cuts", "cutting", "slashed", "slash", "slashes", "slashing", "halve",
    "halved", "stall", "stalls", "stalled", "stagnate", "stagnates",
    "stagnated", "stagnant", "flat", "misses", "missed", "shed", "sheds",
    "shedding", "axe", "axes", "axed", "axing", "lose", "loses", "losing",
    "lost", "narrow", "narrows", "narrowed", "freeze", "frozen", "trim",
    "trims", "trimmed", "reduce", "reduces", "reduced", "downturn", "weaker",
    "softer", "subdued", "sluggish", "worst", "collapse", "collapses",
    "collapsed", "crash", "crashes", "crashed", "downgrade", "downgrades",
    "downgraded", "wane", "wanes", "waned", "waning", "fade", "fades",
    "faded", "slip", "slips", "slipped", "lowers", "lowered", "erode",
    "erodes", "eroded", "evaporate", "evaporates",
}
INTENSE = {"soar", "soars", "soared", "soaring", "surge", "surges", "surged",
           "surging", "plunge", "plunges", "plunged", "plummet", "plummets",
           "plummeted", "slump", "slumps", "slumped", "tumble", "tumbles",
           "tumbled", "rocket", "rockets", "rocketed", "doubles", "doubled",
           "highest", "lowest", "record", "worst", "collapse", "collapses",
           "collapsed", "crash", "crashes", "crashed", "skyrocket",
           "skyrockets", "skyrocketing", "spiral", "spiralling", "halved",
           "halve", "thousands", "decade", "decades"}

BAD_TERMS = [
    (r"recession\w*", 5), (r"bankrupt\w*", 5), (r"insolvenc(?:y|ies)", 4),
    (r"insolvent", 5), (r"collaps\w*", 5), (r"crash\w*", 4),
    (r"(?:credit )?rating downgrade\w*", 5),
    (r"downgrade\w*(?: \w+){0,3} (?:rating|outlook|credit)", 5),
    (r"(?:moody'?s|fitch|s&p|scope|dbrs)(?: \w+){0,3} (?:downgrade\w*|cuts?)", 5),
    (r"downgrad\w*", 3), (r"mass layoffs", 6), (r"thousands of jobs", 5),
    (r"[\d,.]+ jobs", 2), (r"defaults?", 3), (r"bail ?out\w*", 4), (r"junk", 4),
    (r"meltdown", 5), (r"toppled", 5), (r"ousted", 4), (r"falls? apart", 5),
    (r"government (?:collapse\w*|falls|fell)", 6), (r"no-confidence", 3),
    (r"confidence vote", 2), (r"snap elections?", 3), (r"resign\w*", 2),
    (r"debt crisis", 5), (r"record debt", 5), (r"crisis", 3), (r"crises", 3),
    (r"lay ?offs?", 3), (r"layoffs", 3), (r"job cuts", 3), (r"job losses", 4),
    (r"redundanc\w*", 3), (r"closures?", 3), (r"to close", 3),
    (r"shr[iau]nk\w*", 2),
    (r"shut\w*", 3), (r"shutdown", 3), (r"stagnat\w*", 3),
    (r"contraction", 3), (r"austerity", 3), (r"spending cuts", 3),
    (r"worst", 2), (r"deepest", 2), (r"emergency", 3), (r"warns?", 2),
    (r"warning", 2), (r"losses", 2), (r"fears?", 2), (r"feared", 2),
    (r"threat\w*", 1), (r"at risk", 2), (r"risks?", 1), (r"squeez\w*", 2),
    (r"strain\w*", 2), (r"pressures?", 1), (r"struggl\w*", 2), (r"gloom\w*", 2),
    (r"woes", 2), (r"turmoil", 3), (r"unrest", 2), (r"strikes?", 2),
    (r"walkouts?", 2), (r"protests?", 1), (r"weak\w*", 2), (r"sluggish", 2),
    (r"blow", 2), (r"poverty", 2), (r"homeless\w*", 2), (r"evictions?", 2),
    (r"shortages?", 2), (r"debt", 1), (r"deficits?", 1), (r"tariffs?", 1),
    (r"sanctions", 1), (r"exodus", 2), (r"worse\w*", 2), (r"worsen\w*", 2),
    (r"deteriorat\w*", 2), (r"slowdown", 2), (r"headwinds", 1),
    (r"uncertain\w*", 1), (r"volatil\w*", 1), (r"plight", 2), (r"pain\w*", 2),
    (r"grim", 2), (r"bleak", 2), (r"dire", 3), (r"alarm\w*", 2),
    (r"black hole", 3), (r"chaos", 3), (r"chaotic", 3), (r"deadlock\w*", 2),
    (r"gridlock", 2), (r"impasse", 2), (r"paralys\w*", 2), (r"scandal", 2),
    (r"fraud", 2), (r"u-turn", 1), (r"overrun\w*", 2), (r"spiral\w*", 2),
    (r"skyrocket\w*", 2), (r"hammer\w*", 2), (r"hit hard", 2), (r"hard-hit", 2),
    (r"hit by", 1), (r"hits? to", 1), (r"concern\w*", 1), (r"jitters", 2),
    (r"panic", 3), (r"distress\w*", 2), (r"in the red", 2), (r"red ink", 2),
    (r"tax (?:rises?|hikes?|increases?|raid)", 2), (r"cost of living crisis", 2),
    (r"cost-of-living crisis", 2), (r"slash\w*", 1), (r"axe\w*", 2),
    (r"scrap\w*", 1), (r"delay\w*", 1), (r"backlash", 1), (r"setback", 2),
    (r"fails?", 2), (r"failed", 2), (r"failure", 2), (r"miss(?:es|ed)", 1),
    (r"bust", 3), (r"exit\w*", 1), (r"relocat\w*", 1), (r"leaves?", 1),
    (r"pull(?:s|ing)? out", 2), (r"moves? production", 2), (r"flee\w*", 2),
    (r"brain drain", 2), (r"deindustriali[sz]\w*", 4), (r"sick man", 3),
    (r"hollowing", 2), (r"unaffordab\w*", 2), (r"stagflation", 4),
    (r"stuck", 1), (r"trapped", 2), (r"los(?:e|es|ing|t)", 2),
    (r"lays? off", 3), (r"laid off", 3), (r"laying off", 3),
    (r"cost[- ]cut\w*", 2), (r"punish\w*", 2), (r"slap in the face", 2),
    (r"unresolved", 1), (r"tighten\w*", 1), (r"red flags?", 2),
    (r"holding back", 2), (r"burden\w*", 1), (r"complicated", 1), (r"downturn", 2), (r"slump\w*", 2),
    (r"plung\w*", 2), (r"tumbl\w*", 1), (r"lowest", 1), (r"highest", 1),
]
GOOD_TERMS = [
    (r"recover(?:y|s|ed|ing)?", 2), (r"rebound\w*", 1), (r"boost\w*", 1),
    (r"upgrade\w*", 2), (r"surplus", 2), (r"beats? (?:expectations|forecasts|estimates)", 2),
    (r"better than expected", 2), (r"better-than-expected", 2),
    (r"stronger", 1), (r"strong", 1), (r"robust", 2), (r"resilien\w*", 2),
    (r"optimis\w*", 2), (r"deal agreed", 1), (r"agrees? deal", 1),
    (r"creates? (?:[\d,.]+ )?jobs", 2), (r"new jobs", 2), (r"boom\w*", 2),
    (r"thriv\w*", 2), (r"cheaper", 2), (r"relief", 1), (r"record low unemployment", 3),
    (r"avoids? recession", 4), (r"exits? recession", 4), (r"out of recession", 4),
    (r"rate cuts?", 1), (r"cuts? (?:interest )?rates", 1), (r"tax cuts?", 1),
    (r"pay rises?", 1), (r"wage growth", 1), (r"outperform\w*", 2),
    (r"fastest", 1), (r"bright spot", 2), (r"improv\w*", 1),
    (r"easing", 1), (r"ease", 1), (r"cooling", 1), (r"stabilis\w*", 1),
    (r"stabiliz\w*", 1),
]
BAD_RX = [(re.compile(r"(?<![\w-])" + p + r"(?![\w-])", re.I), w) for p, w in BAD_TERMS]
GOOD_RX = [(re.compile(r"(?<![\w-])" + p + r"(?![\w-])", re.I), w) for p, w in GOOD_TERMS]
NEGATORS = re.compile(r"(?<!\w)(?:despite|avoid\w*|avert\w*|escap\w*|dodg\w*|"
                      r"stave\w* off|no|not|isn'?t|aren'?t|won'?t|ends?|ended|exit\w*|"
                      r"emerg\w*|out of|fend\w* off|surviv\w*|ward\w* off|rules? out|"
                      r"ruled out|recover\w* from|bounce\w* back from|after|post-|"
                      r"learn\w* from|lessons? from)\W+(?:[\w']+\W+){0,3}$", re.I)
POST_NEG = re.compile(r"\W+(?:[\w']+\W+)?(?:avoided|averted|ruled out|dodged|"
                      r"staved off|unlikely|fades|faded|is over|ended|recedes|receded)", re.I)
TOKEN_RE = re.compile(r"[a-z0-9%]+(?:['-][a-z0-9]+)*")


ATTRIBUTIVE = {"high", "higher", "highest", "low", "lower", "lowest", "rising",
               "falling", "soaring", "surging", "elevated", "weak", "weaker",
               "strong", "stronger", "sticky", "persistent", "stubborn",
               "spiralling", "spiraling", "skyrocketing", "plunging",
               "slowing", "sluggish", "subdued", "softer", "hotter",
               "growing", "declining", "shrinking", "widening", "frozen"}
TRANSITIVE = {"cut", "cuts", "cutting", "slash", "slashes", "slashed",
              "slashing", "raise", "raises", "raised", "raising", "lift",
              "lifts", "lifted", "hike", "hikes", "hiked", "hiking", "boost",
              "boosts", "boosted", "axe", "axes", "axed", "axing", "shed",
              "sheds", "shedding", "reduce", "reduces", "reduced", "trim",
              "trims", "trimmed", "halve", "halved", "doubles", "doubled",
              "lose", "loses", "losing", "lost", "freeze", "increase",
              "increases", "increased", "downgrade", "downgrades",
              "downgraded", "lowers", "lowered"}
MACRO = {"gdp", "economy", "growth", "output", "unemployment", "jobless",
         "inflation", "production", "employment", "debt", "deficit", "prices"}
JOBS_N_RE = re.compile(r"(\d[\d,.]*)\s*(k\b|thousand\b)?\s*(?:\w+\s+)?(?:jobs|roles|positions|"
                       r"workers|staff|employees|redundancies|layoffs)", re.I)


def subject_verb_score(title):
    low = title.lower()
    low = re.sub(r"\b(?:fertility|birth) rates?\b", "fertility", low)
    low = re.sub(r"\bcosts? (?:cut\w*|saving\w*)|cost-cutting", "costcutting", low)
    low = re.sub(r"\b(?:interest )?rate cuts?\b", "ratecut", low)
    toks = TOKEN_RE.findall(low)
    bad = good = 0
    used = set()
    for i, t in enumerate(toks):
        if t not in UP_VERBS and t not in DOWN_VERBS:
            continue
        up = t in UP_VERBS and t not in DOWN_VERBS
        nxt = toks[i + 1] if i + 1 < len(toks) else ""
        # Where to look for the thing that rose/fell:
        #  "rising prices", "high inflation"  -> forward (attributive)
        #  "cuts 2,000 jobs", "raises taxes"  -> forward first (transitive)
        #  "rise in unemployment"             -> forward
        #  "inflation rises"                  -> backward only
        if t in ATTRIBUTIVE or t.endswith("ing") or t in TRANSITIVE:
            order = ["f", "b"]
        else:
            order = ["b"]
        subj = None
        # noun use: "rise in unemployment", "fall of output"
        if nxt in ("in", "of") and i + 2 < len(toks) and (i + 2) not in used and (
                toks[i + 2] in BAD_UP or toks[i + 2] in GOOD_UP):
            subj = i + 2
            order = []
        for direction_ in order:
            if direction_ == "f":
                rng = range(i + 1, min(len(toks), i + 5))
            else:
                rng = range(i - 1, max(-1, i - 6), -1)
            for j in rng:
                if j in used:
                    continue
                if toks[j] in BAD_UP or toks[j] in GOOD_UP:
                    subj = j
                    break
            if subj is not None:
                break
        if subj is None:
            continue
        used.add(subj)
        s = toks[subj]
        window = toks[max(0, i - 4): i + 5]
        weight = 2
        if s in MACRO:
            weight += 1
        if t in INTENSE or any(w in INTENSE for w in window):
            weight += 2
        if "record" in window:
            weight += 1
        is_bad_subject = s in BAD_UP
        if s in ("rates", "rate"):
            weight = 1
        if s in ("job", "jobs", "workers", "staff", "roles", "positions", "workforce") and not up:
            weight += 1
        if is_bad_subject == up:
            bad += weight
        else:
            good += weight
    return min(bad, 6), min(good, 6)


def severity_of(title):
    title = title.replace("\u2019", "'").replace("\u2018", "'")
    bad, good = subject_verb_score(title)
    for rx, w in BAD_RX:
        for m in rx.finditer(title):
            prefix = title[max(0, m.start() - 25): m.start()]
            suffix = title[m.end(): m.end() + 20]
            if NEGATORS.search(prefix) or POST_NEG.match(suffix):
                good += 1
            else:
                bad += w
            break
    for rx, w in GOOD_RX:
        if rx.search(title):
            good += w
    m = JOBS_N_RE.search(title)
    if m and not re.search(r"creat|new|add|hir", title, re.I):
        try:
            n = float(m.group(1).replace(",", ""))
            if m.group(2):
                n *= 1000
            if n >= 5000:
                bad += 3
            elif n >= 1000:
                bad += 2
        except ValueError:
            pass
    # "Inflation eases" type headlines: good wins only if no strong bad markers
    net = bad - good
    if net >= 8:
        sev = 3
    elif net >= 4:
        sev = 2
    elif net >= 1:
        sev = 1
    else:
        sev = 0
    # severe-only markers can lift to 3
    if sev == 2 and re.search(r"(?<![\w-])(?:recession|bankrupt\w*|insolven\w*|collaps\w*|"
                              r"downgrad\w* (?:\w+ ){0,3}(?:rating|credit)|mass layoffs|"
                              r"thousands of jobs|government (?:collapse\w*|falls)|toppled|"
                              r"record (?:high|debt|deficit)|stagflation|meltdown|"
                              r"deindustriali[sz]\w*)(?![\w-])", title, re.I):
        sev = 3
    if net >= 1:
        direction = "down"
    elif net <= -1:
        direction = "up"
    else:
        direction = "flat"
    return sev, direction


# ---------------------------------------------------------------------------
# Memos
# ---------------------------------------------------------------------------
MEMOS = {
    "general": [
        "Status: noted, minuted, ignored.",
        "Forwarded to the relevant committee, which is itself under review.",
        "Action: a working group will be convened to consider convening a working group.",
        "Classified as 'regrettable'. Filed alphabetically.",
        "Ministers are monitoring the situation closely, from a safe distance.",
        "Cross-referenced with last year's file. It is the same file.",
        "Assessment: not ideal. Further assessment: also not ideal.",
        "Lessons will be learned at a date to be confirmed.",
        "Stamped, scanned and placed in the tray marked 'eventually'.",
        "Communique drafted. Adjectives softened.",
        "Directorate notes: the trend remains, regrettably, a trend.",
        "Filed in triplicate. Two copies lost in a restructuring.",
    ],
    "inflation": [
        "Filed under: things that were supposed to be temporary.",
        ("Directorate notes: transitory, again, for a further consecutive year.", r"inflation|prices"),
        "Price stability remains the objective. Prices remain unaware of this.",
        ("Basket of goods re-weighed. Basket found lighter.", r"prices|inflation|food|shop|grocer"),
        ("Target reaffirmed at two per cent. Reality has requested an extension.", r"inflation|cpi|hicp|ecb|central bank"),
    ],
    "economy": [
        ("Directorate notes: forecast revised, again.", r"forecast|outlook|growth|gdp|projection"),
        ("Growth located. Size of growth: under investigation.", r"grow|growth|gdp|expan"),
        ("Industrial strategy to be published shortly. Industry advised not to wait.", r"industr|factor|manufactur|plant|car|steel|chemical"),
        "Officially a 'soft patch'. The patch now covers most of the map.",
        ("Competitiveness report commissioned. Previous report still in its envelope.", r"competitiv|industr|business|firms"),
    ],
    "government": [
        ("Budget balanced, in the sense that the problems are evenly distributed.", r"budget"),
        ("A consultation will be launched on whether to hold a consultation.", r"budget|plan|proposal|government|minister|policy|tax"),
        ("Coalition talks continue. Refreshments have been budgeted for.", r"coalition|talks|negotiat|parties"),
        ("The fiscal rules have been reinterpreted, respectfully.", r"fiscal|deficit|debt|borrow|rules"),
        ("Reform announced. Implementation reserved for a future government.", r"reform|plan|overhaul|pledge|promise"),
    ],
    "jobs": [
        ("Restructuring confirmed. The word 'synergies' was used without irony.", r"cut|layoff|lay off|redundanc|restructur|axe|shed|jobs"),
        ("Labour market described as 'adjusting'. The adjusted were not consulted.", r"unemploy|jobless|labou?r market|jobs|employment"),
        ("Sympathies to the workforce; a raised eyebrow to the boardroom.", r"cut|layoff|lay off|redundanc|axe|shed|close|closure"),
        ("Retraining scheme announced. Scheme currently retraining itself.", r"cut|layoff|lay off|redundanc|axe|shed|unemploy"),
    ],
    "energy": [
        ("Energy security strategy updated. Strategy remains: hope for a mild winter.", r"gas|energy|lng|winter|heating"),
        ("Thermostat policy under review. Jumpers recommended pending outcome.", r"gas|heating|winter|bills|energy prices"),
        ("Grid capacity located. It was in a different decade.", r"grid|electricity|power|renewable|nuclear|blackout"),
        ("Bills described as 'elevated'. Citizens described as 'aware'.", r"bills|prices|tariff|cost"),
    ],
    "debt": [
        ("Debt sustainability reaffirmed, with fingers crossed in triplicate.", r"debt|deficit|borrow"),
        ("Bond markets have been informed. Bond markets already knew.", r"bond|yield|gilt|bund|btp|oat|spread|market"),
        ("Rating agency letter received. Opened with tongs.", r"rating|moody|fitch|s&p|scope|dbrs|downgrad|outlook"),
        ("Spread widening noted. Spreadsheet widening also noted.", r"spread|yield"),
    ],
    "housing": [
        ("Housing target reaffirmed. Houses not yet informed.", r"hous|homes|build|construction"),
        ("Planning application lodged some years ago. Status: being planned.", r"hous|homes|build|construction|planning"),
        ("Rent described by officials as 'a market signal'. Tenants received the signal.", r"rent|tenant|landlord"),
        ("Affordability index updated. Index no longer affordable to compile.", r"afford|prices|rent|mortgage|loan"),
    ],
    "living": [
        ("Purchasing power confirmed to exist, theoretically.", r"wage|pay|income|purchasing|prices|cost of living|cost-of-living"),
        ("Households advised to tighten belts. Belt prices under review.", r"household|famil|cost of living|cost-of-living|prices|bills|consumer"),
        "The squeeze continues. The Directorate regrets the word 'continues'.",
        "Living standards placed under observation. Visiting hours limited.",
    ],
    "severe": [
        "Escalated to the Head of Unit, who has escalated it back.",
        "Upgraded from 'concerning' to 'deeply concerning'. Stationery order placed.",
        "Emergency summit scheduled. Catering confirmed; solutions to follow.",
        "Red folder issued. The Directorate has run out of red folders.",
        "Situation now 'fluid'. Officials have been issued buckets.",
    ],
    "up": [
        "Good news received. Verified twice. Filed under 'anomalies'.",
        "A rare positive filing. Staff have been asked to remain calm.",
        "Improvement noted. Not to be confused with a trend.",
        "Positive development logged. Ministers will claim it shortly.",
        ("Better than expected, expectations having been managed accordingly.", r"expect|forecast|beat|outlook|data|figures|growth|rises|falls|eases"),
        ("Recovery sighted. Officials have asked it not to make sudden movements.", r"recover|rebound|grow|growth|gdp|expan|upturn"),
    ],
    "flat": [
        "Nothing happened, officially. Minutes to follow.",
        "Situation stable. 'Stable' is used here in its relative sense.",
        "Filed for completeness. Completeness remains elusive.",
        "Statement issued. Statement contained words.",
    ],
}


def pick_memo(h, category, severity, direction, title=""):
    """Deterministic memo: pool depends on category/severity/direction; templates
    carrying a keyword condition are only eligible when the headline matches."""
    n = int(h, 16)
    if direction == "up":
        pool = MEMOS["up"]
    elif direction == "flat" or severity == 0:
        pool = MEMOS["flat"] + MEMOS["general"][:4] + MEMOS.get(category, [])
    elif severity >= 3:
        pool = MEMOS["severe"] + MEMOS.get(category, [])
    else:
        pool = MEMOS.get(category, []) + MEMOS["general"]
    eligible = []
    for m in pool:
        if isinstance(m, tuple):
            if re.search(m[1], title, re.I):
                eligible.append(m[0])
        else:
            eligible.append(m)
    return eligible[n % len(eligible)]


# ---------------------------------------------------------------------------
# Dedupe + clustering
# ---------------------------------------------------------------------------
STOP = set("""a an the and or of to in on for at by with from as is are was were be
been it its this that these those after before over under into out up down new
says said say amid as but not no than more most less least will would could can
may might has have had do does did why how what who when where which while about
against between during through per vs via just also again still yet own their
they them he she his her we our you your i""".split())


def norm_title(t):
    t = t.lower()
    t = re.sub(r"[‘’“”'\"`]", "", t)
    t = re.sub(r"[^a-z0-9%]+", " ", t)
    return t.strip()


def tokens(t):
    return {w for w in norm_title(t).split() if w not in STOP and len(w) > 1}


PREFERRED_SOURCES = ["Reuters", "Bloomberg", "Financial Times", "BBC", "The Guardian",
                     "POLITICO", "Euronews", "Associated Press", "AP News", "CNBC",
                     "DW", "Deutsche Welle", "Le Monde", "The Economist", "Bloomberg.com",
                     "The Irish Times", "France 24", "RTE", "Sky News", "The Times",
                     "European Central Bank", "Eurostat", "Al Jazeera", "Yahoo Finance"]


def source_rank(src):
    for i, p in enumerate(PREFERRED_SOURCES):
        if p.lower() in (src or "").lower():
            return i
    return len(PREFERRED_SOURCES)


def cluster(items):
    """items sorted by published asc. Greedy clustering on token Jaccard."""
    clusters = []  # list of dict(seed_tokens, members)
    index = {}  # token -> set(cluster ids)
    for it in items:
        tk = it["_tokens"]
        cand = set()
        for w in tk:
            cand |= index.get(w, set())
        best, best_j = None, 0.0
        for cid in cand:
            st = clusters[cid]["tokens"]
            inter = len(tk & st)
            if not inter:
                continue
            j = inter / len(tk | st)
            if j > best_j:
                best, best_j = cid, j
        if best is not None and best_j >= 0.5:
            clusters[best]["members"].append(it)
        else:
            cid = len(clusters)
            clusters.append({"tokens": tk, "members": [it]})
            for w in tk:
                index.setdefault(w, set()).add(cid)
    return [c["members"] for c in clusters]


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def flag_emoji(code):
    return "".join(chr(0x1F1E6 + ord(ch) - ord("A")) for ch in code.upper())


def load_archive(now):
    try:
        with open(ARCHIVE, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return []
    out = []
    cutoff = now - timedelta(days=HISTORY_DAYS)
    for r in data.get("items", []):
        d = parse_date(r.get("published"))
        if d and d >= cutoff:
            out.append({"title": r["title"], "source": r["source"], "url": r["url"],
                        "published": d, "hints": r.get("hints", [])})
    return out


def save_archive(raw_items):
    """One item per line so that git diffs between runs stay small."""
    rows = [{"title": r["title"], "source": r["source"], "url": r["url"],
             "published": iso(r["published"]), "hints": r.get("hints", [])}
            for r in raw_items]
    rows.sort(key=lambda r: (r["published"], r["title"]), reverse=True)
    lines = [json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows]
    text = ('{"updated":"%s","items":[\n' % iso(datetime.now(timezone.utc))
            + ",\n".join(lines) + "\n]}\n")
    write_atomic(ARCHIVE, text)


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def process(raw, now, kept_keys=None):
    cutoff = now - timedelta(days=HISTORY_DAYS)
    # 1. exact dedupe by normalised title, merging query hints
    by_norm = {}
    for r in raw:
        if not r.get("title") or not r.get("published"):
            continue
        if r["published"] < cutoff or r["published"] > now + timedelta(hours=2):
            continue
        k = norm_title(r["title"]) + "||" + (r["source"] or "").lower()
        if k in by_norm:
            ex = by_norm[k]
            for h in r.get("hints", []):
                if h not in ex["hints"]:
                    ex["hints"].append(h)
            if r["published"] < ex["published"]:
                ex["published"] = r["published"]
        else:
            by_norm[k] = {**r, "hints": list(r.get("hints", []))}
    deduped = list(by_norm.values())

    # 2. learn which outlets are local to one country
    src_counts, src_total = {}, {}
    for r in deduped:
        r["_detected"] = detect_countries(r["title"])
        cs = [c for c in r["_detected"] if c != "EU"]
        if cs:
            s = (r["source"] or "").lower()
            src_total[s] = src_total.get(s, 0) + 1
            for c in cs:
                src_counts.setdefault(s, {})
                src_counts[s][c] = src_counts[s].get(c, 0) + 1

    def is_local(source, code):
        if code == "EU":
            return True
        if code in LOCAL_SOURCES_RX and LOCAL_SOURCES_RX[code].search(source or ""):
            return True
        s = (source or "").lower()
        n = src_counts.get(s, {}).get(code, 0)
        return n >= 2 and n >= 0.5 * src_total.get(s, 1)

    # 3. countries + relevance
    kept = []
    for r in deduped:
        title = r["title"]
        european = list(r["_detected"])
        if not european:
            if has_non_europe(title):
                continue
            # no place named in the headline: fall back on the query's country,
            # but only when the outlet is local to it
            ch = [h for h in r["hints"] if h and is_local(r["source"], h)]
            if len(ch) > 2:
                continue
            european = ch
        if not is_relevant(title, r["source"], european):
            continue
        r["countries"] = european
        r["_tokens"] = tokens(title)
        if len(r["_tokens"]) < 3:
            continue
        kept.append(r)
        if kept_keys is not None:
            kept_keys.add(norm_title(title) + "||" + (r["source"] or "").lower())

    # 4. cluster near-duplicates
    kept.sort(key=lambda r: r["published"])
    out = []
    for members in cluster(kept):
        # distinct sources
        seen_src, uniq = set(), []
        for m in members:
            s = m["source"].lower()
            if s not in seen_src:
                seen_src.add(s)
                uniq.append(m)
        rep = sorted(uniq, key=lambda m: (source_rank(m["source"]), m["published"]))[0]
        countries = []
        for m in members:
            for c in m["countries"]:
                if c not in countries:
                    countries.append(c)
        # put title-detected ones first; prefer the representative's own countries
        rep_c = [c for c in rep["countries"]]
        # Only use countries detected by any member *title*, else hints
        title_c = []
        for m in members:
            for c in detect_countries(m["title"]):
                if c not in title_c:
                    title_c.append(c)
        final_c = title_c or rep_c or countries
        corroboration = len(uniq)
        sev, direction = severity_of(rep["title"])
        cat = categorise(rep["title"])
        points = round(sev * (1 + 0.25 * min(corroboration - 1, 4)), 2)
        h = hashlib.sha1((norm_title(rep["title"]) + rep["source"]).encode("utf-8")).hexdigest()
        latest = max(m["published"] for m in members)
        first = min(m["published"] for m in members)
        out.append({
            "id": h[:12],
            "title": rep["title"],
            "source": rep["source"],
            "url": rep["url"],
            "published": iso(first if corroboration > 1 else rep["published"]),
            "category": cat,
            "countries": final_c,
            "severity": sev,
            "direction": direction,
            "points": points,
            "corroboration": corroboration,
            "also": [{"source": m["source"], "url": m["url"]}
                     for m in uniq if m is not rep][:3],
            "memo": pick_memo(h, cat, sev, direction, rep["title"]),
            "_dt": first if corroboration > 1 else rep["published"],
            "_latest": latest,
            "_sources": {m["source"] for m in uniq},
        })
    out.sort(key=lambda x: x["_dt"], reverse=True)
    return out


def league(items, now):
    def window_stats(code, start, end):
        f, p, sev2 = 0, 0.0, 0
        for it in items:
            if code in it["countries"] and start <= it["_dt"] < end and it["severity"] >= 1:
                f += 1
                p += it["points"]
                if it["severity"] >= 2:
                    sev2 += 1
        return f, p, sev2

    coverage = {}
    for code, *_ in COUNTRIES:
        total = sum(1 for it in items if code in it["countries"])
        coverage[code] = max(1.0, total / 5.0)

    def score(raw, code):
        return round(raw / math.sqrt(coverage[code]) * 10, 1)

    week = timedelta(days=7)
    # Weekly volume normalisation for the form guide / sparkline: early in the
    # archive's life (and because news search favours recency) recent weeks
    # hold more items, so each week is scaled to the average weekly volume.
    vol = []
    for k in range(5):
        start = now - (5 - k) * week
        end = now - (4 - k) * week if k < 4 else now + timedelta(hours=2)
        vol.append(sum(1 for it in items if start <= it["_dt"] < end))
    avg_vol = (sum(vol) / 5.0) or 1.0
    factor = [avg_vol / v if v else 1.0 for v in vol]
    rows = []
    for code, slug, name, _, _ in COUNTRIES:
        f7, p7, _ = window_stats(code, now - week, now + timedelta(hours=2))
        fprev, pprev, _ = window_stats(code, now - 2 * week, now - week)
        f28, p28, _ = window_stats(code, now - 4 * week, now + timedelta(hours=2))
        fs, ps, _ = window_stats(code, now - 5 * week, now + timedelta(hours=2))
        weekly, weekly_sev2 = [], []
        for k in range(5):
            start = now - (5 - k) * week
            end = now - (4 - k) * week if k < 4 else now + timedelta(hours=2)
            fw, pw, s2 = window_stats(code, start, end)
            weekly.append(score(pw * factor[k], code))
            weekly_sev2.append(s2)
        med = statistics.median(weekly)
        form = []
        for s, s2 in zip(weekly, weekly_sev2):
            if s > med and s2 >= 1:
                form.append("L")
            elif s == 0 or s < 0.5 * med:
                form.append("W")
            else:
                form.append("D")
        rows.append({
            "code": code, "slug": slug, "name": name, "flag": flag_emoji(code),
            "score": score(p7, code), "filings": f7, "points": round(p7, 2),
            "coverage": round(coverage[code], 1), "form": form,
            "score_28d": score(p28, code), "filings_28d": f28,
            "score_season": score(ps, code), "filings_season": fs,
            "weekly": weekly,
            "_prev": score(pprev, code), "_prevf": fprev,
        })
    key = lambda r: (-r["score"], -r["filings"], r["name"])  # noqa: E731
    prev_key = lambda r: (-r["_prev"], -r["_prevf"], r["name"])  # noqa: E731
    prev_pos = {r["code"]: i + 1 for i, r in enumerate(sorted(rows, key=prev_key))}
    rows.sort(key=key)
    n = len(rows)
    table = []
    for i, r in enumerate(rows):
        pos = i + 1
        zone = "crisis" if pos <= 4 else ("fine" if pos > n - 4 else "mid")
        table.append({
            "pos": pos, "code": r["code"], "slug": r["slug"], "name": r["name"],
            "flag": r["flag"], "score": r["score"], "filings": r["filings"],
            "points": r["points"], "coverage": r["coverage"], "form": r["form"],
            "movement": prev_pos[r["code"]] - pos,
            "score_28d": r["score_28d"], "filings_28d": r["filings_28d"],
            "score_season": r["score_season"], "filings_season": r["filings_season"],
            "zone": zone, "weekly": r["weekly"],
        })
    return {"window": "7d", "updated": iso(now), "table": table}


def stats(items, now):
    d1 = now - timedelta(hours=24)
    d7 = now - timedelta(days=7)
    last7 = [it for it in items if it["_dt"] >= d7]
    by_cat = {c: 0 for c, _ in CATEGORY_RULES}
    for it in last7:
        by_cat[it["category"]] = by_cat.get(it["category"], 0) + 1
    counts = {}
    for it in last7:
        if it["severity"] >= 1:
            for c in it["countries"]:
                if c != "EU":
                    counts[c] = counts.get(c, 0) + 1
    most = max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0] if counts else None
    return {
        "items_24h": sum(1 for it in items if it["_dt"] >= d1),
        "items_7d": len(last7),
        "severe_7d": sum(1 for it in last7 if it["severity"] >= 3),
        "by_category": by_cat,
        "most_filed_country": most,
    }


def run_once(log=print):
    t0 = time.time()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    log(f"[{iso(now)}] The Wire: fetching")
    fresh = fetch_all(log)
    if len(fresh) < 50:
        log("  ! too few items fetched; keeping existing output")
        return None
    archive = load_archive(now)
    # merge fresh + archive (fresh wins); key by normalised title + source
    merged = {}
    for r in archive + fresh:
        if not r.get("published"):
            continue
        k = norm_title(r["title"]) + "||" + (r["source"] or "").lower()
        if k in merged:
            for h in r.get("hints", []):
                if h not in merged[k]["hints"]:
                    merged[k]["hints"].append(h)
        else:
            merged[k] = {**r, "hints": list(r.get("hints", []))}
    raw = [r for r in merged.values()
           if r["published"] >= now - timedelta(days=HISTORY_DAYS)]
    kept_keys = set()
    items = process(raw, now, kept_keys)
    lg = league(items, now)
    st = stats(items, now)
    sources = set()
    for it in items:
        sources |= it["_sources"]
    # The wire leads with setbacks: every severity >= 1 filing from the last
    # WIRE_DAYS days (capped), plus the newest neutral/good items for balance.
    cutoff = iso(now - timedelta(days=WIRE_DAYS))
    bad = [it for it in items if it["severity"] >= 1 and it["published"] >= cutoff][:MAX_SETBACKS]
    calm = [it for it in items if it["severity"] == 0][:MAX_NEUTRAL]
    chosen = sorted(bad + calm, key=lambda it: it["published"], reverse=True)
    public = [{k: v for k, v in it.items() if not k.startswith("_")}
              for it in chosen]
    doc = {
        "generated": iso(now),
        "next_refresh_minutes": NEXT_REFRESH_MINUTES,
        "sources_count": len(sources),
        "items": public,
        "league": lg,
        "stats": st,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    js = json.dumps(doc, ensure_ascii=False, indent=1)
    write_atomic(OUT_JSON, js + "\n")
    write_atomic(OUT_JS, "window.EP_NEWS = " + json.dumps(doc, ensure_ascii=False) + ";\n")
    # tiny file for open pages to poll, so they only download news.json when it changed
    write_atomic(os.path.join(DATA_DIR, "version.json"), json.dumps({"generated": doc["generated"]}) + "\n")
    # archive only items that passed the relevance filter
    save_archive([r for r in raw
                  if norm_title(r["title"]) + "||" + (r["source"] or "").lower() in kept_keys])
    log(f"  {len(raw)} raw (35d) -> {len(items)} filings ({len(public)} published), "
        f"{len(sources)} sources, {time.time() - t0:.1f}s")
    return doc, items


def main():
    ap = argparse.ArgumentParser(description="EUROPOOR news pipeline (The Wire)")
    ap.add_argument("--loop", type=float, metavar="N",
                    help="refresh every N minutes forever")
    args = ap.parse_args()
    if not args.loop:
        res = run_once()
        sys.exit(0 if res else 1)
    while True:
        try:
            run_once()
        except Exception as e:  # noqa: BLE001
            print(f"  ! run failed: {e}", file=sys.stderr)
        sys.stdout.flush()
        time.sleep(max(1.0, args.loop) * 60)


if __name__ == "__main__":
    main()

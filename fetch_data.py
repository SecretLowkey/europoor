#!/usr/bin/env python3
"""
EUROPOOR data pipeline - Directorate-General for Decline.

Fetches the latest official statistics for EU27 + UK, NO, CH, IS, computes the
EUROPOOR Index and writes data/data.json and data/data.js
(window.EP_DATA = {...};).

Python 3 standard library only.

Sources, in order of preference for every value:
  1. Eurostat dissemination API (JSON-stat 2.0)
  2. Live national / international APIs where Eurostat has gaps:
       ONS time-series API (United Kingdom), OECD SDMX (house prices UK / Greece),
       IMF DataMapper (government debt Switzerland / Iceland)
  3. scripts/manual.json - hand-entered values with a source URL each
     (used only where 1 and 2 return nothing, unless "override": true)

Usage:  python3 scripts/fetch_data.py
"""
import csv
import datetime as dt
import io
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data")
MANUAL_PATH = os.path.join(ROOT, "scripts", "manual.json")

ES_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
ES_VIEW = "https://ec.europa.eu/eurostat/databrowser/view/{}/default/table"
UA = "Mozilla/5.0 (EUROPOOR data pipeline; +https://ec.europa.eu/eurostat)"

NOW = dt.datetime.now(dt.timezone.utc)
LAST_FULL_YEAR = NOW.year - 1
BASE_START, BASE_END = 2000, 2019

# ----------------------------------------------------------------------------
# Countries
# code, geo, slug, name, flag, region, currency, euro, eu, pop (millions, ~2025)
# ----------------------------------------------------------------------------
COUNTRIES = [
    ("BE", "BE", "belgium", "Belgium", "\U0001F1E7\U0001F1EA", "Western", "EUR", True, True, 11.9),
    ("BG", "BG", "bulgaria", "Bulgaria", "\U0001F1E7\U0001F1EC", "Central & Eastern", "EUR", True, True, 6.4),
    ("CZ", "CZ", "czechia", "Czechia", "\U0001F1E8\U0001F1FF", "Central & Eastern", "CZK", False, True, 10.9),
    ("DK", "DK", "denmark", "Denmark", "\U0001F1E9\U0001F1F0", "Northern", "DKK", False, True, 6.0),
    ("DE", "DE", "germany", "Germany", "\U0001F1E9\U0001F1EA", "Western", "EUR", True, True, 83.6),
    ("EE", "EE", "estonia", "Estonia", "\U0001F1EA\U0001F1EA", "Northern", "EUR", True, True, 1.4),
    ("IE", "IE", "ireland", "Ireland", "\U0001F1EE\U0001F1EA", "Western", "EUR", True, True, 5.4),
    ("GR", "EL", "greece", "Greece", "\U0001F1EC\U0001F1F7", "Southern", "EUR", True, True, 10.4),
    ("ES", "ES", "spain", "Spain", "\U0001F1EA\U0001F1F8", "Southern", "EUR", True, True, 49.1),
    ("FR", "FR", "france", "France", "\U0001F1EB\U0001F1F7", "Western", "EUR", True, True, 68.6),
    ("HR", "HR", "croatia", "Croatia", "\U0001F1ED\U0001F1F7", "Southern", "EUR", True, True, 3.9),
    ("IT", "IT", "italy", "Italy", "\U0001F1EE\U0001F1F9", "Southern", "EUR", True, True, 58.9),
    ("CY", "CY", "cyprus", "Cyprus", "\U0001F1E8\U0001F1FE", "Southern", "EUR", True, True, 1.0),
    ("LV", "LV", "latvia", "Latvia", "\U0001F1F1\U0001F1FB", "Northern", "EUR", True, True, 1.9),
    ("LT", "LT", "lithuania", "Lithuania", "\U0001F1F1\U0001F1F9", "Northern", "EUR", True, True, 2.9),
    ("LU", "LU", "luxembourg", "Luxembourg", "\U0001F1F1\U0001F1FA", "Western", "EUR", True, True, 0.7),
    ("HU", "HU", "hungary", "Hungary", "\U0001F1ED\U0001F1FA", "Central & Eastern", "HUF", False, True, 9.5),
    ("MT", "MT", "malta", "Malta", "\U0001F1F2\U0001F1F9", "Southern", "EUR", True, True, 0.6),
    ("NL", "NL", "netherlands", "Netherlands", "\U0001F1F3\U0001F1F1", "Western", "EUR", True, True, 18.0),
    ("AT", "AT", "austria", "Austria", "\U0001F1E6\U0001F1F9", "Western", "EUR", True, True, 9.2),
    ("PL", "PL", "poland", "Poland", "\U0001F1F5\U0001F1F1", "Central & Eastern", "PLN", False, True, 36.5),
    ("PT", "PT", "portugal", "Portugal", "\U0001F1F5\U0001F1F9", "Southern", "EUR", True, True, 10.7),
    ("RO", "RO", "romania", "Romania", "\U0001F1F7\U0001F1F4", "Central & Eastern", "RON", False, True, 19.0),
    ("SI", "SI", "slovenia", "Slovenia", "\U0001F1F8\U0001F1EE", "Central & Eastern", "EUR", True, True, 2.1),
    ("SK", "SK", "slovakia", "Slovakia", "\U0001F1F8\U0001F1F0", "Central & Eastern", "EUR", True, True, 5.4),
    ("FI", "FI", "finland", "Finland", "\U0001F1EB\U0001F1EE", "Northern", "EUR", True, True, 5.6),
    ("SE", "SE", "sweden", "Sweden", "\U0001F1F8\U0001F1EA", "Northern", "SEK", False, True, 10.6),
    ("GB", "UK", "united-kingdom", "United Kingdom", "\U0001F1EC\U0001F1E7", "Western", "GBP", False, False, 69.3),
    ("NO", "NO", "norway", "Norway", "\U0001F1F3\U0001F1F4", "Northern", "NOK", False, False, 5.6),
    ("CH", "CH", "switzerland", "Switzerland", "\U0001F1E8\U0001F1ED", "Western", "CHF", False, False, 9.0),
    ("IS", "IS", "iceland", "Iceland", "\U0001F1EE\U0001F1F8", "Northern", "ISK", False, False, 0.4),
]
# Note on regions: the Baltic states are grouped with "Northern" (UN geoscheme),
# Croatia with "Southern".
EU_GEO = "EU27_2020"
ALL_GEOS = [EU_GEO] + [c[1] for c in COUNTRIES]

# ----------------------------------------------------------------------------
# Measures (exactly 12, in this order)
# sources: list of (dataset, filters); first one with data wins per geo.
# ----------------------------------------------------------------------------
HICP = "prc_hicp_minr"  # HICP, ECOICOP ver.2 (replaced prc_hicp_manr in 2026)
MEASURES = [
    dict(key="inflation", label="Inflation", unit="%", decimals=1, worse="higher", freq="Monthly",
         dataset=HICP, sources=[(HICP, {"unit": "RCH_A", "coicop18": "TOTAL"})],
         desc="Harmonised consumer price inflation (HICP, all items), % change vs same month a year earlier."),
    dict(key="food_inflation", label="Food inflation", unit="%", decimals=1, worse="higher", freq="Monthly",
         dataset=HICP, sources=[(HICP, {"unit": "RCH_A", "coicop18": "CP01"})],
         desc="HICP food and non-alcoholic beverages, % change vs same month a year earlier."),
    dict(key="unemployment", label="Unemployment", unit="%", decimals=1, worse="higher", freq="Monthly",
         dataset="une_rt_m", sources=[("une_rt_m", {"s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"})],
         desc="Unemployment rate, % of labour force, seasonally adjusted (ILO definition)."),
    dict(key="youth_unemployment", label="Youth unemployment", unit="%", decimals=1, worse="higher", freq="Monthly",
         dataset="une_rt_m", sources=[("une_rt_m", {"s_adj": "SA", "age": "Y_LT25", "sex": "T", "unit": "PC_ACT"})],
         desc="Unemployment rate of people under 25, % of labour force, seasonally adjusted."),
    dict(key="growth", label="GDP growth", unit="%", decimals=1, worse="lower", freq="Quarterly",
         dataset="namq_10_gdp",
         sources=[("namq_10_gdp", {"unit": "CLV_PCH_SM", "s_adj": "SCA", "na_item": "B1GQ"}),
                  ("namq_10_gdp", {"unit": "CLV_PCH_SM", "s_adj": "NSA", "na_item": "B1GQ"})],
         desc="Real GDP, % change vs same quarter a year earlier (chain-linked volumes)."),
    dict(key="debt", label="Government debt", unit="% of GDP", decimals=1, worse="higher", freq="Quarterly",
         dataset="gov_10q_ggdebt", sources=[("gov_10q_ggdebt", {"unit": "PC_GDP", "sector": "S13", "na_item": "GD"})],
         desc="General government consolidated gross debt (Maastricht), % of GDP."),
    dict(key="deficit", label="Budget balance", unit="% of GDP", decimals=1, worse="lower", freq="Annual",
         dataset="gov_10dd_edpt1",
         sources=[("gov_10dd_edpt1", {"unit": "PC_GDP", "sector": "S13", "na_item": "B9"}),
                  ("gov_10a_main", {"unit": "PC_GDP", "sector": "S13", "na_item": "B9"})],
         desc="General government net lending (+) / net borrowing (-), % of GDP. Negative = deficit."),
    dict(key="electricity", label="Electricity price", unit="€/kWh", decimals=3, worse="higher", freq="Semi-annual",
         dataset="nrg_pc_204",
         sources=[("nrg_pc_204", {"nrg_cons": "KWH2500-4999", "tax": "I_TAX", "currency": "EUR", "unit": "KWH"})],
         desc="Household electricity price incl. all taxes and levies, band DC (2,500-4,999 kWh/yr), €/kWh."),
    dict(key="gas", label="Gas price", unit="€/kWh", decimals=3, worse="higher", freq="Semi-annual",
         dataset="nrg_pc_202",
         sources=[("nrg_pc_202", {"nrg_cons": "GJ20-199", "tax": "I_TAX", "currency": "EUR", "unit": "KWH"})],
         desc="Household natural gas price incl. all taxes and levies, band D2 (20-199 GJ/yr), €/kWh."),
    dict(key="housing", label="House prices", unit="%", decimals=1, worse="higher", freq="Quarterly",
         dataset="prc_hpi_q", sources=[("prc_hpi_q", {"purchase": "TOTAL", "unit": "RCH_A"})],
         desc="House price index, all dwellings, % change vs same quarter a year earlier."),
    dict(key="purchasing_power", label="Purchasing power", unit="EU=100", decimals=0, worse="lower", freq="Annual",
         dataset="prc_ppp_ind", sources=[("prc_ppp_ind", {"ppp_cat": "A01", "na_item": "VI_PPS_EU27_2020_HAB"})],
         desc="Actual individual consumption per capita in purchasing power standards, EU27=100."),
    dict(key="industry", label="Industrial production", unit="%", decimals=1, worse="lower", freq="Monthly",
         dataset="sts_inpr_m",
         sources=[("sts_inpr_m", {"nace_r2": "B-D", "s_adj": "CA", "unit": "PCH_SM"}),
                  ("sts_inpr_m", {"nace_r2": "B-D", "s_adj": "SCA", "unit": "PCH_SM"}),
                  ("sts_inpr_m", {"nace_r2": "B-D", "s_adj": "NSA", "unit": "PCH_SM"})],
         desc="Industrial production (mining, manufacturing, energy), % change vs same month a year earlier."),
]
MKEYS = [m["key"] for m in MEASURES]
MBYKEY = {m["key"]: m for m in MEASURES}
COMPONENTS = ["inflation", "unemployment", "growth", "energy", "debt", "purchasing_power"]

NOTES = []


GEO2CODE = {c[1]: c[0] for c in COUNTRIES}


def note(s):
    for geo, code in (("for UK:", "for GB:"), ("for EL:", "for GR:")):
        s = s.replace(geo, code)
    if s not in NOTES:
        NOTES.append(s)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
def http_get(url, timeout=90, retries=4, accept=None):
    last = None
    for attempt in range(retries):
        try:
            headers = {"User-Agent": UA}
            if accept:
                headers["Accept"] = accept
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 404):  # not retryable
                raise
        except Exception as e:  # timeouts, resets
            last = e
        time.sleep(2 * (attempt + 1))
    raise last


def http_json(url, **kw):
    return json.loads(http_get(url, **kw).decode("utf-8"))


# ----------------------------------------------------------------------------
# Eurostat JSON-stat decoding
# ----------------------------------------------------------------------------
_ES_CACHE = {}


def eurostat(dataset, filters, geos=ALL_GEOS, since=None, until=None):
    """Return {geo: [(period, value), ...]} sorted by period, nulls dropped.
    All non geo/time dimensions must resolve to a single category."""
    params = [("geo", g) for g in geos]
    params += [(k, v) for k, v in filters.items()]
    if since:
        params.append(("sinceTimePeriod", str(since)))
    if until:
        params.append(("untilTimePeriod", str(until)))
    url = ES_API + dataset + "?" + urllib.parse.urlencode(params)
    if url in _ES_CACHE:
        return _ES_CACHE[url]
    out = {}
    try:
        d = http_json(url)
    except Exception as e:
        log(f"  ! eurostat {dataset} {filters}: {e}")
        _ES_CACHE[url] = out
        return out
    ids, size = d.get("id", []), d.get("size", [])
    if not ids or 0 in size:
        _ES_CACHE[url] = out
        return out
    dims = d["dimension"]
    for k, s in zip(ids, size):
        if k not in ("geo", "time") and s != 1:
            raise RuntimeError(f"{dataset}: dimension {k} has {s} categories; add a filter")
    strides = [1] * len(size)
    for i in range(len(size) - 2, -1, -1):
        strides[i] = strides[i + 1] * size[i + 1]
    gpos, tpos = ids.index("geo"), ids.index("time")
    gidx = dims["geo"]["category"]["index"]
    tidx = dims["time"]["category"]["index"]
    times = sorted(tidx, key=tidx.get)
    vals = d.get("value", {})
    is_dict = isinstance(vals, dict)
    for g, gi in gidx.items():
        series = []
        for t in times:
            idx = gi * strides[gpos] + tidx[t] * strides[tpos]
            v = vals.get(str(idx)) if is_dict else (vals[idx] if idx < len(vals) else None)
            if v is not None:
                series.append((t, float(v)))
        if series:
            out[g] = series
    _ES_CACHE[url] = out
    return out


# ----------------------------------------------------------------------------
# National / international supplementary sources
# ----------------------------------------------------------------------------
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def ons(topic, cdid, ds, freq):
    """ONS time-series API. freq in months|quarters|years."""
    url = f"https://www.ons.gov.uk/{topic}/timeseries/{cdid}/{ds}/data"
    page = f"https://www.ons.gov.uk/{topic}/timeseries/{cdid}/{ds}"
    try:
        d = http_json(url)
    except Exception as e:
        log(f"  ! ONS {cdid}/{ds}: {e}")
        return [], page
    out = []
    for o in d.get(freq, []):
        try:
            v = float(o["value"])
        except (TypeError, ValueError):
            continue
        date = o["date"].strip()
        if freq == "months":
            y, m = date.split()
            p = f"{y}-{MONTHS.index(m[:3].upper()) + 1:02d}"
        elif freq == "quarters":
            y, q = date.split()
            p = f"{y}-{q}"
        else:
            p = date
        out.append((p, v))
    out.sort()
    return out, page


def oecd_house_prices(areas):
    """OECD analytical house prices, nominal index (HPI), quarterly -> {iso3: [(q, idx)]}"""
    url = ("https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/"
           f"{'+'.join(areas)}.Q.HPI.?startPeriod=2014-Q1&format=csvfile")
    out = {}
    try:
        raw = http_get(url, timeout=120).decode("utf-8")
    except Exception as e:
        log(f"  ! OECD house prices: {e}")
        return out
    for row in csv.DictReader(io.StringIO(raw)):
        try:
            out.setdefault(row["REF_AREA"], []).append((row["TIME_PERIOD"], float(row["OBS_VALUE"])))
        except (KeyError, ValueError):
            continue
    for k in out:
        out[k].sort()
    return out


def imf(indicator, iso3s, max_year):
    url = f"https://www.imf.org/external/datamapper/api/v1/{indicator}/{'/'.join(iso3s)}"
    out = {}
    try:
        d = http_json(url, timeout=120)["values"][indicator]
    except Exception as e:
        log(f"  ! IMF {indicator}: {e}")
        return out
    for c in iso3s:
        ser = [(y, float(v)) for y, v in d.get(c, {}).items() if v is not None and int(y) <= max_year]
        if ser:
            out[c] = sorted(ser)
    return out


def yoy(series):
    """% change vs the same period one year earlier."""
    m = dict(series)
    out = []
    for p, v in series:
        q = shift_year(p, -1)
        if m.get(q):
            out.append((p, round((v / m[q] - 1) * 100, 2)))
    return out


# ----------------------------------------------------------------------------
# Period helpers
# ----------------------------------------------------------------------------
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]


def shift_year(period, years):
    return str(int(period[:4]) + years) + period[4:]


def period_label(p):
    if len(p) == 4:
        return p
    y, rest = p[:4], p[5:]
    if rest.startswith("Q"):
        return f"{rest} {y}"
    if rest.startswith("S"):
        return f"H{rest[1:]} {y}"
    return f"{MONTH_NAMES[int(rest) - 1]} {y}"


def rnd(v, n=2):
    return None if v is None else round(v, n)


def make_value(series, src, ndp):
    """series: sorted [(period, v)]. Returns schema value object."""
    if not series:
        return {"v": None, "period": None, "label": None, "prev": None, "y1": None, "y5": None, "src": src}
    m = dict(series)
    p, v = series[-1]
    prev = series[-2][1] if len(series) > 1 else None
    return {"v": rnd(v, ndp), "period": p, "label": period_label(p), "prev": rnd(prev, ndp),
            "y1": rnd(m.get(shift_year(p, -1)), ndp), "y5": rnd(m.get(shift_year(p, -5)), ndp), "src": src}


def ndp_for(key):
    return 4 if key in ("electricity", "gas") else 2


# ----------------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------------
def badness(x, mean, sd, worse):
    if x is None or mean is None or not sd:
        return None
    z = (x - mean) / sd
    if worse == "lower":
        z = -z
    return round(max(0.0, min(100.0, 50 + 15 * z)), 1)


def mean_sd(values):
    vals = [v for v in values if v is not None and not math.isnan(v)]
    if len(vals) < 3:
        return None, None
    return statistics.mean(vals), statistics.stdev(vals)


def winsorize(vals, lo=0.05, hi=0.95):
    s = sorted(vals)
    if len(s) < 20:
        return s
    a, b = s[int(lo * (len(s) - 1))], s[int(hi * (len(s) - 1))]
    return [min(max(v, a), b) for v in s]


def index_from(comps):
    vals = [v for v in comps.values() if v is not None]
    return round(statistics.mean(vals), 1) if vals else None


# ----------------------------------------------------------------------------
# Main pipeline
# ----------------------------------------------------------------------------
def main():
    since_latest = NOW.year - 7  # enough for y5 + 36-month series
    raw = {g: {} for g in ALL_GEOS}   # geo -> key -> [(p, v)]
    srcs = {g: {} for g in ALL_GEOS}  # geo -> key -> url

    # ---- 1. Eurostat latest values -------------------------------------
    for m in MEASURES:
        log(f"Eurostat: {m['key']}")
        for i, (ds, flt) in enumerate(m["sources"]):
            missing = [g for g in ALL_GEOS if g not in raw or m["key"] not in raw[g]]
            if not missing:
                break
            res = eurostat(ds, flt, geos=missing, since=since_latest)
            for g, ser in res.items():
                raw[g][m["key"]] = ser
                srcs[g][m["key"]] = ES_VIEW.format(ds)
                if i > 0:
                    note(f"{m['key']} for {g}: fallback Eurostat source {ds} {flt}.")

    # Drop stale series (e.g. UK data frozen at Brexit) so that national sources can take over;
    # they are restored at the end only if nothing fresher is found.
    stale = {}
    for key in MKEYS:
        latest = [int(raw[g][key][-1][0][:4]) for g in ALL_GEOS if raw[g].get(key)]
        if not latest:
            continue
        cutoff = max(latest) - 3
        for g in ALL_GEOS:
            if raw[g].get(key) and int(raw[g][key][-1][0][:4]) < cutoff:
                stale[(g, key)] = (raw[g].pop(key), srcs[g].pop(key))

    # ---- 2. Supplementary live sources --------------------------------
    uk = "UK"
    log("ONS (United Kingdom)")
    ons_specs = {
        "inflation": ("economy/inflationandpriceindices", "d7g7", "mm23", "months"),
        "food_inflation": ("economy/inflationandpriceindices", "d7g8", "mm23", "months"),
        "unemployment": ("employmentandlabourmarket/peoplenotinwork/unemployment", "mgsx", "lms", "months"),
        "youth_unemployment": ("employmentandlabourmarket/peoplenotinwork/unemployment", "mgwy", "lms", "months"),
        "growth": ("economy/grossdomesticproductgdp", "ihyr", "qna", "quarters"),
        "debt": ("economy/governmentpublicsectorandtaxes/publicspending", "yeqj", "edp", "quarters"),
        "deficit": ("economy/grossdomesticproductgdp", "ct8o", "ukea", "years"),
    }
    for key, (topic, cdid, ds, freq) in ons_specs.items():
        if raw[uk].get(key):
            continue
        ser, page = ons(topic, cdid, ds, freq)
        ser = [x for x in ser if int(x[0][:4]) >= since_latest - 1]
        if ser:
            raw[uk][key] = ser
            srcs[uk][key] = page
    if not raw[uk].get("industry"):
        ser, page = ons("economy/economicoutputandproductivity/output", "k222", "diop", "months")
        ser = [x for x in yoy(ser) if int(x[0][:4]) >= since_latest]
        if ser:
            raw[uk]["industry"] = ser
            srcs[uk]["industry"] = page
    note("United Kingdom (no longer in Eurostat after 2020): ONS time series - CPI annual rate D7G7 "
         "(inflation), D7G8 (food), LFS unemployment rate MGSX and 16-24 rate MGWY (3-month average ending in the "
         "stated month), GDP q-on-q4 growth IHYR, Maastricht gross debt % GDP YEQJ, general government net "
         "lending/borrowing % GDP CT8O (annual), index of production B-E (K222, y/y computed; includes water "
         "supply, unlike Eurostat B-D).")

    log("OECD house prices (UK, Greece)")
    iso3 = {"UK": "GBR", "EL": "GRC", "CH": "CHE", "IS": "ISL", "NO": "NOR"}
    need_hpi = [g for g in iso3 if not raw[g].get("housing")]
    if need_hpi:
        hp = oecd_house_prices([iso3[g] for g in need_hpi])
        for g in need_hpi:
            ser = [x for x in yoy(hp.get(iso3[g], [])) if int(x[0][:4]) >= since_latest]
            if ser:
                raw[g]["housing"] = [(p, round(v, 1)) for p, v in ser]
                srcs[g]["housing"] = "https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=DSD_AN_HOUSE_PRICES%40DF_HOUSE_PRICES&df[ag]=OECD.ECO.MPD"
                note(f"housing for {g}: OECD analytical house price database, nominal HPI (s.a.), % change vs same "
                     f"quarter a year earlier (not in Eurostat prc_hpi_q).")

    log("IMF (debt gaps)")
    need_debt = [g for g in ("CH", "IS", "NO", "UK") if not raw[g].get("debt")]
    if need_debt:
        res = imf("GGXWDG_NGDP", [iso3[g] for g in need_debt], LAST_FULL_YEAR)
        for g in need_debt:
            ser = res.get(iso3[g], [])
            if ser:
                raw[g]["debt"] = [x for x in ser if int(x[0]) >= since_latest - 1]
                srcs[g]["debt"] = "https://www.imf.org/external/datamapper/GGXWDG_NGDP@WEO"
                note(f"debt for {g}: IMF World Economic Outlook general government gross debt % GDP (annual, "
                     f"latest year <= {LAST_FULL_YEAR}; broader than the Maastricht definition). Not in Eurostat.")

    # ---- 3. Manual values ---------------------------------------------
    manual = {}
    if os.path.exists(MANUAL_PATH):
        with open(MANUAL_PATH, encoding="utf-8") as f:
            manual = json.load(f)
    manual_values = {}  # (geo, key) -> value object
    code2geo = {c[0]: c[1] for c in COUNTRIES}
    code2geo["EU"] = EU_GEO
    for code, entries in manual.get("countries", {}).items():
        g = code2geo.get(code)
        if not g:
            continue
        for key, e in entries.items():
            if key not in MBYKEY:
                continue
            if raw[g].get(key) and not e.get("override"):
                continue
            manual_values[(g, key)] = e

    for (g, key), (ser, src) in stale.items():
        if not raw[g].get(key) and (g, key) not in manual_values:
            raw[g][key], srcs[g][key] = ser, src
            note(f"{key} for {g}: only an old observation ({ser[-1][0]}) is available.")

    # ---- 4. Build values ----------------------------------------------
    rates = latest_fx_rates([e["local"]["currency"] for e in manual_values.values() if "local" in e])

    def to_eur(x, cur):
        if x is None:
            return None
        if cur == "EUR":
            return x
        return x / rates[cur][1]

    values = {}
    for g in ALL_GEOS:
        values[g] = {}
        for key in MKEYS:
            if (g, key) in manual_values:
                e = manual_values[(g, key)]
                cur = e.get("local", {}).get("currency", "EUR")
                conv = (lambda x: to_eur(x, cur)) if "local" in e else (lambda x: x)
                v = conv(e["local"]["value"]) if "local" in e else e.get("v")
                p = e["period"]
                values[g][key] = {"v": rnd(v, ndp_for(key)), "period": p, "label": period_label(p),
                                  "prev": rnd(conv(e.get("prev")), ndp_for(key)),
                                  "y1": rnd(conv(e.get("y1")), ndp_for(key)),
                                  "y5": rnd(conv(e.get("y5")), ndp_for(key)), "src": e["src"]}
                extra = f" Converted at {rates[cur][1]} {cur}/EUR ({rates[cur][0]} ECB average)." if cur != "EUR" else ""
                note(f"{key} for {g}: hand-entered from official source ({e['src']}). {e.get('note', '')}{extra}".strip())
            else:
                ser = raw[g].get(key, [])
                src = srcs[g].get(key, ES_VIEW.format(MBYKEY[key]["dataset"]))
                values[g][key] = make_value(ser, src, ndp_for(key))

    # ---- 5. Series -----------------------------------------------------
    def series_for(g):
        out = {}
        for key, n, fr in (("inflation", 36, "M"), ("unemployment", 36, "M"), ("growth", 16, "Q"), ("debt", 16, "Q")):
            ser = raw[g].get(key, [])
            if fr == "Q":
                ser = [x for x in ser if "-Q" in x[0]]
            else:
                ser = [x for x in ser if len(x[0]) == 7 and "-Q" not in x[0] and "-S" not in x[0]]
            out[key] = [[p, round(v, 2)] for p, v in ser[-n:]]
        return out

    # ---- 6. Pooled baseline (countries) -------------------------------
    log("Pooled 2000-2019 baselines")
    cgeos = [c[1] for c in COUNTRIES]
    pooled_specs = {
        "inflation": ("prc_hicp_aind", {"unit": "RCH_A_AVG", "coicop": "CP00"}, BASE_START),
        "unemployment": ("une_rt_a", {"age": "Y15-74", "sex": "T", "unit": "PC_ACT"}, BASE_START),
        "growth": ("nama_10_gdp", {"unit": "CLV_PCH_PRE", "na_item": "B1GQ"}, BASE_START),
        "energy": ("nrg_pc_204", {"nrg_cons": "KWH2500-4999", "tax": "I_TAX", "currency": "EUR", "unit": "KWH"}, "2007-S1"),
        "debt": ("gov_10dd_edpt1", {"unit": "PC_GDP", "sector": "S13", "na_item": "GD"}, BASE_START),
        "purchasing_power": ("prc_ppp_ind", {"ppp_cat": "A01", "na_item": "VI_PPS_EU27_2020_HAB"}, BASE_START),
    }
    pooled = {}
    for comp, (ds, flt, since) in pooled_specs.items():
        until = f"{BASE_END}-S2" if comp == "energy" else BASE_END
        res = eurostat(ds, flt, geos=cgeos, since=since, until=until)
        sample = [v for ser in res.values() for p, v in ser]
        mu, sd = mean_sd(winsorize(sample))
        pooled[comp] = {"mean": mu, "sd": sd, "n": len(sample), "dataset": ds}
        log(f"  {comp:17s} n={len(sample):4d} mean={mu:.3f} sd={sd:.3f}")
    comp_measure = {"inflation": "inflation", "unemployment": "unemployment", "growth": "growth",
                    "energy": "electricity", "debt": "debt", "purchasing_power": "purchasing_power"}
    comp_worse = {"inflation": "higher", "unemployment": "higher", "growth": "lower",
                  "energy": "higher", "debt": "higher", "purchasing_power": "lower"}

    def country_index(g):
        comps, prevc = {}, {}
        for comp in COMPONENTS:
            vo = values[g][comp_measure[comp]]
            b = pooled[comp]
            comps[comp] = badness(vo["v"], b["mean"], b["sd"], comp_worse[comp])
            pv = vo["prev"] if vo["prev"] is not None else vo["v"]
            prevc[comp] = badness(pv, b["mean"], b["sd"], comp_worse[comp])
        return {"score": index_from(comps), "prev": index_from(prevc), "components": comps}

    # ---- 7. EU history (own 2000-2019 baseline) -----------------------
    log("EU history")
    hist = {k: {} for k in COMPONENTS}
    yrs = list(range(BASE_START, LAST_FULL_YEAR + 1))

    def annual_mean(ser, min_n=12):
        acc = {}
        for p, v in ser:
            acc.setdefault(int(p[:4]), []).append(v)
        return {y: statistics.mean(v) for y, v in acc.items() if len(v) >= min_n}

    eu_inf_m = eurostat(HICP, {"unit": "RCH_A", "coicop18": "TOTAL"}, geos=[EU_GEO], since="1996-01").get(EU_GEO, [])
    hist["inflation"] = annual_mean(eu_inf_m)
    aind = eurostat("prc_hicp_aind", {"unit": "RCH_A_AVG", "coicop": "CP00"}, geos=[EU_GEO], since=1996).get(EU_GEO, [])
    for p, v in aind:  # fill any gaps from the legacy annual dataset
        hist["inflation"].setdefault(int(p), v)
    nrg_m = eurostat(HICP, {"unit": "I15", "coicop18": "NRG"}, geos=[EU_GEO], since="1996-01").get(EU_GEO, [])
    tot_m = eurostat(HICP, {"unit": "I15", "coicop18": "TOTAL"}, geos=[EU_GEO], since="1996-01").get(EU_GEO, [])
    tot_d = dict(tot_m)
    ratio_m = [(p, v / tot_d[p] * 100) for p, v in nrg_m if tot_d.get(p)]
    hist["energy"] = annual_mean(ratio_m)
    une_m = eurostat("une_rt_m", {"s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"},
                     geos=[EU_GEO], since="2000-01").get(EU_GEO, [])
    hist["unemployment"] = annual_mean(une_m)
    hist["growth"] = {int(p): v for p, v in eurostat("nama_10_gdp", {"unit": "CLV_PCH_PRE", "na_item": "B1GQ"},
                                                     geos=[EU_GEO], since=BASE_START).get(EU_GEO, [])}
    hist["debt"] = {int(p): v for p, v in eurostat("gov_10dd_edpt1", {"unit": "PC_GDP", "sector": "S13", "na_item": "GD"},
                                                   geos=[EU_GEO], since=BASE_START).get(EU_GEO, [])}
    gdhi = eurostat("nasa_10_ki", {"sector": "S14_S15", "na_item": "B7G_R_HAB_GR", "unit": "PC"},
                    geos=[EU_GEO], since=BASE_START).get(EU_GEO, [])
    hist["purchasing_power"] = {int(p): v for p, v in gdhi}

    eu_base = {}
    for comp in COMPONENTS:
        mu, sd = mean_sd([hist[comp].get(y) for y in range(BASE_START, BASE_END + 1)])
        eu_base[comp] = (mu, sd)
        log(f"  EU {comp:17s} mean={mu:.3f} sd={sd:.3f}")

    history = {"years": yrs, "index": [], "components": {k: [] for k in COMPONENTS},
               "raw": {k: [] for k in COMPONENTS}}
    for y in yrs:
        comps = {}
        for comp in COMPONENTS:
            x = hist[comp].get(y)
            history["raw"][comp].append(rnd(x, 2))
            comps[comp] = badness(x, *eu_base[comp], comp_worse[comp])
            history["components"][comp].append(comps[comp])
        history["index"].append(index_from(comps))

    # EU current index: latest high-frequency values against the EU's own baseline
    eu_cur = {
        "inflation": values[EU_GEO]["inflation"],
        "unemployment": values[EU_GEO]["unemployment"],
        "growth": values[EU_GEO]["growth"],
        "debt": values[EU_GEO]["debt"],
    }
    ratio_obj = make_value(ratio_m, ES_VIEW.format(HICP), 2)
    gdhi_obj = make_value(gdhi, ES_VIEW.format("nasa_10_ki"), 2)
    eu_cur["energy"] = ratio_obj
    eu_cur["purchasing_power"] = gdhi_obj
    eu_comps, eu_prevc = {}, {}
    for comp in COMPONENTS:
        vo = eu_cur[comp]
        eu_comps[comp] = badness(vo["v"], *eu_base[comp], comp_worse[comp])
        pv = vo["prev"] if vo["prev"] is not None else vo["v"]
        eu_prevc[comp] = badness(pv, *eu_base[comp], comp_worse[comp])
    eu_index = {"score": index_from(eu_comps), "prev": index_from(eu_prevc), "components": eu_comps}

    # ---- 8. Assemble ---------------------------------------------------
    countries = []
    for (code, geo, slug, name, flag, region, cur, euro, eu, pop) in COUNTRIES:
        countries.append({
            "code": code, "geo": geo, "slug": slug, "name": name, "flag": flag, "region": region,
            "currency": cur, "euro": euro, "eu": eu, "pop": pop,
            "values": values[geo], "series": series_for(geo), "index": country_index(geo),
        })
    order = sorted(countries, key=lambda c: (c["index"]["score"] is None, -(c["index"]["score"] or 0)))
    for i, c in enumerate(order, 1):
        c["index"]["rank"] = i

    eu_obj = {"code": "EU", "name": "European Union", "geo": EU_GEO, "values": values[EU_GEO],
              "series": series_for(EU_GEO), "index": eu_index}

    # method notes
    method_notes = [
        "Every value is the latest non-null observation available from the official source at build time; "
        "'period' records which month/quarter/half-year/year it refers to.",
        "HICP (inflation, food inflation, energy) uses Eurostat prc_hicp_minr (ECOICOP ver.2), which replaced "
        "prc_hicp_manr/prc_hicp_aind from 2026; legacy prc_hicp_aind is used for the 2000-2019 country baseline.",
        "Country index: each component is scored against a POOLED 2000-2019 baseline - the mean and standard "
        "deviation of all 31 countries' annual values (sample winsorised at the 5th/95th percentile so that "
        "early-2000s hyperinflation in a few accession states does not swamp the scale). Components: inflation = "
        "latest HICP annual rate vs prc_hicp_aind annual averages; unemployment = latest monthly rate vs une_rt_a; "
        "growth = latest quarterly real GDP y/y vs nama_10_gdp annual growth; energy = latest household "
        "electricity price (EUR/kWh, band DC) vs all semi-annual nrg_pc_204 prices 2007-2019; debt = latest "
        "debt % GDP vs gov_10dd_edpt1 annual debt; purchasing_power = AIC per capita in PPS (EU27=100) vs "
        "prc_ppp_ind 2000-2019 (lower is worse).",
        f"Pooled baselines: " + "; ".join(
            f"{k} mean {v['mean']:.2f}, sd {v['sd']:.2f} (n={v['n']})" for k, v in pooled.items()) + ".",
        "EU index and history: EU27_2020 scored against its OWN 2000-2019 annual average. inflation = annual mean "
        "of monthly HICP annual rates (prc_hicp_minr); unemployment = annual mean of monthly SA rate (une_rt_m); "
        "growth = real GDP growth (nama_10_gdp CLV_PCH_PRE); energy = relative energy price, HICP energy index "
        "divided by all-items HICP (both 2015=100, x100; prc_hicp_minr); debt = gross debt % GDP "
        "(gov_10dd_edpt1); purchasing_power = growth of real adjusted gross disposable income of households per "
        "capita (nasa_10_ki B7G_R_HAB_GR, lower is worse). The current EU score uses the latest monthly/quarterly "
        "readings of the same concepts (latest quarterly debt from gov_10q_ggdebt).",
        "EU baselines: " + "; ".join(f"{k} mean {m:.2f}, sd {s:.2f}" for k, (m, s) in eu_base.items()) + ".",
        "'prev' index = the same calculation using each component's previous observation.",
        "Gas is null where there is no household gas grid or no recent Eurostat coverage (Cyprus, Malta, "
        "Norway, Iceland, Switzerland, Finland); Poland's latest Eurostat household gas price is 2023-S2. "
        "Industrial production is not published monthly for Iceland. EU inflation for 2000 is unavailable in "
        "EU27_2020 HICP series, so the 2000 index uses five components.",
    ]
    method = {
        "baseline": "2000–2019",
        "scale": "badness = clamp(0,100, 50 + 15*z) where z is the standardised distance from the 2000–2019 "
                 "average, signed so worse is higher",
        "notes": method_notes + NOTES,
    }
    measures_out = [{"key": m["key"], "label": m["label"], "unit": m["unit"], "decimals": m["decimals"],
                     "worse": m["worse"], "desc": m["desc"], "dataset": m["dataset"], "freq": m["freq"],
                     "url": ES_VIEW.format(m["dataset"])} for m in MEASURES]

    data = {"generated": NOW.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "method": method, "measures": measures_out, "countries": countries, "eu": eu_obj,
            "history": history}

    validate(data)
    os.makedirs(OUT_DIR, exist_ok=True)
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "data.json"), "w", encoding="utf-8") as f:
        f.write(js)
    with open(os.path.join(OUT_DIR, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.EP_DATA = " + js + ";\n")
    summary(data, len(js.encode("utf-8")))


def latest_fx_rates(currencies):
    """ECB reference rates (monthly average, national currency per EUR) via Eurostat ert_bil_eur_m."""
    out = {}
    for cur in set(currencies):
        if cur == "EUR":
            continue
        url = ES_API + "ert_bil_eur_m?" + urllib.parse.urlencode(
            [("currency", cur), ("statinfo", "AVG"), ("unit", "NAC"), ("sinceTimePeriod", f"{NOW.year - 1}-01")])
        d = http_json(url)
        ti = d["dimension"]["time"]["category"]["index"]
        times = sorted(ti, key=ti.get)
        vals = d["value"]
        ser = [(t, vals[str(ti[t])]) for t in times if str(ti[t]) in vals]
        out[cur] = ser[-1]
    return out


# ----------------------------------------------------------------------------
# Validation + summary
# ----------------------------------------------------------------------------
def validate(d):
    assert len(d["countries"]) == 31, "expected 31 countries"
    for c in d["countries"] + [d["eu"]]:
        assert list(c["values"].keys()) == MKEYS, f"{c['code']}: measure keys"
        for k, vo in c["values"].items():
            assert set(vo) == {"v", "period", "label", "prev", "y1", "y5", "src"}, (c["code"], k)
        assert set(c["series"]) == {"inflation", "unemployment", "growth", "debt"}
        assert set(c["index"]["components"]) == set(COMPONENTS)
        assert c["index"]["score"] is not None, f"{c['code']}: no score"
    ranks = sorted(c["index"]["rank"] for c in d["countries"])
    assert ranks == list(range(1, 32))
    h = d["history"]
    for k in COMPONENTS:
        assert len(h["components"][k]) == len(h["years"]) == len(h["raw"][k])
    assert len(h["index"]) == len(h["years"])


def summary(d, nbytes):
    print(f"\nEUROPOOR data built {d['generated']}  ({nbytes / 1024:.0f} KB)")
    e = d["eu"]["index"]
    print(f"EU index: {e['score']} (prev {e['prev']})  components: {e['components']}")
    print(f"EU history: " + ", ".join(f"{y}:{v}" for y, v in zip(d['history']['years'], d['history']['index'])))
    short = {"inflation": "infl", "food_inflation": "food", "unemployment": "unemp", "youth_unemployment": "youth",
             "growth": "gdp", "debt": "debt", "deficit": "bal", "electricity": "elec", "gas": "gas",
             "housing": "house", "purchasing_power": "pp", "industry": "ind"}
    hdr = f"{'rk':>2} {'code':4} {'score':>5} {'prev':>5} " + " ".join(f"{short[k]:>6}" for k in MKEYS)
    print("\n" + hdr)
    for c in sorted(d["countries"], key=lambda c: c["index"]["rank"]):
        cells = []
        for k in MKEYS:
            v = c["values"][k]["v"]
            cells.append(f"{'-':>6}" if v is None else f"{v:>6.3f}" if k in ("electricity", "gas") else f"{v:>6.1f}")
        print(f"{c['index']['rank']:>2} {c['code']:4} {c['index']['score']:>5} {c['index']['prev']:>5} " + " ".join(cells))
    print("\nLatest periods / null counts:")
    for k in MKEYS:
        per = {}
        nulls = []
        for c in d["countries"]:
            p = c["values"][k]["period"]
            if p is None:
                nulls.append(c["code"])
            else:
                per[p] = per.get(p, 0) + 1
        top = sorted(per.items(), key=lambda x: -x[1])[:3]
        print(f"  {k:19s} EU={d['eu']['values'][k]['period']}  countries={top}  nulls={len(nulls)} {nulls}")


if __name__ == "__main__":
    main()

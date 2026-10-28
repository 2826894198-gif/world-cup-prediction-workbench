#!/usr/bin/env python3

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT_DIR = Path(__file__).resolve().parents[1]
VENDORED_PDF_TOOLS = Path("/tmp/codex_pdf_tools")
if VENDORED_PDF_TOOLS.exists():
    sys.path.insert(0, str(VENDORED_PDF_TOOLS))

try:
    import pdfplumber
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing pdfplumber. Install with: "
        "python3 -m pip install --target /tmp/codex_pdf_tools pdfplumber"
    ) from error


PDF_FILE = ROOT_DIR / "data/research/worldcup-2026/FWC26-Match-Schedule_English.pdf"
OUTPUT_FILE = ROOT_DIR / "data/research/worldcup-2026/official-schedule.json"
SOURCE_RELEASE = (
    "https://inside.fifa.com/organisation/media-releases/"
    "updated-world-cup-2026-match-schedule-venues-kick-off-times-104-matches"
)
SOURCE_PAGE = (
    "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/"
    "articles/match-schedule-fixtures-results-teams-stadiums"
)
SOURCE_PDF = (
    "https://digitalhub.fifa.com/asset/4b5d4417-3343-4732-9cdf-14b6662af407/"
    "FWC26-Match-Schedule_English.pdf"
)

ROUND_OF_32_CONFIRMED_TEAMS = {
    73: ("RSA", "CAN"),
    74: ("GER", "PAR"),
    75: ("NED", "MAR"),
    76: ("BRA", "JPN"),
    77: ("FRA", "SWE"),
    78: ("CIV", "NOR"),
    79: ("MEX", "ECU"),
    80: ("ENG", "COD"),
    81: ("USA", "BIH"),
    82: ("BEL", "SEN"),
    83: ("POR", "CRO"),
    84: ("ESP", "AUT"),
    85: ("SUI", "ALG"),
    86: ("ARG", "CPV"),
    87: ("COL", "GHA"),
    88: ("AUS", "EGY"),
}

VENUE_ROWS = [
    (151, "Vancouver"),
    (189, "Seattle"),
    (225, "San Francisco Bay Area"),
    (262, "Los Angeles"),
    (300, "Guadalajara"),
    (338, "Mexico City"),
    (375, "Monterrey"),
    (412, "Houston"),
    (449, "Dallas"),
    (486, "Kansas City"),
    (523, "Atlanta"),
    (560, "Miami"),
    (598, "Toronto"),
    (635, "Boston"),
    (672, "Philadelphia"),
    (709, "New York New Jersey"),
]


def stage_for(match_no):
    if match_no <= 72:
        return "group_stage", "Group stage"
    if match_no <= 88:
        return "round_of_32", "Round of 32"
    if match_no <= 96:
        return "round_of_16", "Round of 16"
    if match_no <= 100:
        return "quarter_final", "Quarter-final"
    if match_no <= 102:
        return "semi_final", "Semi-final"
    if match_no == 103:
        return "third_place", "Bronze final"
    return "final", "Final"


def group_rows(words, top_tolerance=2.4):
    rows = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        for row in rows:
            if abs(row["top"] - word["top"]) <= top_tolerance:
                row["words"].append(word)
                row["top"] = (row["top"] + word["top"]) / 2
                break
        else:
            rows.append({"top": word["top"], "words": [word]})

    values = []
    for row in rows:
        row_words = sorted(row["words"], key=lambda item: item["x0"])
        text = "".join(item["text"] for item in row_words).strip()
        if text and not re.fullmatch(r"\d{1,2}:\d{2}", text):
            values.append(text)
    return values


def extract_date_headers(words):
    headers = []
    for word in words:
        text = word["text"]
        if not re.fullmatch(r"\d{1,2}", text):
            continue
        if not (100 <= word["top"] <= 125 and word["x0"] > 180):
            continue
        day = int(text[::-1]) if len(text) > 1 else int(text)
        if 1 <= day <= 31:
            headers.append(
                {
                    "x": (word["x0"] + word["x1"]) / 2,
                    "raw": text,
                    "day": day,
                }
            )

    headers.sort(key=lambda item: item["x"])
    month = 6
    previous_day = 0
    for header in headers:
        if previous_day and header["day"] < previous_day:
            month += 1
        header["month"] = month
        previous_day = header["day"]
    return headers


def extract_match_cards(words):
    sorted_words = sorted(words, key=lambda item: (item["top"], item["x0"]))
    cards_by_no = {}
    for index, word in enumerate(sorted_words[:-1]):
        if not re.fullmatch(r"\d{1,3}", word["text"]):
            continue
        match_no = int(word["text"])
        if not 1 <= match_no <= 104:
            continue
        next_word = sorted_words[index + 1]
        is_same_line = abs(next_word["top"] - word["top"]) < 3
        is_time = re.fullmatch(r"\d{1,2}:\d{2}", next_word["text"])
        if is_same_line and is_time and next_word["x0"] > word["x1"]:
            cards_by_no[match_no] = {"number": word, "time": next_word}
    return [cards_by_no[number] | {"match_no": number} for number in sorted(cards_by_no)]


def nearest_date(card, headers):
    card_x = (card["number"]["x0"] + card["time"]["x1"]) / 2
    return min(headers, key=lambda header: abs(header["x"] - card_x))


def nearest_venue(card):
    card_y = card["number"]["top"] + 19
    return min(VENUE_ROWS, key=lambda row: abs(row[0] - card_y))[1]


def parse_card_tokens(match_no, tokens):
    if match_no in ROUND_OF_32_CONFIRMED_TEAMS:
        home_code, away_code = ROUND_OF_32_CONFIRMED_TEAMS[match_no]
        return {
            "home_code": home_code,
            "away_code": away_code,
        }

    stage, _ = stage_for(match_no)
    if match_no == 103:
        return {
            "home_placeholder": "Loser Match 101",
            "away_placeholder": "Loser Match 102",
        }
    if match_no == 104:
        return {
            "home_placeholder": "Winner Match 101",
            "away_placeholder": "Winner Match 102",
        }

    if stage == "group_stage":
        if len(tokens) < 4 or tokens[1].lower() != "v":
            raise ValueError(f"Cannot parse group-stage teams for match {match_no}: {tokens}")
        return {
            "home_code": tokens[0],
            "away_code": tokens[2],
            "group_name": tokens[3],
        }

    if len(tokens) < 3 or tokens[1].lower() != "v":
        raise ValueError(f"Cannot parse knockout placeholders for match {match_no}: {tokens}")
    away = tokens[2]
    if away == "3" and len(tokens) >= 4:
        away = f"3 {tokens[3]}"
    return {
        "home_placeholder": tokens[0],
        "away_placeholder": away,
    }


def build_fixture(card, words, headers):
    match_no = card["match_no"]
    stage, round_label = stage_for(match_no)
    date_header = nearest_date(card, headers)
    date = datetime(2026, date_header["month"], date_header["day"])
    kickoff_et = card["time"]["text"]
    hour, minute = (int(part) for part in kickoff_et.split(":"))
    kickoff_local = datetime(
        date.year,
        date.month,
        date.day,
        hour,
        minute,
        tzinfo=ZoneInfo("America/New_York"),
    )
    kickoff_utc = kickoff_local.astimezone(ZoneInfo("UTC"))

    block_words = [
        word
        for word in words
        if card["number"]["x0"] - 12 <= word["x0"] <= card["time"]["x1"] + 12
        and card["number"]["top"] + 4 <= word["top"] <= card["number"]["top"] + 42
    ]
    tokens = group_rows(block_words)
    parsed_tokens = parse_card_tokens(match_no, tokens)

    return {
        "match_no": match_no,
        "stage": stage,
        "round_label": round_label,
        "date_et": date.strftime("%Y-%m-%d"),
        "kickoff_et": kickoff_et,
        "kickoff_utc": kickoff_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "time_basis": "Eastern Time (ET), as displayed in the FIFA schedule PDF",
        "venue": nearest_venue(card),
        "status": "official_fixture",
        **parsed_tokens,
    }


def validate(fixtures):
    match_numbers = [fixture["match_no"] for fixture in fixtures]
    missing = [number for number in range(1, 105) if number not in match_numbers]
    duplicates = sorted({number for number in match_numbers if match_numbers.count(number) > 1})
    errors = []
    if len(fixtures) != 104:
        errors.append(f"expected 104 fixtures, found {len(fixtures)}")
    if missing:
        errors.append(f"missing match numbers: {missing}")
    if duplicates:
        errors.append(f"duplicate match numbers: {duplicates}")

    required_checks = {
        1: {"stage": "group_stage", "date_et": "2026-06-11", "kickoff_et": "15:00", "venue": "Mexico City", "home_code": "MEX", "away_code": "RSA", "group_name": "A"},
        2: {"stage": "group_stage", "date_et": "2026-06-11", "kickoff_et": "22:00", "venue": "Guadalajara", "home_code": "KOR", "away_code": "CZE", "group_name": "A"},
        3: {"stage": "group_stage", "date_et": "2026-06-12", "kickoff_et": "15:00", "venue": "Toronto", "home_code": "CAN", "away_code": "BIH", "group_name": "B"},
        4: {"stage": "group_stage", "date_et": "2026-06-12", "kickoff_et": "21:00", "venue": "Los Angeles", "home_code": "USA", "away_code": "PAR", "group_name": "D"},
        5: {"stage": "group_stage", "date_et": "2026-06-13", "kickoff_et": "21:00", "venue": "Boston", "home_code": "HAI", "away_code": "SCO", "group_name": "C"},
        6: {"stage": "group_stage", "date_et": "2026-06-13", "kickoff_et": "00:00", "venue": "Vancouver", "home_code": "AUS", "away_code": "TUR", "group_name": "D"},
        7: {"stage": "group_stage", "date_et": "2026-06-13", "kickoff_et": "18:00", "venue": "New York New Jersey", "home_code": "BRA", "away_code": "MAR", "group_name": "C"},
        8: {"stage": "group_stage", "date_et": "2026-06-13", "kickoff_et": "15:00", "venue": "San Francisco Bay Area", "home_code": "QAT", "away_code": "SUI", "group_name": "B"},
        73: {"stage": "round_of_32", "date_et": "2026-06-28", "kickoff_et": "15:00", "venue": "Los Angeles", "home_placeholder": "2A", "away_placeholder": "2B"},
        74: {"stage": "round_of_32", "date_et": "2026-06-29", "kickoff_et": "16:30", "venue": "Boston", "home_placeholder": "1E", "away_placeholder": "3 ABCDF"},
        88: {"stage": "round_of_32", "date_et": "2026-07-03", "kickoff_et": "14:00", "venue": "Dallas", "home_placeholder": "2D", "away_placeholder": "2G"},
        89: {"stage": "round_of_16", "date_et": "2026-07-04", "kickoff_et": "17:00", "venue": "Philadelphia", "home_placeholder": "W74", "away_placeholder": "W77"},
        97: {"stage": "quarter_final", "date_et": "2026-07-09", "kickoff_et": "16:00", "venue": "Boston", "home_placeholder": "W89", "away_placeholder": "W90"},
        101: {"stage": "semi_final", "date_et": "2026-07-14", "kickoff_et": "15:00", "venue": "Dallas", "home_placeholder": "W97", "away_placeholder": "W98"},
        102: {"stage": "semi_final", "date_et": "2026-07-15", "kickoff_et": "15:00", "venue": "Atlanta", "home_placeholder": "W99", "away_placeholder": "W100"},
        103: {"stage": "third_place", "date_et": "2026-07-18", "kickoff_et": "17:00", "venue": "Miami", "home_placeholder": "Loser Match 101", "away_placeholder": "Loser Match 102"},
        104: {"stage": "final", "date_et": "2026-07-19", "kickoff_et": "15:00", "venue": "New York New Jersey", "home_placeholder": "Winner Match 101", "away_placeholder": "Winner Match 102"},
    }
    by_match = {fixture["match_no"]: fixture for fixture in fixtures}
    for match_no, expected in required_checks.items():
        fixture = by_match.get(match_no)
        for key, expected_value in expected.items():
            if fixture.get(key) != expected_value:
                errors.append(
                    f"match {match_no} expected {key}={expected_value}, got {fixture.get(key)}"
                )
    if errors:
        raise SystemExit("Schedule validation failed:\n- " + "\n- ".join(errors))


def main():
    if not PDF_FILE.exists():
        raise SystemExit(f"Missing official PDF: {PDF_FILE}")

    with pdfplumber.open(PDF_FILE) as pdf:
        if len(pdf.pages) != 1:
            raise SystemExit(f"Expected one-page PDF, found {len(pdf.pages)} pages")
        page = pdf.pages[0]
        words = page.extract_words(
            x_tolerance=2,
            y_tolerance=2,
            keep_blank_chars=False,
            use_text_flow=False,
        )

    headers = extract_date_headers(words)
    cards = extract_match_cards(words)
    fixtures = [build_fixture(card, words, headers) for card in cards]
    validate(fixtures)
    stage_counts = {}
    for fixture in fixtures:
        stage_counts[fixture["stage"]] = stage_counts.get(fixture["stage"], 0) + 1

    payload = {
        "status": "official_schedule_parsed",
        "generated_at": datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_release": SOURCE_RELEASE,
        "source_page": SOURCE_PAGE,
        "source_pdf": SOURCE_PDF,
        "local_pdf": str(PDF_FILE.relative_to(ROOT_DIR)),
        "match_count": len(fixtures),
        "date_span_et": [fixtures[0]["date_et"], fixtures[-1]["date_et"]],
        "stage_counts": stage_counts,
        "venue_count": len({fixture["venue"] for fixture in fixtures}),
        "time_basis": "All kickoff times are parsed from the FIFA PDF's Eastern Time (ET) display.",
        "parser": "scripts/parse-official-2026-schedule.py",
        "fixtures": fixtures,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(
        f"Wrote {len(fixtures)} official fixtures to {OUTPUT_FILE.relative_to(ROOT_DIR)} "
        f"({fixtures[0]['date_et']} to {fixtures[-1]['date_et']})"
    )


if __name__ == "__main__":
    main()

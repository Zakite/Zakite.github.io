#!/usr/bin/env python3
"""Refresh counts.json from the public NocoDB shared view behind pie.html.

Standard library only, so the GitHub Action needs no installs. Reads every row
of the view (paged the same way the page reads it), tallies the Paragenesis
column, and writes counts.json only when the counts have actually changed, so
the daily run does not commit noise. A failed read exits non-zero and leaves
the last good counts.json in place.
"""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE = "da706988-efef-4f95-939d-50d8a6f938ca"   # "Paragenesis (pie source)"
BASE = "https://app.nocodb.com"
BASES = [f"{BASE}/api/v2/public/shared-view", f"{BASE}/api/v1/db/public/shared-view"]
OUT = Path(__file__).resolve().parent / "counts.json"
MAX_PAGES = 40


def fetch_page(base, offset):
    url = f"{base}/{SOURCE}/rows?limit=1000&offset={offset}"
    req = urllib.request.Request(url, headers={"accept": "application/json",
                                               "user-agent": "zakite-pie/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def read_rows():
    last = None
    for base in BASES:
        try:
            rows, offset = [], 0
            for _ in range(MAX_PAGES):
                d = fetch_page(base, offset)
                page = d.get("list") or []
                rows.extend(page)
                info = d.get("pageInfo") or {}
                if not page or info.get("isLastPage"):
                    return rows
                offset += len(page)
            return rows
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
            last = e
    sys.exit(f"could not read the shared view: {last}")


def tally(rows):
    counts, blank = {}, 0
    for r in rows:
        k = (r.get("Paragenesis") or "").strip()
        if k:
            counts[k] = counts.get(k, 0) + 1
        else:
            blank += 1
    if blank:
        counts["(blank)"] = blank
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def main():
    rows = read_rows()
    counts = tally(rows)
    total = len(rows)

    previous = None
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8"))
        except ValueError:
            previous = None
    if previous and previous.get("total") == total and previous.get("counts") == counts:
        print(f"unchanged: {total} samples")
        return

    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"{BASES[0]}/{SOURCE}/rows",
        "total": total,
        "counts": counts,
    }
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(OUT)
    print(f"wrote {total} samples: {counts}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Local editor for the homepage.

Run it on your own computer, then open the address it prints:

    python tools/edit_server.py

Click "Last updated 2026" at the bottom of the page and an edit button appears.
Change any text in the list, press "Save and push", and the change is written to
index.html, committed, and pushed to origin main.

Safety: it listens on 127.0.0.1 only, refuses saves from any other origin, and
only ever writes index.html. The repo holds no password or token; pushing uses
your existing git login. On the published site there is no server, so the edit
button never appears.
"""
import argparse
import hashlib
import json
import re
import subprocess
import threading
from html import unescape
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = "index.html"
PUSH = True
ALLOWED = set()
LOCK = threading.Lock()

# elements whose text can be edited, as a whole, with their inline markup kept
EDITABLE = {"p", "h1", "h2", "h3", "h4", "figcaption", "li", "dt", "dd", "blockquote", "span", "a"}
# an editable element containing any of these is skipped: its markup is not text
BAD = {"svg", "script", "style", "canvas", "iframe", "video", "audio", "object", "math", "noscript"}
# block-level tags: an editable element containing one of these is skipped too
BLOCK = {"address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset",
         "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main",
         "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "th", "thead", "tr", "ul"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
        "source", "track", "wbr"}
# sections are named by their id, so each block can say where it lives
LABELLED = {"section", "header", "footer", "aside", "nav", "main", "article"}


def read_page():
    with open(ROOT / PAGE, encoding="utf-8", newline="") as fh:
        return fh.read()


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def plain(raw):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


class Scanner(HTMLParser):
    """Walks the page source and records every outermost editable element with
    the exact character range of its inner markup, so a save can splice text in
    without disturbing anything else in the file."""

    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.starts = [0] + [i + 1 for i, ch in enumerate(text) if ch == "\n"]
        self.stack = []
        self.root = None
        self.out = []

    def here(self):
        line, col = self.getpos()
        return self.starts[line - 1] + col

    def label(self):
        for entry in reversed(self.stack):
            if entry["id"]:
                return entry["id"]
        return ""

    def close_root(self, pos):
        r = self.root
        self.root = None
        raw = self.text[r["start"]:pos]
        if not r["bad"] and raw.strip():
            self.out.append({"id": len(self.out), "start": r["start"], "end": pos, "tag": r["tag"],
                             "label": r["label"], "raw": raw, "text": plain(raw)})

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        pos = self.here()
        end = pos + len(self.get_starttag_text())
        ident = dict(attrs).get("id") if tag in LABELLED else None
        if self.root is not None:
            if tag in BAD or tag in BLOCK:
                self.root["bad"] = True
        elif tag in EDITABLE:
            self.root = {"tag": tag, "start": end, "depth": len(self.stack), "bad": False,
                         "label": self.label()}
        self.stack.append({"tag": tag, "id": ident})

    def handle_endtag(self, tag):
        idx = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                idx = i
                break
        if idx is None:
            return
        pos = self.here()
        if self.root is not None and idx <= self.root["depth"]:
            self.close_root(pos)
        del self.stack[idx:]


def parse(text):
    scanner = Scanner(text)
    scanner.feed(text)
    scanner.close()
    return scanner.out


def run_git(*args):
    proc = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def apply_edits(text, blocks, edits):
    """Splice each edited block's new inner markup into the page text. Edits are
    applied from the end of the file backwards, so earlier offsets stay valid."""
    spans = []
    for e in edits:
        block = blocks.get(e.get("id"))
        if block is None:
            raise ValueError(f"block {e.get('id')} is not in the page")
        new = str(e.get("new", "")).replace("\r\n", "\n").replace("\n", "\r\n")
        spans.append((block["start"], block["end"], new))
    spans.sort(reverse=True)
    for start, end, new in spans:
        text = text[:start] + new + text[end:]
    return text


def save(body):
    original = read_page()
    if body.get("sha") != sha(original):
        return 409, {"error": "index.html changed since the editor opened. Reload the page and edit again."}
    edits = body.get("edits") or []
    if not edits:
        return 200, {"ok": True, "message": "nothing to save"}
    code, branch = run_git("rev-parse", "--abbrev-ref", "HEAD")
    if code or branch != "main":
        return 409, {"error": "the editor only commits from the main branch", "detail": branch}
    blocks = {b["id"]: b for b in parse(original)}
    try:
        new_text = apply_edits(original, blocks, edits)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    if new_text == original:
        return 200, {"ok": True, "message": "nothing changed"}
    with open(ROOT / PAGE, "w", encoding="utf-8", newline="") as fh:
        fh.write(new_text)

    code, out = run_git("add", PAGE)
    if code:
        return 500, {"error": "git add failed", "detail": out}
    code, _ = run_git("diff", "--cached", "--quiet", "--", PAGE)
    if code == 0:
        return 200, {"ok": True, "message": "saved; git sees no difference"}
    count = len(edits)
    msg = f"Site edit: {count} text block{'s' if count != 1 else ''}"
    code, out = run_git("commit", "-m", msg, "--", PAGE)
    if code:
        return 500, {"error": "git commit failed", "detail": out}
    _, commit = run_git("rev-parse", "--short", "HEAD")
    if not PUSH:
        return 200, {"ok": True, "commit": commit, "pushed": False,
                     "message": f"committed {commit} (push turned off)"}
    code, out = run_git("push", "origin", "HEAD:main")
    if code:
        # the daily counts job may have pushed first: rebase onto it and try once more
        code2, out2 = run_git("pull", "--rebase", "--autostash", "origin", "main")
        if code2:
            return 500, {"error": "push was rejected and the rebase failed", "commit": commit,
                         "detail": out + "\n" + out2}
        code, out = run_git("push", "origin", "HEAD:main")
        if code:
            return 500, {"error": "push failed", "commit": commit, "detail": out}
    return 200, {"ok": True, "commit": commit, "pushed": True,
                 "message": f"committed {commit} and pushed to main"}


class Handler(SimpleHTTPRequestHandler):
    server_version = "zakite-edit"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            return self.send_json(200, {"ok": True, "page": PAGE, "push": PUSH})
        if path == "/api/blocks":
            text = read_page()
            blocks = [{k: b[k] for k in ("id", "label", "tag", "raw", "text")} for b in parse(text)]
            return self.send_json(200, {"sha": sha(text), "blocks": blocks})
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "no such endpoint"})
        if ".git" in Path(path).parts:
            return self.send_error(403)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/save":
            return self.send_json(404, {"error": "no such endpoint"})
        if self.headers.get("X-Edit") != "1" or self.headers.get("Origin", "") not in ALLOWED:
            return self.send_json(403, {"error": "saves are accepted from the local editor only"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > 5_000_000:
            return self.send_json(413, {"error": "too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "bad request body"})
        with LOCK:
            code, payload = save(body)
        return self.send_json(code, payload)


def main():
    global ROOT, PUSH, ALLOWED
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-push", action="store_true", help="commit but do not push")
    ap.add_argument("--repo", default=None, help="repo to edit (defaults to this checkout)")
    args = ap.parse_args()
    if args.repo:
        ROOT = Path(args.repo).resolve()
    PUSH = not args.no_push
    ALLOWED = {f"http://127.0.0.1:{args.port}", f"http://localhost:{args.port}"}
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Editor for {ROOT / PAGE}")
    print(f"Open http://127.0.0.1:{args.port}/ and click 'Last updated 2026'. Ctrl+C stops it.")
    print("Pushing to origin main is " + ("ON." if PUSH else "OFF (commits only)."))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

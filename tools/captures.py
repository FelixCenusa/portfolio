#!/usr/bin/env python3
"""Project captures: commit history per project, binned into ISO weeks.

A one-off data script (the site has no build step). It reads index.html,
finds each project's "Code" link, and for every link that points at a public
GitHub repo it lists the commit dates (only under the linked folder when the
link goes into one via /tree/<branch>/<path>), bins them into ISO weeks and
writes assets/data/captures.json for assets/js/captures.js to draw.

Only dates and counts are kept: no commit messages, authors or emails.
Projects without a public repo get {"none": "No public history (<reason>)"},
where the reason is what the page itself says under "Code" (for example
"Course work, not public" -> "course work").

Run it from anywhere:   python tools/captures.py
It uses the GitHub CLI (`gh api`, read-only GETs) when gh is installed and
logged in, and falls back to unauthenticated HTTPS (60 requests an hour,
plenty for this) when it isn't. Nothing is written if any request fails, so a
bad run never replaces good data: only a 404 or a private visibility counts as
"not public"; being offline, rate limited or hitting a server error stops the run.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"
OUT = ROOT / "assets" / "data" / "captures.json"
API = "https://api.github.com/"
MAX_PAGES = 30  # 3,000 commits per project is far more than any of these have

REPO_URL = re.compile(
    r"^https://github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?"
    r"(?:/tree/(?P<branch>[^/#?]+)(?:/(?P<path>[^#?]*?))?)?/?(?:[#?].*)?$"
)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


# ------------------------------------------------------------------ the page
class Projects(HTMLParser):
    """Collects, per article.proj, its Code links and its "Code" spec row text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.projects: dict[str, dict] = {}
        self.cur: dict | None = None  # the article we're in
        self.art_depth = self.links_depth = self.row_depth = -1
        self.link: dict | None = None  # the <a> we're in, inside .proj__links
        self.row: dict | None = None  # the .spec__row we're in
        self.part: str | None = None  # 'label' or 'value' while inside a row's span

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if tag not in VOID:
            self.depth += 1
        if tag == "article" and "proj" in cls and a.get("id"):
            self.cur = self.projects.setdefault(a["id"], {"links": [], "code": None})
            self.art_depth = self.depth
        if not self.cur:
            return
        if tag == "div" and "proj__links" in cls:
            self.links_depth = self.depth
        elif tag == "a" and self.links_depth > 0:
            self.link = {"href": a.get("href", ""), "text": ""}
        elif tag == "div" and "spec__row" in cls:
            self.row, self.row_depth = {"label": "", "value": ""}, self.depth
        elif tag == "span" and self.row is not None and self.part is None:
            self.part = "label" if "label" in cls else "value"

    def handle_startendtag(self, tag, attrs):
        # <path .../> and friends open and close at once; void tags never counted
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.cur:
            if tag == "a" and self.link is not None:
                self.cur["links"].append({"href": self.link["href"], "text": " ".join(self.link["text"].split())})
                self.link = None
            elif tag == "span" and self.part:
                self.part = None
            elif tag == "div" and self.depth == self.links_depth:
                self.links_depth = -1
            elif tag == "div" and self.depth == self.row_depth:
                if self.row["label"].strip() == "Code":
                    self.cur["code"] = " ".join(self.row["value"].split())
                self.row, self.row_depth = None, -1
            elif tag == "article" and self.depth == self.art_depth:
                self.cur, self.art_depth = None, -1
        self.depth -= 1

    def handle_data(self, data):
        if self.link is not None:
            self.link["text"] += data
        if self.row is not None and self.part:
            self.row[self.part] += data


def reason_from(text: str | None) -> str:
    """The page's own words for why there's no public code, shortened."""
    if not text:
        return "No public history"
    t = text.lower()
    for words in ("private repo", "course work"):
        if words in t:
            return f"No public history ({words})"
    return f"No public history ({re.split(r'[,(]', t)[0].strip()})"


def read_page(page: Path) -> dict[str, dict]:
    """article id -> {'owner', 'repo', 'branch', 'path'} or {'none': text}."""
    p = Projects()
    p.feed(page.read_text(encoding="utf-8"))
    out = {}
    for pid, proj in p.projects.items():
        code = next(
            (m for link in proj["links"] if re.match(r"^Code\b", link["text"]) and not re.match(r"^Code walkthrough", link["text"])
             for m in [REPO_URL.match(link["href"])] if m),
            None,
        )
        if code:
            out[pid] = {
                "owner": code["owner"],
                "repo": code["repo"],
                "branch": code["branch"] or "",
                "path": urllib.parse.unquote(code["path"] or "").strip("/"),
            }
        else:
            out[pid] = {"none": reason_from(proj["code"])}
    return out


# ------------------------------------------------------------------ GitHub
def gh_ready() -> bool:
    if not shutil.which("gh"):
        return False
    try:
        r = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0


class NotFound(RuntimeError):
    """GitHub answered 404: the thing doesn't exist, or isn't visible to us."""


class GitHub:
    def __init__(self) -> None:
        self.use_gh = gh_ready()

    def get(self, endpoint: str):
        """A read-only GET of an API endpoint ('repos/o/r/commits?...'), parsed JSON.

        Every failure ends up as a RuntimeError (NotFound for a real 404), so main()
        can stop before writing anything."""
        if self.use_gh:
            try:
                r = subprocess.run(
                    ["gh", "api", "-X", "GET", "-H", "Accept: application/vnd.github+json", endpoint],
                    capture_output=True, text=True, encoding="utf-8", timeout=60,
                )
            except (OSError, subprocess.SubprocessError) as e:  # gh vanished, or timed out
                raise RuntimeError(f"gh api {endpoint}: {e}") from e
            if r.returncode != 0:
                err = (r.stderr or "").strip()
                kind = NotFound if "HTTP 404" in err else RuntimeError
                raise kind(f"gh api {endpoint}: {err or r.returncode}")
            body = r.stdout
        else:
            req = urllib.request.Request(
                API + endpoint,
                headers={"Accept": "application/vnd.github+json", "User-Agent": "portfolio-captures-script"},
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    body = res.read().decode("utf-8")
            except urllib.error.HTTPError as e:  # before OSError: HTTPError is one
                kind = NotFound if e.code == 404 else RuntimeError
                raise kind(f"GET {endpoint}: HTTP {e.code}") from e
            except OSError as e:  # URLError (no network, DNS), timeouts, dropped connections
                raise RuntimeError(f"GET {endpoint}: {getattr(e, 'reason', None) or e}") from e
        try:
            return json.loads(body)
        except ValueError as e:
            raise RuntimeError(f"{endpoint}: the response isn't JSON ({e})") from e

    def is_public(self, owner: str, repo: str) -> bool:
        """True for a public repo, False for one that's private or 404s (gone, or hidden
        without a login). Any other failure (offline, rate limit, 5xx) is raised: it says
        nothing about the repo, so it must never turn into "No public history"."""
        try:
            meta = self.get(f"repos/{owner}/{repo}")
        except NotFound:
            return False
        if not isinstance(meta, dict):
            raise RuntimeError(f"repos/{owner}/{repo}: unexpected response")
        return meta.get("visibility", "public" if meta.get("private") is False else "private") == "public"

    def commit_dates(self, owner: str, repo: str, branch: str, path: str) -> list[dt.date]:
        q = {"per_page": "100"}
        if branch:
            q["sha"] = branch
        if path:
            q["path"] = path
        dates = []
        for page in range(1, MAX_PAGES + 1):
            q["page"] = str(page)
            batch = self.get(f"repos/{owner}/{repo}/commits?{urllib.parse.urlencode(q)}")
            if not isinstance(batch, list):
                raise RuntimeError(f"repos/{owner}/{repo}/commits: unexpected response")
            for c in batch:
                info = c.get("commit") or {}
                stamp = (info.get("author") or {}).get("date") or (info.get("committer") or {}).get("date")
                if stamp:
                    dates.append(parse_date(stamp))
            # everything else in the response (messages, names, emails) is dropped right here
            if len(batch) < 100:
                break
        return dates


def parse_date(stamp: str) -> dt.date:
    """'2024-06-03T11:07:48Z' -> the UTC calendar date."""
    when = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if when.tzinfo:
        when = when.astimezone(dt.timezone.utc)
    return when.date()


# ------------------------------------------------------------------ binning
def week_start(d: dt.date) -> dt.date:
    """The Monday that starts d's ISO week."""
    return d - dt.timedelta(days=d.weekday())


def capture(dates: list[dt.date]) -> dict:
    weeks: dict[dt.date, int] = {}
    for d in dates:
        w = week_start(d)
        weeks[w] = weeks.get(w, 0) + 1
    return {
        "first": min(dates).isoformat(),
        "last": max(dates).isoformat(),
        "commits": len(dates),
        "weeks": [[w.isoformat(), n] for w, n in sorted(weeks.items())],
    }


def dump(data: dict) -> str:
    """Pretty at the top, one line per project, so diffs stay readable and the file small."""
    rows = [f'    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, separators=(",", ":"))}' for k, v in data["projects"].items()]
    return "{\n" + f'  "generated": {json.dumps(data["generated"])},\n  "projects": {{\n' + ",\n".join(rows) + "\n  }\n}\n"


def main() -> int:
    targets = read_page(PAGE)
    gh = GitHub()
    print(f"{len(targets)} projects in {PAGE.name}; using {'gh api' if gh.use_gh else 'unauthenticated HTTPS'}")
    projects = {}
    try:
        for pid, t in targets.items():
            if "none" in t:
                projects[pid] = {"none": t["none"]}
                print(f"  {pid:<20} {t['none']}")
                continue
            full = f"{t['owner']}/{t['repo']}"
            if not gh.is_public(t["owner"], t["repo"]):
                projects[pid] = {"none": "No public history"}
                print(f"  {pid:<20} {full} is not public")
                continue
            dates = gh.commit_dates(t["owner"], t["repo"], t["branch"], t["path"])
            if not dates:
                projects[pid] = {"none": "No public history"}
                print(f"  {pid:<20} {full} {t['path']}: no commits")
                continue
            projects[pid] = {"repo": full, "path": t["path"], **capture(dates)}
            c = projects[pid]
            print(f"  {pid:<20} {full}/{t['path']:<10} {c['commits']:>4} commits in {len(c['weeks'])} weeks, {c['first']} to {c['last']}")
    except RuntimeError as e:
        print(f"error: {e}\nNothing written.", file=sys.stderr)
        return 1
    data = {"generated": dt.date.today().isoformat(), "projects": projects}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = dump(data)
    json.loads(text)  # it must round-trip
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(text.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

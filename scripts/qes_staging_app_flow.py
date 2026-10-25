#!/usr/bin/env python3
"""Staging: browser krok + podpis KÓDEM APPKY proti https://dokulachtan-staging.fly.dev.

Použití: .venv/bin/python scripts/qes_staging_app_flow.py <submitter_slug> <field_uuid>
Vypíše JSON s tokenem a výsledkem obřadu z appky.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("QES_STAGING_URL", "https://dokulachtan-staging.fly.dev")
ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "mobile" / "app"

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(method: str, path: str, payload: dict | None = None, headers: dict | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json", **(headers or {})},
    )
    try:
        with opener.open(req, timeout=60) as res:
            body = res.read()
            return res.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace")
        return err.code, json.loads(body) if body.strip().startswith(("{", "[")) else {"raw": body[:300]}


def main() -> int:
    slug, field_uuid = sys.argv[1], sys.argv[2]

    with opener.open(f"{BASE}/s/{slug}", timeout=60) as res:
        html = res.read().decode(errors="replace")

    match = re.search(r'name="csrf-token" content="([^"]+)"', html)
    if not match:
        raise SystemExit("CSRF token nenalezen")

    status, created = request("POST", f"/s/{slug}/qes_sessions", {"field_uuid": field_uuid},
                             {"X-CSRF-Token": match.group(1)})
    print(f"POST /s/:slug/qes_sessions -> HTTP {status}")

    if status != 201:
        raise SystemExit(f"Vytvoření session selhalo: {created}")

    token = created["token"]
    print(f"token: {token[:12]}…  state: {created['state']}")
    print(f"universal_link: {created['universal_link']}")

    proc = subprocess.run(
        ["npx", "tsx", "--tsconfig", "scripts/tsconfig.e2e.json", "scripts/qes-app-e2e.ts"],
        capture_output=True, text=True, cwd=APP, timeout=300,
        env={**os.environ, "QES_E2E_TOKEN": token, "QES_E2E_SERVER_URL": BASE},
    )

    if proc.returncode != 0:
        raise SystemExit(f"Appka selhala: {(proc.stdout + proc.stderr)[-600:]}")

    result = json.loads(proc.stdout.strip().splitlines()[-1])
    print(json.dumps(result, indent=2, ensure_ascii=False)[:900])

    return 0 if result.get("completed", {}).get("state") == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())

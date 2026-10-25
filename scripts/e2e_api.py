#!/usr/bin/env python3
"""E2E test: DocuSeal API + fixtures + validace.

Tok podpisu (varianta B - aplikace vrací podpis):
  1. POST /api/submissions/pdf  - PDF z fixtures + podpisové pole + submitter
     s completed:true a hodnotou podpisu (base64 PNG data URL)
  2. GET  /api/submissions/{id}           - kontrola stavu
  3. GET  /api/submissions/{id}/documents - finální PDF
  4. qpdf + pdfsig + pyHanko             - validace výsledku

Použití: DOCUSEAL_TOKEN=... ./scripts/e2e_api.py
"""
from __future__ import annotations

import base64
import json
import math
import os
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get("DOCUSEAL_URL", "http://localhost:3000").rstrip("/")
OUT = ROOT / "test" / "out"


def signature_png(width: int = 200, height: int = 60) -> bytes:
    """Deterministický PNG s podpisovou křivkou."""
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            yy = int(height / 2 + 18 * math.sin(x / 22))
            on = abs(y - yy) <= 1 and 10 < x < width - 10
            row += bytes((0, 0, 0) if on else (255, 255, 255))
        rows.append(b"\x00" + bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def api(method: str, path: str, payload: dict | None = None, raw: bool = False):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "X-Auth-Token": os.environ["DOCUSEAL_TOKEN"],
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read()
            return res.status, body if raw else json.loads(body)
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace")
        raise SystemExit(f"HTTP {err.code} {method} {path}: {body[:500]}")


def run(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    return (proc.stdout + proc.stderr).strip()


def main() -> int:
    if not os.environ.get("DOCUSEAL_TOKEN"):
        raise SystemExit("Chybí DOCUSEAL_TOKEN (viz .env.docuseal)")

    OUT.mkdir(parents=True, exist_ok=True)
    report: list[str] = [f"# E2E report - {time.strftime('%Y-%m-%d %H:%M:%S')}", f"- DocuSeal: {BASE}"]

    png = signature_png()
    (ROOT / "test" / "fixtures" / "signature.png").write_bytes(png)
    data_url = "data:image/png;base64," + base64.b64encode(png).decode()
    template_id = int(os.environ["DOCUSEAL_TEMPLATE_ID"])

    payload = {
        "template_id": template_id,
        "send_email": False,
        "submitters": [
            {
                "role": "Signer",
                "email": "signer@example.com",
                "completed": True,
                "values": {"Signature": data_url},
            }
        ],
    }

    status, created = api("POST", "/api/submissions", payload)
    report.append(f"\n## POST /api/submissions (template {template_id}) -> HTTP {status}")
    report.append(json.dumps(created, indent=2, ensure_ascii=False)[:1500])

    submitter = created[0]
    submission_id = submitter["submission_id"]
    report.append(f"- submission_id: {submission_id}")
    report.append(
        f"- submitter: {submitter.get('name')} <{submitter.get('email')}> "
        f"completed_at={submitter.get('completed_at')}"
    )

    for _ in range(20):
        _, submission = api("GET", f"/api/submissions/{submission_id}")
        if submission.get("completed_at"):
            break
        time.sleep(1)
    report.append(f"- submission.completed_at: {submission.get('completed_at')}")

    status, docs = api("GET", f"/api/submissions/{submission_id}/documents")
    report.append(f"\n## GET /api/submissions/{submission_id}/documents -> HTTP {status}")
    report.append(json.dumps(docs, indent=2, ensure_ascii=False)[:1000])

    for i, doc in enumerate(docs.get("documents", [])):
        status, body = api("GET", doc["url"].replace(BASE, ""), raw=True)
        path = OUT / f"e2e-document-{i}.pdf"
        path.write_bytes(body)
        report.append(f"\n## Dokument {i}: {doc['name']} -> {path.name} ({len(body)} B)")

        report.append(f"\n### qpdf --check {path.name}\n```\n{run(['qpdf', '--check', str(path)])}\n```")
        report.append(f"\n### pdfsig {path.name}\n```\n{run(['pdfsig', str(path)])}\n```")
        trust = str(ROOT / "test" / "certs" / "signer.cert.pem")
        report.append(
            f"\n### pyhanko sign validate --trust {trust} {path.name}\n```\n"
            f"{run(['.venv/bin/pyhanko', 'sign', 'validate', '--trust', trust, str(path)])}\n```"
        )

    text = "\n".join(report)
    (OUT / "e2e-report.txt").write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

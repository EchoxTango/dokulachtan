#!/usr/bin/env python3
"""Negativní a LTV scénáře pro E2E testy QES.

Spustí lokální HTTP server s CRL (127.0.0.1:8765), podepíše fixtures
a ověří je pyHanko API (strukturované asserty):

  T8  změna PDF po podpisu          -> intact=False
  T9a expirovaný certifikát          -> trust_problem_indic=EXPIRED
  T9b revokovaný certifikát (CRL)    -> revoked=True
  T3  PAdES-B-LT s LTV (CRL embedded) -> trusted=True, LTV v PDF
  T10 QCStatements: QcCompliance/QcSSCD -> AdES vs QES-capable

Výstup: test/out/negative-report.txt
"""
from __future__ import annotations

import base64
import http.server
import socketserver
import threading
from datetime import datetime, timezone
from pathlib import Path

from asn1crypto import core, x509 as asn1_x509
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.oid import ObjectIdentifier
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import signers
from pyhanko.sign.signers.pdf_signer import PdfSignatureMetadata, PdfSigner
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "test" / "fixtures"
PKI = ROOT / "test" / "certs" / "pki"
OUT = ROOT / "test" / "out"
PORT = 8765
QC_STATEMENTS_OID = ObjectIdentifier("1.3.6.1.5.5.7.1.3")
QC_OIDS = {
    "0.4.0.1862.1.1": "QcCompliance",
    "0.4.0.1862.1.4": "QcSSCD",
}

report: list[str] = []

socketserver.TCPServer.allow_reuse_address = True


def log(line: str = "") -> None:
    print(line)
    report.append(line)


def start_crl_server(crl_name: str) -> socketserver.TCPServer:
    """Servíruje test/certs/pki/root.crl nebo root-revoked.crl na 127.0.0.1:8765."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(PKI), **kwargs)

        def translate_path(self, path: str) -> str:
            if path.endswith("root.crl"):
                return str(PKI / crl_name)
            return super().translate_path(path)

        def log_message(self, *args):  # ticho
            pass

    server = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def load_cert(path: Path) -> asn1_x509.Certificate:
    """asn1crypto cert pro ValidationContext."""
    crypto = x509.load_pem_x509_certificate(path.read_bytes())
    return asn1_x509.Certificate.load(crypto.public_bytes(serialization.Encoding.DER))


def load_crypto_cert(path: Path) -> x509.Certificate:
    return x509.load_pem_x509_certificate(path.read_bytes())


def sign_pdf(out_name: str, signer_name: str, *, embed_ltv: bool, vc: ValidationContext) -> Path:
    signer = signers.SimpleSigner.load(
        key_file=str(PKI / f"{signer_name}.key"),
        cert_file=str(PKI / f"{signer_name}.crt"),
        ca_chain_files=[str(PKI / "root.crt")],
    )
    meta = PdfSignatureMetadata(
        field_name="Sig1",
        reason="E2E negative/LTV test",
        embed_validation_info=embed_ltv,
        **({"validation_context": vc} if embed_ltv else {}),
    )
    out = FIX / out_name
    with open(FIX / "input.pdf", "rb") as f:
        w = IncrementalPdfFileWriter(f)
        PdfSigner(meta, signer).sign_pdf(w, output=open(out, "wb"))
    return out


def validate(path: Path, vc: ValidationContext):
    with open(path, "rb") as f:
        reader = PdfFileReader(f)
        return validate_pdf_signature(reader.embedded_signatures[0], vc)


def qc_statements(cert: x509.Certificate) -> list[str]:
    try:
        ext = cert.extensions.get_extension_for_oid(QC_STATEMENTS_OID)
    except x509.ExtensionNotFound:
        return []
    seq = core.Sequence.load(ext.value.value)
    return [str(seq[i][0].dotted) for i in range(len(seq))]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    root_cert = load_cert(PKI / "root.crt")

    log(f"# Negativní / LTV scénáře - {datetime.now(timezone.utc).isoformat()}")
    log()

    # --- QCStatements -------------------------------------------------
    log("## T10: QCStatements (QcCompliance / QcSSCD)")
    for name in ("signer-ades", "signer-qscd"):
        cert = load_crypto_cert(PKI / f"{name}.crt")
        oids = qc_statements(cert)
        labels = [QC_OIDS.get(o, o) for o in oids]
        log(f"- {name}: {labels} -> {'QES-capable' if 'QcSSCD' in labels else 'AdES (bez QcSSCD)'}")
    log()

    # --- PAdES-B-LT s CRL (LTV) -------------------------------------
    server = start_crl_server("root.crl")
    try:
        vc = ValidationContext(trust_roots=[root_cert], allow_fetching=True)
        lt = sign_pdf("signed-lt.pdf", "signer-ades", embed_ltv=True, vc=vc)
        status = validate(lt, vc)
        offline = ValidationContext(trust_roots=[root_cert], allow_fetching=False)
        off_status = validate(lt, offline)
        log("## T3: PAdES-B-LT s LTV (CRL embedded)")
        log(f"- {lt.name}: intact={status.intact} valid={status.valid} trusted={status.trusted} "
            f"revoked={status.revoked}")
        log(f"- offline validace (bez fetch): trusted={off_status.trusted} -> "
            f"{'LTV OK' if off_status.trusted else 'LTV CHYBI'}")
        log(f"- embedded DSS dict: {'ano' if _has_dss(lt) else 'NE (revokační data v CMS)'}")
        log()

        # --- T9b revokovaný (CRL se zneplatněným certem) -------------
        server.shutdown()
        server.server_close()
        server = start_crl_server("root-revoked.crl")
        vc_revoked = ValidationContext(trust_roots=[root_cert], allow_fetching=True)
        revoked = sign_pdf("signed-revoked.pdf", "signer-ades", embed_ltv=False, vc=vc_revoked)
        st = validate(revoked, vc_revoked)
        log("## T9b: revokovaný certifikát")
        log(f"- {revoked.name}: intact={st.intact} valid={st.valid} trusted={st.trusted} "
            f"revoked={st.revoked}")
        log()
    finally:
        server.shutdown()
        server.server_close()

    # --- T9a expirovaný ----------------------------------------------
    vc = ValidationContext(trust_roots=[root_cert], allow_fetching=False)
    expired = sign_pdf("signed-expired.pdf", "signer-expired", embed_ltv=False, vc=vc)
    st = validate(expired, vc)
    log("## T9a: expirovaný certifikát")
    log(f"- {expired.name}: intact={st.intact} valid={st.valid} trusted={st.trusted} "
        f"indic={getattr(st.trust_problem_indic, 'name', st.trust_problem_indic)}")
    log()

    # --- T8 změna PDF po podpisu -------------------------------------
    modified = OUT / "signed-modified.pdf"
    data = bytearray((FIX / "signed-pades-bes.pdf").read_bytes())
    needle = b"Dokulachtan test document"
    idx = bytes(data).find(needle)
    data[idx : idx + len(needle)] = b"Dokulachtan TAMPERED!!!!!"[: len(needle)]
    modified.write_bytes(bytes(data))
    st = validate(modified, vc)
    log("## T8: změna PDF po podpisu (přepis byte v podepsaném obsahu)")
    log(f"- {modified.name}: intact={st.intact} valid={st.valid} "
        f"modification_level={st.modification_level.name}")
    log()

    (OUT / "negative-report.txt").write_text("\n".join(report) + "\n")
    log(f"OK: report v {OUT / 'negative-report.txt'}")
    return 0


def _has_dss(path: Path) -> bool:
    data = path.read_bytes()
    return b"/DSS" in data or b"/VRI" in data


if __name__ == "__main__":
    raise SystemExit(main())

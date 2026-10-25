#!/usr/bin/env python3
"""PoC varianty B: klíč zůstane v telefonu (Android), server jen připraví digest
a vloží podpis do PDF.

Tok:
  1. pyHanko připraví TBS PDF a digest (interrupted signing)
  2. DigestInfo (SHA-256) se pošle do emulátoru
  3. Android app (PKCS#12 v telefonu) podepíše DigestInfo přes NONEwithRSA
  4. Raw signatura se vrátí na server, pyHanko sestaví CMS a vloží do PDF
  5. Validace pyHanko + pdfsig

Předpoklad: běžící emulátor, nainstalovaný APK (mobile/android-signer-poc).
"""
from __future__ import annotations

import asyncio
import hashlib
import subprocess
import sys
from pathlib import Path

from asn1crypto import algos, x509 as asn1_x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from pyhanko.sign.signers import ExternalSigner, PdfSignatureMetadata, PdfSigner
from pyhanko_certvalidator.registry import SimpleCertificateStore

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "test" / "fixtures"
OUT = ROOT / "test" / "out"
P12 = ROOT / "test" / "certs" / "signer.p12"
P12_PASS = b"test"
REMOTE = "/data/local/tmp"
ADB = "adb"
APK = ROOT / "mobile" / "android-signer-poc" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
ACTIVITY = "cz.dokulachtan.signerpoc/.MainActivity"
PKG = "cz.dokulachtan.signerpoc"

report: list[str] = []


def log(line: str = "") -> None:
    print(line)
    report.append(line)


def adb(*args: str) -> str:
    proc = subprocess.run([ADB, *args], capture_output=True, text=True)
    return (proc.stdout + proc.stderr).strip()


def load_signer_material() -> tuple[asn1_x509.Certificate, SimpleCertificateStore]:
    _, cert, cas = pkcs12.load_key_and_certificates(P12.read_bytes(), P12_PASS)
    signer_cert = asn1_x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER))
    registry = SimpleCertificateStore()
    registry.register(signer_cert)
    for ca in cas or []:
        registry.register(asn1_x509.Certificate.load(ca.public_bytes(serialization.Encoding.DER)))
    return signer_cert, registry


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if not APK.exists():
        raise SystemExit(f"APK nenalezen: {APK}")

    log(f"# Mobile PoC (varianta B) - klíč v telefonu, digest na serveru")
    log()

    # --- 1. připravit TBS PDF a digest ----------------------------------
    signer_cert, registry = load_signer_material()
    external = ExternalSigner(signer_cert, registry, signature_value=256)
    pdf_signer = PdfSigner(
        PdfSignatureMetadata(field_name="Sig1", reason="Mobile PoC QES/AdES"),
        signer=external,
    )

    tbs_path = OUT / "mobile-tbs.pdf"

    async def prepare():
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

        with open(FIX / "input.pdf", "rb") as src, open(tbs_path, "wb") as tbs_out:
            writer = IncrementalPdfFileWriter(src)
            prepared, tbs, _ = await pdf_signer.async_digest_doc_for_signing(
                writer, bytes_reserved=16384, output=tbs_out
            )
        return prepared, tbs

    prepared, tbs = asyncio.run(prepare())

    digest_info = algos.DigestInfo(
        {"digest_algorithm": {"algorithm": "sha256"}, "digest": prepared.document_digest}
    ).dump()
    digest_path = OUT / "document-digest.bin"
    digest_path.write_bytes(digest_info)
    log(f"1. TBS PDF: {tbs_path.name} ({tbs_path.stat().st_size} B)")
    log(f"   digest (SHA-256 ByteRange): {prepared.document_digest.hex()[:32]}...")
    log()

    # --- 2. do telefonu -------------------------------------------------
    adb("install", "-r", str(APK))
    adb("push", str(P12), f"{REMOTE}/signer.p12")
    adb("push", str(digest_path), f"{REMOTE}/digest.bin")
    adb("shell", f"run-as {PKG} sh -c 'cat {REMOTE}/signer.p12 > files/signer.p12'")
    adb("shell", f"run-as {PKG} sh -c 'cat {REMOTE}/digest.bin > files/digest.bin'")
    adb("shell", f"run-as {PKG} rm -f files/signature.bin")
    adb("shell", "am", "start", "-n", ACTIVITY)
    import time

    for _ in range(30):
        if "signature.bin" in adb("shell", "run-as", PKG, "ls", "files/signature.bin"):
            break
        time.sleep(1)
    logcat = adb("logcat", "-d", "-s", "SignerPoC:I", "*:S")
    log("2. Android app (telefon):")
    for line in logcat.splitlines():
        if "SignerPoC" in line:
            log("   " + line.split("SignerPoC", 1)[1].lstrip(": ").strip())
    log()

    # --- 3. zpět na server ----------------------------------------------
    sig_path = OUT / "signature.bin"
    proc = subprocess.run(
        [ADB, "exec-out", "run-as", PKG, "cat", "files/signature.bin"], capture_output=True
    )
    sig_path.write_bytes(proc.stdout)
    raw_sig = sig_path.read_bytes()
    log(f"3. Raw signatura z telefonu: {sig_path.name} ({len(raw_sig)} B)")
    log()

    # --- 4. sestavit CMS a vložit do PDF ---------------------------------
    signer_dummy = ExternalSigner(signer_cert, registry, signature_value=256)

    async def build_cms():
        # data, která telefon podepsal = ByteRange bez rezervovaného regionu
        data = tbs_path.read_bytes()
        part1 = data[: prepared.reserved_region_start]
        part2 = data[prepared.reserved_region_end :]
        to_sign = part1 + part2
        assert hashlib.sha256(to_sign).digest() == prepared.document_digest, "digest mismatch"
        # 1. CMS s placeholderem -> z něj vezmeme podepsané atributy
        dummy_cms = await signer_dummy.async_sign_general_data(
            to_sign, "sha256", detached=True, use_cades=True
        )
        return dummy_cms

    dummy_cms = asyncio.run(build_cms())
    signed_attrs = dummy_cms["content"]["signer_infos"][0]["signed_attrs"].untag().dump()
    attrs_digest_info = algos.DigestInfo(
        {
            "digest_algorithm": {"algorithm": "sha256"},
            "digest": hashlib.sha256(signed_attrs).digest(),
        }
    ).dump()
    attrs_path = OUT / "digest.bin"
    attrs_path.write_bytes(attrs_digest_info)
    log(f"   podepsané atributy: {len(signed_attrs)} B, DigestInfo: {attrs_path.name} "
        f"({len(attrs_digest_info)} B)")
    log()

    # --- 2. do telefonu -------------------------------------------------
    adb("install", "-r", str(APK))
    adb("push", str(P12), f"{REMOTE}/signer.p12")
    adb("push", str(attrs_path), f"{REMOTE}/digest.bin")
    adb("shell", f"run-as {PKG} sh -c 'cat {REMOTE}/signer.p12 > files/signer.p12'")
    adb("shell", f"run-as {PKG} sh -c 'cat {REMOTE}/digest.bin > files/digest.bin'")
    adb("shell", f"run-as {PKG} rm -f files/signature.bin")
    adb("shell", "am", "start", "-n", ACTIVITY)
    import time

    for _ in range(30):
        if "signature.bin" in adb("shell", "run-as", PKG, "ls", "files/signature.bin"):
            break
        time.sleep(1)
    logcat = adb("logcat", "-d", "-s", "SignerPoC:I", "*:S")
    log("2. Android app (telefon):")
    for line in logcat.splitlines():
        if "SignerPoC" in line:
            log("   " + line.split("SignerPoC", 1)[1].lstrip(": ").strip())
    log()

    # --- 3. zpět na server ----------------------------------------------
    sig_path = OUT / "signature.bin"
    proc = subprocess.run(
        [ADB, "exec-out", "run-as", PKG, "cat", "files/signature.bin"], capture_output=True
    )
    sig_path.write_bytes(proc.stdout)
    raw_sig = sig_path.read_bytes()
    log(f"3. Raw signatura z telefonu: {sig_path.name} ({len(raw_sig)} B)")
    log()

    # nahradit placeholder v CMS skutečnou signaturou
    dummy_cms["content"]["signer_infos"][0]["signature"] = raw_sig
    cms = dummy_cms.dump()
    with open(tbs_path, "r+b") as fh:
        tbs.finish_signing(fh, prepared, cms)

    final = OUT / "mobile-signed.pdf"
    final.write_bytes(tbs_path.read_bytes())
    log(f"4. CMS sestaveno a vloženo: {final.name} ({final.stat().st_size} B)")
    log()

    # --- 5. validace ------------------------------------------------------
    from cryptography import x509 as crypto_x509
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    trust = asn1_x509.Certificate.load(
        crypto_x509.load_pem_x509_certificate(
            (ROOT / "test" / "certs" / "signer.cert.pem").read_bytes()
        ).public_bytes(serialization.Encoding.DER)
    )
    vc = ValidationContext(trust_roots=[trust], allow_fetching=False)
    with open(final, "rb") as fh:
        status = validate_pdf_signature(PdfFileReader(fh).embedded_signatures[0], vc)
    log(f"5. pyHanko validace: intact={status.intact} valid={status.valid} trusted={status.trusted} "
        f"coverage={status.coverage.name}")
    log("   pdfsig:")
    pdfsig = subprocess.run(["pdfsig", str(final)], capture_output=True, text=True)
    for line in pdfsig.stdout.splitlines():
        if any(k in line for k in ("Signature Field", "Signature Type", "Total document", "Validation", "Hash")):
            log("   " + line.strip())
    log()

    (OUT / "mobile-report.txt").write_text("\n".join(report) + "\n")
    log(f"OK: report v {OUT / 'mobile-report.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

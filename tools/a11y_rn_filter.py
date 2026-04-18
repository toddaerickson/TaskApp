#!/usr/bin/env python3
"""Wrap .claude/skills/a11y-audit/scripts/a11y_scanner.py and drop findings
whose rule_id targets HTML constructs that React Native doesn't have.

Why: the bundled scanner is HTML-first. It flags every .tsx file for
missing <main>, <nav>, and skip-link landmarks — false positives for a
React Native + expo-router codebase. Its other rules (image-alt,
form-label, aria-*, link-*, table-*, media-*) either look for lowercase
HTML tag names that RN doesn't emit, or for attribute shapes (tabindex,
onClick, aria-*) that don't apply. Once we strip those, the remaining
signal is close to zero — which is the point: the scanner as-is is the
wrong tool. Real RN a11y checks (accessibilityLabel coverage, 44x44 tap
targets) want a TypeScript-AST walker, noted as a follow-up in
docs/a11y-audit-2026-04.md.

Usage:
    python3 tools/a11y_rn_filter.py mobile/
    python3 tools/a11y_rn_filter.py mobile/ --format=table
    python3 tools/a11y_rn_filter.py mobile/ --json

Exit codes mirror the wrapped scanner (0 pass, 1 warnings, 2+ errors).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


# Rule IDs that don't apply to React Native. Derived from reading
# .claude/skills/a11y-audit/scripts/a11y_scanner.py. If the scanner
# learns new RN-friendly rules, add them to the keep-list by NOT
# adding them here.
RN_INCOMPATIBLE = {
    # HTML landmarks — RN has no <main>, <nav>, skip-links.
    "landmark-no-main",
    "landmark-no-nav",
    "landmark-no-skip-link",
    # Heading hierarchy — no <h1>–<h6> in RN.
    "heading-missing-h1",
    "heading-multiple-h1",
    "heading-skipped",
    # Form-control rules target <input>, <select>, <label> — RN uses
    # <TextInput> + accessibilityLabel with a different API.
    "form-input-no-label",
    "form-select-no-label",
    "form-orphan-label",
    "form-missing-fieldset",
    # Image alt rules look for tag == "img"; RN uses <Image>.
    "img-alt-missing",
    "img-alt-empty-informative",
    "img-decorative-alt",
    # Keyboard rules target HTML attributes (tabindex, onclick, autofocus)
    # that RN doesn't emit.
    "keyboard-tabindex-positive",
    "keyboard-click-no-key",
    "keyboard-autofocus",
    # ARIA: RN uses accessibility* props, not aria-*.
    "aria-invalid-attr",
    "aria-hidden-focusable",
    "aria-live-missing",
    # HTML-only element families.
    "link-empty",
    "link-bad-text",
    "link-empty-fragment",
    "table-no-headers",
    "table-no-caption",
    "media-no-captions",
    "media-autoplay-no-controls",
    "media-audio-autoplay",
}


def run_scanner(target: str, scanner_path: Path) -> dict:
    """Invoke the upstream scanner in JSON mode and return the parsed report."""
    proc = subprocess.run(
        [sys.executable, str(scanner_path), target, "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode not in (0, 1):
        # 0 = pass, 1 = findings. Anything else is a scanner failure we want to see.
        sys.stderr.write(proc.stderr)
        sys.exit(proc.returncode)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Could not parse scanner output: {e}\n")
        sys.stderr.write(proc.stdout[:500])
        sys.exit(2)


def filter_findings(report: dict) -> dict:
    kept = [f for f in report.get("findings", []) if f.get("rule_id") not in RN_INCOMPATIBLE]
    dropped = len(report.get("findings", [])) - len(kept)
    by_sev: dict[str, int] = {}
    for f in kept:
        sev = f.get("severity", "unknown")
        by_sev[sev] = by_sev.get(sev, 0) + 1
    return {
        "summary": {
            "files_scanned": report.get("summary", {}).get("files_scanned", 0),
            "total_issues": len(kept),
            "by_severity": by_sev,
            "dropped_as_rn_incompatible": dropped,
            "ignored_rule_ids": sorted(RN_INCOMPATIBLE),
        },
        "findings": kept,
    }


def format_table(report: dict) -> str:
    s = report["summary"]
    lines = [
        "React Native filtered a11y scan",
        f"  files scanned: {s['files_scanned']}",
        f"  findings: {s['total_issues']}  (dropped {s['dropped_as_rn_incompatible']} RN-incompatible)",
        f"  by severity: {s['by_severity'] or '—'}",
        "",
    ]
    if not report["findings"]:
        lines.append("No findings that apply to React Native. ✓")
        lines.append("")
        lines.append("Note: the upstream scanner targets HTML; for RN a11y see the")
        lines.append("follow-ups in docs/a11y-audit-2026-04.md (accessibilityLabel")
        lines.append("coverage, 44x44 tap targets, design-token contrast).")
        return "\n".join(lines)

    for f in report["findings"]:
        lines.append(
            f"[{f['severity']}] {f['rule_id']} — {f['message']}\n"
            f"    {f['file']}:{f['line']}  ({f.get('wcag_criterion', '')})"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("target", help="Directory to scan (e.g. mobile/)")
    parser.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="Output format (default: table)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Shorthand for --format=json",
    )
    args = parser.parse_args()

    scanner = (
        Path(__file__).resolve().parent.parent
        / ".claude/skills/a11y-audit/scripts/a11y_scanner.py"
    )
    if not scanner.exists():
        sys.stderr.write(f"Scanner not found at {scanner}\n")
        return 2

    report = filter_findings(run_scanner(args.target, scanner))

    if args.json or args.format == "json":
        print(json.dumps(report, indent=2))
    else:
        print(format_table(report))

    return 0 if not report["findings"] else 1


if __name__ == "__main__":
    sys.exit(main())

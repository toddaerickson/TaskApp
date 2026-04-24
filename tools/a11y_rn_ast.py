#!/usr/bin/env python3
"""React Native-specific a11y linter.

The bundled `a11y-audit` scanner is HTML-shaped and doesn't fire on
.tsx files (see tools/a11y_rn_filter.py). This one walks the mobile
app for two RN-specific smells the scanner can't catch:

  1. Interactive element without an accessible name. A `<Pressable>`,
     `<TouchableOpacity>`, `<TouchableHighlight>`, `<TouchableWithout-
     Feedback>`, `<Pressable />` or `<TextInput>` that has neither
     an `accessibilityLabel` prop nor a `<Text>` descendant has no
     accessible name — screen readers announce it as "button" with
     no further context.
  2. `<TextInput>` without `accessibilityLabel` AND without a
     preceding `<Text>` label. TextInputs never have text descendants
     (they're self-closing-ish) so the rule is narrower: no label on
     the component = no accessible name.

Not covered (deliberate scope cut for v1):
  - 44x44 tap-target sizing from StyleSheet.create entries — requires
    parsing the style object. Follow-up.
  - `accessibilityRole` correctness — requires a roles registry.
  - Dynamic labels pulled from variables — we only check the literal
    presence of the prop, not its runtime value.

Usage:
    python3 tools/a11y_rn_ast.py mobile/
    python3 tools/a11y_rn_ast.py mobile/ --json
    python3 tools/a11y_rn_ast.py mobile/ --ci

Exit codes:
    0 — clean
    1 — findings
    2 — scanner error
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator


# Tags that present as interactive but can get a label from a <Text> child.
INTERACTIVE_WITH_TEXT_CHILDREN = {
    "Pressable", "TouchableOpacity", "TouchableHighlight",
    "TouchableWithoutFeedback",
}
# Tags that must carry their own accessibilityLabel (no child text path).
INTERACTIVE_SELF_LABELED = {"TextInput"}

# File extensions we scan.
EXTENSIONS = {".tsx", ".jsx"}

# A JSX opening tag: `<TagName` followed by optional attributes. We stop at
# the first matching `>` (accounting for JSX expressions `{...}`, strings
# `"..."` / `'...'`, and JSX fragments we don't care about).
TAG_OPEN_RE = re.compile(r"(?<![A-Za-z0-9_])<([A-Z][A-Za-z0-9_]*)")


@dataclass
class Finding:
    rule_id: str
    severity: str
    message: str
    file: str
    line: int
    tag: str
    wcag_criterion: str
    fix: str


def _iter_tsx(root: Path) -> Iterator[Path]:
    skip_dirs = {"node_modules", ".expo", "dist", "build", "__pycache__", "coverage"}
    for p in root.rglob("*"):
        if p.suffix not in EXTENSIONS:
            continue
        if any(part in skip_dirs for part in p.parts):
            continue
        yield p


def _find_matching_close(src: str, start: int, tag: str) -> int:
    """Return the index just after the matching `</tag>`, starting at `start`
    (which is the index *after* the opening tag's `>`). Tracks nested tags
    of the same name so `<Pressable><Pressable>...</Pressable></Pressable>`
    resolves correctly. Returns -1 if no match found.
    """
    depth = 1
    open_re = re.compile(rf"<{re.escape(tag)}[\s/>]")
    close_re = re.compile(rf"</{re.escape(tag)}>")
    i = start
    while i < len(src):
        m_open = open_re.search(src, i)
        m_close = close_re.search(src, i)
        if not m_close:
            return -1
        if m_open and m_open.start() < m_close.start():
            depth += 1
            i = m_open.end()
            continue
        depth -= 1
        i = m_close.end()
        if depth == 0:
            return i
    return -1


def _end_of_opening_tag(src: str, start: int) -> int:
    """Given `start` pointing to the '<' of a JSX opening tag, return the
    index just after the matching '>' that closes the opening tag.
    Tracks quoted strings and JSX expression braces so we don't stop on
    a '>' inside e.g. `onPress={() => x > 0}`."""
    i = start + 1
    in_str: str | None = None
    brace_depth = 0
    while i < len(src):
        ch = src[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in ('"', "'", "`"):
            in_str = ch
            i += 1
            continue
        if ch == "{":
            brace_depth += 1
        elif ch == "}":
            brace_depth -= 1
        elif ch == "/" and i + 1 < len(src) and src[i + 1] == ">" and brace_depth == 0:
            return i + 2  # self-closing
        elif ch == ">" and brace_depth == 0:
            return i + 1
        i += 1
    return -1


def _line_of(src: str, idx: int) -> int:
    return src.count("\n", 0, idx) + 1


def _strip_jsx_comments(src: str) -> str:
    # /* … */ block comments
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.DOTALL)
    # // line comments
    src = re.sub(r"(^|\s)//[^\n]*", "\\1", src)
    return src


def _scan_file(path: Path) -> list[Finding]:
    findings: list[Finding] = []
    try:
        src = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return findings

    # Keep comments literal-enough for line counting but strip so we don't
    # match a commented-out <Pressable>.
    clean = _strip_jsx_comments(src)

    for m in TAG_OPEN_RE.finditer(clean):
        tag = m.group(1)
        if tag not in INTERACTIVE_WITH_TEXT_CHILDREN and tag not in INTERACTIVE_SELF_LABELED:
            continue

        open_start = m.start()
        open_end = _end_of_opening_tag(clean, open_start)
        if open_end < 0:
            continue
        opening_src = clean[open_start:open_end]

        # accessibilityLabel / accessibilityLabelledBy / aria-label — any
        # of these gives the element an accessible name for this rule.
        has_label = bool(
            re.search(
                r"\b(accessibilityLabel|accessibilityLabelledBy|aria-label)\b",
                opening_src,
            )
        )
        # accessible={false} → explicitly opted out; don't flag.
        is_aria_hidden = bool(
            re.search(r"accessible\s*=\s*\{\s*false\s*\}", opening_src)
        )
        if is_aria_hidden:
            continue

        if has_label:
            continue

        is_self_closing = opening_src.rstrip().endswith("/>")
        if tag in INTERACTIVE_SELF_LABELED:
            findings.append(Finding(
                rule_id="rn-textinput-no-label",
                severity="serious",
                message=f"<{tag}> missing accessibilityLabel",
                file=str(path),
                line=_line_of(src, open_start),
                tag=tag,
                wcag_criterion="4.1.2 Name, Role, Value",
                fix="Add accessibilityLabel, or pair with a preceding <Text> label whose id is referenced via accessibilityLabelledBy.",
            ))
            continue

        # For Pressable / Touchable*: self-closing → clearly no text child.
        if is_self_closing:
            findings.append(Finding(
                rule_id="rn-pressable-no-accessible-name",
                severity="serious",
                message=f"Self-closing <{tag}> has no accessibilityLabel and no children",
                file=str(path),
                line=_line_of(src, open_start),
                tag=tag,
                wcag_criterion="4.1.2 Name, Role, Value",
                fix="Add accessibilityLabel describing the action.",
            ))
            continue

        # Otherwise walk the body; if it contains a <Text, treat that as
        # the accessible name.
        close_end = _find_matching_close(clean, open_end, tag)
        if close_end < 0:
            # Mismatched tags — don't invent a finding, the file won't
            # even parse.
            continue
        body = clean[open_end:close_end]
        has_text_child = bool(re.search(r"<Text[\s/>]", body))
        if has_text_child:
            continue

        findings.append(Finding(
            rule_id="rn-pressable-no-accessible-name",
            severity="serious",
            message=f"<{tag}> has no accessibilityLabel and no <Text> descendant",
            file=str(path),
            line=_line_of(src, open_start),
            tag=tag,
            wcag_criterion="4.1.2 Name, Role, Value",
            fix="Add accessibilityLabel describing the action, or wrap a <Text> child whose content names it.",
        ))

    return findings


def _counts_by_key(findings: list[Finding], root: Path) -> dict[tuple[str, str], int]:
    """Bucket findings by (rule_id, relative_file_path).

    Why not include the line number? Line numbers drift on any edit, so a
    baseline that keys on lines goes stale after every refactor. (rule_id,
    file) + count is robust: the sweep PR can delete a baseline entry as
    the rule_id's count in that file drops to zero, and CI still catches
    *new* instances of the rule appearing in that file.
    """
    out: dict[tuple[str, str], int] = {}
    for f in findings:
        try:
            rel = str(Path(f.file).resolve().relative_to(root))
        except ValueError:
            rel = f.file
        key = (f.rule_id, rel)
        out[key] = out.get(key, 0) + 1
    return out


def _load_baseline(path: Path) -> dict[tuple[str, str], int]:
    data = json.loads(path.read_text())
    return {(row["rule_id"], row["file"]): row["count"] for row in data.get("entries", [])}


def _emit_baseline(findings: list[Finding], root: Path) -> dict:
    counts = _counts_by_key(findings, root)
    entries = [
        {"rule_id": rid, "file": fp, "count": n}
        for (rid, fp), n in sorted(counts.items())
    ]
    return {
        "description": (
            "Known a11y_rn_ast.py findings on master. Generated by "
            "`python3 tools/a11y_rn_ast.py mobile/ --write-baseline "
            "tools/a11y_rn_baseline.json`. CI fails only when a new "
            "finding appears (rule_id+file not in this file, or count "
            "higher than recorded). Shrink this file as fixes land."
        ),
        "total": sum(e["count"] for e in entries),
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("target", help="Directory to scan (e.g. mobile/)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--ci",
        action="store_true",
        help="Exit non-zero on any findings NOT covered by --baseline. "
             "With no baseline, any finding fails.",
    )
    parser.add_argument(
        "--baseline",
        metavar="FILE",
        help="JSON file of known findings to ignore. A finding escapes "
             "the baseline when its (rule_id, file) key isn't present or "
             "its count exceeds the baseline count.",
    )
    parser.add_argument(
        "--write-baseline",
        metavar="FILE",
        help="Scan, then write the current findings out as a baseline "
             "file. Use to refresh tools/a11y_rn_baseline.json after "
             "fixing a batch of issues.",
    )
    args = parser.parse_args()

    root = Path(args.target).resolve()
    if not root.is_dir():
        sys.stderr.write(f"Not a directory: {root}\n")
        return 2

    all_findings: list[Finding] = []
    files_scanned = 0
    for path in _iter_tsx(root):
        files_scanned += 1
        all_findings.extend(_scan_file(path))

    if args.write_baseline:
        out = _emit_baseline(all_findings, root)
        Path(args.write_baseline).write_text(json.dumps(out, indent=2) + "\n")
        print(f"Wrote baseline: {args.write_baseline}  ({out['total']} findings)")
        return 0

    # Split findings into "expected" (in baseline) and "new" (escapes it).
    baseline = _load_baseline(Path(args.baseline)) if args.baseline else {}
    current = _counts_by_key(all_findings, root)
    # A finding is "new" if the current count exceeds the baseline count
    # for its (rule_id, file) key. Surface the ones past the threshold.
    regressions: list[Finding] = []
    seen_by_key: dict[tuple[str, str], int] = {}
    for f in all_findings:
        try:
            rel = str(Path(f.file).resolve().relative_to(root))
        except ValueError:
            rel = f.file
        key = (f.rule_id, rel)
        seen_by_key[key] = seen_by_key.get(key, 0) + 1
        allowed = baseline.get(key, 0)
        if seen_by_key[key] > allowed:
            regressions.append(f)
    # Also flag entries whose baseline count dropped — the baseline is
    # stale (fixed issues should shrink the file).
    stale_keys = [k for k, n in baseline.items() if current.get(k, 0) < n]

    report = {
        "summary": {
            "files_scanned": files_scanned,
            "total_issues": len(all_findings),
            "regressions": len(regressions),
            "baselined": len(all_findings) - len(regressions),
            "stale_baseline_entries": len(stale_keys),
            "by_rule": {},
        },
        "findings": [asdict(f) for f in all_findings],
        "regressions_only": [asdict(f) for f in regressions],
    }
    by_rule: dict[str, int] = {}
    for f in all_findings:
        by_rule[f.rule_id] = by_rule.get(f.rule_id, 0) + 1
    report["summary"]["by_rule"] = by_rule

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        s = report["summary"]
        baseline_note = f" (baseline allows {s['baselined']})" if args.baseline else ""
        print(f"React Native a11y AST scan: {s['files_scanned']} files, "
              f"{s['total_issues']} findings{baseline_note}")
        if by_rule:
            for rule, count in sorted(by_rule.items(), key=lambda kv: -kv[1]):
                print(f"  {rule}: {count}")
        print()
        shown = regressions if args.baseline else all_findings
        if shown:
            label = "NEW (baseline escaped)" if args.baseline else ""
            if label:
                print(f"*** {label} ***")
            for f in shown:
                rel = str(Path(f.file).resolve().relative_to(root.parent)) if root.parent in Path(f.file).resolve().parents else f.file
                print(f"[{f.severity}] {f.rule_id} — {f.message}")
                print(f"    {rel}:{f.line}  (WCAG {f.wcag_criterion})")
        else:
            print("No findings. ✓" if not args.baseline else "No new findings past baseline. ✓")
        if stale_keys:
            print()
            print(f"Note: {len(stale_keys)} baseline entries are now stale (findings dropped).")
            print("Refresh with: python3 tools/a11y_rn_ast.py mobile/ --write-baseline tools/a11y_rn_baseline.json")

    if args.ci:
        return 1 if regressions else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())

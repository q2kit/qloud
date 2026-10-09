#!/usr/bin/env python3
"""Fail if a dependency uses a license forbidden by qloud_docs/conventions.md.

Usage:
    pip-licenses --from=mixed --format=json | scripts/check_licenses.py pip
    pnpm licenses list --json             | scripts/check_licenses.py pnpm
"""

import json
import re
import sys

# GPL/AGPL family (but not LGPL) is forbidden in shipped code.
FORBIDDEN = re.compile(r"(?<![L\w])A?GPL|GNU (Affero )?General Public", re.IGNORECASE)
LGPL = re.compile(r"LGPL|Lesser General Public", re.IGNORECASE)
# LGPL is allowed only for dynamically linked libraries listed (with a reason) here.
LGPL_ALLOWED = {
    "psycopg": "dynamically linked database driver (conventions.md)",
    "psycopg-binary": "binary build of psycopg",
}


def load(kind: str, raw: str) -> list[tuple[str, str]]:
    data = json.loads(raw)
    if kind == "pip":
        return [(item["Name"], item["License"]) for item in data]
    if kind == "pnpm":
        return [(pkg["name"], license_) for license_, pkgs in data.items() for pkg in pkgs]
    raise SystemExit(f"unknown kind: {kind}")


def main() -> int:
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    errors: list[str] = []
    warnings: list[str] = []
    for name, license_ in load(kind, sys.stdin.read()):
        if not license_ or license_.strip().upper() in {"UNKNOWN", "UNLICENSED"}:
            warnings.append(f"{name}: unknown license ({license_!r}) — check manually")
        elif LGPL.search(license_) and not FORBIDDEN.search(LGPL.sub("", license_)):
            if name.lower() not in LGPL_ALLOWED:
                errors.append(f"{name}: {license_} (LGPL needs an entry in LGPL_ALLOWED)")
        elif FORBIDDEN.search(license_):
            errors.append(f"{name}: {license_}")

    for message in warnings:
        print(f"::warning::{message}")
    for message in errors:
        print(f"::error::Forbidden license — {message}")
    print(f"License check ({kind}): {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fail unless every dependency uses a license allowed by qloud_docs/conventions.md.

Usage:
    pip-licenses --from=mixed --format=json | scripts/check_licenses.py pip
    pnpm licenses list --json             | scripts/check_licenses.py pnpm

Allowlist, not blocklist: an unknown or unrecognised license fails until someone
reviews it and adds it to ALLOWED or EXCEPTIONS.
"""

import json
import re
import sys

# Permissive licenses (SPDX ids) usable anywhere in an MIT project.
ALLOWED = {
    "0BSD", "Apache-2.0", "BlueOak-1.0.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0",
    "HPND", "ISC", "MIT", "MIT-0", "MPL-2.0", "PSF-2.0", "Python-2.0", "Unlicense", "Zlib",
}  # fmt: skip

# Non-SPDX names (mostly PyPI trove classifiers) mapped to SPDX ids.
ALIASES = {
    "apache 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "bsd": "BSD-3-Clause",
    "bsd license": "BSD-3-Clause",
    "bsd 3-clause": "BSD-3-Clause",
    "isc license (iscl)": "ISC",
    "mit license": "MIT",
    "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0",
    "python software foundation license": "PSF-2.0",
}

# Licenses allowed for one package only, with the exact license string and the reason.
# A package changing its license must be reviewed again.
EXCEPTIONS = {
    "psycopg": ("LGPL-3.0-only", "dynamically linked database driver"),
    "psycopg-binary": ("LGPL-3.0-only", "binary build of psycopg"),
    "caniuse-lite": ("CC-BY-4.0", "browser support data used at build time"),
    "@fontsource/be-vietnam-pro": ("OFL-1.1", "font, OFL allows bundling with any software"),
}


def load(kind: str, raw: str) -> list[tuple[str, str]]:
    data = json.loads(raw)
    if kind == "pip":
        return [(item["Name"], item["License"]) for item in data]
    if kind == "pnpm":
        return [(pkg["name"], license_) for license_, pkgs in data.items() for pkg in pkgs]
    raise SystemExit(f"unknown kind: {kind}")


def _normalise(term: str) -> str:
    term = term.strip()
    # Grouping parentheses from SPDX expressions, e.g. `(MIT OR CC0-1.0)`.
    if term.startswith("("):
        term = term[1:]
    if term.endswith(")") and term.count("(") < term.count(")"):
        term = term[:-1]
    term = term.strip()
    return ALIASES.get(term.lower(), term)


def is_allowed(license_: str) -> bool:
    """`A OR B` (and pip's `A; B` for several classifiers) needs one allowed term;
    `A AND B` needs all of them."""
    expression = license_.strip()
    if not expression:
        return False
    for alternative in re.split(r"\s+OR\s+|;", expression):
        terms = re.split(r"\s+AND\s+", alternative)
        if all(_normalise(term) in ALLOWED for term in terms):
            return True
    return False


def problems(packages: list[tuple[str, str]]) -> list[str]:
    errors = []
    for name, license_ in packages:
        exception = EXCEPTIONS.get(name.lower())
        if exception and license_ == exception[0]:
            continue
        if not is_allowed(license_ or ""):
            errors.append(f"{name}: {license_!r}")
    return errors


def main() -> int:
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    packages = load(kind, sys.stdin.read())
    errors = problems(packages)

    for message in errors:
        print(
            f"::error::License not on the allowlist — {message}. "
            "See qloud_docs/conventions.md › Giấy phép dependency."
        )
    print(f"License check ({kind}): {len(packages)} package(s), {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

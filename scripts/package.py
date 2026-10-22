#!/usr/bin/env python3
"""Build a VSIX for this repository with the Python standard library.

Preferred packager when npm can download packages:

    npx @vscode/vsce package

This script is the offline helper used by ``npm run package``. It writes the
same layout ``@vscode/vsce`` uses: files under ``extension/``, plus
``extension.vsixmanifest`` and ``[Content_Types].xml`` at the archive root.
Root ``README.md``, ``CHANGELOG.md``, and ``LICENSE`` are stored as
``extension/readme.md``, ``extension/changelog.md``, and ``extension/LICENSE.txt``.

Run from anywhere:

    python3 scripts/package.py
    python scripts/package.py

``.git``, ``node_modules``, VSIX outputs, and similar checkout junk are left
out. Runtime files in ``vendor/`` stay in, including ``playwright-core``,
because export loads it from the extension.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

SKIP_DIR_NAMES = {
    ".git",
    ".github",
    ".cursor",
    ".vscode-test",
    ".vscode-test-web",
    "node_modules",
    "__pycache__",
}

SKIP_FILE_NAMES = {
    ".DS_Store",
    ".cz-config.js",
    ".editorconfig",
    ".gitattributes",
    ".npmrc",
    ".vscodeignore",
    ".yarnrc",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "ISSUE_TEMPLATE.md",
    "PULL_REQUEST_TEMPLATE.md",
    "Thumbs.db",
    "appveyor.yml",
    "npm-debug.log",
    "npm-shrinkwrap.json",
    "package-lock.json",
    "tslint.yaml",
    "webpack.config.js",
    "yarn-error.log",
    "yarn.lock",
    ".travis.yml",
}

SKIP_SUFFIXES = (".vsix", ".vsixmanifest", ".pyc", ".todo")

SKIP_PREFIXES = (".eslintrc", ".babelrc", ".prettierrc", ".commitlintrc")

# Always declared, matching @vscode/vsce, even before the file scan.
BASE_CONTENT_TYPES = {
    ".json": "application/json",
    ".vsixmanifest": "text/xml",
}

CONTENT_TYPES = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".cjs": "application/javascript",
    ".json": "application/json",
    ".map": "application/json",
    ".vsixmanifest": "text/xml",
    ".xml": "text/xml",
    ".html": "text/html",
    ".css": "text/css",
    ".md": "text/markdown",
    ".txt": "text/plain",
    # mime.lookup values used by @vscode/vsce, including the odd .ts mapping.
    ".ps1": "application/octet-stream",
    ".license": "application/octet-stream",
    ".ts": "video/mp2t",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".wasm": "application/wasm",
    ".sh": "application/x-sh",
    ".yml": "text/yaml",
    ".yaml": "text/yaml",
    ".webmanifest": "application/manifest+json",
}


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def xml_text(value: str) -> str:
    return escape(value, {'"': "&quot;", "'": "&apos;"})


def file_extension(name: str) -> str:
    base = name.rsplit("/", 1)[-1]
    if base.startswith(".") and base.count(".") == 1:
        return ""
    dot = base.rfind(".")
    if dot <= 0:
        return ""
    return base[dot:].lower()


def skip_file(rel: str, name: str) -> bool:
    if name in SKIP_FILE_NAMES or name.startswith(SKIP_PREFIXES):
        return True
    lower = name.lower()
    return lower.endswith(SKIP_SUFFIXES)


def collect_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if name not in SKIP_DIR_NAMES)
        for name in sorted(filenames):
            path = Path(dirpath) / name
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            if skip_file(rel, name):
                continue
            files.append(path)
    return files


def archive_name(root: Path, path: Path) -> str:
    """Match @vscode/vsce names for the files the manifest points at."""
    rel = path.relative_to(root).as_posix()
    if rel == "README.md":
        return "readme.md"
    if rel == "CHANGELOG.md":
        return "changelog.md"
    if rel == "LICENSE":
        return "LICENSE.txt"
    return rel


def load_manifest(root: Path) -> dict:
    package_path = root / "package.json"
    with package_path.open(encoding="utf-8") as handle:
        package = json.load(handle)
    for key in ("name", "version", "publisher", "displayName", "description"):
        if not package.get(key):
            raise SystemExit(f"package.json is missing {key}")
    engines = package.get("engines") or {}
    if not engines.get("vscode"):
        raise SystemExit("package.json is missing engines.vscode")
    return package


def vsix_manifest(package: dict) -> str:
    keywords = [str(item) for item in (package.get("keywords") or [])]
    if package.get("contributes", {}).get("keybindings") and "keybindings" not in keywords:
        keywords.append("keybindings")
    categories = package.get("categories") or ["Other"]
    tags = ",".join(keywords)
    category_text = ",".join(str(item) for item in categories)
    repository = (package.get("repository") or {}).get("url") or ""
    bugs = (package.get("bugs") or {}).get("url") or ""
    homepage = package.get("homepage") or ""
    engine = package["engines"]["vscode"]

    properties = [
        ("Microsoft.VisualStudio.Code.Engine", engine),
        ("Microsoft.VisualStudio.Code.ExtensionDependencies", ""),
        ("Microsoft.VisualStudio.Code.ExtensionPack", ""),
        ("Microsoft.VisualStudio.Code.ExtensionKind", "workspace"),
        ("Microsoft.VisualStudio.Code.LocalizedLanguages", ""),
        ("Microsoft.VisualStudio.Code.EnabledApiProposals", ""),
        ("Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown", "true"),
        ("Microsoft.VisualStudio.Services.Content.Pricing", "Free"),
    ]
    if package.get("main") or package.get("browser"):
        properties.append(("Microsoft.VisualStudio.Code.ExecutesCode", "true"))
    if repository:
        properties.extend(
            [
                ("Microsoft.VisualStudio.Services.Links.Source", repository),
                ("Microsoft.VisualStudio.Services.Links.Getstarted", repository),
                ("Microsoft.VisualStudio.Services.Links.GitHub", repository),
            ]
        )
    if bugs:
        properties.append(("Microsoft.VisualStudio.Services.Links.Support", bugs))
    if homepage:
        properties.append(("Microsoft.VisualStudio.Services.Links.Learn", homepage))

    property_xml = "\n".join(
        '      <Property Id="%s" Value="%s"/>' % (xml_text(key), xml_text(value))
        for key, value in properties
    )
    name = xml_text(package["name"])
    version = xml_text(package["version"])
    publisher = xml_text(package["publisher"])
    display_name = xml_text(package["displayName"])
    description = xml_text(package["description"])
    assets = [
        (
            "Microsoft.VisualStudio.Code.Manifest",
            "extension/package.json",
        ),
        (
            "Microsoft.VisualStudio.Services.Content.Details",
            "extension/readme.md",
        ),
        (
            "Microsoft.VisualStudio.Services.Content.Changelog",
            "extension/changelog.md",
        ),
        (
            "Microsoft.VisualStudio.Services.Content.License",
            "extension/LICENSE.txt",
        ),
    ]
    asset_xml = "\n".join(
        '    <Asset Type="%s" Path="%s" Addressable="true"/>' % (xml_text(kind), xml_text(path))
        for kind, path in assets
    )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}"/>
    <DisplayName>{display_name}</DisplayName>
    <Description xml:space="preserve">{description}</Description>
    <Tags>{xml_text(tags)}</Tags>
    <Categories>{xml_text(category_text)}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
{property_xml}
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
{asset_xml}
  </Assets>
</PackageManifest>
"""


def content_types(extension_paths: list[str]) -> str:
    used = dict(BASE_CONTENT_TYPES)
    overrides: list[str] = []
    for rel in extension_paths:
        ext = file_extension(rel)
        if not ext:
            part = "/extension/" + rel
            overrides.append(
                f'<Override PartName="{xml_text(part)}" ContentType="application/octet-stream"/>'
            )
            continue
        used.setdefault(ext, CONTENT_TYPES.get(ext, "application/octet-stream"))
    defaults = "".join(
        f'<Default Extension="{xml_text(ext)}" ContentType="{xml_text(content_type)}"/>'
        for ext, content_type in sorted(used.items())
    )
    override_xml = "".join(sorted(overrides))
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        f"{defaults}{override_xml}"
        "</Types>"
    )


def zip_info(arcname: str, mode: int, mtime: float) -> zipfile.ZipInfo:
    stamp = time.localtime(mtime if mtime > 315532800 else 315532800)
    info = zipfile.ZipInfo(arcname, stamp[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    # Unix permission bits in the high 16 bits; directories are not stored.
    info.external_attr = (mode & 0xFFFF) << 16
    info.create_system = 3
    return info


def write_vsix(root: Path, output: Path, files: list[Path], package: dict) -> None:
    extension_paths = [archive_name(root, path) for path in files]
    if len(extension_paths) != len(set(extension_paths)):
        raise SystemExit("two files would be written to the same VSIX path")
    manifest = vsix_manifest(package).encode("utf-8")
    types = content_types(extension_paths).encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + ".partial")
    if partial.exists():
        partial.unlink()
    try:
        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr(zip_info("extension.vsixmanifest", 0o644, time.time()), manifest)
            archive.writestr(zip_info("[Content_Types].xml", 0o644, time.time()), types)
            for path, rel in zip(files, extension_paths):
                stat = path.stat()
                info = zip_info(f"extension/{rel}", stat.st_mode, stat.st_mtime)
                with path.open("rb") as handle:
                    archive.writestr(info, handle.read())
        os.replace(partial, output)
    except Exception:
        if partial.exists():
            partial.unlink()
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package this repository as a VSIX.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="VSIX path. Default: <name>-<version>.vsix in the repository root.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    root = repo_root()
    package = load_manifest(root)
    output = args.output
    if output is None:
        output = root / f"{package['name']}-{package['version']}.vsix"
    else:
        output = output.resolve()
    files = collect_files(root)
    output_resolved = output.resolve()
    files = [path for path in files if path.resolve() != output_resolved]
    if not any(path.name == "package.json" and path.parent == root for path in files):
        raise SystemExit("refusing to package without package.json")
    write_vsix(root, output, files, package)
    size = output.stat().st_size
    print(f"Wrote {output} ({len(files)} extension files, {size} bytes)")
    print("Preferred packager when npm can reach the registry: npx @vscode/vsce package")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

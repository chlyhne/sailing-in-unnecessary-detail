"""Render a separate, private copy of the blog with drafts treated as published."""

from pathlib import Path
import datetime
import html
import json
import re
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "_owner-site"


def main():
    # Work on a copy so previewing can never publish a draft in the source tree.
    with tempfile.TemporaryDirectory(prefix="sailing-owner-preview-") as directory:
        source = Path(directory) / "blog"
        shutil.copytree(ROOT, source, ignore=shutil.ignore_patterns(
            ".git", ".github", ".quarto", "_site", "_owner-site", "comments-api",
            "node_modules", "__pycache__", "test", "scripts",
        ))
        for path in source.rglob("*.qmd"):
            text = path.read_text(encoding="utf-8")
            parts = text.split("---", 2)
            if len(parts) == 3 and not parts[0].strip():
                parts[1] = re.sub(r"(?m)^draft: *true *$", "draft: false", parts[1])
                path.write_text("---".join(parts), encoding="utf-8")

        # The private copy uses the same layout and latest-post filter. Its sidebar
        # includes drafts as normal articles; the public sidebar stays unchanged.
        header = source / "_includes/header.html"
        entries = []
        for path in sorted((source / "posts").rglob("*.qmd")):
            result = subprocess.run(
                ["quarto", "inspect", str(path)],
                check=True, capture_output=True, text=True,
            )
            meta = json.loads(result.stdout)["formats"]["html"]["metadata"]
            title = meta["title"]
            date = meta["date"]
            day = datetime.date.fromisoformat(date)
            display_date = f"{day.day} {day:%B %Y}"
            link = "/" + path.relative_to(source).with_suffix(".html").as_posix()
            entries.append((date, f'<li><a href="{html.escape(link)}">{html.escape(title)}</a>'
                            f'<time datetime="{date}">{display_date}</time></li>'))
        header.write_text(re.sub(r"(?s)<ol>.*?</ol>",
                                "<ol>\n" + "\n".join(entry for _, entry in sorted(entries, reverse=True)) + "\n</ol>",
                                header.read_text(encoding="utf-8")), encoding="utf-8")
        config = source / "_quarto.yml"
        config.write_text(re.sub(r"(?m)^  google-analytics:.*\n", "", config.read_text(encoding="utf-8")), encoding="utf-8")
        subprocess.run(["quarto", "render"], cwd=source, check=True)
        if OUTPUT.exists():
            shutil.rmtree(OUTPUT)
        shutil.copytree(source / "_site", OUTPUT)
        # These are owner readings, not public readership or discoverable pages.
        for path in OUTPUT.rglob("*.html"):
            text = path.read_text(encoding="utf-8").replace("<head>", '<head><meta name="robots" content="noindex,nofollow">', 1)
            path.write_text(text, encoding="utf-8")
    print(f"Owner preview: {OUTPUT}")


if __name__ == "__main__":
    main()

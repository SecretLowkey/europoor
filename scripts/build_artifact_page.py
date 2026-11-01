#!/usr/bin/env python3
"""Build publish/page.html: index.html minus the document wrapper, which is
the shape the claude.ai artifact host expects (it adds its own <html>/<head>).
The page references assets/ and data/ relatively, so those are published as
files next to it."""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
head = re.search(r"<head>(.*)</head>", src, re.S).group(1)
body = re.search(r"<body[^>]*>(.*)</body>", src, re.S).group(1)
keep = [l for l in head.splitlines() if l.strip().startswith(("<title", '<link rel="stylesheet"', '<link rel="preconnect"', '<link rel="icon"'))]
os.makedirs(os.path.join(ROOT, "publish"), exist_ok=True)
out = os.path.join(ROOT, "publish", "page.html")
open(out, "w", encoding="utf-8").write("\n".join(keep) + "\n" + body)
print(out)

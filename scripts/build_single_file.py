#!/usr/bin/env python3
"""Build dist/europoor.html: the whole site in one self-contained file."""
import base64, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(path):
    return open(os.path.join(ROOT, path), encoding="utf-8").read()

def data_uri(path, mime):
    raw = open(os.path.join(ROOT, path), "rb").read()
    return "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode())

html, css, images = read("index.html"), read("assets/css/europoor.css"), []
for name in ("engraving-europa", "engraving-bridge", "engraving-piggy"):
    ref = "url(../img/%s.png)" % name
    if ref in css:
        images.append('--img-%s: url("%s");' % (name, data_uri("assets/img/%s.png" % name, "image/png")))
        css = css.replace(ref, "var(--img-%s)" % name)
css = ":root { %s }\n%s" % (" ".join(images), css)

html = html.replace('<link rel="stylesheet" href="assets/css/europoor.css">', "<style>\n%s\n</style>" % css)
html = html.replace('<link rel="icon" href="assets/img/europoor-logo.jpg">',
                    '<link rel="icon" href="%s">' % data_uri("assets/img/europoor-logo.jpg", "image/jpeg"))
html = html.replace('<meta property="og:image" content="assets/img/europoor-logo.jpg">\n', "")
html = re.sub(r'<script src="([^"]+)"></script>',
              lambda m: "<script>/* %s */\n%s\n</script>" % (m.group(1), read(m.group(1)).replace("</script", "<\\/script")), html)

os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
open(os.path.join(ROOT, "dist", "europoor.html"), "w", encoding="utf-8").write(html)
print("dist/europoor.html", len(html) // 1024, "KB")

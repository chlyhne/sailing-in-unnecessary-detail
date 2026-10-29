"""Colour the exported leg tracks by Euclidean distance to mark B (nautical miles).

Run after exporting sail-change-crossover-leg.svg. The inset retains its boat
identity colours; the shared distance scale applies to the two main tracks.
"""
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET

import matplotlib as mpl
import numpy as np

POST = Path(__file__).resolve().parents[1] / "posts/dont-always-lay-the-mark"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")


def main():
    path = POST / "sail-change-crossover-leg.svg"
    root = ET.parse(path).getroot()
    metadata = json.loads((POST / "provenance.json").read_text())
    # Coordinates from the exported A/B marker transforms, in SVG screen units.
    markers = [p for p in root.findall("{*}path")
               if p.get("fill") == "rgb(100%, 84.312439%, 0%)"]
    def position(marker):
        return np.array([float(v) for v in marker.get("transform")[7:-1].split(",")][-2:])
    start, mark = map(position, markers)
    units_per_nm = np.linalg.norm(mark - start) / metadata["example"]["distance_nm"]
    cmap = mpl.colormaps["viridis"]
    count = 0
    for p in root.findall(".//{*}path"):
        if p.get("stroke-width") != "1.50002":
            continue
        vertices = np.array(re.findall(r"[ML]\s+([-\d.]+)\s+([-\d.]+)", p.get("d")), float)
        vertices[:, 1] = 396 - vertices[:, 1]
        radius = np.linalg.norm((vertices[0] + vertices[-1]) / 2 - mark) / units_per_nm
        p.set("stroke", mpl.colors.to_hex(cmap(np.clip(radius, 0, 1))))
        count += 1
    assert count == 398, f"Unexpected exported track geometry: {count} segments"

    # The original colour bar and its labels are the final root elements.
    old_bar = next((i for i, e in enumerate(root) if e.get("mask") == "url(#mask-0)"), None)
    if old_bar is not None:
        for element in list(root)[old_bar:]:
            root.remove(element)
    for element in list(root):
        if element.get("id") == "distance-legend":
            root.remove(element)
    group = ET.SubElement(root, f"{{{SVG}}}g", id="distance-legend")
    def add(tag, **attrs):
        return ET.SubElement(group, f"{{{SVG}}}{tag}", {k.replace("_", "-"): str(v) for k, v in attrs.items()})
    for i in range(256):
        add("rect", x=195 + 300 * i / 256, y=347, width=300 / 256 + 0.02,
            height=15, fill=mpl.colors.to_hex(cmap(i / 255)), shape_rendering="crispEdges")
    add("rect", x=195, y=347, width=300, height=15, fill="none", stroke="black", stroke_width=0.6)
    for radius in np.linspace(0, 1, 6):
        x = 195 + 300 * radius
        add("line", x1=x, x2=x, y1=362, y2=366, stroke="black", stroke_width=0.6)
        add("text", x=x, y=375, text_anchor="middle", font_family="serif", font_size=8).text = f"{radius:.1f}"
    add("text", x=345, y=389, text_anchor="middle", font_family="serif", font_size=9).text = "Distance to mark B (nm)"
    ET.indent(root)
    path.write_text(ET.tostring(root, encoding="unicode") + "\n", encoding="utf-8")
    entry = metadata["figures"][path.name]
    entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    entry["postprocessing"] = "python scripts/recolor_leg_tracks.py; main tracks coloured by Euclidean distance to B; inset colours identify boats."
    (POST / "provenance.json").write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    main()

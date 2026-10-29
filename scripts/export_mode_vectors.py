"""Build the time-weighted velocity diagram using the post's exported polars."""

from pathlib import Path
import re
import xml.etree.ElementTree as ET

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
POST = ROOT / "posts/dont-always-lay-the-mark"


def polar_points(colour):
    root = ET.parse(POST / "sail-change-crossover-intro.svg").getroot()
    path = next(p for p in root.findall("{*}path")
                if p.get("stroke") == colour and len(p.get("d", "")) > 1000)
    points = np.array(re.findall(r"[ML]\s+([-\d.]+)\s+([-\d.]+)", path.get("d")), float)
    # Original PDF coordinates: origin and 25 plot units per knot.
    return (points - [39.708064, 292.694362]) / 25


def main():
    jib = polar_points("rgb(9.017944%, 38.038635%, 54.901123%)")
    gennaker = polar_points("rgb(70.587158%, 32.548523%, 3.527832%)")
    angles = np.degrees(np.arctan2(jib[:, 0], jib[:, 1]))
    a, b = [np.array([np.interp(t, angles, jib[:, i]) for i in (0, 1)])
            for t in (50, 100)]
    fraction = 0.5
    first = fraction * a
    average = first + (1 - fraction) * b
    bearing = np.degrees(np.arctan2(*average))
    direct = np.array([np.interp(bearing, angles, jib[:, i]) for i in (0, 1)])
    assert np.linalg.norm(average) < np.linalg.norm(direct)
    assert np.allclose(average, (a + b) / 2)

    plt.rcParams.update({"font.family": "serif", "font.size": 11})
    fig, ax = plt.subplots(figsize=(6.2, 7.2))
    theta = np.linspace(0, np.pi, 181)
    for speed in (2, 4, 6, 8, 10, 12):
        ax.plot(speed * np.sin(theta), speed * np.cos(theta), color="0.88", lw=0.7)
        ax.text(-0.2, speed, str(speed), ha="right", va="center", fontsize=9, color="0.4")
    for angle in range(0, 181, 30):
        t = np.radians(angle)
        ax.plot([0, 12 * np.sin(t)], [0, 12 * np.cos(t)], color="0.88", lw=0.7)
        ax.text(12.6 * np.sin(t), 12.6 * np.cos(t), f"{angle}°", ha="center", va="center", fontsize=10)
    ax.plot(*jib.T, color="#17618c", lw=1.7, label="Jib")
    ax.plot(*gennaker.T, color="#b45309", lw=1.7, label="Gennaker")
    for point in (a, b):
        ax.plot([0, point[0]], [0, point[1]], color="0.6", lw=0.9, ls=":")
    ax.plot(*np.array([a, b]).T, color="#b13d36", lw=1.8, label="Line between A and B")
    ax.plot([0, direct[0]], [0, direct[1]], color="#28734c", lw=1, ls="--")

    def arrow(start, end, colour):
        ax.annotate("", xy=end, xytext=start,
                    arrowprops={"arrowstyle": "->", "color": colour, "lw": 2, "shrinkA": 0, "shrinkB": 0})

    arrow(np.zeros(2), first, "#66449a")
    arrow(first, average, "#cf7817")
    ax.scatter(*np.array([a, b]).T, color="#17618c", s=22, zorder=5)
    ax.scatter(*average, color="#b13d36", s=30, zorder=6)
    for point, label, offset in [(a, "A (50°)", (-57, 9)), (b, "B (100°)", (9, -9)),
                                 (average, "P: average velocity", (-3, -33)),
                                 (direct, "Direct on jib", (12, 12))]:
        ax.annotate(label, point, xytext=offset, textcoords="offset points", fontsize=10,
                    arrowprops={"arrowstyle": "-", "color": "0.45", "lw": 0.6})
    ax.annotate("½ vA", first / 2, xytext=(-37, 0), textcoords="offset points", color="#66449a")
    ax.annotate("½ vB", (first + average) / 2, xytext=(0, 9), textcoords="offset points", color="#a85c08")
    ax.text(-0.2, -0.2, "O", ha="right", va="top")
    ax.set(xlim=(-1.2, 14), ylim=(-13.5, 13.8), aspect="equal")
    ax.axis("off")
    ax.set_title("Half the time at A, half at B", pad=16)
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, -0.04), frameon=False, fontsize=10)
    fig.text(0.5, 0.035, "Speed in knots · angles are true wind angles", ha="center", fontsize=10)
    fig.savefig(POST / "sail-change-mode-vectors.svg", transparent=True)
    plt.close(fig)
    print(f"Average: {np.linalg.norm(average):.2f} kn; direct jib: {np.linalg.norm(direct):.2f} kn; TWA: {bearing:.2f}°")


if __name__ == "__main__":
    main()

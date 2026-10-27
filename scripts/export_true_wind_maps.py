"""Convert the article's linear percent components to delta TWS/TWA.

The saved SVGs retain their scalar colour mesh and contour geometry. Since
each component is a constant times its physical wind change, dividing its
contour values and colour scale by that constant recovers the original
first-order wind changes without needing the large 3D cache. Requires Inkscape
only to export matching PNGs; ordinary Quarto builds use the saved images.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def rescale_svg(svg, factor, title, label, decimals):
    if factor <= 0:
        raise ValueError('A positive scale factor is required to preserve red/blue meaning')
    converted = 0

    def replace(match):
        nonlocal converted
        opening, text, closing = match.groups()
        if re.fullmatch(r'[+-]?\d+(?:\.\d+)?%?', text):
            value = float(text.rstrip('%')) / factor
            text = '0' if abs(value) < .5 * 10**-decimals else f'{value:+.{decimals}f}'
            converted += 1
        elif text.endswith('contribution · sail-height average'):
            text = title
        elif text.startswith('Estimated change in VMG [%]'):
            text = label
        return opening + text + closing

    result = re.sub(r'(<text\b[^>]*>)([^<]*)(</text>)', replace, svg)
    if converted < 5 or title not in result or label not in result:
        raise ValueError('Expected a percentage component SVG with numeric contour and scale labels')
    return result


def export_components(post):
    provenance_path = post / 'provenance.json'
    provenance = json.loads(provenance_path.read_text())
    coefficients = provenance['weighting_metadata']['linearisation']
    settings = {
        'speed': {
            'factor': coefficients['percent_per_true_wind_knot'],
            'units': 'knots', 'quantity': 'delta_TWS', 'decimals': 2,
            'title': 'Change in true wind speed · sail-height average',
            'label': 'ΔTWS [knots] · red = less wind · blue = more wind',
        },
        'direction': {
            # The cached header is -delta TWA; negate its coefficient too.
            # Negative delta TWA is a header (red); positive is a lift (blue).
            'factor': -coefficients['percent_per_true_header_degree'],
            'units': 'degrees', 'quantity': 'delta_TWA', 'decimals': 1,
            'title': 'Change in true wind angle · sail-height average',
            'label': 'ΔTWA [°] · red = header · blue = lift',
        },
    }
    for stem, spec in settings.items():
        original = provenance['figures'][f'{stem}.svg']
        if original['units'] == spec['units']:
            continue
        if original['units'] != 'percent':
            raise ValueError(f'Unexpected source units for {stem}: {original["units"]}')
        svg_path = post / f'{stem}.svg'
        source = svg_path.read_text()
        source_sha = hashlib.sha256(svg_path.read_bytes()).hexdigest()
        # Git normalises SVG line endings from the original Windows export.
        valid_hashes = {source_sha, hashlib.sha256(source.encode()).hexdigest(),
                        hashlib.sha256(source.replace('\n', '\r\n').encode()).hexdigest()}
        if original['sha256'] not in valid_hashes:
            raise ValueError(f'{stem}.svg does not match its recorded source hash')
        svg_path.write_text(rescale_svg(source, spec['factor'], spec['title'],
                                       spec['label'], spec['decimals']))
        subprocess.run(['inkscape', str(svg_path), '--export-type=png',
                        f'--export-filename={post / (stem + ".png")}',
                        '--export-dpi=240'], check=True)
        calibration = provenance['weighting_metadata']['calibration']
        for suffix in ('svg', 'png'):
            target = post / f'{stem}.{suffix}'
            provenance['figures'][target.name] = {
                'dataset': original['dataset'], 'units': spec['units'],
                'quantity': spec['quantity'],
                'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                'source_percent_svg_sha256': source_sha,
                'percent_per_unit': spec['factor'],
                'range': [calibration[key] / spec['factor'] for key in ('minimum', 'maximum')],
                'conversion': 'Invert the plotted linear percent component; preserve sail-height weighting, reference wind, colour mesh and contours.',
            }
        print(f'Exported {spec["quantity"]} in {spec["units"]}', flush=True)
    provenance['display_units'] = 'mixed'
    provenance['figure_units'] = {'combined': 'percent', 'speed': 'knots', 'direction': 'degrees'}
    provenance['export'] = ('Existing CFD scalar cache with sail-chord weighting. Combined map: '
                            'linearised ORC VMG percentage. Separate maps: first-order ΔTWS in '
                            'knots and ΔTWA in degrees, recovered by inverting the linear '
                            'component scales. No solver run.')
    provenance_path.write_text(json.dumps(provenance, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--post', type=Path, default=Path(__file__).resolve().parents[1] / 'posts/reading-the-wind')
    export_components(parser.parse_args().post.resolve())

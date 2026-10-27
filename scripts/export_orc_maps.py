"""Re-export article maps using a linearised ORC X-332 polar, without CFD.

python scripts/export_orc_maps.py --cfd-root ../ob
"""
import argparse
import json
from pathlib import Path
import shutil
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cfd-root', type=Path, required=True)
    args = parser.parse_args()
    root = args.cfd_root.resolve()
    sys.path.insert(0, str(root))
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    matplotlib.rcParams['svg.fonttype'] = 'none'
    from cfd.orc_polar import linearisation, percent_fields, POLAR_PATH
    from cfd.marine_rans import read_profile
    from cfd.plot_wind import distance_from_boat
    from cfd.separation_3d import sha
    from cfd.weighted_wind_2d import average_layers, height_quadrature, render
    from cfd.wind_viewer_3d import iso_meshes, palette, render as render_viewer

    post = Path(__file__).resolve().parents[1]/'posts/reading-the-wind'
    case = root/'cfd/output/trimmed_3d_v2'
    source = case/'visualizations'
    output = case/'orc_percent'
    output.mkdir(exist_ok=True)
    info = json.loads((source/'wind_3d.json').read_text(encoding='utf-8'))
    manifest = json.loads((case/'marine_case.json').read_text(encoding='utf-8'))
    profile = read_profile(manifest)
    coefficients = linearisation()
    with np.load(source/'wind_3d.npz', allow_pickle=False) as saved:
        arrays = dict(saved)
    x, y, z = (arrays[key] for key in ('x', 'y', 'z'))
    heights = np.repeat(z, len(x)*len(y))
    fields = percent_fields(arrays['speed'], arrays['direction'], heights, profile, coefficients)
    quadrature_z, dz, chords, weights = height_quadrature(info['geometry'], z)
    averaged = {'x': x, 'y': y}
    for field, values in fields.items():
        averaged[field], averaged[field+'_coverage'] = average_layers(
            values.reshape(len(z), len(y), len(x)), z, quadrature_z, weights)
        arrays[field] = values.astype('f4')
    plane_fields = percent_fields(arrays['plane_speed'], arrays['plane_direction'],
                                  arrays['plane_points'][:, 2], profile, coefficients)
    for field, values in plane_fields.items():
        arrays['plane_'+field] = values.astype('f4')

    xx, yy = np.meshgrid(x, y)
    exterior = distance_from_boat(np.column_stack((xx.ravel(), yy.ravel())), info['geometry']['hull']).reshape(xx.shape)>=1.
    span = max(float(np.nanmax(np.abs(averaged[field][exterior]))) for field in fields)
    limit = max(5., float(np.ceil(span/5)*5))
    ref = {'minimum': -limit, 'maximum': limit, 'white_band': .25,
           'contour_magnitudes': [1., 2., 5., 10., 20.]}
    weighted = json.loads((case/'weighted_wind.json').read_text(encoding='utf-8'))
    metadata = {**weighted, 'source': 'Onsdagsbanen/cfd/output/trimmed_3d_v2/visualizations',
                'display_units': 'percent', 'calibration': ref, 'palette': palette(ref),
                'contour_step': 2., 'linearisation': coefficients,
                'centering': 'Uses the inherited centred apparent-speed and direction perturbations. Convert their first-order Cartesian perturbation to true wind before applying polar derivatives. No subsequent recentering.',
                'formula': '100/V0 * (dV/dU * delta_true_wind_knots - dV/dalpha * true_header_deg), averaged with the existing sail-chord weights',
                'source_sha256': {name: sha(source/name) for name in ('wind_3d.json','wind_3d.npz')}}
    np.savez_compressed(output/'weighted_wind.npz', **averaged)
    (output/'weighted_wind.json').write_text(json.dumps(metadata, indent=2)+'\n', encoding='utf-8')
    stems = {'goodness': ('combined', 'Estimated change in VMG'),
             'speed': ('speed', 'Wind speed contribution'),
             'direction': ('direction', 'Wind direction contribution')}
    provenance = json.loads((post/'provenance.json').read_text(encoding='utf-8'))
    for field, (stem, title) in stems.items():
        for suffix in ('svg', 'png'):
            target = post/f'{stem}.{suffix}'
            render(metadata, averaged, target, field=field, percentage=True, english=True,
                   title=title+' · sail-height average')
            if suffix == 'svg':
                target.write_text('\n'.join(line.rstrip() for line in target.read_text(encoding='utf-8').splitlines())+'\n', encoding='utf-8')
            provenance['figures'][target.name] = {'dataset': 'trimmed_3d_v2', 'units': 'percent', 'sha256': sha(target)}
            print(f'Saved {target.name}', flush=True)
    shutil.copyfile(POLAR_PATH, post/'x332-orc-polar.json')
    (post/'orc-linearisation.json').write_text(json.dumps(coefficients, indent=2)+'\n', encoding='utf-8')
    provenance.update(display_units='percent', weighting_metadata=metadata,
                      export='Existing CFD scalar cache; first-order apparent-to-true wind conversion and linearised interpolated ORC X-332 polar; common percentage scale; existing sail-chord weighting. No solver run.',
                      polar_source={'data': 'x332-orc-polar.json', 'source_url': coefficients['polar']['source_url'],
                                    'sha256': sha(post/'x332-orc-polar.json'), 'linearisation': 'orc-linearisation.json'})
    provenance['pending_3d_captures'] = {'wind-3d.png': {'status': 'Awaiting author framing of percentage view',
                                                       'current_display_units': 'knots'}}
    (post/'provenance.json').write_text(json.dumps(provenance, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in coefficients.items() if k!='polar'}, indent=2), flush=True)
    print('Building matching percentage 3D view', flush=True)
    contours, levels = iso_meshes([x, y, z], fields, ref)
    arrays.update(contours)
    percent_info = {**info, 'display_units': 'percent', 'calibration': ref, 'palette': palette(ref),
                    'linearisation': coefficients, 'contour_levels_knots': None,
                    'contour_levels_percent': levels}
    render_viewer(percent_info, arrays, output)
    (output/'wind_3d.html').replace(output/'wind-orc-percent.html')
    (output/'wind-orc-percent.json').write_text(json.dumps(percent_info, indent=2)+'\n', encoding='utf-8')
    print(f'Percentage 3D view ready: {output / "wind-orc-percent.html"}', flush=True)


if __name__ == '__main__':
    main()

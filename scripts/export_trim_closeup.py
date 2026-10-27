"""Plot pressure in a saved 2D solution at the selected sail trim; never start a solver."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cfd-root', type=Path, required=True)
    parser.add_argument('--case', type=Path, required=True)
    args = parser.parse_args()
    root = args.cfd_root.resolve()
    case = args.case.resolve()
    sys.path.insert(0, str(root))

    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    matplotlib.rcParams['svg.fonttype'] = 'none'
    import matplotlib.pyplot as plt
    import matplotlib.patheffects as effects
    import matplotlib.tri as mtri
    from matplotlib.colors import LinearSegmentedColormap, Normalize
    from matplotlib.patches import Circle, Polygon
    import meshio
    from scipy.spatial import cKDTree
    from cfd.case import case_section
    from cfd.marine_rans import read_profile
    from cfd.section_loads import loads
    from cfd.storage import case_file
    from cfd.transfer_solution import read_restart
    from cfd.wind_viewer_3d import palette

    post = Path(__file__).resolve().parents[1] / 'posts/reading-the-wind'
    provenance_path = post / 'provenance.json'
    provenance = json.loads(provenance_path.read_text())
    manifest = json.loads(case_file(case, 'section_case.json').read_text())
    geometry = json.loads(case_file(case, 'geometry.json').read_text())
    report = json.loads(case_file(case, 'report.json').read_text())
    selected = provenance['weighting_metadata']['geometry']
    for key in ('hull', 'sail_definitions', 'sail_shapes'):
        if geometry[key] != selected[key]:
            raise ValueError('2D trim differs from the article simulation geometry')
    if not report['checks_passed']:
        raise ValueError('The saved 2D solution has not passed its checks')
    forces = loads(case)
    if not forces['force_integration_passed']:
        raise ValueError('Independent force integration does not match the solver')

    height = manifest['height_m']
    profile = read_profile(manifest)
    with np.load(case_file(case, 'slice.npz')) as saved:
        xy, triangles = saved['xy'], saved['triangles']
    names, native = read_restart(case_file(case, 'restart.dat'))
    reference = np.asarray(manifest['reference_velocity_m_s'])[:2]
    velocity = native[:, [names.index('Velocity_x'), names.index('Velocity_y')]] * np.linalg.norm(reference)
    if not np.allclose(native[:, [names.index('x'), names.index('y')]], xy):
        raise ValueError('Velocity and slice meshes do not match')
    config = case_file(case, 'yacht.cfg').read_text()
    if not re.search(r'^INC_NONDIM\s*=\s*INITIAL_VALUES\s*$', config, re.M):
        raise ValueError('Expected SU2 INITIAL_VALUES pressure normalisation')
    density = float(re.search(r'^INC_DENSITY_INIT\s*=\s*([\d.eE+-]+)', config, re.M).group(1))
    # SU2 pressure is gauge pressure, scaled by rho_ref * velocity_ref**2.
    pressure_scale = density * float(reference @ reference)
    pressure = native[:, names.index('Pressure')] * pressure_scale
    dynamic_pressure = .5 * pressure_scale
    surface = meshio.read(case_file(case, 'surface.vtk'))
    distance, indices = cKDTree(xy).query(surface.points[:, :2])
    cp_error = float(np.max(np.abs(pressure[indices] / dynamic_pressure -
                                   surface.point_data['Pressure_Coefficient'].ravel())))
    if distance.max() > 2e-5 or cp_error > 1e-5:
        raise ValueError('Pressure conversion does not match the solver surface coefficients')
    # Physical coordinates: x forward, y port. Plot coordinates: (-y, x).
    plot_points = np.column_stack((-xy[:, 1], xy[:, 0]))
    triangulation = mtri.Triangulation(*plot_points.T, triangles)
    triangulation.set_mask(~np.isfinite(pressure[triangles]).all(axis=1))
    limit = 100.
    calibration = {'minimum': -limit, 'maximum': limit, 'white_band': 1.}
    # For pressure, use the conventional blue suction / red high pressure.
    cmap = LinearSegmentedColormap.from_list('pressure_red_blue', palette(calibration), N=4097).reversed()
    norm = Normalize(calibration['minimum'], calibration['maximum'], clip=True)
    fig, ax = plt.subplots(figsize=(7.2, 9), layout='constrained')
    image = ax.tripcolor(triangulation, np.nan_to_num(pressure), shading='gouraud',
                         cmap=cmap, norm=norm, rasterized=True)
    # Sparse arrows interpolate the actual solved velocity on the fluid mesh.
    gx, gy = np.meshgrid(np.arange(-2.3, 2.1, .32), np.arange(-3.1, 3.0, .32))
    u = mtri.LinearTriInterpolator(triangulation, -velocity[:, 1])(gx, gy)
    v = mtri.LinearTriInterpolator(triangulation, velocity[:, 0])(gx, gy)
    ax.quiver(gx, gy, u, v, color='#263b4f', alpha=.55, angles='xy',
              scale_units='xy', scale=40, width=.0024, zorder=3)
    outline = [effects.withStroke(linewidth=4, foreground='white')]
    for index in range(2):
        section = case_section(geometry, index, height)
        ax.add_patch(Polygon(np.column_stack((-section[:, 1], section[:, 0])),
                             color='#142b3b', linewidth=1.6, zorder=5,
                             path_effects=outline))
    ax.add_patch(Circle((0, .15), .075, color='#142b3b', zorder=5,
                        path_effects=outline))
    for label, point, position in [('Main', (-.55, -1.4), (-1.8, -1.9)),
                                   ('Jib', (-.55, 1.3), (-1.8, 1.8)),
                                   ('Mast', (0, .15), (.8, .35))]:
        ax.annotate(label, xy=point, xytext=position, fontsize=13, color='#142b3b',
                    arrowprops={'arrowstyle': '-', 'color': '#142b3b', 'lw': .9},
                    bbox={'facecolor': 'white', 'edgecolor': 'none', 'alpha': .9, 'pad': 2},
                    zorder=6)
    angle = np.radians(profile.true_angle_deg)
    ax.annotate('', xy=(1.5-.8*np.sin(angle), 2.15-.8*np.cos(angle)), xytext=(1.5, 2.15),
                arrowprops={'arrowstyle': '-|>', 'color': '#142b3b', 'lw': 2}, zorder=6)
    ax.text(1.1, 2.35, 'True wind', ha='center', fontsize=12, color='#142b3b',
            path_effects=[effects.withStroke(linewidth=3, foreground='white')])
    ax.set(xlim=(-2.3, 2.0), ylim=(-3.1, 2.9), aspect='equal')
    ax.set_axis_off()
    main_trim, jib_trim = [sail[3] for sail in geometry['sail_definitions']]
    ax.set_title(f'Pressure around the sails · selected 2D trim\nMain {main_trim:.2f}° · jib {jib_trim:.2f}° · height {height:.2f} m',
                 fontsize=16, pad=15)
    bar = fig.colorbar(image, ax=ax, orientation='horizontal', fraction=.035,
                       pad=.025, shrink=.95, ticks=np.linspace(-limit, limit, 5))
    bar.ax.tick_params(labelsize=11, length=0, pad=6)
    bar.set_label('Δp [Pa] · blue = low pressure · red = high pressure', fontsize=11, labelpad=8)
    bar.outline.set_visible(False)
    for suffix in ('svg', 'png'):
        target = post / f'trim-2d-closeup.{suffix}'
        fig.savefig(target, dpi=240)
        if suffix == 'svg':
            target.write_text('\n'.join(line.rstrip() for line in target.read_text().splitlines()) + '\n')
        provenance['figures'][target.name] = {
            'dataset': 'selected_trim_2d', 'model': manifest['model'],
            'units': 'Pa', 'quantity': 'gauge_pressure', 'height_m': height,
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'source_case': str(case.relative_to(root)),
        }
    plt.close(fig)
    provenance['trim_2d_closeup'] = {
        'solver_run': True, 'source_case': str(case.relative_to(root)),
        'selection': 'Reproduced the saved trimmed_reference_v2 candidate; no new optimisation.',
        'height_m': height, 'main_foot_angle_deg': main_trim, 'jib_foot_angle_deg': jib_trim,
        'checks_passed': report['checks_passed'], 'report': report, 'forces': forces,
        'colour_scale': calibration,
        'colour_quantity': 'Static pressure relative to the undisturbed far-field pressure, in Pa; blue is lower, red is higher.',
        'reference': 'SU2 incompressible gauge pressure has zero undisturbed far-field pressure; no spatial median subtracted.',
        'pressure_conversion': {'formula': 'delta_p_Pa = restart_Pressure * rho_ref * velocity_ref**2',
                                'density_kg_m3': density, 'pressure_scale_Pa': pressure_scale,
                                'maximum_surface_Cp_error': cp_error,
                                'source': 'https://su2code.github.io/docs_v7/Physical-Definition/#initial-state-and-non-dimensionalization'},
        'arrows': 'Interpolated solved horizontal air velocity; not boat motion.',
        'source_sha256': {name: hashlib.sha256(case_file(case, name).read_bytes()).hexdigest()
                          for name in ('geometry.json', 'section_case.json', 'slice.npz', 'restart.dat', 'yacht.cfg', 'surface.vtk')},
    }
    provenance_path.write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Exported 2D close-up: drive {forces["force_N_per_m"][0]:.2f} N/m; checks passed.')


if __name__ == '__main__':
    main()

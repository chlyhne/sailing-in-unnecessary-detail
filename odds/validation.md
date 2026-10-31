# Ranking-model evaluation: 2025 and 2026 only

The dashboard now fits finishing order, not the time-imputation uncertainty of
the redress model. The source CSV is shared, but no fitted redress state or
2023/2024 race result enters the odds calculation.

## Model and chronology

One completed race contributes one Plackett–Luce ranking likelihood, conditional
on its finishers. This avoids counting all pairwise outcomes from the same race
as independent observations. Recorded-time ties are unresolved orders: sum the
probabilities of all compatible strict rankings. The model does not estimate a
tie-generation process. DNF/DNS/DNC are not losses in this conditional model.

Boat strengths have independent zero-mean Normal priors. The posterior is
approximated jointly at its maximum with its full Hessian (Laplace approximation).
Head-to-head odds integrate logistic strength differences using 32-point
Gauss–Hermite quadrature; this includes posterior cross-boat covariance.
Approximate central 90% posterior intervals describe uncertainty in the underlying
win chance. Fleet probabilities integrate softmax strengths over the joint
posterior using fixed-seed Sobol samples.

Each season starts fresh; strengths are assumed constant within a season and
re-estimated as results accumulate. No recency decay, weather covariates,
boat-specific settings or matchup exceptions are fitted. At least three finishes
per boat are required before the UI displays a probability.

The prior standard deviation was selected on **2025 only**, from 0.5, 1, 2 and 4.
Each validation prediction used only earlier races that season. The selection
criterion was mean per-race pairwise log loss, with one equal-weight score per
course-race. Model training uses the ranking likelihood; pairwise losses are
only evaluation scores, not independent likelihood terms.

| Prior SD | 2025 tuning log loss |
|---:|---:|
| 0.5 | 0.480575 |
| 1 | 0.402726 |
| **2** | **0.381054** |
| 4 | 0.381381 |

2026 was held out from choosing that parameter. Prior SD 2 was then frozen.
The 2025 dashboard curve is retrospective with respect to this hyperparameter
selection; the 2026 curve updates using no later race outcomes.

## Later-season evaluation

For each 2026 race, predict before fitting its outcome. Score matchups only after
at least three earlier course races and three earlier finishes per boat. Both
models use exactly the same evaluated matchups. This gives 28 course-races
across the two courses. The baseline is each pair's earlier record with a
Beta(0.5, 0.5) prior, not a specially weakened or unregularized baseline.

| Model | Mean race Brier score | Mean race log loss |
|---|---:|---:|
| Smoothed head-to-head counts | 0.147937 | 0.459719 |
| Ranking model | 0.139298 | 0.421102 |

Lower is better. The observed reduction is about 5.8% in Brier score and 8.4% in
log loss. It is **not proof of precise calibration**. There are few independent
race evenings: a date-block bootstrap (20,000 resamples, seed 42) of the log-loss
advantage gives an approximate 95% interval of -0.0002 to +0.1005, which includes
zero. Model selection also barely separates prior SD 2 from 4. These results
support a provisional model, not a claim that any one displayed percentage is
known accurately.

[Course-race evaluation data](held-out-races.csv) · [Chosen configuration](model-config.json)

## The matchup that exposed the issue

Christian Grejs won 16 of 17 completed 2026 races in the combined large-course
results. Casper and Christian shared 13 finishes; Christian was ahead in all 13.
The old dashboard showed about 11.3% for Casper by applying independent log-time
noise to saved redress marginals. This was not calibrated for ranking outcomes.
Zero wins in 13 races alone does not logically disprove an 11% future chance;
the problem was presenting an unvalidated conversion as odds.

The ranking model uses that pair's record **and** their results against the rest
of the fleet. There is no Casper/Christian-specific parameter or probability cap.
It is a different prediction model; the redress model itself has not been changed.

## Reproduce

From the Onsdagsbanen directory:

```bash
OPENBLAS_NUM_THREADS=1 .venv/bin/python scripts/evaluate_ranking_odds.py
```

The tuning and held-out outputs are in
`analysis/results/odds_validation_2025_2026/`. Copy its `configuration.json` to
this website's `odds/model-config.json` only when intentionally updating the
model configuration. From the website directory:

```bash
OPENBLAS_NUM_THREADS=1 ../Onsdagsbanen/.venv/bin/python scripts/export_odds.py
../Onsdagsbanen/.venv/bin/python -m unittest discover -s test -p 'test_ranking_odds.py'
node --test test/*.test.cjs
quarto render odds.qmd
```

Background: [Turner et al., introduction to the Plackett–Luce ranking model](https://hturner.github.io/PlackettLuce/articles/Overview.html).
Our implementation uses a Normal prior and partial-order marginalization;
it is not the R package's generalized tie model.

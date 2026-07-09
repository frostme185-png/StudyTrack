# Achievement icons (Level + Badges)

Drop SVG or PNG icons here. The dashboard (`src/renderer/index.html`) probes
for these files at runtime and falls back to a built-in emoji for anything
missing — nothing breaks if only some icons exist.

**Level icons** — named `level-<n>.svg` (or `.png`), matching `LEVELS` in
index.html. 6 tiers by cumulative all-time hours; tiers 1-5 each split into
4 sub-ranks (I-IV, shown as increasing accent chevrons), tier 6 is a single
capstone rank with no sub-rank (like Valorant's Radiant above Immortal I-III):

| lvl | Title | Hours | Tier material |
|---|---|---|---|
| 1 | Sprout I | 0 | Brushed iron |
| 2 | Sprout II | 3 | Brushed iron |
| 3 | Sprout III | 6 | Brushed iron |
| 4 | Sprout IV | 10 | Brushed iron |
| 5 | Student I | 15 | Bronze |
| 6 | Student II | 22 | Bronze |
| 7 | Student III | 30 | Bronze |
| 8 | Student IV | 40 | Bronze |
| 9 | Diligent I | 50 | Silver |
| 10 | Diligent II | 65 | Silver |
| 11 | Diligent III | 80 | Silver |
| 12 | Diligent IV | 100 | Silver |
| 13 | Elite I | 125 | Gold |
| 14 | Elite II | 150 | Gold |
| 15 | Elite III | 180 | Gold |
| 16 | Elite IV | 220 | Gold |
| 17 | Legend I | 260 | Prismatic |
| 18 | Legend II | 310 | Prismatic |
| 19 | Legend III | 370 | Prismatic |
| 20 | Legend IV | 450 | Prismatic |
| 21 | Eternal | 550 | Holographic — capstone, no sub-rank |

Example: `level-1.svg`, `level-21.png`.

**Badge icons** — named to match each badge's `id` in `BADGES` (10 total —
7 milestone + 3 activity-pattern badges):

- `hours-10.svg`, `hours-50.svg`, `hours-100.svg`, `hours-500.svg`
- `streak-7.svg`, `streak-30.svg`, `streak-100.svg`
- `first-session.svg` — earned on the very first tracked session
- `multi-site-day.svg` — earned once you've studied 3+ different sites/apps in a single day
- `perfect-week.svg` — earned once you've hit the daily goal every day of a Mon-Sun week

SVGs are preferred (crisp at any size, themeable), PNG also works. Square
source art (any resolution) is safest — icons are displayed at ~30px and
scaled with `object-fit:contain`.

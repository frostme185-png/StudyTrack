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
| 1 | Mầm I | 0 | Sắt xước (brushed iron) |
| 2 | Mầm II | 3 | Sắt xước |
| 3 | Mầm III | 6 | Sắt xước |
| 4 | Mầm IV | 10 | Sắt xước |
| 5 | Học Viên I | 15 | Đồng đánh bóng (bronze) |
| 6 | Học Viên II | 22 | Đồng đánh bóng |
| 7 | Học Viên III | 30 | Đồng đánh bóng |
| 8 | Học Viên IV | 40 | Đồng đánh bóng |
| 9 | Chuyên Cần I | 50 | Bạc bóng (silver) |
| 10 | Chuyên Cần II | 65 | Bạc bóng |
| 11 | Chuyên Cần III | 80 | Bạc bóng |
| 12 | Chuyên Cần IV | 100 | Bạc bóng |
| 13 | Tinh Anh I | 125 | Vàng (gold) |
| 14 | Tinh Anh II | 150 | Vàng |
| 15 | Tinh Anh III | 180 | Vàng |
| 16 | Tinh Anh IV | 220 | Vàng |
| 17 | Huyền Thoại I | 260 | Pha lê cầu vồng (prismatic) |
| 18 | Huyền Thoại II | 310 | Pha lê cầu vồng |
| 19 | Huyền Thoại III | 370 | Pha lê cầu vồng |
| 20 | Huyền Thoại IV | 450 | Pha lê cầu vồng |
| 21 | Vĩnh Hằng | 550 | Holographic — capstone, no sub-rank |

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

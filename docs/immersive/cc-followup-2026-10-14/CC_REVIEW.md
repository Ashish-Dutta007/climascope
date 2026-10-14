# Independent review of immersive v4.2.1

The current version is in good shape. Every number I recomputed from the source data is right, the charts plot those numbers correctly, and the deployed site matches the commit. I found one real bug (Na h-Eileanan Siar can't be selected) and a handful of small wording and legend problems. I changed nothing in the repo.
Is the ensemble loop worth keeping? There is no member loop in the code, only Scene loop and Month loop. I've taken the question as "should the Member spread stop stay in the scene loop?":
- Keep one ensemble chapter in the loop. It's the only stop that says how consistent the projections are, which the design review asked for. The national July result is a simple, strong message: all 12 members show lower water balance, by 4.4 to 49.7 mm.
- But the current stop is weak for unattended viewing. Its evidence sits in two charts about 820 px wide, while the big maps are the same ensemble-mean water-balance maps as the stops before it. It suits a presenter better than a loop.
- Best option: when it's built, replace that loop stop with the study's twelve-member map view, and keep the current Member spread scene for presenter use.
- Don't build a loop that steps through members one at a time. Twelve steps of near-identical maps would take over a minute, invite reading one member as a forecast, and the twelve-member view shows the same thing at once.
What checks out:
- Cells below zero: I recomputed them from the source Parquets. The counts match exactly for 10 regions (national, councils, islands, catchments including a tiny one), 4 months and 3 periods, for the mean and members 05, 08 and 13.
- Member changes: all 12 members, all three metrics and both future periods agree within 0.001, for the same regions and months. Angus July precipitation really is 6 higher, 6 lower.
- Land-cover shares: match exactly.
- Headlines: clear, for example "12 of 12 show lower water balance · 4.4 to 49.7 mm lower", and "Change: −28.9 to +13.5 mm" when members split.
- Charts, checked by converting the drawn SVG back into values:
  - median lines are within 0.03 of the true median, and the shaded bands match the lowest and highest members;
  - all 24 member dots are exact, and the selected member is highlighted;
  - the selected-month band is on the right month, with the dots centred in it;
  - the change bars are within 0.03 mm.
- Change maps: values are differenced from raw data before rounding, and the colour scale is symmetric about zero.
- Locator: now has Scotland's true proportions, and region outlines line up.
- Deployment: all 23 assets I compared are byte-identical on the live site. The three page templates are identical once cache-busting ?v= values are removed. Live API output matches local for three requests.
Problems:
1. Na h-Eileanan Siar can't be selected (bug). The council's outline includes St Kilda, which reaches 8.65° W. The sanity check rejects anything west of 8.0° W (immersive.js:189, control.js:112). What happens depends on where it's chosen:
   - phone or controller: silently resets to All Scotland (control.js:143);
   - preview: shows "bounds outside Scotland" and pauses.
   St Kilda has no climate cells, so widening the limit loses nothing. All 1,026 catchments pass.
2. Wrong advice on the phone. When the wall goes quiet, the phone says "No wall display open in this browser. Open /immersive in another window of the same browser" (control.js:75). That's wrong for a phone paired by code, and it contradicts the relay's "Wall offline — waiting for connection" (remote.js:177).
3. Overlapping ranges in Member spread. The two period bands are similar yellow and orange at 18% opacity (immersive.js:861). Where they overlap you can't tell which is which, and projection will make it worse. The headline uses only 2050–2079, so shade only that period.
4. Legend keys show lines for bar charts. The change chart in single-metric scenes (immersive.js:922) and the land-cover chart (970) draw bars but show line swatches. The dot plot already got proper dot symbols; bars need the same.
5. Small wording overlaps.
   - Under the baseline map it says "Regional mean · 2,310 cells" (immersive.js:1409), while the change map says "Angus mean change". Use the region name in both.
   - In the analytical scenes, "Δ −2.2 mm from baseline" under the 2050–2079 map (1412) repeats the change map's own number.
6. Locator marker sometimes just off the region (cosmetic). It's placed at the bounding-box centre (immersive.js:699). For Argyll and Bute, North Ayrshire, Orkney and the Western Isles that point is 2.8–8.6 km out to sea, which is only 1–3 pixels on the inset. A point guaranteed to be inside the shape would fix it.
- Its quoted figures are correct:
  - February +57.1 mm, September −45.0 mm;
  - Tmax peak in August (+5.3 °C);
  - July member precipitation −31.4 to +9.0 mm;
  - −12.2 − 15.9 = −28.1 mm for the water-balance components;
  - all twelve member values match.
- Twelve months is the strongest view. It fills the wall, and the pattern of wetter winters and drier late summer and autumn is obvious at a glance.
- Twelve members fills the wall but looks washed out. It uses the ±160 mm scale fixed across all months, while July water-balance changes are about −4 to −50 mm nationally. Every map is pale pink, so differences between members are faint. A scale fixed across members, and labelled, would show them better.
- The components view colours evaporation misleadingly. The PT evapotranspiration map uses the same red–white–blue as precipitation and water balance. So the +15.9 mm increase is drawn bluish, which reads as "wetter" next to its neighbours, even though it dries the balance. Either map its effect on the balance (−15.9) or give it its own palette. This view also uses only a narrow central slice of the wall.
# Is Zambia's August 2026 near-real-time month real?

Question: the harmonized series shows August 2026 in Zambia (378,993 detections, from NOAA-20 near real time) as the largest month on
record. Is that an artifact of near-real-time data, or a real fire season?

Method: `python pipeline/checks/nrt_check.py`, plus an Aqua MODIS pull for August 2026. Same simple filter for every VIIRS number
here (low confidence dropped, no mask), Zambia box, August of each year.

| Series | August 2026 | Compared with August 2025 |
|---|---|---|
| NOAA-20 near real time | 379,749 | x1.44 (August 2025 standard processing: 263,888) |
| Suomi NPP near real time | 347,792 | x1.32 |
| Aqua MODIS standard processing (Aqua, confidence 30 or more, type 0) | 70,106 | x1.14 (August 2025: 61,556) |

- **No spike days.** NOAA-20 near real time ran at 7,031 to 21,779 detections a day (median 11,411) over all 31 days; none was above
  three times the median. August 2025 standard processing: median 8,582 a day. A duplicated or double-counted day would show up.
- **No duplicate rows.** Step 02 removed 0 duplicates from the near-real-time rows.
- **Independent instruments agree on the direction.** Two VIIRS satellites and MODIS all show August 2026 above August 2025. In July 2026
  MODIS, Suomi NPP and NOAA-20 were all 2.5 to 2.9 times July 2025.
- **The size depends on the instrument:** x1.14 (MODIS), x1.32 (Suomi NPP), x1.44 (NOAA-20). NOAA-20 near real time is 9 percent above
  Suomi NPP near real time in the same month.

Conclusion: the large August 2026 value is a real, intense fire season, not a near-real-time artifact. Its exact size carries about
10 percent of sensor uncertainty, and because the series switches from Suomi NPP (through July) to NOAA-20 (from August), the latest
months may be about 9 percent high on the Suomi NPP scale. The pipeline already warns about the NOAA-20 to Suomi NPP ratio over the
latest six months (1.11 for Zambia). Nothing was rescaled.

Not tested: near real time against standard processing of the same satellite for the same days (they do not overlap in our data),
and MODIS near real time (it only starts on 1 September 2026).

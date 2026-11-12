/**
 * Every handset, tablet and watch Al-Esnad's counter is likely to ever see,
 * per brand — 2010 to today, independent of what is on the shelf.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 * Every device picker on this site used to be built from `products`: the repair
 * wizard, the trade-in estimator and the comparison tool each asked the
 * catalogue what a brand sells and offered that. For a shop that stocks ten
 * brands and carries devices from six of them, that is a picker where Huawei,
 * realme, Xiaomi and Redmi have **no models at all** — measured against the
 * live database, not assumed — and where Oppo, Tecno and Infinix have three
 * each. A customer bringing in a Redmi Note 8 with a cracked screen was offered
 * an empty list and a free-text box.
 *
 * What we *sell* and what we *service* are different sets, and conflating them
 * is what made the wizards feel like they did not know the brands advertised on
 * the home page.
 *
 * ---------------------------------------------------------------------------
 * Why a list here is safe, where `repair-pricing.ts` refuses one
 * ---------------------------------------------------------------------------
 * `lib/data/repair-pricing.ts` deliberately infers a price *tier* from naming
 * rules rather than from a model table, and says why: a table goes stale, and a
 * model it has never heard of would be silently mispriced. That reasoning does
 * not transfer, because the two lists fail in opposite directions.
 *
 * This one is **additive and never authoritative**. A model missing from it
 * costs nothing — the pickers that use it still accept a free-typed name, and
 * the tier rules still run on whatever was typed. Being out of date makes the
 * list shorter, not wrong. So the tier stays a rule and the *choices* become a
 * list, and neither has to pretend to be the other.
 *
 * ---------------------------------------------------------------------------
 * What is in, and what is deliberately out
 * ---------------------------------------------------------------------------
 * **In:** the releases that actually sold in Iraq. That is not the same as the
 * releases that were reviewed well or sold in Europe, and the difference is
 * large — Samsung's J series and Grand Prime, Huawei's Y series, Infinix Hot
 * and Tecno Spark are a big share of what crosses this counter and barely
 * register on a Western spec site.
 *
 * **Out:** carrier-exclusive and region-locked variants (a "Verizon" or
 * "Indian-market" model number), engineering names, and the long tail of
 * near-identical rebadges. They would triple the list to serve almost nobody,
 * and the free-text fallback already covers the person who owns one.
 *
 * ---------------------------------------------------------------------------
 * `year` and ordering
 * ---------------------------------------------------------------------------
 * The release year, and it exists only to sort the list newest-first. It is not
 * a spec, nothing prices off it, and where a model shipped across a new year
 * boundary either answer is fine. It is shown beside the name in the pickers,
 * because with sixteen years of releases in one dropdown "Galaxy A5" needs to
 * say which one it is.
 *
 * **Anything the admin adds to `products` is merged in on top of this** — see
 * `mergeBrandModels`. That is the half of the list that cannot go stale, and it
 * is why a new arrival needs no edit here to become pickable.
 *
 * ---------------------------------------------------------------------------
 * Bundle cost
 * ---------------------------------------------------------------------------
 * This is imported by three Client Components — both wizards and the product
 * editor — so it ships to the browser on `/repair`, `/trade-in` and the back
 * office, and on no other route. The year-keyed shape below is what keeps that
 * affordable: the year is written once per group rather than once per device,
 * and a model that is only a name is only a string.
 */

/*
 * ⚠️ A **relative** import, and the only one in this file.
 *
 * `lib/data/device-name.ts` holds the naming rules and imports nothing itself,
 * so both modules run under `node --test` with no bundler — which is what
 * `lib/data/device-name.test.ts` needs, and the reason
 * `lib/data/support-terms.ts` already takes a relative import. An `@/` alias
 * is resolved by the bundler and would make the tests unrunnable.
 *
 * ⚠️ With the `.ts` extension, which node's own resolver requires and which
 * the bundler is content with — `lib/data/queue-window.ts` imports
 * `./date-window.ts` the same way, and `allowImportingTsExtensions` is on.
 * Drop it and this module stops loading outside the bundler, silently, until
 * somebody writes the test that needs it.
 */
import {
  knownModelNames,
  modelIdentity,
  standardModelName,
  withStockMark,
  type WorldModel,
} from "./device-name.ts";


/** Categories a catalogue device can prefill. Absent means a phone. */
export type DeviceCategory = "tablets" | "watches" | "audio";

export type CatalogueDevice = {
  /** As it is written on the box, in Latin. Both locales show this. */
  name: string;
  /** Release year — ordering and disambiguation only. */
  year: number;
  /** `category_code` to prefill in the editor. Absent means `phones`. */
  category?: DeviceCategory;
  /** Extra search terms, folded in but never drawn. */
  aliases?: string;
};

type Entry = string | Omit<CatalogueDevice, "year" | "category">;

/**
 * Expand a year-keyed group into flat devices.
 *
 * Written this way because the alternative — seven hundred object literals each
 * repeating `year:` and `category:` — is both unreadable and materially larger
 * in the bundle these three pages download. Here the year is a heading and most
 * devices are just their name.
 */
function fromYears(
  byYear: Record<number, readonly Entry[]>,
  category?: DeviceCategory,
): CatalogueDevice[] {
  return Object.entries(byYear).flatMap(([year, entries]) =>
    entries.map((entry) =>
      typeof entry === "string"
        ? { name: entry, year: Number(year), category }
        : { ...entry, year: Number(year), category },
    ),
  );
}

/**
 * Search terms that apply to every model of a brand.
 *
 * **Only the brand's own name and its spellings belong here — never a product
 * line.** These are attached to every device of the brand, so a line name in
 * this map matches devices that are not in that line: "ايفون" here put every
 * iPad in the results for an iPhone search, and "بوكو" returned all sixty-four
 * Xiaomis for a POCO search, the actual POCOs ranked below phones that are not
 * POCOs. Line names are derived per device from the name itself — see
 * `arabicAliasesFor` — which is what makes them match only the right rows.
 *
 * The Arabic spellings are the ones customers type, not transliteration
 * schemes: `normalizeSearch` already folds alef and ya variants, so one
 * spelling of each covers its family.
 */
const BRAND_ALIASES: Record<string, string> = {
  apple: "ابل",
  samsung: "سامسونج سامسونغ",
  honor: "هونر هونور",
  huawei: "هواوي",
  oppo: "اوبو",
  realme: "ريلمي",
  /*
   * ⚠️ Both codes answer to both names, and that is not sloppiness.
   *
   * The two model lists are split (Redmi handsets under `redmi`, Mi and POCO
   * under `xiaomi`) because a picker keyed on brand code has to give each code
   * its own devices. Search is a different question: at this counter a Redmi
   * Note is asked for as a "شاومي" about as often as by its own name, and
   * somebody typing "ريدمي" is not trying to exclude the Mi 11. Narrowing
   * these to one name each would make the split visible to customers, which is
   * exactly what it must not be.
   */
  redmi: "ريدمي شاومي",
  xiaomi: "شاومي ريدمي بوكو",
  tecno: "تكنو",
  infinix: "انفينكس انفنكس",
  /*
   * The makes the ERP import added that customers do write in Arabic. The
   * others — Blackview, Oukitel, KXD, G-Tab — are asked for in Latin at this
   * counter and are reachable anyway: every stocked row carries its own
   * Arabic name in `keywords`, and every world row carries `name_ar`.
   */
  nokia: "نوكيا",
  vivo: "فيفو",
  motorola: "موتورولا",
  lenovo: "لينوفو",
  alcatel: "الكاتيل",
  sony: "سوني",
  google: "جوجل",
};

/* ── Apple ────────────────────────────────────────────────────────── */
const APPLE: readonly CatalogueDevice[] = [
  ...fromYears({
    2025: [
      "iPhone 17 Pro Max",
      "iPhone 17 Pro",
      "iPhone 17",
      "iPhone Air",
      "iPhone 16e",
    ],
    2024: ["iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus", "iPhone 16"],
    2023: ["iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15 Plus", "iPhone 15"],
    2022: [
      "iPhone 14 Pro Max",
      "iPhone 14 Pro",
      "iPhone 14 Plus",
      "iPhone 14",
      { name: "iPhone SE (2022)", aliases: "se 3" },
    ],
    2021: ["iPhone 13 Pro Max", "iPhone 13 Pro", "iPhone 13", "iPhone 13 mini"],
    2020: [
      "iPhone 12 Pro Max",
      "iPhone 12 Pro",
      "iPhone 12",
      "iPhone 12 mini",
      { name: "iPhone SE (2020)", aliases: "se 2" },
    ],
    2019: ["iPhone 11 Pro Max", "iPhone 11 Pro", "iPhone 11"],
    2018: ["iPhone XS Max", "iPhone XS", "iPhone XR"],
    2017: ["iPhone X", "iPhone 8 Plus", "iPhone 8"],
    2016: [
      "iPhone 7 Plus",
      "iPhone 7",
      { name: "iPhone SE (2016)", aliases: "se 1" },
    ],
    2015: ["iPhone 6s Plus", "iPhone 6s"],
    2014: ["iPhone 6 Plus", "iPhone 6"],
    2013: ["iPhone 5s", "iPhone 5c"],
    2012: ["iPhone 5"],
    2011: ["iPhone 4s"],
    2010: ["iPhone 4"],
  }),
  ...fromYears(
    {
      2024: [
        "iPad Pro 13 (M4)",
        "iPad Pro 11 (M4)",
        "iPad Air 13 (M2)",
        "iPad Air 11 (M2)",
        "iPad mini (7th gen)",
      ],
      2022: ["iPad Pro 12.9 (M2)", "iPad Air (5th gen)", "iPad (10th gen)"],
      2021: ["iPad Pro 12.9 (M1)", "iPad (9th gen)", "iPad mini (6th gen)"],
      2020: ["iPad Air (4th gen)", "iPad (8th gen)"],
      2019: ["iPad (7th gen)", "iPad Air (3rd gen)", "iPad mini (5th gen)"],
      2018: ["iPad Pro 11 (2018)", "iPad Pro 12.9 (2018)", "iPad (6th gen)"],
      2017: ["iPad Pro 10.5", "iPad (5th gen)"],
      2016: ["iPad Pro 9.7"],
      2015: ["iPad Pro 12.9", "iPad mini 4"],
      2014: ["iPad Air 2", "iPad mini 3"],
      2013: ["iPad Air", "iPad mini 2"],
      2012: ["iPad (4th gen)", "iPad (3rd gen)", "iPad mini"],
      2011: ["iPad 2"],
    },
    "tablets",
  ),
  ...fromYears(
    {
      2024: ["Apple Watch Series 10"],
      2023: ["Apple Watch Series 9", "Apple Watch Ultra 2"],
      2022: [
        "Apple Watch Series 8",
        "Apple Watch Ultra",
        "Apple Watch SE (2nd gen)",
      ],
      2021: ["Apple Watch Series 7"],
      2020: ["Apple Watch Series 6", "Apple Watch SE"],
      2019: ["Apple Watch Series 5"],
      2018: ["Apple Watch Series 4"],
      2017: ["Apple Watch Series 3"],
      2016: ["Apple Watch Series 2", "Apple Watch Series 1"],
    },
    "watches",
  ),
];

/* ── Samsung ──────────────────────────────────────────────────────────
   The S, Note and Z lines in full; the A, J and M lines because between
   them they are most of what actually walks through the door here. The
   J series and Grand Prime in particular sold in volume in Iraq and are
   still arriving for batteries and screens.                            */
const SAMSUNG: readonly CatalogueDevice[] = [
  ...fromYears({
    2025: [
      "Galaxy S25 Ultra",
      "Galaxy S25+",
      "Galaxy S25",
      "Galaxy S25 Edge",
      "Galaxy Z Fold 7",
      "Galaxy Z Flip 7",
      "Galaxy A56",
      "Galaxy A36",
      "Galaxy A26",
    ],
    2024: [
      "Galaxy S24 Ultra",
      "Galaxy S24+",
      "Galaxy S24",
      "Galaxy S24 FE",
      "Galaxy Z Fold 6",
      "Galaxy Z Flip 6",
      "Galaxy A55",
      "Galaxy A35",
      "Galaxy A25",
      "Galaxy A15",
      "Galaxy A16",
      "Galaxy A05s",
      "Galaxy M55",
      "Galaxy M35",
    ],
    2023: [
      "Galaxy S23 Ultra",
      "Galaxy S23+",
      "Galaxy S23",
      "Galaxy S23 FE",
      "Galaxy Z Fold 5",
      "Galaxy Z Flip 5",
      "Galaxy A54",
      "Galaxy A34",
      "Galaxy A24",
      "Galaxy A14",
      "Galaxy A05",
      "Galaxy M34",
      "Galaxy M14",
    ],
    2022: [
      "Galaxy S22 Ultra",
      "Galaxy S22+",
      "Galaxy S22",
      "Galaxy S21 FE",
      "Galaxy Z Fold 4",
      "Galaxy Z Flip 4",
      "Galaxy A73",
      "Galaxy A53",
      "Galaxy A33",
      "Galaxy A23",
      "Galaxy A13",
      "Galaxy A04",
      "Galaxy A03 Core",
      "Galaxy M53",
      "Galaxy M33",
      "Galaxy M13",
    ],
    2021: [
      "Galaxy S21 Ultra",
      "Galaxy S21+",
      "Galaxy S21",
      "Galaxy Z Fold 3",
      "Galaxy Z Flip 3",
      "Galaxy A72",
      "Galaxy A52",
      "Galaxy A32",
      "Galaxy A22",
      "Galaxy A12",
      "Galaxy A03s",
      "Galaxy A02s",
      "Galaxy M52",
      "Galaxy M32",
      "Galaxy M12",
    ],
    2020: [
      "Galaxy S20 Ultra",
      "Galaxy S20+",
      "Galaxy S20",
      "Galaxy S20 FE",
      "Galaxy Note 20 Ultra",
      "Galaxy Note 20",
      "Galaxy Z Fold 2",
      "Galaxy Z Flip",
      "Galaxy A71",
      "Galaxy A51",
      "Galaxy A31",
      "Galaxy A21s",
      "Galaxy A11",
      "Galaxy A01",
      "Galaxy M51",
      "Galaxy M31",
      "Galaxy M21",
      "Galaxy M11",
    ],
    2019: [
      "Galaxy S10+",
      "Galaxy S10",
      "Galaxy S10e",
      "Galaxy Note 10+",
      "Galaxy Note 10",
      "Galaxy A80",
      "Galaxy A70",
      "Galaxy A50",
      "Galaxy A30",
      "Galaxy A20",
      "Galaxy A10",
      "Galaxy M30",
      "Galaxy M20",
      "Galaxy M10",
    ],
    2018: [
      "Galaxy S9+",
      "Galaxy S9",
      "Galaxy Note 9",
      "Galaxy A8 (2018)",
      "Galaxy A6+",
      "Galaxy A6",
      "Galaxy J8",
      "Galaxy J6",
      "Galaxy J4",
      "Galaxy J2 Core",
    ],
    2017: [
      "Galaxy S8+",
      "Galaxy S8",
      "Galaxy Note 8",
      "Galaxy A7 (2017)",
      "Galaxy A5 (2017)",
      "Galaxy A3 (2017)",
      "Galaxy J7 Pro",
      "Galaxy J7 Prime",
      "Galaxy J5 Pro",
      "Galaxy J3 (2017)",
      "Galaxy J2 Prime",
    ],
    2016: [
      "Galaxy S7 Edge",
      "Galaxy S7",
      "Galaxy Note 7",
      "Galaxy A9 (2016)",
      "Galaxy A7 (2016)",
      "Galaxy A5 (2016)",
      "Galaxy J7 (2016)",
      "Galaxy J5 (2016)",
      "Galaxy J3 (2016)",
      "Galaxy J1 (2016)",
      "Galaxy Grand Prime Plus",
    ],
    2015: [
      "Galaxy S6 Edge+",
      "Galaxy S6 Edge",
      "Galaxy S6",
      "Galaxy Note 5",
      "Galaxy A7",
      "Galaxy A5",
      "Galaxy A3",
      "Galaxy J7",
      "Galaxy J5",
      "Galaxy J1",
    ],
    2014: [
      "Galaxy S5",
      "Galaxy Note 4",
      "Galaxy Note Edge",
      "Galaxy Grand Prime",
      "Galaxy Core Prime",
      "Galaxy Grand 2",
    ],
    2013: ["Galaxy S4", "Galaxy Note 3", "Galaxy Grand", "Galaxy Core"],
    2012: ["Galaxy S3", "Galaxy Note 2"],
    2011: ["Galaxy S2", "Galaxy Note"],
    2010: ["Galaxy S"],
  }),
  ...fromYears(
    {
      2024: ["Galaxy Tab S10+", "Galaxy Tab S10 Ultra"],
      2023: [
        "Galaxy Tab S9",
        "Galaxy Tab S9 FE",
        "Galaxy Tab A9+",
        "Galaxy Tab A9",
      ],
      2022: ["Galaxy Tab S8", "Galaxy Tab A8"],
      2021: ["Galaxy Tab S7 FE", "Galaxy Tab A7 Lite"],
      2020: ["Galaxy Tab S7", "Galaxy Tab S6 Lite", "Galaxy Tab A7"],
      2019: ["Galaxy Tab S6", "Galaxy Tab A 10.1"],
      2018: ["Galaxy Tab S4", "Galaxy Tab A 10.5"],
      2016: ["Galaxy Tab A6"],
      2014: ["Galaxy Tab S", "Galaxy Tab 4"],
      2013: ["Galaxy Tab 3"],
      2012: ["Galaxy Tab 2"],
    },
    "tablets",
  ),
  ...fromYears(
    {
      2024: ["Galaxy Watch 7", "Galaxy Watch Ultra", "Galaxy Watch FE"],
      2023: ["Galaxy Watch 6"],
      2022: ["Galaxy Watch 5"],
      2021: ["Galaxy Watch 4"],
      2019: ["Galaxy Watch Active 2"],
      2018: ["Galaxy Watch"],
      2016: ["Gear S3"],
    },
    "watches",
  ),
];

/* ── Huawei ───────────────────────────────────────────────────────────
   The Y series is the reason this list runs long. Those are the phones
   Huawei actually sold here in volume, and the P30 / Mate 20 era is the
   last with Google services, so they are still in daily use and still
   coming in for batteries.                                             */
const HUAWEI: readonly CatalogueDevice[] = [
  ...fromYears({
    /*
     * ⚠️ 2024 and 2025 were missing entirely, and that is the gap that
     * mattered most in this whole file.
     *
     * The list stopped at 2023, so every Huawei released since — the Pura 70
     * line, the whole Mate 70 line, two generations of nova — was unpickable.
     * A gap at the *top* of a device list is the expensive kind: those are the
     * handsets still under warranty, still worth trading in, and most likely
     * to arrive at the bench with a cracked screen. A gap at the bottom costs
     * almost nothing by comparison.
     */
    2025: [
      "Huawei Pura 80 Ultra",
      "Huawei Pura 80 Pro",
      "Huawei Pura 80",
      "Huawei nova 13 Pro",
      "Huawei nova 13",
      "Huawei nova 13i",
      "Huawei Enjoy 70",
    ],
    2024: [
      "Huawei Mate 70 Pro+",
      "Huawei Mate 70 Pro",
      "Huawei Mate 70",
      "Huawei Mate X6",
      "Huawei Pura 70 Ultra",
      "Huawei Pura 70 Pro",
      "Huawei Pura 70",
      "Huawei nova 12",
      "Huawei nova 12i",
      "Huawei nova 12s",
      "Huawei nova Y72",
      "Huawei nova Y61",
    ],
    2023: [
      "Huawei Mate 60 Pro",
      "Huawei Mate X5",
      "Huawei P60 Pro",
      "Huawei Nova 11",
      "Huawei nova 11i",
      "Huawei nova Y91",
      "Huawei nova Y71",
    ],
    2022: ["Huawei Mate 50 Pro", "Huawei Nova 10", "Huawei Nova Y70"],
    2021: ["Huawei P50 Pro", "Huawei Nova 9", "Huawei Nova 8i", "Huawei Y7a"],
    2020: [
      "Huawei P40 Pro",
      "Huawei P40 Lite",
      "Huawei Mate 40 Pro",
      "Huawei Nova 7i",
      "Huawei Y9s",
      "Huawei Y8p",
      "Huawei Y7p",
      "Huawei Y6p",
      "Huawei Y5p",
    ],
    2019: [
      "Huawei P30 Pro",
      "Huawei P30",
      "Huawei P30 Lite",
      "Huawei Mate 30 Pro",
      "Huawei Nova 5T",
      "Huawei Y9 Prime 2019",
      "Huawei Y9 2019",
      "Huawei Y7 2019",
      "Huawei Y6 2019",
      "Huawei Y5 2019",
    ],
    2018: [
      "Huawei P20 Pro",
      "Huawei P20",
      "Huawei P20 Lite",
      "Huawei Mate 20 Pro",
      "Huawei Mate 20",
      "Huawei Mate 20 Lite",
      "Huawei Nova 3i",
      "Huawei Y9 2018",
      "Huawei Y7 Prime 2018",
      "Huawei Y6 2018",
      "Huawei Y5 Prime 2018",
    ],
    2017: [
      "Huawei P10",
      "Huawei P10 Lite",
      "Huawei Mate 10 Pro",
      "Huawei Mate 10 Lite",
      "Huawei Nova 2i",
      "Huawei Y7 Prime",
      "Huawei Y6 2017",
      "Huawei Y5 2017",
      "Huawei GR5 2017",
    ],
    2016: [
      "Huawei P9",
      "Huawei P9 Lite",
      "Huawei Mate 9",
      "Huawei Nova",
      "Huawei GR5",
      "Huawei Y6 II",
      "Huawei Y5 II",
    ],
    2015: [
      "Huawei P8",
      "Huawei P8 Lite",
      "Huawei Mate 8",
      "Huawei Mate S",
      "Huawei Y6",
      "Huawei Y5",
    ],
    2014: ["Huawei Ascend P7", "Huawei Ascend Mate 7", "Huawei Ascend G7"],
    2013: [
      "Huawei Ascend P6",
      "Huawei Ascend Mate",
      "Huawei Ascend G510",
      "Huawei Ascend Y300",
    ],
    /*
     * The Ascend years, kept short on purpose.
     *
     * These are here because the brief was every device after 2010, and they
     * are three lines each rather than thirty because of the rule at the top
     * of this file: what is in, is what actually sold in Iraq. A 2011 Android
     * is not a device anybody brings to this counter — it is a device somebody
     * *mentions*, and one accurate row is worth more than a page of rebadges
     * nobody will ever pick. The free-text fallback covers the rest.
     */
    2012: [
      "Huawei Ascend P1",
      "Huawei Ascend D1",
      "Huawei Ascend G300",
      "Huawei Ascend Y200",
    ],
    2011: ["Huawei IDEOS X5", "Huawei Vision U8850", "Huawei IDEOS X3"],
  }),
  ...fromYears(
    {
      2021: ["Huawei MatePad 11"],
      2020: ["Huawei MatePad T10"],
      2018: ["Huawei MediaPad T5"],
      2017: ["Huawei MediaPad T3"],
    },
    "tablets",
  ),
];

/* ── Honor ────────────────────────────────────────────────────────────
   Independent of Huawei since 2020; everything before that split still
   arrives at the counter as an Honor, so it is filed here.             */
const HONOR: readonly CatalogueDevice[] = [
  ...fromYears({
    2025: [
      "Honor Magic 7 Pro",
      "Honor Magic 7 Lite",
      "Honor 400 Pro",
      "Honor 400",
      "Honor 400 Lite",
      "Honor X9c",
      "Honor X8c",
      "Honor X7c",
      "Honor X6c",
    ],
    2024: [
      "Honor Magic 6 Pro",
      "Honor 200 Pro",
      "Honor 200",
      "Honor X9b",
      "Honor X8b",
      "Honor X6b",
      "Honor X7b",
    ],
    2023: [
      "Honor Magic 5 Pro",
      "Honor 90",
      "Honor X9a",
      "Honor X8a",
      "Honor X7a",
      "Honor X6a",
      "Honor X5",
      "Honor Play 8T",
    ],
    2022: ["Honor Magic 4 Pro", "Honor 70", "Honor X8", "Honor X7", "Honor X6"],
    2021: ["Honor 50", "Honor X20", "Honor 9X Lite"],
    2020: ["Honor 9X Pro", "Honor 9A", "Honor 9C", "Honor 9S"],
    2019: [
      "Honor 20 Pro",
      "Honor 20",
      "Honor 20 Lite",
      "Honor 9X",
      "Honor 8A",
      "Honor 8S",
      "Honor Play",
    ],
    2018: [
      "Honor 10",
      "Honor 8X",
      "Honor 7A",
      "Honor 7C",
      "Honor 9 Lite",
      "Honor Note 10",
    ],
    2017: ["Honor 9", "Honor 7X", "Honor 6X", "Honor 8 Pro"],
    2016: ["Honor 8", "Honor 5C", "Honor 5X"],
    2015: ["Honor 7", "Honor 4C", "Honor 4X"],
    2014: ["Honor 6", "Honor 3C"],
    // Honor's first year — the sub-brand launched in December 2013, so like
    // realme's 2018 this is a genuine floor rather than a gap.
    2013: ["Honor 3X", "Honor 3"],
  }),
  ...fromYears({ 2023: ["Honor Pad 9", "Honor Pad X9"] }, "tablets"),
  ...fromYears({ 2024: ["Honor Band 9"], 2021: ["Honor Band 6"] }, "watches"),
];

/* ── OPPO ─────────────────────────────────────────────────────────── */
const OPPO: readonly CatalogueDevice[] = fromYears({
  2025: ["OPPO Reno 13 Pro", "OPPO Reno 13", "OPPO A80"],
  2024: [
    "OPPO Find X8 Pro",
    "OPPO Find X7 Ultra",
    "OPPO Find X7",
    "OPPO Reno 12 Pro",
    "OPPO Reno 12",
    "OPPO A60",
    "OPPO A3",
  ],
  2023: [
    "OPPO Reno 11 Pro",
    "OPPO Reno 11",
    "OPPO Reno 10 Pro",
    "OPPO A98",
    "OPPO A79",
    "OPPO A78",
    "OPPO A58",
    "OPPO A38",
    "OPPO A18",
  ],
  2022: [
    "OPPO Find X5 Pro",
    "OPPO Find N3 Flip",
    "OPPO Reno 8",
    "OPPO A96",
    "OPPO A77",
    "OPPO A57",
    "OPPO A17",
    "OPPO A16e",
  ],
  2021: [
    "OPPO Reno 6",
    "OPPO Reno 5",
    "OPPO A95",
    "OPPO A94",
    "OPPO A74",
    "OPPO A54",
    "OPPO A16",
    "OPPO A15s",
  ],
  2020: [
    "OPPO Reno 4",
    "OPPO Reno 3",
    "OPPO A72",
    "OPPO A52",
    "OPPO A31",
    "OPPO A15",
    "OPPO A12",
  ],
  2019: [
    "OPPO Reno 2",
    "OPPO Reno",
    "OPPO F11 Pro",
    "OPPO F11",
    "OPPO A9 2020",
    "OPPO A5 2020",
    "OPPO A9",
    "OPPO A5s",
    "OPPO A1k",
  ],
  2018: [
    "OPPO Find X",
    "OPPO F9",
    "OPPO F7",
    "OPPO A83",
    "OPPO A3s",
    "OPPO A7",
  ],
  // OPPO re-used "A57" in 2022. Same name, two different phones, so the older
  // one carries its year — otherwise the dedupe in `mergeBrandModels` keeps
  // whichever came first and the other is silently unpickable.
  2017: [
    "OPPO F5",
    "OPPO F3 Plus",
    "OPPO F3",
    "OPPO A57 (2017)",
    "OPPO A37",
    "OPPO R11",
  ],
  2016: ["OPPO F1s", "OPPO F1 Plus", "OPPO F1", "OPPO A39"],
  2015: ["OPPO R7", "OPPO Neo 7", "OPPO Mirror 5", "OPPO Joy 3"],
  2014: ["OPPO Find 7", "OPPO N1 mini", "OPPO Neo 5"],
});

/* ── realme ───────────────────────────────────────────────────────── */
const REALME: readonly CatalogueDevice[] = fromYears({
  2025: [
    "realme 14 Pro+",
    "realme 14 Pro",
    "realme 14",
    "realme 14x",
    "realme GT 7 Pro",
    "realme GT 7",
    "realme P3 Pro",
    "realme C75",
    "realme C71",
    "realme Note 60",
  ],
  2024: [
    "realme 13 Pro+",
    "realme 13 Pro",
    "realme 12 Pro+",
    "realme 12 Pro",
    "realme 12+",
    "realme GT 6",
    "realme C65",
    "realme C63",
    "realme Note 50",
  ],
  2023: [
    "realme 11 Pro+",
    "realme 11 Pro",
    "realme 11",
    "realme GT 3",
    "realme GT Neo 5",
    "realme C67",
    "realme C55",
    "realme C53",
    "realme C51",
    "realme Narzo 60",
  ],
  2022: [
    "realme 10 Pro+",
    "realme 10",
    "realme 9 Pro+",
    "realme 9i",
    "realme GT 2 Pro",
    "realme C35",
    "realme C33",
    "realme C31",
    "realme C30",
    "realme Narzo 50",
  ],
  2021: [
    "realme 8 Pro",
    "realme 8",
    "realme 8i",
    "realme GT",
    "realme C25",
    "realme C21",
    "realme C21Y",
    "realme C11 2021",
    "realme Narzo 30",
  ],
  2020: [
    "realme 7 Pro",
    "realme 7",
    "realme 6",
    "realme 6i",
    "realme X50 Pro",
    "realme C15",
    "realme C12",
    "realme C11",
    "realme C3",
    "realme Narzo 20",
  ],
  2019: [
    "realme 5 Pro",
    "realme 5",
    "realme 5i",
    "realme 3 Pro",
    "realme 3",
    "realme XT",
    "realme X2 Pro",
    "realme C2",
  ],
  2018: ["realme 2 Pro", "realme 2", "realme 1", "realme U1", "realme C1"],
});

/* ── Redmi ────────────────────────────────────────────────────────────
   One list, covering Redmi, Xiaomi and POCO alike.

   These used to be two `brands` rows and two lists, on the reasoning
   that the shop sells them as separate lines so `?brand=redmi` had to
   mean Redmi and nothing else. That was never true of this counter: the
   catalogue carries no product under either code, both walls of logos
   showed both marks, and a customer bringing in a Mi 10 is bringing in
   a phone this shop calls a Redmi. Two rows bought a partner wall with
   a stranded tenth cell and a device picker that made the customer
   guess which of two brands their handset was filed under.

   POCO was already folded in here — there is no `poco` row to file it
   under — which is the same argument one line further along.

   The models keep their own names. "Xiaomi Mi 10" is what is engraved
   on the back and what the customer types; renaming it "Redmi Mi 10"
   would be a device that does not exist. `arabicAliasesFor` derives the
   line name per device, so a search for بوكو still matches the POCOs
   and only the POCOs.                                                  */
/*
 * ---------------------------------------------------------------------------
 * ⚠️ These two arrays are ONE list again — the shop folded them on 2026-09-30
 * ---------------------------------------------------------------------------
 * The note that stood here argued for keeping them apart, and half of it was
 * right: *"a shopper choosing Xiaomi being shown Redmi Notes is defensible; a
 * shopper choosing Redmi being shown Mi flagships is not."* Exactly so — and
 * that sentence only ever described the **second** direction. The shop's
 * instruction was the first one: "mix redmi with xiaomi so all the devices get
 * shown under the name of xiaomi filters and identity". Everything Redmi makes
 * is a Xiaomi product, so the fold removes the dishonest direction rather than
 * creating it.
 *
 * The other half of the old note — that a picker keyed on brand code would hand
 * `xiaomi` an empty list — stopped being true the moment `scripts/merge-brands.mjs`
 * moved all 26 Redmi products onto `xiaomi` and hid the `redmi` row.
 *
 * The arrays stay separate **as arrays** so the split is still visible and
 * reversible in one line, and so the years inside each stay in their own order.
 * POCO is already inside `XIAOMI`, because that is whose sub-brand it is.
 */
const REDMI: readonly CatalogueDevice[] = [
  ...fromYears({
    2025: [
      "Redmi Note 15 Pro+",
      "Redmi Note 15 Pro",
      "Redmi Note 15",
      "Redmi Note 14 Pro+",
      "Redmi Note 14 Pro",
      "Redmi Note 14",
      "Redmi 15C",
      "Redmi 14C",
      "Redmi A5",
    ],
    2024: [
      "Redmi Note 13 Pro+",
      "Redmi Note 13 Pro",
      "Redmi Note 13",
      "Redmi 13C",
      "Redmi A3",
    ],
    2023: [
      "Redmi Note 12 Pro+",
      "Redmi Note 12 Pro",
      "Redmi Note 12S",
      "Redmi Note 12",
      "Redmi 12",
      "Redmi 12C",
      "Redmi A2",
    ],
    2022: [
      "Redmi Note 11 Pro",
      "Redmi Note 11S",
      "Redmi Note 11",
      "Redmi 10C",
      "Redmi 10A",
      "Redmi 10",
    ],
    2021: [
      "Redmi Note 10 Pro",
      "Redmi Note 10S",
      "Redmi Note 10",
      "Redmi Note 9T",
      "Redmi 9T",
    ],
    2020: [
      "Redmi Note 9 Pro",
      "Redmi Note 9S",
      "Redmi Note 9",
      "Redmi 9",
      "Redmi 9A",
      "Redmi 9C",
    ],
    2019: [
      "Redmi Note 8 Pro",
      "Redmi Note 8",
      "Redmi Note 7 Pro",
      "Redmi Note 7",
      "Redmi 8",
      "Redmi 8A",
      "Redmi 7",
      "Redmi 7A",
      "Redmi Go",
    ],
    2018: [
      "Redmi Note 6 Pro",
      "Redmi Note 5 Pro",
      "Redmi Note 5",
      "Redmi 6",
      "Redmi 6A",
      "Redmi 6 Pro",
      "Redmi S2",
    ],
    2017: [
      "Redmi Note 4X",
      "Redmi Note 4",
      "Redmi 5 Plus",
      "Redmi 5",
      "Redmi 5A",
      "Redmi 4X",
      "Redmi 4A",
    ],
    2016: ["Redmi Note 3", "Redmi 3S", "Redmi 3", "Redmi 4"],
    2015: ["Redmi Note 2", "Redmi 2"],
    2014: ["Redmi Note", "Redmi 1S"],
    // The first Redmi, and the start of the sub-brand. There is nothing
    // before this one to add — Redmi did not exist until 2013.
    2013: ["Redmi 1"],
  }),
  ...fromYears({ 2023: ["Redmi Pad SE"], 2022: ["Redmi Pad"] }, "tablets"),
];

/* ── Xiaomi, and POCO ─────────────────────────────────────────────── */
const XIAOMI: readonly CatalogueDevice[] = [
  ...fromYears({
    2025: [
      // Xiaomi skipped 16 and went straight to 17 in September 2025, to line
      // the numbering up with the iPhone. Worth the note: a list that jumped
      // 15 → 17 otherwise reads as a row somebody forgot to type.
      "Xiaomi 17 Pro Max",
      "Xiaomi 17 Pro",
      "Xiaomi 17",
      "Xiaomi 15T Pro",
      "Xiaomi 15T",
      "Xiaomi 15 Ultra",
      "Xiaomi 15",
      "Poco F7 Ultra",
      "Poco F7 Pro",
      "Poco F7",
      "Poco X7 Pro",
      "Poco M7 Pro",
      "Poco C75",
    ],
    2024: [
      "Xiaomi 14 Ultra",
      "Xiaomi 14T Pro",
      "Xiaomi 14T",
      "Poco X6 Pro",
      "Poco F6 Pro",
      "Poco M6 Pro",
    ],
    2023: [
      "Xiaomi 13 Pro",
      "Xiaomi 13T Pro",
      "Xiaomi 13T",
      "Xiaomi 13",
      "Poco X5 Pro",
      "Poco F5",
      "Poco C65",
    ],
    2022: [
      "Xiaomi 12T Pro",
      "Xiaomi 12T",
      "Xiaomi 12",
      "Xiaomi 12 Lite",
      "Poco X4 Pro",
      "Poco M4 Pro",
      "Poco F4",
    ],
    2021: [
      "Xiaomi 11T Pro",
      "Xiaomi 11T",
      "Xiaomi Mi 11",
      "Xiaomi Mi 11 Lite",
      "Poco X3 Pro",
      "Poco M3",
      "Poco F3",
    ],
    2020: [
      { name: "Xiaomi Mi 10", aliases: "mi10" },
      "Xiaomi Mi 10T Pro",
      "Xiaomi Mi 10T",
      "Xiaomi Mi 10 Lite",
      "Poco X3 NFC",
      "Poco M2",
    ],
    2019: [
      { name: "Xiaomi Mi 9", aliases: "mi9" },
      "Xiaomi Mi 9T Pro",
      "Xiaomi Mi 9T",
      "Xiaomi Mi A3",
      "Xiaomi Mi Note 10",
    ],
    2018: [
      "Xiaomi Mi 8",
      "Xiaomi Mi A2",
      "Xiaomi Mi Max 3",
      "Xiaomi Mi Mix 2S",
      "Poco F1",
    ],
    2017: [
      "Xiaomi Mi 6",
      "Xiaomi Mi A1",
      "Xiaomi Mi Max 2",
      "Xiaomi Mi Mix 2",
      "Xiaomi Mi Note 3",
    ],
    2016: ["Xiaomi Mi 5", "Xiaomi Mi 5s", "Xiaomi Mi Max", "Xiaomi Mi Note 2"],
    2015: ["Xiaomi Mi 4i", "Xiaomi Mi 4c", "Xiaomi Mi Note"],
    2014: ["Xiaomi Mi 4", "Xiaomi Mi 3"],
    // Back to the first one. The Mi 1 is where Xiaomi starts — August 2011 —
    // so this list is now complete on its own terms rather than merely long.
    2013: [
      { name: "Xiaomi Mi 2S", aliases: "mi2s" },
      { name: "Xiaomi Mi 2A", aliases: "mi2a" },
    ],
    2012: [
      { name: "Xiaomi Mi 2", aliases: "mi2" },
      { name: "Xiaomi Mi 1S", aliases: "mi1s" },
    ],
    2011: [{ name: "Xiaomi Mi 1", aliases: "mi1" }],
  }),
  ...fromYears({ 2023: ["Xiaomi Pad 6"], 2021: ["Xiaomi Pad 5"] }, "tablets"),
];

/* ── Tecno ────────────────────────────────────────────────────────────
   A far larger share of this shop's repair traffic than its three
   catalogue rows suggest — these sell heavily here and break like
   anything else, which is precisely the gap this file closes.          */
const TECNO: readonly CatalogueDevice[] = fromYears({
  2025: ["Tecno Camon 40", "Tecno Spark 30"],
  2024: [
    "Tecno Camon 30 Pro",
    "Tecno Camon 30",
    "Tecno Spark 20 Pro",
    "Tecno Spark 20",
    "Tecno Spark Go 2024",
    "Tecno Pova 6 Pro",
    "Tecno Pop 8",
    "Tecno Phantom V Fold 2",
    "Tecno Phantom V2",
  ],
  2023: [
    "Tecno Camon 20 Pro",
    "Tecno Camon 20",
    "Tecno Spark 10 Pro",
    "Tecno Spark 10",
    "Tecno Spark Go 2023",
    "Tecno Pova 5 Pro",
    "Tecno Pova 5",
    "Tecno Pop 7",
    "Tecno Phantom V Flip",
  ],
  2022: [
    "Tecno Camon 19 Pro",
    "Tecno Camon 19",
    "Tecno Spark 9",
    "Tecno Pova 4",
    "Tecno Pop 6",
    "Tecno Phantom X2 Pro",
  ],
  2021: [
    "Tecno Camon 18",
    "Tecno Camon 17",
    "Tecno Spark 8",
    "Tecno Spark 7",
    "Tecno Pova 2",
    "Tecno Pouvoir 5",
    "Tecno Phantom X",
  ],
  2020: [
    "Tecno Camon 16",
    "Tecno Camon 15",
    "Tecno Spark 6",
    "Tecno Spark 5",
    "Tecno Pova",
    "Tecno Pouvoir 4",
  ],
  2019: [
    "Tecno Camon 12",
    "Tecno Camon 11",
    "Tecno Spark 4",
    "Tecno Spark 3",
    "Tecno Pouvoir 3",
  ],
  2018: [
    "Tecno Camon 11 Pro",
    "Tecno Camon X",
    "Tecno Spark 2",
    "Tecno Pouvoir 2",
    "Tecno Phantom 8",
  ],
  2017: [
    "Tecno Camon CX",
    "Tecno Camon CM",
    "Tecno Spark",
    "Tecno WX3",
    "Tecno Phantom 6 Plus",
  ],
  2016: [
    "Tecno Camon C9",
    "Tecno Camon C8",
    "Tecno Boom J8",
    "Tecno W3",
    "Tecno L8",
  ],
  2015: ["Tecno Camon C7", "Tecno Boom J7", "Tecno Phantom 5"],
});

/* ── Infinix ──────────────────────────────────────────────────────── */
const INFINIX: readonly CatalogueDevice[] = fromYears({
  2025: ["Infinix Note 50", "Infinix Hot 50 Pro"],
  2024: [
    "Infinix Note 40 Pro+",
    "Infinix Note 40 Pro",
    "Infinix Note 40",
    "Infinix Zero 40",
    "Infinix Hot 50",
    "Infinix Smart 9",
    "Infinix GT 20 Pro",
  ],
  2023: [
    "Infinix Note 30 Pro",
    "Infinix Note 30",
    "Infinix Zero 30",
    "Infinix Hot 40",
    "Infinix Hot 40i",
    "Infinix Hot 30",
    "Infinix Hot 30i",
    "Infinix Smart 8",
    "Infinix Smart 7",
    "Infinix GT 10 Pro",
  ],
  2022: [
    "Infinix Note 12",
    "Infinix Zero 20",
    "Infinix Zero 5G",
    "Infinix Hot 20",
    "Infinix Hot 12",
    "Infinix Smart 6",
  ],
  2021: [
    "Infinix Note 11",
    "Infinix Note 10",
    "Infinix Hot 11",
    "Infinix Hot 10i",
    "Infinix Smart 5",
    "Infinix Zero 8",
  ],
  2020: [
    "Infinix Note 8",
    "Infinix Note 7",
    "Infinix Hot 10",
    "Infinix Hot 9",
    "Infinix Hot 9 Play",
    "Infinix Smart 4",
    "Infinix S5",
  ],
  2019: [
    "Infinix Note 6",
    "Infinix Hot 8",
    "Infinix Hot 7",
    "Infinix S4",
    "Infinix Smart 3 Plus",
  ],
  2018: [
    "Infinix Note 5",
    "Infinix Hot 6",
    "Infinix Hot S3",
    "Infinix Zero 5",
    "Infinix Smart 2",
  ],
  2017: ["Infinix Note 4", "Infinix Hot 4", "Infinix Zero 4", "Infinix S2 Pro"],
  2016: ["Infinix Note 3", "Infinix Hot 3", "Infinix Zero 3"],
  2015: ["Infinix Hot 2", "Infinix Zero 2"],
  2014: ["Infinix Hot", "Infinix Zero"],
});

/**
 * Keyed by `brands.code`, so a brand added in the back office simply has no
 * curated list and falls through to whatever it sells — which is the behaviour
 * this had everywhere before, and a safe floor rather than an error.
 */
export const DEVICE_CATALOGUE: Record<string, readonly CatalogueDevice[]> = {
  apple: APPLE,
  samsung: SAMSUNG,
  /*
   * ⚠️ One range under one name, and `redmi` is kept as an alias rather than
   * removed.
   *
   * The brand row is *hidden*, not deleted — `code` is a primary key and a
   * soft delete is what `/admin/filters` performs — so a repair ticket filed
   * last week, a saved link and any ERP row still carrying `redmi` all resolve.
   * Dropping the key would hand every one of them an empty picker, which is the
   * shape of "the model list is broken" rather than "that brand was folded".
   *
   * Redmi leads because it is the volume seller at this counter: the picker is
   * searched far more often than it is scrolled, but what is on screen when it
   * opens should be what customers most often walk in holding.
   */
  xiaomi: [...REDMI, ...XIAOMI],
  redmi: [...REDMI, ...XIAOMI],
  huawei: HUAWEI,
  honor: HONOR,
  oppo: OPPO,
  realme: REALME,
  tecno: TECNO,
  infinix: INFINIX,
};

/**
 * Arabic for the words that actually appear in device names.
 *
 * `normalizeSearch` folds script *variants* — alef carriers, ya, ta-marbuta,
 * Arabic-Indic digits — but it does not translate, and it must not: it mirrors
 * `search_normalize()` in Postgres character for character, and changing one
 * without the other silently desynchronises the catalogue's own search.
 *
 * So the translation happens here instead, as extra keywords on each row. It is
 * the difference between a picker that works for this shop's customers and one
 * that does not: "نوت ٨" is how a Redmi Note 8 gets typed at this counter, and
 * against the Latin name alone it matched nothing at all.
 *
 * Folding is applied to the whole haystack afterwards, so the Arabic written
 * here does not need its own variants — `ساعة` and `ساعه` both arrive as the
 * same string.
 */
const SERIES_ARABIC: Record<string, string> = {
  iphone: "ايفون",
  ipad: "ايباد",
  watch: "ساعة واتش",
  galaxy: "جالكسي غالاكسي",
  note: "نوت",
  pro: "برو",
  max: "ماكس",
  ultra: "الترا",
  plus: "بلس",
  lite: "لايت",
  mini: "ميني",
  air: "اير",
  edge: "ايدج",
  fold: "فولد",
  flip: "فليب",
  prime: "برايم",
  tab: "تاب",
  redmi: "ريدمي",
  poco: "بوكو",
  nova: "نوفا",
  mate: "ميت",
  reno: "رينو",
  find: "فايند",
  magic: "ماجيك",
  spark: "سبارك",
  camon: "كامون",
  phantom: "فانتوم",
  pova: "بوفا",
  pop: "بوب",
  hot: "هوت",
  zero: "زيرو",
  smart: "سمارت",
  play: "بلاي",
  grand: "جراند",
};

/**
 * The Arabic words a device could be searched by, from its Latin name.
 *
 * Only the series words are translated — the model *number* is already
 * script-independent once `normalizeSearch` has folded Arabic-Indic digits, so
 * "نوت ٨" and "note 8" reach the same haystack from opposite directions.
 */
export function arabicAliasesFor(name: string): string {
  const words = name.toLowerCase().split(/[^a-z0-9+]+/);
  const out: string[] = [];
  for (const word of words) {
    const arabic = SERIES_ARABIC[word];
    if (arabic && !out.includes(arabic)) out.push(arabic);
  }
  return out.join(" ");
}

/*
 * `identityKey` used to live here — lower case, collapsed whitespace, and a
 * warning that it must not be `normalizeSearch` because that fold deleted
 * thirteen Samsungs from one picker by treating "Galaxy S24+" as "Galaxy S24".
 * That reasoning is kept and the function is not: `modelIdentity` in
 * `device-name.ts` is the one answer to "are these the same device" now, it
 * still keeps `+` meaningful for exactly that reason, and it also folds the
 * stock noise — which is the half a picker built from `products` needs.
 */

/** Newest first, which is the order every picker shows them in. */
/**
 * What an Arabic-typing reader can find a model by when no make is chosen yet:
 * the make's own Arabic names and the series words in Arabic. The scoped list
 * folds the same two in through `mergeBrandModels`; this is the unscoped one.
 */
export function arabicKeywordsFor(brandCode: string, name: string): string {
  return `${BRAND_ALIASES[brandCode] ?? ""} ${arabicAliasesFor(name)}`.trim();
}

export function catalogueFor(brandCode: string | null): CatalogueDevice[] {
  if (!brandCode) return [];
  // Sorted on a copy: the module constants are shared by every request on the
  // server, and `sort` mutates in place.
  return [...(DEVICE_CATALOGUE[brandCode] ?? [])].sort(
    (a, b) => b.year - a.year,
  );
}

/** One row of a device picker. */
export type DeviceOption = {
  /**
   * The **standard** model name, which is also what is submitted and stored.
   *
   * ⚠️ Never the stock name, and never the label. See
   * `lib/data/device-name.ts`: this string ends up on a repair ticket and is
   * printed alone on the label, the receipt and the warranty certificate, so
   * the shop's "(متوفر لدينا)" mark belongs on `label` and nowhere near here.
   */
  value: string;
  /** The standard name, plus the shop's own mark when it sells it. */
  label: string;
  /** Folded into the search haystack; never drawn. */
  keywords: string;
  /** True when the shop currently sells it, which floats it to the top. */
  inStock: boolean;
  /** Release year, drawn beside the name. */
  year?: number;
};

/** One model the shop actually stocks, as `getDeviceModels` reports it. */
export type StockModel = {
  /**
   * The ERP stock name, in English — "Samsung Galaxy A17 256GB / 8GB".
   *
   * ⚠️ English in both locales, deliberately. It is resolved onto a standard
   * name against the curated list and `compare_catalogue`, and both of those
   * are Latin; an Arabic stock name would match neither and would put a second
   * spelling of the same handset in the list. The Arabic goes in `keywords`,
   * which is the decision `loadWorldModels` already made for the same reason.
   */
  name: string;
  /** The Arabic name, folded into the search haystack and never drawn. */
  keywords?: string;
};

/**
 * Every device of a brand the counter is likely to see, named the way the
 * maker names it.
 *
 * Three sources, in preference order, and the whole function is three rules:
 *
 * 1. **Every row is a standard name.** The shop's own products arrive as ERP
 *    stock names — capacity, RAM, colour, grade — and are resolved onto the
 *    maker's own spelling by `standardModelName`. Measured on 2026-11-03:
 *    254 branded stock rows hold 170 distinct devices, so this is what stops
 *    one handset filling seven rows of a picker.
 * 2. **Stocked models come first, and say so.** A device the shop sells is a
 *    device it certainly services and the one most likely to be asked about.
 *    The mark is `inStockMark` in brackets after the name — the shop asked for
 *    it in those words — and it is on the label only.
 * 3. **One row per device.** De-duplicated on the identity of the *resolved*
 *    name rather than the raw one, which is the only version that works: the
 *    seven iPhone 17 Pro Max stock rows have seven different raw identities
 *    and one resolved one, so keying on the raw name would draw the same
 *    label seven times.
 *
 * `live` is whatever `getDeviceModels` returned for this brand, so anything
 * the admin adds to `products` is pickable on the next revalidation with no
 * edit to this file.
 */
export function mergeBrandModels(
  brandCode: string | null,
  live: readonly StockModel[],
  /**
   * Every device this make has shipped, from `compare_catalogue` — fetched
   * per make by `loadWorldModels` when one is chosen.
   *
   * ⚠️ **Third, behind the stock and the curated list, and never instead of
   * either.** The shop's own products lead because what is on the shelf is
   * the best signal about what this counter handles; the curated list is
   * second because it was written for *this* market — Samsung's J series,
   * Huawei's Y series, Infinix Hot — which a world index under-represents
   * badly. The world list is the long tail that stops a picker being empty.
   */
  world: readonly WorldModel[] = [],
  {
    inStockMark = null,
  }: {
    /**
     * What to put in brackets after a model the shop sells — `Picker.available`,
     * which is «متوفر لدينا». Null draws no mark, for a caller that has no
     * translator in hand.
     */
    inStockMark?: string | null;
  } = {},
): DeviceOption[] {
  if (!brandCode) return [];

  const aliases = BRAND_ALIASES[brandCode] ?? "";
  const curated = catalogueFor(brandCode);

  /*
   * The maker's own spellings, curated first. Built before the stock pass,
   * because resolving a stock name is a lookup into this map.
   */
  const known = knownModelNames(
    brandCode,
    curated.map((device) => device.name),
    world.map((device) => device.name),
  );

  /*
   * The year and the extra search terms a device carries, keyed the same way.
   *
   * Separate from `known` so that map can stay the plain identity→name shape
   * every other caller wants. Keyed on the identity of the source name, which
   * `modelIdentity` guarantees is the identity of its standardised form too —
   * prefixing the make and then dropping it again is a no-op.
   */
  const years = new Map<string, number>();
  const extras = new Map<string, string>();
  const remember = (name: string, year: number | null, keywords?: string) => {
    const id = modelIdentity(name, brandCode);
    if (!id) return;
    if (year != null && !years.has(id)) years.set(id, year);
    if (keywords && !extras.has(id)) extras.set(id, keywords);
  };
  for (const device of curated) remember(device.name, device.year, device.aliases);
  for (const device of world) remember(device.name, device.year, device.keywords);

  const seen = new Set<string>();
  const options: DeviceOption[] = [];

  const push = (raw: string, inStock: boolean, extra = "") => {
    const name = standardModelName(raw, brandCode, known);
    if (!name) return;
    // ⚠️ The identity of the *resolved* name. See rule 3 above.
    const id = modelIdentity(name, brandCode);
    if (!id || seen.has(id)) return;
    seen.add(id);
    options.push({
      value: name,
      label: withStockMark(name, inStock ? inStockMark : null),
      /*
       * Brand aliases, the series words in Arabic, whatever the source row
       * carried, and — for a stocked device — its own Arabic name. That last
       * one is not optional: the labels are Latin in both locales now, so an
       * Arabic-typing customer reaches "Nokia 105" through «نوكيا ١٠٥» in the
       * haystack or not at all.
       */
      keywords: `${aliases} ${arabicAliasesFor(name)} ${extras.get(id) ?? ""} ${extra}`
        .replace(/\s+/g, " ")
        .trim(),
      inStock,
      year: years.get(id),
    });
  };

  // Stock first, in the order the catalogue returned it — that is already
  // `sort_order`, which is a merchandising decision somebody made.
  for (const model of live) push(model.name, true, model.keywords ?? "");
  for (const device of curated) push(device.name, false);
  for (const device of world) push(device.name, false, device.keywords ?? "");

  return options;
}

// Small, stable reference data used to power dropdowns and format
// validation across the app. Deliberately limited to lists that are short
// and rarely change — GST slabs, the official state-code table, standard
// unit codes, and structural PAN/GSTIN validation. Large, frequently-
// updated registries (full HSN/SAC catalogs, PIN codes, IFSC codes) are
// NOT bundled here: they run to tens or hundreds of thousands of rows and
// change often enough that shipping a fixed snapshot would go stale and
// risk being wrong on real tax/banking documents. Verify against the
// current CBIC/RBI source before relying on any of this for compliance-
// critical filing.

// GST rate slabs in common use for goods/services (standard rate schedule).
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// Official CBIC GST state/UT codes — the first two digits of every GSTIN.
export const GST_STATE_CODES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman and Diu (merged into 26)" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (old code, pre-bifurcation)" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
  { code: "99", name: "Centre Jurisdiction" },
];

// Standard GST Unit Quantity Codes (UQC) — not the full CBIC list, but
// covers the units a general retail shop is likely to need.
export const UQC_UNITS: { code: string; name: string }[] = [
  { code: "BAG", name: "BAGS" },
  { code: "BAL", name: "BALE" },
  { code: "BDL", name: "BUNDLES" },
  { code: "BOX", name: "BOX" },
  { code: "BTL", name: "BOTTLES" },
  { code: "CAN", name: "CANS" },
  { code: "CTN", name: "CARTONS" },
  { code: "DOZ", name: "DOZENS" },
  { code: "DRM", name: "DRUMS" },
  { code: "GMS", name: "GRAMMES" },
  { code: "GRS", name: "GROSS" },
  { code: "KGS", name: "KILOGRAMS" },
  { code: "KLR", name: "KILOLITRE" },
  { code: "MLT", name: "MILLILITRE" },
  { code: "MTR", name: "METERS" },
  { code: "MTS", name: "METRIC TON" },
  { code: "NOS", name: "NUMBERS" },
  { code: "PAC", name: "PACKS" },
  { code: "PCS", name: "PIECES" },
  { code: "PRS", name: "PAIRS" },
  { code: "QTL", name: "QUINTAL" },
  { code: "ROL", name: "ROLLS" },
  { code: "SET", name: "SETS" },
  { code: "SQF", name: "SQUARE FEET" },
  { code: "SQM", name: "SQUARE METERS" },
  { code: "TBS", name: "TABLETS" },
  { code: "THD", name: "THOUSANDS" },
  { code: "TON", name: "TONNES" },
  { code: "TUB", name: "TUBES" },
  { code: "UNT", name: "UNITS" },
  { code: "YDS", name: "YARDS" },
  { code: "OTH", name: "OTHERS" },
];

// Generic starter categories offered as datalist suggestions on the product
// form — not authoritative, just common retail groupings to speed up data
// entry. The field stays free text; existing categories already in the
// catalog are suggested too (see ProductModal).
export const GENERIC_PRODUCT_CATEGORIES = [
  "Groceries",
  "Beverages",
  "Snacks",
  "Household",
  "Personal Care",
  "Stationery",
  "Electronics",
  "Clothing",
  "Footwear",
  "Toys",
  "Pharmacy",
  "Other",
] as const;

export const BUSINESS_TYPES = [
  "Proprietorship",
  "Partnership Firm",
  "LLP",
  "Private Limited Company",
  "Public Limited Company",
  "One Person Company (OPC)",
  "Hindu Undivided Family (HUF)",
  "Trust",
  "Society",
  "Cooperative Society",
  "Government Department",
  "Individual / Freelancer",
] as const;

// Structural validation only (regex format), not the GSTIN checksum digit —
// that algorithm is easy to get subtly wrong from memory and a false
// "invalid" on a real GSTIN is worse than not checking it. Treat these as
// advisory hints in the UI, not hard blockers.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidPanFormat(pan: string): boolean {
  return PAN_RE.test(pan.trim().toUpperCase());
}

export function isValidGstinFormat(gstin: string): boolean {
  return GSTIN_RE.test(gstin.trim().toUpperCase());
}

export function gstStateFromGstin(gstin: string): string | null {
  const code = gstin.trim().slice(0, 2);
  return GST_STATE_CODES.find((s) => s.code === code)?.name ?? null;
}

# ICEGATE dashboard

An analysis dashboard for ICEGATE (Indian Customs) activity over 30 days, 90 days, 6 months or 12 months, each compared with the previous period:

- **Volume & value:** shipping bills, bills of entry, export FOB, import value and duty paid.
- **Performance:** median clearance time, query rate and IGST refund turnaround.
- **Key findings:** auto-generated, e.g. slowest port, refund money blocked by errors, rising query rate, concentration risk.
- **Needs action:** queries left open, refund validation errors (SB002/SB003/SB005/SB006), unpaid duty and missing EGMs, oldest first.
- **Clearance:** distribution of clearance times, open-query aging, and per-port median and p90 times with query rates.
- **IGST refunds:** pipeline by stage, validation errors by code, and how long refunds have waited since EGM.
- **Trade mix:** top HS chapters and destination/origin countries, with share and change.
- **Documents table:** filter by type, status and port.

It needs no dependencies, just Node 18 or later.

```bash
npm start            # http://localhost:3000
```

## Connecting your API key

The key is read **server-side only** from the environment. It is never sent to the browser and must never be committed.

```bash
cp .env.example .env # .env is git-ignored
# then set ICEGATE_API_BASE and ICEGATE_API_KEY in .env
```

| Variable | Default | Purpose |
|---|---|---|
| `ICEGATE_API_BASE` | – | Base URL of the API |
| `ICEGATE_API_KEY` | – | Your key |
| `ICEGATE_API_KEY_HEADER` | `Authorization` | Header the key goes in |
| `ICEGATE_API_KEY_PREFIX` | `Bearer` | Prefix before the key (set empty for none) |
| `ICEGATE_API_PATH` | `/documents` | Path called as `GET {base}{path}`; must return the document list |
| `CACHE_SECONDS` | `60` | Server-side response cache |

If the variables are missing, or the live call fails or returns an unexpected shape, the dashboard shows **demo data**, with a "Demo data" badge and a banner saying why.

## Data contract

The live endpoint only has to return documents. All analysis is computed on the server in `lib/analytics.js`. The response can be a bare array, `{ "documents": [...] }`, or `{ "data": { "documents": [...] } }`. Include at least the last two years, so every range has a previous period to compare against. `lib/demo.js` generates a complete example.

```jsonc
{
  "documents": [
    {
      "type": "Shipping Bill",            // or "Bill of Entry"           (required)
      "number": "8413166",                //                               (required)
      "filedAt": "2026-11-03T10:20:00Z",  //                               (required)
      "port": "INNSA1", "country": "US", "hsChapter": "30", "valueInr": 920000,
      "assessedAt": "...", "queryRaisedAt": "...", "queryResolvedAt": "...",
      // shipping bills
      "leoAt": "...", "egmAt": "...", "igstRefundInr": 165600,
      "refundErrorCode": "SB005", "refundScrollAt": "...", "refundCreditedAt": "...",
      // bills of entry
      "dutyInr": 120000, "dutyPaidAt": "...", "oocAt": "..."
    }
  ]
}
```

Missing timestamps mean the step hasn't happened yet. Status and refund stage are derived from them, unless you send `status` or `refundStage` yourself.

If your ICEGATE data comes back in a different shape, map it in `lib/normalize.js`.

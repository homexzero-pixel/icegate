# ICEGATE dashboard

A small dashboard for ICEGATE (Indian Customs) activity: shipping bills, bills of entry, open queries, duty pending, the IGST refund pipeline and filings by port, plus a searchable documents table.

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
| `ICEGATE_API_PATH` | `/dashboard` | Path called as `GET {base}{path}?days=7\|30\|90` |
| `CACHE_SECONDS` | `60` | Server-side response cache |

If the variables are missing, or the live call fails or returns an unexpected shape, the dashboard shows **demo data**, with a "Demo data" badge and a banner saying why.

## Data contract

The live endpoint (or an adapter in front of it) should return JSON with these keys. It can also be wrapped as `{ "data": { ... } }`. `lib/demo.js` is a complete working example.

```jsonc
{
  "kpis": {
    "shippingBills": { "value": 422, "previous": 397 },
    "billsOfEntry": { "value": 269, "previous": 251 },
    "exportFobInr": { "value": 1352603057, "previous": 1223957922 },
    "queriesOpen": { "value": 51 },
    "dutyPendingInr": { "value": 16248250 },
    "igstRefundPendingInr": { "value": 110508212 },
    "igstRefundCreditedInr": { "value": 27846337 }
  },
  "daily": [{ "date": "2026-11-12", "shippingBills": 17, "billsOfEntry": 14 }],
  "refundStages": [{ "name": "Credited", "count": 50, "amountInr": 27846337 }],
  "statusBreakdown": [{ "status": "Query raised", "shippingBills": 30, "billsOfEntry": 21 }],
  "ports": [{ "code": "INNSA1", "name": "Nhava Sheva", "shippingBills": 141, "billsOfEntry": 100 }],
  "documents": [{
    "type": "Shipping Bill", "number": "8413166", "date": "2026-11-12", "port": "INMUN1",
    "status": "LEO granted", "valueInr": 920000, "igstRefundInr": 165600
  }]
}
```

If your ICEGATE data comes back in a different shape, map it in `lib/normalize.js`.

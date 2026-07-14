# HQ Ingest API — the one door for n8n

Every n8n workflow writes into the CRM through a single endpoint. One
contract, one auth header, six tables.

```
POST https://<crm-domain>/api/ingest
Content-Type: application/json
x-ivory-key: <IVORY_INGEST_KEY>       ← shared secret, set in Vercel + n8n
```

## Body shape

```json
{
  "table":  "calls",                   // required — see allowlist below
  "action": "insert",                  // optional — "insert" (default) or "update"
  "match":  { "id": "..." },           // required for updates — which rows to touch
  "data":   { "...": "..." }           // required — column values
}
```

**Responses**

| Case | Status | Body |
|---|---|---|
| Insert OK | 200 | `{ "ok": true, "action": "insert", "table": "...", "id": "<uuid>" }` |
| Update OK | 200 | `{ "ok": true, "action": "update", "table": "...", "ids": [...], "updated": n }` |
| Bad/missing `x-ivory-key` | 401 | `{ "error": "Unauthorized" }` |
| Unknown table / missing fields / DB constraint | 400 | `{ "error": "<what went wrong>" }` |

Postgres check-constraint errors come back verbatim in the 400 body — if a
workflow sends `outcome: "Booked"` instead of `booked`, the response will say
so.

## Tables + required insert fields

| Table | Required | Notes |
|---|---|---|
| `hq_clients` | `name` | Signed clients (Kenny, dental). `vertical`: physio/chiro/dental/cosmetic/other |
| `calls` | `source` | retell / chat_widget / other. `client_id` optional FK → hq_clients |
| `prospects` | `business_name` | `pipeline_stage`: new/mystery_shopped/contacted/replied/demo_booked/won/lost |
| `prospect_events` | `prospect_id`, `type` | type: mystery_call/cold_call/email_sent/email_opened/email_replied/dm_sent/demo/note |
| `outreach_events` | `prospect_id`, `channel`, `event` | channel: email/phone/dm · event: sent/opened/clicked/replied/bounced/unsubscribed |
| `jobs` | `agent` | status: queued/running/done/failed (default queued) |

## curl examples

Set once:

```bash
export CRM="https://<crm-domain>"
export KEY="<IVORY_INGEST_KEY>"
```

### hq_clients — register a signed client

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "hq_clients",
    "data": {
      "name": "Physio K",
      "vertical": "physio",
      "status": "active",
      "cliniko_or_pms_type": "cliniko"
    }
  }'
```

### calls — Retell call_ended → CRM

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "calls",
    "data": {
      "client_id": "<hq_clients uuid>",
      "source": "retell",
      "external_call_id": "retell_abc123",
      "caller_number": "+61400000000",
      "started_at": "2026-07-14T09:30:00+10:00",
      "duration_seconds": 142,
      "outcome": "booked",
      "summary": "New patient booked Thursday 2pm with Sarah.",
      "transcript": "…full transcript…",
      "raw_payload": { "retell": "event json here" }
    }
  }'
```

### prospects — new target from a hiring ad

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "prospects",
    "data": {
      "business_name": "Smile Dental Group",
      "vertical": "dental",
      "location": "Parramatta NSW",
      "phone": "+61298765432",
      "contact_name": "Jess",
      "contact_role": "Practice Manager",
      "source": "hiring_ad",
      "pipeline_stage": "new"
    }
  }'
```

### prospects — move stage (update)

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "prospects",
    "action": "update",
    "match": { "id": "<prospect uuid>" },
    "data": { "pipeline_stage": "demo_booked" }
  }'
```

### prospect_events — log a mystery-shop call

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "prospect_events",
    "data": {
      "prospect_id": "<prospect uuid>",
      "type": "mystery_call",
      "occurred_at": "2026-07-14T11:15:00+10:00",
      "detail": {
        "call_time": "11:15",
        "rings": 8,
        "answered": false,
        "went_to_voicemail": true,
        "callback_received": false,
        "capture_attempted": false,
        "notes": "Rang out to voicemail mid-morning — good pain point."
      }
    }
  }'
```

### outreach_events — cold email telemetry

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "outreach_events",
    "data": {
      "prospect_id": "<prospect uuid>",
      "channel": "email",
      "event": "replied",
      "campaign": "dental-july",
      "occurred_at": "2026-07-14T14:02:00+10:00",
      "detail": { "subject": "Re: Missed calls costing you bookings?" }
    }
  }'
```

### jobs — usually created by the /agents page (Phase 2), but ingestable

```bash
curl -s -X POST "$CRM/api/ingest" \
  -H "content-type: application/json" -H "x-ivory-key: $KEY" \
  -d '{
    "table": "jobs",
    "data": { "agent": "slide_deck_creator", "input": { "clinic_name": "Physio K" } }
  }'
```

## n8n setup

1. HTTP Request node → POST `{{$env.CRM_URL}}/api/ingest`
2. Header `x-ivory-key` = the shared secret (store as an n8n credential, not
   inline in the workflow)
3. Body = the JSON contract above
4. Treat any non-200 as a workflow failure — the `error` string says why

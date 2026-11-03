#!/bin/sh
# Examples of agents sending updates to Mission Control.
# Start the server first (./start.sh), then run: sh examples/send-events.sh
URL="${MC_URL:-http://localhost:4000}/api/events"
post() { curl -s -X POST "$URL" -H 'Content-Type: application/json' -d "$1"; echo; }

# Something happened → Activity feed
post '{"type":"activity","who":"Scout","what":"found 12 new dental clinics to score"}'

# Agent status, log line and live-view session
post '{"type":"agent","agent":"Scout","status":"Busy","log":"Scoring 12 new clinics",
       "session":{"url":"maps.example.com/dentists","title":"Dentists near you","target":"reading reviews","steps":["Find clinics","Score each site","Draft outreach","Ask before sending"],"cur":1}}'

# A brand-new coworker joins (created automatically)
post '{"type":"agent","agent":"Echo","role":"Support","model":"Claude Haiku","status":"Online","caps":["Inbox","FAQ replies"],"log":"Connected via AG-UI"}'

# Intel item → Intel feed and daily brief
post '{"type":"intel","who":"Scout","title":"Competitor dropped their starter price","summary":"Now $39/mo, self-serve only.","source":"rival-one.example.com","cat":"Competitor Watch","imp":"hot"}'

# Rules-check result → Stack action log
post '{"type":"action","who":"Ledger","outcome":"REFUSE","what":"tried to pay an unverified invoice"}'

# Ask for approval → approval card on the Stack screen
post '{"type":"approval","ref":"quill-post-42","who":"Quill","what":"publish the Thursday video","rule":"public posts → ask first"}'

# Read the decision later: GET /api/state and look for approvals[].ref == "quill-post-42" → state is approved / denied / pending

// SAMPLE DATA — every person and company below is fictional (.example domains).
// Columns match the CSV template users upload in Setup. Real lists replace this.
// changelog bullets are separated by " | ".
window.SAMPLE_CSV = `name,email,company,role,website,github,source,list_name,launch_video,release_version,release_days_ago,releases_90d,team_size,stage,funding_days_ago,region,changelog
Maya Okafor,maya@driftline.example,Driftline,Co-founder & CEO,driftline.example,,ambassador,Ambassador intro (Priya R.),none,v3.2,3,11,28,Series A,140,US,"Live trace replay for any request | Slack alerts with root-cause summary | 40% faster dashboard loads | New Go and Rust SDKs"
Tom Becker,tom@ledgerloop.example,LedgerLoop,Founder,ledgerloop.example,,hackathon,Vapi hackathon,none,v1.4,2,6,6,Seed,,UK,"Voice agent that reconciles invoices on a call | Xero and QuickBooks sync | Audit log export to CSV"
Aisha Rahman,aisha@quillstack.example,Quillstack,Head of Growth,quillstack.example,,london_rsvp,London Dec 3 RSVP,screen_recording,v2.0,5,5,14,Seed,60,UK,"Multiplayer docs editor | AI outline from a single prompt | Version history with diff view | SSO for teams"
Diego Martín,diego@pagerkit.example,PagerKit,CTO,pagerkit.example,,hackathon,Vapi hackathon,none,v0.9,1,9,4,Pre-seed,,EU,"Phone-call escalation for on-call incidents | Voice acknowledgement in 12 languages | PagerDuty importer"
Lena Fischer,lena@bramble.example,Bramble,Founder,bramble.example,,popup,Coffee pop-up · Shoreditch,none,,,0,3,Bootstrapped,,UK,
Kenji Watanabe,kenji@tessellate.example,Tessellate,Co-founder,tessellate.example,,ambassador,Ambassador intro (Marco L.),stale,v5.1,9,8,45,Series B,300,US,"Workflow builder with branching | 200+ new integrations | Usage-based billing dashboard"
Sofia Rossi,sofia@formfox.example,FormFox,CEO,formfox.example,,london_rsvp,London Dec 3 RSVP,none,v4.3,4,7,19,Seed,30,UK,"Conditional logic for multi-page forms | Stripe payments in forms | Embeds for Webflow and Framer"
Priyanka Iyer,priyanka@vectorly.example,Vectorly,Founder,vectorly.example,,hackathon,Vapi hackathon,produced,v2.2,6,4,9,Seed,,US,"Hybrid search across vectors and keywords | Re-ranking API | Python client 2.0"
Owen Hughes,owen@beanmetric.example,BeanMetric,Owner-operator,beanmetric.example,,popup,Coffee pop-up · Brixton,none,,,0,2,Bootstrapped,,UK,
Hana Kim,hana@shipnote.example,Shipnote,Co-founder,shipnote.example,,hackathon,Vapi hackathon,none,v1.1,12,3,3,Pre-seed,,US,"Auto-generated release notes from PRs | Linear integration | Public changelog page"
Marcus Reid,marcus@relaywave.example,RelayWave,VP Marketing,relaywave.example,,london_rsvp,London Dec 3 RSVP,produced,v6.0,20,3,60,Series B,90,UK,"Redesigned inbox | AI reply drafts | Shared team views"
Chloe Martin,chloe@gridnest.example,GridNest,Founder,gridnest.example,,ambassador,Ambassador intro (Priya R.),screen_recording,v2.8,7,6,12,Seed,,EU,"Spreadsheet-to-API in one click | Row-level permissions | Webhooks on change"
Ravi Patel,ravi@callsmith.example,Callsmith,CEO,callsmith.example,,hackathon,Vapi hackathon,none,v0.6,4,5,5,Pre-seed,20,US,"Outbound voice agent for appointment booking | Calendar sync | Call transcript search"
Ella Novak,ella@crema.example,Crema & Co,Operator,crema.example,,popup,Coffee pop-up · Soho,none,,,0,4,Bootstrapped,,UK,
Jonas Berg,jonas@tracewise.example,Tracewise,Co-founder,tracewise.example,,hackathon,Vapi hackathon,stale,v3.0,25,4,11,Seed,,EU,"OpenTelemetry auto-instrumentation | Cost per trace view | Retention controls"
Nadia Haddad,nadia@lumenly.example,Lumenly,Head of Product,lumenly.example,,london_rsvp,London Dec 3 RSVP,none,v1.9,2,10,22,Series A,200,UK,"In-app onboarding checklists | A/B test any tooltip | Segment by plan and usage | React SDK 1.0"
Sam Turner,sam@kettle.example,Kettle Roasters,Owner,kettle.example,,popup,Coffee pop-up · Hackney,none,,,0,6,Bootstrapped,,UK,
Ines Duarte,ines@promptdeck.example,PromptDeck,Founder,promptdeck.example,,ambassador,Ambassador intro (Marco L.),none,v2.4,5,8,7,Seed,45,EU,"Prompt versioning with rollbacks | Eval runs on every commit | Team review queue"
Ben Adler,ben@queuebird.example,QueueBird,CTO,queuebird.example,,hackathon,Vapi hackathon,screen_recording,v1.2,8,3,6,Pre-seed,,US,"Voice IVR replacement in 10 minutes | Twilio and Vonage numbers | Live call dashboard"
Grace Liu,grace@stackpilot.example,StackPilot,CEO,stackpilot.example,,cold,GitHub releases feed,none,v7.2,1,14,80,Series B,120,US,"Preview environments per pull request | Cost guardrails | Terraform export"
Ahmed Saleh,ahmed@dataquay.example,DataQuay,Founder,dataquay.example,,cold,Product Hunt launch,screen_recording,v1.0,3,2,5,Seed,,EU,"Launch: natural-language queries over Postgres | Chart export | Slack bot"
Laura Chen,laura@notebird.example,Notebird,Growth Lead,notebird.example,,cold,X launch post,none,v3.5,6,6,18,Seed,,US,"Meeting notes that write the follow-up email | HubSpot sync | Speaker labels"
Pablo Ortega,pablo@mintpath.example,Mintpath,Co-founder,mintpath.example,,cold,LinkedIn launch post,produced,v2.1,10,3,15,Series A,50,EU,"Expense policies as code | Card controls | Accounting close in a day"
Zara Ahmed,zara@cartwheel.example,Cartwheel,Founder,cartwheel.example,,hackathon,Vapi hackathon,none,v0.4,15,2,2,Pre-seed,,UK,"Voice ordering for Shopify stores | Order status by phone"
Felix Wagner,felix@schemafy.example,Schemafy,CEO,schemafy.example,,cold,GitHub releases feed,none,v1.8,2,9,10,Seed,,EU,"Visual database migrations | Rollback previews | GitHub Action"
Olivia Brooks,olivia@rally.example,Rally HQ,Ambassador,rally.example,,ambassador,AdaL ambassador,none,,,0,1,Community,,US,
Daniel Park,daniel@loopform.example,Loopform,CTO,loopform.example,,london_rsvp,London Dec 3 RSVP,stale,v2.6,35,2,16,Seed,,UK,"Survey logic jumps | Typeform importer"
Mei Tanaka,mei@hookline.example,Hookline,Founder,hookline.example,,hackathon,Vapi hackathon,none,v1.0,3,4,3,Pre-seed,,US,"Webhook debugger with replay | Signed payload verification | Team inboxes"
Ali Khan,ali@brewdesk.example,BrewDesk,Owner,brewdesk.example,,popup,Coffee pop-up · Peckham,none,v0.2,40,1,2,Bootstrapped,,UK,"Loyalty stamps on Apple Wallet"
Rosa Jimenez,rosa@vizcraft.example,Vizcraft,Head of Marketing,vizcraft.example,,cold,Product Hunt launch,none,v4.0,1,5,30,Series A,75,US,"Animated charts from any CSV | Brand themes | Embed anywhere"
Theo Laurent,theo@patchday.example,Patchday,Founder,patchday.example,,ambassador,Ambassador intro (Priya R.),produced,v1.5,4,5,4,Pre-seed,,EU,"Dependency updates grouped by risk | Auto-merge rules | Monorepo support"
Yuki Sato,yuki@speakflow.example,Speakflow,CEO,speakflow.example,,hackathon,Vapi hackathon,none,v2.0,6,7,13,Seed,10,US,"Real-time voice translation for support calls | Zendesk app | 30 languages"`;

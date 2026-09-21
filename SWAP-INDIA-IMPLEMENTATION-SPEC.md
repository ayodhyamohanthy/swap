# Swap India
## AI Coding Agent Implementation Specification

Version: 1.0
Product: Mobile-first Indian train seat coordination PWA
Initial market: India
Initial transport mode: Reserved Indian trains
Primary users: Families, groups, elderly passengers, students, tour groups, and travelers seeking better berth arrangements

---

# 1. Product Definition

Swap India helps passengers visually understand their train coach, find compatible passengers, and coordinate possible berth exchanges.

The product is not an official railway reservation system.

The application must never imply that:

- A passenger can sell or permanently transfer a railway seat.
- An in-app agreement automatically changes a railway reservation.
- An unregistered berth is available.
- A passenger is officially verified only because they uploaded a ticket image.
- A swap is guaranteed.
- The app has official railway approval unless a real authorized integration exists.

Preferred product language:

> See your berth. Find a better fit. Coordinate safely.

Core user flow:

```text
Create journey
→ Select train and date
→ Select boarding and destination stations
→ Enter coach and berth
→ View visual coach map
→ Choose preferences
→ Publish availability
→ Find compatible passengers
→ Compare proposed seats visually
→ Send request
→ Both passengers accept
→ Revalidate before departure
→ Coordinate with railway staff when required
```

---

# 2. Product Goals

## Primary goals

1. Make train berths understandable through visual maps.
2. Help families and groups coordinate seats.
3. Enable safe passenger-to-passenger swap requests.
4. Build journey-specific matching density.
5. Provide accurate, transparent seat-map confidence.
6. Work well on low-cost Android devices and slow Indian mobile networks.
7. Support English and Hindi at launch.
8. Create a viral group-invitation loop.
9. Monetize coordination convenience without charging for basic participation.
10. Build a provider-independent architecture for future railway and flight integrations.

## Non-goals for the first release

Do not build initially:

- Official railway ticket transfers.
- Seat resale or auctioning.
- Passenger-to-passenger payments.
- Three-way swaps.
- Automated booking changes.
- Universal live seat availability.
- Public passenger directories.
- Flight support.
- Complex ticket OCR.
- Full railway account login.
- Guaranteed seat upgrades.
- Anonymous public train chat rooms.

---

# 3. Target Users

## Persona A: Family traveler

Needs:

- Seats together.
- Lower berth for elderly members.
- Children near parents.
- One visual family view.

## Persona B: Elderly or accessibility-focused traveler

Needs:

- Lower berth.
- Easier access.
- Fewer stairs.
- Near family or companion.

Do not require public disclosure of medical information.

## Persona C: Group traveler

Examples:

- Wedding group.
- College trip.
- Religious trip.
- Tour group.
- Company travel group.

Needs:

- Invite link.
- Group roster.
- Coach visualization.
- Seating coordination.
- Group admin controls.

## Persona D: Individual comfort seeker

Needs:

- Lower instead of upper berth.
- Side berth preference.
- Same coach.
- Away from toilet or entrance.
- Better proximity to companion.

## Persona E: Tour or travel organizer

Needs:

- Manage many passengers.
- Import or collect berth details.
- See group distribution.
- Send reminders.
- Coordinate changes.

---

# 4. Launch Strategy

Start with a concentrated network rather than nationwide availability.

## Initial transport scope

Support:

- Sleeper Class.
- AC 3 Tier.
- AC 2 Tier.
- Selected coach types.
- Curated layouts.
- Manual journey entry.
- A limited route set.

## Recommended pilot strategy

Select 3–5 high-density route clusters based on:

- Long travel duration.
- High family travel.
- High group travel.
- Frequent split-berth problems.
- Strong digital adoption.
- Availability of reliable train data.

Do not build the system around hardcoded routes. Routes must be configurable in the admin panel.

---

# 5. Technical Architecture

## Recommended stack

Use the existing repository stack if viable. If greenfield:

### Frontend

- Next.js or React.
- TypeScript.
- CSS modules, Tailwind, or the existing design system.
- SVG seat-map renderer.
- React Query or equivalent server-state library.
- IndexedDB for offline journey data.
- Service worker.
- Web app manifest.
- Accessible component primitives.

### Backend

- Node.js with TypeScript.
- REST or typed RPC API.
- PostgreSQL.
- Redis for rate limiting, queues, locks, and short-lived matching jobs.
- Background worker.
- Object storage for temporary evidence uploads.
- Admin dashboard.
- Structured audit logging.

### Infrastructure

- Managed PostgreSQL.
- Managed Redis.
- Managed object storage.
- CDN.
- Error monitoring.
- Application logs.
- Database backups.
- CI/CD pipeline.
- Preview environments.

## Architecture principles

1. Keep seat-map geometry separate from live passenger data.
2. Keep railway providers behind adapter interfaces.
3. Keep matching rules server-side.
4. Use database constraints for conflicting commitments.
5. Treat all availability as time-sensitive.
6. Never trust client-side authorization.
7. Make uncertain data visibly uncertain.
8. Design for localization from the beginning.
9. Keep sensitive journey evidence private.
10. Make every important action auditable.

---

# 6. Repository Structure

Use this structure unless the existing repository has a better equivalent:

```text
src/
  app/
    page.tsx
    journeys/
      page.tsx
      new/
        page.tsx
      [journeyId]/
        page.tsx
        map/
          page.tsx
        preferences/
          page.tsx
        matches/
          page.tsx
    requests/
      page.tsx
      [requestId]/
        page.tsx
    inbox/
      page.tsx
    profile/
      page.tsx
    help/
      page.tsx
    legal/
      privacy/
        page.tsx
      terms/
        page.tsx

  components/
    layout/
    navigation/
    journey/
    train-search/
    seat-map/
      SeatMap.tsx
      CoachStrip.tsx
      CoachMap.tsx
      Berth.tsx
      SeatDetailSheet.tsx
      BerthElevation.tsx
      SeatLegend.tsx
      SeatMapToolbar.tsx
      SeatListAlternative.tsx
    matching/
    requests/
    messaging/
    notifications/
    forms/
    feedback/
    accessibility/

  server/
    auth/
    journeys/
    trains/
    layouts/
    matching/
    swap-requests/
    messaging/
    notifications/
    moderation/
    payments/
    admin/

  lib/
    auth/
    db/
    validation/
    permissions/
    localization/
    dates/
    timezones/
    rate-limit/
    feature-flags/
    analytics/
    errors/

  providers/
    trains/
      TrainProvider.ts
      ManualTrainProvider.ts
      ProviderRegistry.ts
    notifications/
    payments/

  data/
    layouts/
      sleeper/
      ac-3-tier/
      ac-2-tier/

  workers/
    match-worker.ts
    expire-requests-worker.ts
    notification-worker.ts
    journey-revalidation-worker.ts

  types/
    journey.ts
    seat-map.ts
    matching.ts
    requests.ts
    users.ts

  tests/
    unit/
    integration/
    e2e/
    accessibility/
```

---

# 7. Domain Model

## Main entities

```text
users
user_profiles
operators
stations
trains
train_services
service_stops
coach_types
layout_templates
layout_versions
coach_instances
berths
traveler_journeys
journey_members
seat_claims
swap_preferences
match_candidates
swap_requests
swap_events
messages
notifications
reports
blocks
payments
admin_actions
analytics_events
```

## Important concepts

### Physical berth

The actual physical location in a coach.

### Journey seat claim

A user’s reported or verified use of a berth for a specific journey segment.

### Preference

What the user wants.

### Swap request

A proposed exchange between two travelers.

### Official reservation

Railway-owned reservation data. This must not be represented as changed unless an authorized integration confirms it.

---

# 8. Database Schema

Use PostgreSQL.

## users

```sql
create table users (
  id uuid primary key,
  phone_hash text unique not null,
  phone_verified_at timestamptz,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

Do not store plain phone numbers unless operationally required. If stored, encrypt them and restrict access.

## user_profiles

```sql
create table user_profiles (
  user_id uuid primary key references users(id),
  display_name text not null,
  preferred_language text not null default 'en',
  avatar_url text,
  allow_group_invites boolean not null default true,
  notification_preferences jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## stations

```sql
create table stations (
  id uuid primary key,
  code text not null,
  name text not null,
  normalized_name text not null,
  city text,
  state text,
  country_code text not null default 'IN',
  latitude numeric,
  longitude numeric,
  aliases jsonb not null default '[]',
  created_at timestamptz not null default now()
);
```

## trains

```sql
create table trains (
  id uuid primary key,
  operator_name text not null,
  train_number text not null,
  train_name text,
  active boolean not null default true,
  metadata jsonb not null default '{}',
  unique(operator_name, train_number)
);
```

## train_services

```sql
create table train_services (
  id uuid primary key,
  train_id uuid not null references trains(id),
  departure_date date not null,
  service_identifier text not null,
  source text not null,
  confidence text not null,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  unique(train_id, departure_date, service_identifier)
);
```

## service_stops

```sql
create table service_stops (
  id uuid primary key,
  service_id uuid not null references train_services(id),
  station_id uuid not null references stations(id),
  stop_index integer not null,
  arrival_time timestamptz,
  departure_time timestamptz,
  unique(service_id, stop_index)
);
```

## layout_templates

```sql
create table layout_templates (
  id uuid primary key,
  transport text not null default 'train',
  class_code text not null,
  coach_type text not null,
  operator_name text,
  name text not null,
  width numeric not null,
  height numeric not null,
  confidence text not null,
  source text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

## layout_versions

```sql
create table layout_versions (
  id uuid primary key,
  layout_template_id uuid not null references layout_templates(id),
  version integer not null,
  geometry jsonb not null,
  fixtures jsonb not null default '[]',
  notes text,
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(layout_template_id, version)
);
```

## traveler_journeys

```sql
create table traveler_journeys (
  id uuid primary key,
  user_id uuid not null references users(id),
  service_id uuid not null references train_services(id),
  boarding_stop_index integer not null,
  destination_stop_index integer not null,
  class_code text not null,
  coach_code text,
  berth_code text,
  verification_level text not null default 'manual',
  visibility text not null default 'matches_only',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Constraints:

```text
boarding_stop_index < destination_stop_index
journey user must own or belong to the journey
journeys cannot be matched across different services
```

## swap_preferences

```sql
create table swap_preferences (
  id uuid primary key,
  traveler_journey_id uuid not null references traveler_journeys(id),
  desired_features jsonb not null default '[]',
  acceptable_features jsonb not null default '[]',
  preferred_coach text,
  preferred_bay text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

## swap_requests

```sql
create table swap_requests (
  id uuid primary key,
  from_journey_id uuid not null references traveler_journeys(id),
  to_journey_id uuid not null references traveler_journeys(id),
  from_berth_code text not null,
  to_berth_code text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  requester_message text,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
```

Use transactional locking when accepting requests.

---

# 9. Seat Map Data Format

```ts
type LayoutConfidence =
  | "verified"
  | "expected"
  | "user_confirmed"
  | "illustrative";

type BerthFeature =
  | "lower"
  | "middle"
  | "upper"
  | "side_lower"
  | "side_upper"
  | "window_side"
  | "near_door"
  | "near_toilet"
  | "easy_access";

interface SeatMap {
  id: string;
  version: number;
  transport: "train";
  classCode: string;
  coachType: string;
  width: number;
  height: number;
  confidence: LayoutConfidence;
  source: string;
  lastReviewedAt?: string;
  berths: Berth[];
  fixtures: Fixture[];
}

interface Berth {
  id: string;
  label: string;
  bayId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  level?: number;
  features: BerthFeature[];
  restrictions: string[];
}

interface Fixture {
  type: "door" | "toilet" | "aisle" | "stairs" | "wall";
  x: number;
  y: number;
  width: number;
  height: number;
}
```

The renderer must not infer availability from geometry.

---

# 10. Train Data Provider Architecture

Use adapters:

```ts
interface TrainProvider {
  searchTrains(input: TrainSearchInput): Promise<TrainSearchResult[]>;
  resolveService(input: ResolveServiceInput): Promise<ResolvedService>;
  resolveStops(input: ResolveStopsInput): Promise<ServiceStop[]>;
  resolveCoachLayout(input: ResolveCoachLayoutInput): Promise<LayoutResolution>;
}
```

Initial provider:

```text
ManualTrainProvider
```

It should support:

- Train number.
- Train name.
- Date.
- Stations.
- Class.
- Coach type.
- Layout template.
- Confidence status.

Future providers must be added without changing UI components.

## Layout resolution response

```ts
interface LayoutResolution {
  layoutTemplateId: string;
  confidence: "verified" | "expected" | "user_confirmed" | "illustrative";
  source: string;
  lastCheckedAt?: string;
  requiresUserConfirmation: boolean;
}
```

If `requiresUserConfirmation` is true, show a confirmation step before allowing matching.

---

# 11. Matching Engine

Start with deterministic rules.

## Eligibility

Two journey records are eligible when:

```text
same train service
same travel date
same class or explicitly compatible class
overlapping journey segments
both journeys active
both users opted into matching
both users have valid seat claims
no active conflicting request
no blocked relationship
no moderation restriction
```

Segment overlap:

```ts
const overlaps =
  Math.max(a.boardingStopIndex, b.boardingStopIndex) <
  Math.min(a.destinationStopIndex, b.destinationStopIndex);
```

For MVP, prefer exact same boarding and destination stations.

## Ranking

```text
same coach: +40
same bay: +30
desired berth feature satisfied: +25
group proximity improved: +25
accessibility preference satisfied: +25
same boarding and destination: +20
verified journey: +15
short physical distance: +10
time remaining above threshold: +5
```

Never rank a listing as available merely because a passenger has not joined.

## Match statuses

```text
candidate
hidden
shown
request_sent
rejected
expired
blocked
```

## Matching worker

Run matching:

- When a journey becomes active.
- When preferences change.
- When a new journey is added.
- When a request is cancelled.
- When a journey is revalidated.
- On scheduled background intervals for upcoming journeys.

---

# 12. Swap Request State Machine

```text
draft
→ pending
→ accepted_by_recipient
→ accepted_by_both
→ awaiting_external_confirmation
→ completed
```

Alternative endings:

```text
cancelled
expired
declined
disputed
invalidated
```

Rules:

- Requests must expire.
- A user cannot have unlimited active requests.
- A berth cannot be committed to multiple accepted requests.
- Acceptance must happen inside a database transaction.
- Equipment changes invalidate affected requests.
- Users can withdraw before completion.
- The system must revalidate before final confirmation.
- Offline acceptance must never be treated as final.

---

# 13. API Design

## Authentication

```text
POST /api/auth/request-otp
POST /api/auth/verify-otp
POST /api/auth/logout
GET  /api/auth/session
DELETE /api/account
```

## Train search

```text
GET /api/trains/search?q=
GET /api/trains/:trainNumber
GET /api/services/:serviceId
GET /api/services/:serviceId/stops
```

## Journeys

```text
POST /api/journeys
GET /api/journeys
GET /api/journeys/:journeyId
PATCH /api/journeys/:journeyId
DELETE /api/journeys/:journeyId
POST /api/journeys/:journeyId/confirm-layout
POST /api/journeys/:journeyId/publish
POST /api/journeys/:journeyId/pause
```

## Seat maps

```text
GET /api/journeys/:journeyId/seat-map
GET /api/journeys/:journeyId/seat-map/availability
GET /api/journeys/:journeyId/berths/:berthId
```

## Preferences

```text
PUT /api/journeys/:journeyId/preferences
GET /api/journeys/:journeyId/preferences
```

## Matches

```text
GET /api/journeys/:journeyId/matches
POST /api/matches/:matchId/hide
POST /api/matches/:matchId/report
```

## Requests

```text
POST /api/swap-requests
GET /api/swap-requests
GET /api/swap-requests/:requestId
POST /api/swap-requests/:requestId/accept
POST /api/swap-requests/:requestId/decline
POST /api/swap-requests/:requestId/cancel
POST /api/swap-requests/:requestId/complete
```

## Messaging

```text
GET  /api/conversations
GET  /api/conversations/:conversationId/messages
POST /api/conversations/:conversationId/messages
POST /api/conversations/:conversationId/report
```

## Group invitations

```text
POST /api/journeys/:journeyId/invites
GET /api/invites/:token
POST /api/invites/:token/accept
POST /api/invites/:token/revoke
```

Invite links must not contain:

- PNR.
- Ticket barcode.
- Phone number.
- Full legal name.
- Private berth details unless the recipient is authenticated and authorized.

---

# 14. PWA Requirements

## Manifest

Include:

- App name.
- Short name.
- Icons.
- Theme color.
- Background color.
- Standalone display.
- Portrait-primary orientation.
- Share target if appropriate.

## Offline capabilities

Allow offline users to:

- Open previously loaded journeys.
- View cached seat maps.
- View their own berth.
- View saved preferences.
- View last-known request status.
- Read safety instructions.

Do not allow offline users to:

- Accept a swap.
- Confirm current availability.
- Publish a listing.
- Make a payment.
- Complete a request.
- Send a message that appears immediately delivered.

Display:

```text
Offline mode
Last updated: [time]
Reconnect to confirm availability and requests.
```

## Performance targets

Target:

- First meaningful screen in under 3 seconds on a mid-range mobile connection.
- Seat map interaction without visible lag.
- Small initial JavaScript bundle.
- Lazy-load admin tools and secondary screens.
- Compress icons and illustrations.
- Avoid heavy 3D rendering.
- Use SVG or CSS geometry for maps.

---

# 15. Mobile UX Requirements

## Bottom navigation

```text
Home
My Journey
Matches
Inbox
Profile
```

## Home screen

Include:

- Add journey.
- Recent journey cards.
- Group invite shortcut.
- Map preview.
- Safety message.
- Sample coach map.

## Seat map screen

Include:

- Train and date header.
- Coach selector.
- Map confidence badge.
- Last updated time.
- Zoom controls.
- Locate my berth.
- Show matches.
- List view.
- Legend.
- Accessible description.

## Berth detail sheet

Include:

- Berth number.
- Visual position.
- Coach and bay.
- Features.
- Current participation state.
- Map confidence.
- Swap action.
- Report incorrect location.

## Accessibility

Required:

- Keyboard navigation.
- Screen-reader labels.
- Focus management.
- Minimum touch target size.
- Color plus icon/text status.
- Reduced-motion support.
- List alternative for every visual map.
- Hindi and English labels.
- High contrast.
- No information conveyed by color alone.

---

# 16. Trust, Privacy, and Moderation

## Verification levels

```text
manual
evidence_checked
operator_verified
```

Never expose uploaded evidence to other travelers.

## Do not expose

- PNR.
- QR code.
- Ticket barcode.
- Aadhaar.
- Passport.
- Full ticket image.
- Phone number.
- Email.
- Public passenger manifest.
- Full legal name by default.

## Safety controls

- Report.
- Block.
- Cancel.
- Expire.
- Rate limit.
- Account suspension.
- Suspicious behavior detection.
- Payment scam warning.
- User-visible safety guidance.
- Admin audit log.

## Structured safety messages

Provide predefined message options:

```text
I can meet near the coach entrance.
I will confirm after boarding.
Please verify with railway staff.
I cannot continue with this request.
I am traveling with a family member.
```

## Moderation rules

Block or review:

- Requests for direct payment.
- Ticket resale offers.
- Repeated spam.
- Harassment.
- Phone-number requests.
- Off-platform payment pressure.
- Threats.
- Impersonation.
- Fake verification claims.

---

# 17. Viral Growth Flywheel

The product should grow through travel groups, not only individual app installs.

## Core flywheel

```text
One traveler creates a journey
→ Invites family or travel group
→ More passengers join the same service
→ More seats and preferences become visible
→ More useful matches appear
→ More successful coordination occurs
→ Users share their journey
→ New travelers join future journeys
→ Matching density improves
```

## Viral loop A: Group invitation

### Trigger

User adds a train journey.

### Prompt

> Traveling with others? Invite your group to see everyone on one coach map.

### Shared link

The link opens a safe landing page showing:

- Train.
- Date.
- Route.
- Group name.
- Number of members, if permitted.

The recipient must sign in before seeing private group details.

### Reward

The group creator receives:

- Group dashboard.
- Group map.
- Member status.
- Reminder controls.
- Free group coordination for a limited group size.

The invited passenger receives:

- One-click journey setup.
- Pre-filled train and date.
- Immediate group context.

## Viral loop B: Better-seat request

A user sees a possible match and sends a request.

The recipient receives:

- A deep link.
- Visual comparison.
- Clear benefit.
- Minimal setup.
- No need to search manually.

The request page should be understandable before signup, but private information must remain protected.

## Viral loop C: Family coordination

Create a family setup flow:

```text
Create family trip
→ Add members
→ Assign or collect berths
→ View all seats
→ Identify distance between members
→ Find possible arrangements
→ Share coordination summary
```

Potential shareable artifact:

> Our family journey map is ready.

Do not share PNRs or private ticket images.

## Viral loop D: Group organizer

Let one organizer manage:

- Wedding groups.
- College trips.
- Tour groups.
- Religious groups.
- Corporate travel.

Organizers invite passengers through WhatsApp. Every passenger joins a real journey, improving marketplace liquidity.

## Viral loop E: Train-specific map pages

Create public pages for supported train and coach layouts:

```text
Train 12951 coach layout
Sleeper berth map
AC 3-tier berth map
How to find berth 42
```

The page should offer:

> Add your journey and see your exact berth.

Do not display current passenger information publicly.

## Viral loop F: Post-journey sharing

After a completed journey, show:

- Journey summary.
- Map used.
- Group coordination result.
- Optional shareable card.

Avoid showing private berth or passenger information in public images.

## Viral loop G: Referral rewards

Use non-cash rewards first:

- Free Group Trip Pass.
- Extra active journey.
- Advanced reminder access.
- Saved preferences.
- Organizer dashboard trial.

Avoid rewarding spam invitations.

## Anti-spam rules

- Limit invitations per journey.
- Detect repeated invalid invites.
- Require authentication after reasonable preview.
- Rate-limit messages.
- Do not send unsolicited SMS or WhatsApp messages.
- Require explicit consent for notifications.
- Allow invite revocation.

---

# 18. Monetization Architecture

## Free tier

Include:

- Journey creation.
- Visual map.
- Basic preferences.
- Basic matching.
- Basic requests.
- Group invitations.
- Report and block.

## Paid Group Trip Pass

Possible features:

- Larger group size.
- Group dashboard.
- Family profiles.
- Advanced alerts.
- Seat-distance visualization.
- Organizer controls.
- Exportable group summary.
- Priority support.

The pass must not promise a successful swap.

## Suggested experiments

Test:

```text
₹19 individual journey add-on
₹29 small family coordination pass
₹49 larger group pass
₹99 monthly frequent traveler plan
₹299 quarterly plan
₹599 annual plan
```

These are experiments, not guaranteed prices.

## B2B plans

Target:

- Tour operators.
- Travel agents.
- Student trip organizers.
- Religious travel organizers.
- Wedding planners.
- Corporate travel coordinators.

Charge the organizer, not every passenger.

## Payment requirements

- Use a licensed Indian payment gateway.
- Support UPI.
- Support cards and net banking.
- Store payment provider references, not sensitive payment data.
- Implement idempotency.
- Implement refunds.
- Keep an immutable payment audit trail.
- Do not create a wallet in the first release.

## Analytics Events

Track product usefulness without collecting unnecessary personal data.

## Acquisition

```text
landing_viewed
install_prompt_shown
pwa_installed
invite_created
invite_opened
invite_accepted
referral_completed
```

## Journey activation

```text
journey_started
train_selected
date_selected
stations_selected
class_selected
coach_entered
berth_entered
layout_viewed
layout_confirmed
preferences_saved
journey_published
```

## Matching

```text
matches_loaded
match_viewed
match_hidden
match_reported
swap_request_created
swap_request_accepted
swap_request_declined
swap_request_expired
swap_request_cancelled
swap_completed
```

## Trust

```text
verification_started
verification_completed
user_reported
user_blocked
layout_error_reported
safety_message_viewed
```

## Monetization

```text
paywall_viewed
checkout_started
payment_succeeded
payment_failed
refund_requested
refund_completed
```

## Important dashboards

Measure separately:

- No other traveler joined.
- No compatible match.
- User did not complete setup.
- User did not understand the map.
- Request was declined.
- Request expired.
- User reported inaccurate layout.

---

# 20. Admin Dashboard

Required before public beta.

## Admin sections

```text
Overview
Users
Journeys
Train services
Layout templates
Layout reports
Swap requests
Moderation
Payments
Feature flags
Notifications
Analytics
Audit logs
```

## Admin actions

- Suspend user.
- Restore user.
- Review report.
- Correct layout.
- Disable layout.
- Mark journey invalid.
- Cancel abusive request.
- Refund payment.
- Update supported train.
- Change confidence status.
- View source and last-reviewed date.
- Export moderation audit.

---

# 21. Security Requirements

## Authentication

- OTP rate limiting.
- Login attempt throttling.
- Session rotation.
- Secure cookies.
- Device/session management.
- Account deletion.

## Authorization

Every private query must check:

```text
current user owns resource
OR current user belongs to authorized group
OR resource is intentionally public
```

Never rely only on hidden UI controls.

## API security

- Request validation.
- Schema validation.
- CSRF protection where relevant.
- Rate limiting.
- Idempotency keys for mutations.
- Audit logs for sensitive actions.
- No secrets in client bundles.
- No ticket evidence in public URLs.

## Data retention

- Delete unnecessary evidence automatically.
- Expire old journey visibility.
- Remove inactive journey data according to retention policy.
- Allow user deletion.
- Keep only the minimum audit data required.

---

# 22. Testing Requirements

## Unit tests

Test:

- Segment overlap.
- Matching score.
- Preference compatibility.
- Request expiry.
- Request state transitions.
- Layout parsing.
- Seat feature detection.
- Time-zone conversion.
- Currency formatting.
- Localization fallback.

## Integration tests

Test:

- Journey creation.
- Layout resolution.
- Match creation.
- Request acceptance.
- Concurrent acceptance.
- Request cancellation.
- Expiry worker.
- Notification worker.
- Permission checks.
- Group invite access.
- Payment idempotency.

## End-to-end tests

Test:

1. New user creates a journey.
2. User selects a coach and berth.
3. User confirms an illustrative layout.
4. User sets preferences.
5. User sees a match.
6. User sends a request.
7. Second user accepts.
8. Both see the accepted state.
9. A competing request is rejected.
10. Request expires.
11. User reports another user.
12. User views journey offline.
13. Offline user cannot falsely confirm a swap.
14. User deletes account.

## Accessibility tests

- Keyboard-only flow.
- Screen-reader seat map.
- List alternative.
- Focus trap in bottom sheets.
- Reduced motion.
- Contrast.
- Hindi interface.
- Touch target validation.

---

# 23. Delivery Milestones

## Milestone 1: Visual prototype

Build:

- PWA shell.
- Home screen.
- Journey setup.
- Sample train data.
- Visual coach maps.
- Berth selection.
- Seat detail sheet.
- Preference selection.
- Swap preview.
- Mobile and desktop responsive layout.

Acceptance criterion:

> A user understands the location and difference between two berths without reading railway abbreviations.

## Milestone 2: Working private beta

Build:

- OTP auth.
- Database.
- Journey records.
- Seat claims.
- Preferences.
- Matching.
- Swap requests.
- Expiry.
- Notifications.
- Reporting.
- Blocking.
- Admin layout management.

Acceptance criterion:

> Two authenticated users can coordinate a possible swap without exposing private booking information or double-committing a berth.

## Milestone 3: Group viral loop

Build:

- Journey invitation.
- Family group.
- Group map.
- WhatsApp-friendly deep links.
- Invite tracking.
- Group dashboard.
- Referral rewards.
- Abuse and rate limits.

Acceptance criterion:

> A user can create a journey and successfully bring multiple travelers into the same journey context.

## Milestone 4: Monetization

Build:

- Group Trip Pass.
- UPI payment.
- Refunds.
- Payment audit.
- Paid feature gates.
- Organizer dashboard.

Acceptance criterion:

> Users understand exactly what they are buying, and no paid feature falsely promises a successful swap.

## Milestone 5: Provider integrations

Build:

- Provider adapter interface.
- Licensed train data integration.
- Layout confidence pipeline.
- Revalidation.
- Service changes.
- Equipment changes.
- Admin override.

Acceptance criterion:

> Uncertain or unsupported train layouts produce an honest fallback—not a fabricated “exact” map.

---

# 24. AI Coding Agent Instructions

The coding agent must follow these rules:

1. Inspect the existing repository before editing.
2. Preserve the current framework if practical.
3. Do not replace working infrastructure without justification.
4. Do not add secrets.
5. Do not add fake API integrations.
6. Use mock providers behind real interfaces.
7. Keep layout data separate from availability.
8. Add tests for all state transitions.
9. Build mobile-first.
10. Make the visual seat map the primary experience.
11. Add accessibility from the first implementation.
12. Use feature flags for incomplete integrations.
13. Use realistic empty states.
14. Never label unknown seats as available.
15. Never claim official railway integration without proof.
16. Never expose private booking data.
17. Add loading, error, offline, and stale-data states.
18. Add analytics events without leaking personal information.
19. Make all mutations idempotent.
20. Explain architectural decisions in the pull request.

## Agent workflow

```text
1. Inspect repository.
2. Identify framework and existing conventions.
3. Run existing tests.
4. Create implementation plan.
5. Build design system foundation.
6. Build sample train data.
7. Build seat-map renderer.
8. Build journey flow.
9. Add backend schema.
10. Add matching engine.
11. Add request state machine.
12. Add group invitation loop.
13. Add moderation.
14. Add PWA support.
15. Add tests.
16. Run lint, typecheck, test, and build.
17. Document setup and known limitations.
```

---

# 25. First Coding Task

The first coding task should be:

> Build a mobile-first train journey demo using local sample data, with a visual Sleeper and AC 3 Tier coach map, berth selection, preference selection, match preview, PWA manifest, offline fallback, and accessible list view.

Do not begin with payments, flights, live railway APIs, or ticket OCR.

## First-task acceptance criteria

- The app loads on a mobile viewport.
- A user can select a sample train.
- A user can select a date.
- A user can select class and coach.
- A coach map renders visually.
- Berths are selectable.
- The user’s berth is visually highlighted.
- Potential swap seats use a separate state.
- Unknown seats are not shown as available.
- Berth detail opens in a mobile bottom sheet.
- A list alternative exists.
- Layout confidence is visible.
- Offline mode displays cached demo data.
- No private or real booking data is included.
- Tests pass.
- Type checking passes.
- Production build passes.

---

# 26. Definition of Done

A feature is complete only when:

- It works on mobile.
- It works on desktop.
- It has loading and error states.
- It has accessible labels.
- It has authorization checks.
- It has validation.
- It has tests.
- It has analytics events where useful.
- It does not expose private data.
- It does not claim unsupported railway functionality.
- It has documentation.
- It passes lint, typecheck, tests, and production build.

---

# 27. Product North Star

The north-star experience is:

> A passenger opens the app, sees their actual berth on a clear coach map, understands what nearby options mean, invites their travel group, finds a compatible passenger, and coordinates a safer and more comfortable arrangement without confusion or false promises.

The business flywheel is:

```text
Useful visual map
→ More journey creation
→ More group invitations
→ More passengers on the same train
→ Better match coverage
→ More successful coordination
→ More sharing and referrals
→ Higher journey density
→ More paid group coordination
→ More organizer adoption
```

Build density, trust, and map accuracy before expanding into more transport modes.

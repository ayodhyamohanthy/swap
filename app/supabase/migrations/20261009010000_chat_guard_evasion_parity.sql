-- =====================================================================
-- SeatSwap migration 7: give the database chat guard the EVASION half.
--
-- THE DEFECT. `check_message_safety()` matched raw text. `lib/chat-guard.ts`
-- matches raw text AND two normalised forms, and the normalisers are the whole
-- defence against someone who is trying:
--
--   squishEvasion()    collapses a run of spaced-out single letters
--                      (`s-e-l-l`, `U P I`) and decodes leet
--                      (`@`->a, `$`->s, `0`->o, `1`->l).
--   digitsFromWords()  rebuilds a number that is spelled out, folding the
--                      spelled digits in among the literal ones
--                      (`nine eight 200 12345` -> `9820012345`).
--
-- Neither had a database counterpart, so `s-e-l-l it to me` and `call nine
-- eight 200 12345` were flagged on the sender's own device and stored with
-- `flagged_risky = false` — and `chat-sync.ts` trusts the ROW for `hidden`, so
-- the receiver never saw the warning. That is a deliberate bypass of the guard,
-- which is a different thing from the accidental formatting leak migration 5
-- fixed: an ordinary user typing their number the normal way versus someone who
-- has worked out what the filter matches.
--
-- MEASURED, NOT READ. `chat-parity-differential.mjs` runs the REAL TS module
-- and the REAL trigger (PGlite = PostgreSQL 18.3) over one corpus and reports
-- divergence BY DIRECTION, because `TS=true/SQL=false` is a hole while
-- `TS=false/SQL=true` merely hides ordinary chat. Counting disagreements ranks
-- those the same; they are not the same. Against the 35-case corpus:
--
--     before migration 5    8 dangerous, 1 over-flag
--     after  migration 5    3 dangerous, 1 over-flag
--     after  this migration 0 dangerous, 0 over-flag
--
-- The three that survived migration 5 were exactly these two normalisers, and
-- the over-flag was the UPI shape below. Grouping the failures by ROOT CAUSE is
-- what turned a list of eight into two changes; eight separate patches would
-- have left the evasion half open, because it never appeared as a phone case.
--
-- WHY INLINED RATHER THAN TWO NEW FUNCTIONS. The TS normalisers are private to
-- their module. Mirroring that here means the trigger is the only caller and
-- the schema gains no public surface; it also keeps the baseline/migration
-- anti-drift pin to a single body. A helper would be easier to unit-test, but
-- there is no unit-test seam in this repo for SQL anyway — the behavioural
-- evidence is the differential above, recorded in docs/DECISIONS.md.
--
-- THE SENTINEL IS THE INTERESTING BIT. `squishEvasion` collapses a separator
-- only when the letter on each side is itself bounded by a non-letter — that is
-- what stops `Meet me near` and `Is Ella coming` from being squashed into
-- keyword soup, and it is the TS run condition
-- `(^|[^A-Za-z]) [A-Za-z] ([\s\-·.•_]+ [A-Za-z])+ (?![A-Za-z])`. Written
-- directly, "start of string" needs a lookbehind of a different width from
-- "non-letter", which Postgres rejects. Wrapping the text in a sentinel turns
-- both ends into an ordinary non-letter, so the lookbehind and lookahead are
-- fixed width and the sentinel is stripped afterwards. `digitsFromWords` needs
-- the same end-of-string handling and gets it from the same lookaround idea,
-- plus the pure-run rule from docs/09: with no digit word present the
-- reconstruction is '' — joining every number in a sentence is what turns a
-- train number plus a berth into a phantom phone.
--
-- THE UPI SHAPE CAME DOWN ONE NOTCH, deliberately. TS wants `{2,}` characters
-- before the `@`; the SQL copy wanted `+`, so `pay a@okaxis` was flagged in the
-- database and not on the device. Over-flagging hides ordinary chat and leaks
-- nothing, so it was the safe direction — but "parity" that only holds in one
-- direction is not parity, and the TS guard is the reviewed spec (it is the one
-- with its own test file). This is the only place in this migration that makes
-- the database guard LESS strict, and it is deliberate.
--
-- STILL NOT PORTED, named rather than left to be discovered: the TS guard
-- lowercases before `digitsFromWords` only; `HINGLISH_WORDS` and `HINDI_WORDS`
-- are still matched against the raw text in both copies, so a spaced-out
-- `b h e j` is caught by neither. That is a real remaining gap, it is the same
-- class as this one, and it is deliberately out of scope here: the differential
-- says these two changes take the measured divergence to zero, and widening the
-- Hinglish/Devanagari matching would be a third topic with its own evidence.
--
-- BASELINE-AND-MIGRATION, like migrations 5 and 6. `schema.part7.sql`,
-- `schema.sql` and `20260925000000_init.sql` carry the same body, because
-- `schema.sql` is what tests/schema.test.ts reads as "the schema" and a
-- superseded copy there is how a fixed guard reads as still broken. The block
-- below is byte-identical to the baseline (asserted in tests/schema.test.ts).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.check_message_safety()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recent int;
  v_squished text;
  v_digits text;
BEGIN
  SELECT count(*) INTO recent FROM public.messages
    WHERE chat_id = NEW.chat_id AND sender_id = NEW.sender_id
      AND created_at > now() - interval '60 seconds';
  IF recent >= 12 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  -- Mirrors lib/chat-guard.ts. This list was a generation behind it: the
  -- English and numeric patterns were here, but the HINGLISH and DEVANAGARI
  -- money verbs were not, so 'bhej do paise' and 'बेच दोगे क्या' passed
  -- flagged_risky = false in the database while the client guard flagged them.
  -- The client is not the enforcement point for another user's device — the
  -- row is what the receiver's screen reads (`chat-sync.ts` trusts
  -- `flagged_risky` for `hidden`), so the database copy has to be at least as
  -- strict as the TypeScript one or the stricter of the two is theatre.
  --
  -- `\y` is the Postgres word boundary (it is ASCII-aware, so the Devanagari
  -- alternatives are plain substrings, exactly as in the TS guard). Every
  -- Devanagari entry is money-specific, never a common word.
  --
  -- The PHONE shape was a second, quieter generation behind. Both copies want a
  -- mobile number, but the TS pattern is `[6-9]\d{4}[\s-]?\d{5}` — a separator
  -- is allowed between the 5th and 6th digit — while this one demanded ten
  -- CONSECUTIVE digits (`[6-9][0-9]{9}`). So `98765 43210`, which is how the
  -- number is written on every form and business card in the country, was
  -- flagged on the sender's device and stored clean. The receiver's screen
  -- reads the row, not the text, so the warning reached nobody who mattered.
  --
  -- `chat-safety-parity.test.ts` compares the two guards' WORD LISTS, and its
  -- own header says it "cannot verify the regex *shapes* (Postgres `\y` vs JS
  -- `\b`, and no lookahead in Postgres) … and leaves shape to review". Shape
  -- was never reviewed, and the excuse was wrong besides: Postgres 18 has
  -- lookahead AND lookbehind, so the TS shapes port verbatim. This line is that
  -- port — it replaces the old two alternatives, and it subsumes them (the
  -- separator is optional, so ten consecutive digits still match).
  --
  -- A third gap was the EVASION MACHINERY, and it is the one an adversary
  -- reaches for on purpose. The TS guard runs two normalisers before matching:
  -- `squishEvasion()` collapses a run of spaced-out single letters (`s-e-l-l`,
  -- `U P I`) and decodes leet (`@`->a, `$`->s, `0`->o, `1`->l);
  -- `digitsFromWords()` rebuilds a number that is spelled out (`nine eight 200
  -- 12345`). Neither had a database counterpart, so `s-e-l-l it to me` and
  -- `call nine eight 200 12345` were flagged on the sender's device and stored
  -- clean — a deliberate bypass, invisible in the row the receiver reads.
  --
  -- v_squished is `squishEvasion()`. A separator collapses only when the letter
  -- on each side is itself bounded by a non-letter, which is the TS run
  -- condition `(^|[^A-Za-z]) [A-Za-z] ([\s\-·•._]+ [A-Za-z])+ (?![A-Za-z])`.
  -- The sentinel is what makes that expressible: it turns start/end of string
  -- into an ordinary non-letter, so the lookbehind and lookahead stay fixed
  -- width. Without the per-letter boundary test a plain "strip separators
  -- between letters" would collapse `Meet me near` into `Meetmenear` and
  -- manufacture keyword matches out of ordinary chat; with it, `Meet me near`,
  -- `Is Ella coming` and `ab c d` come out exactly as written.
  --
  -- v_digits is `digitsFromWords()`. It folds spelled digits in among the
  -- literal ones in order, and yields '' unless a digit word is really there —
  -- the pure-run rule from docs/09, because joining every number in a sentence
  -- turns a train number plus a berth into a phantom phone.
  --
  -- The UPI shape also came down one notch to match: TS wants two characters
  -- before the `@`, this wanted one, so `pay a@okaxis` was flagged here and not
  -- on the device. The TS shape is the reviewed spec.
  v_squished := '[' || NEW.text || ']';
  v_squished := regexp_replace(
    v_squished, '(?<=[^A-Za-z][A-Za-z])[\s\-·•._]+(?=[A-Za-z][^A-Za-z])', '', 'g');
  v_squished := substr(v_squished, 2, length(v_squished) - 2);
  v_squished := translate(v_squished, '@$01', 'asol');

  v_digits := regexp_replace(lower(NEW.text), '(?<![a-z])zero(?![a-z])', '0', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])one(?![a-z])', '1', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])two(?![a-z])', '2', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])three(?![a-z])', '3', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])four(?![a-z])', '4', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])five(?![a-z])', '5', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])six(?![a-z])', '6', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])seven(?![a-z])', '7', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])eight(?![a-z])', '8', 'g');
  v_digits := regexp_replace(v_digits, '(?<![a-z])nine(?![a-z])', '9', 'g');
  v_digits := regexp_replace(v_digits, '[^0-9]', '', 'g');
  IF NEW.text !~* '(^|[^a-z])(zero|one|two|three|four|five|six|seven|eight|nine)([^a-z]|$)' THEN
    v_digits := '';
  END IF;

  IF NEW.text ~* '[a-z0-9._-]{2,}@[a-z]{2,}'
    OR NEW.text ~* '(^|[^0-9])(\+?91[\s-]?)?[6-9][0-9]{4}[\s-]?[0-9]{5}([^0-9]|$)'
    OR v_digits ~ '(^|[^0-9])(\+?91[\s-]?)?[6-9][0-9]{4}[\s-]?[0-9]{5}([^0-9]|$)'
    OR NEW.text ~* '\y(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|bribe|tip\s*(me|us)?|extra\s*(money|cash|charge|fee|payment)|sell|buy|charge\s*(extra|more))\y'
    OR v_squished ~* '\y(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|bribe|tip\s*(me|us)?|extra\s*(money|cash|charge|fee|payment)|sell|buy|charge\s*(extra|more))\y'
    OR NEW.text ~* '\y(khareed|kharid|bech|bhej|paise|paisa|nakad|nagad|nagdi|phone\s*pe)\y'
    OR NEW.text ~ 'नकद|पैसे|पैसा|यूपीआई|यूपीआय|खरीद|बेच|फोन\s*पे'
  THEN
    NEW.flagged_risky := true;
  END IF;
  RETURN NEW;
END $$;

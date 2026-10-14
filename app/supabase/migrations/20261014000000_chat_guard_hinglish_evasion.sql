-- =====================================================================
-- SeatSwap migration 8: squish the HINGLISH list too.
--
-- THE DEFECT, and it is the one migration 7 named and left open. Migration 7
-- gave the database guard the two normalisers (`v_squished`, `v_digits`) but
-- wired them to the ENGLISH list only:
--
--   CASH_WORDS        tested against NEW.text AND v_squished
--   HINGLISH_WORDS    tested against NEW.text alone
--   HINDI_WORDS       tested against NEW.text alone
--
-- `lib/chat-guard.ts` mirrored that asymmetry exactly, so `b h e j`,
-- `p a i s e`, `p@ise` and `b-h-e-j` were called clean by BOTH copies.
--
-- WHY THIS NEEDED ITS OWN EVIDENCE RATHER THAN A LINE IN #7. The differential
-- harness compares the two guards AGAINST EACH OTHER, so a message both of them
-- miss scores as `agree`. Nine cases were agreeing on the wrong answer while
-- the instrument reported perfect health. That is the limit of a differential,
-- and it is now written into the instrument itself: a corpus entry may carry
-- `true` (should flag) or `known` (should flag; a recorded, bounded gap), and
-- the verdict gained a SHARED-BLINDNESS line that no amount of agreement can
-- hide.
--
-- MEASURED, NOT READ. Same instrument, 63-case corpus, the real TS module
-- against the real trigger (PGlite = PostgreSQL 18.3):
--
--     before this migration    9 shared-blind, 0 dangerous, 0 over-flag
--     after  this migration    0 shared-blind, 0 dangerous, 0 over-flag
--
-- The nine were `b h e j it to me`, `p a i s e de do`, `p a i s a de do`,
-- `n a k a d de do`, `k h a r e e d kar lo`, `b e c h do kya`, `p@ise de do`,
-- `n@kad dena`, `b-h-e-j it to me` — five spaced, three leet, one dashed, all
-- of them now caught on both sides.
--
-- WHY IT IS SAFE TO WIDEN. `v_squished` is a superset of `NEW.text` for these
-- words: it differs only by collapsing spaced single-letter runs and decoding
-- leet, and both can only CREATE a match the raw text did not have, never
-- remove one. The mirror-image risk is a manufactured match out of ordinary
-- chat, so the corpus carries three cases that must stay clean — `Meet me near
-- the b h board`, `I will be there`, `phone me later` — and they do, on both
-- sides.
--
-- ONE THING DELIBERATELY NOT FIXED: spaced DEVANAGARI. `v_squished` collapses
-- ASCII letters only — the lookbehind and lookahead are [A-Za-z] — so it cannot
-- reach `प ै स े` even if asked, and the HINDI list therefore stays raw-only in
-- both copies. That is a bounded gap, not an oversight: a Hindi speaker evading
-- writes Latin transliteration, which the HINGLISH list now covers, and
-- `प ै स े` orphans the matras. Widening the letter class to [[:alpha:]] would
-- make the SQL and JS squishers differ by LOCALE — trading a theoretical gap
-- for a real divergence, which is the exact defect class this pair of
-- migrations exists to remove. The harness carries the case marked `known`, so
-- it is reported on every run rather than living in a comment.
--
-- BASELINE-AND-MIGRATION, like migrations 5, 6 and 7. `schema.part7.sql`,
-- `schema.sql` and `20260925000000_init.sql` carry the same body, because
-- `schema.sql` is what tests/schema.test.ts reads as "the schema", and a
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
  --
  -- A FOURTH gap, found 2026-10-14 and fixed here and in the TS guard in the
  -- same change: the normalisers above were wired to the ENGLISH list only.
  -- CASH_WORDS was tested against both NEW.text and v_squished, but HINGLISH
  -- was tested against NEW.text alone — so every Hinglish evasion (`b h e j`,
  -- `p a i s e`, `p@ise`, `b-h-e-j`) was stored flagged_risky = false while
  -- ALSO being called clean by the client guard, and the differential reported
  -- them as AGREEING. That is the failure mode a differential cannot see by
  -- itself: agreement is not correctness, and nine cases were agreeing on the
  -- wrong answer. Measured before the fix: 9 shared-blind, 0 dangerous.
  -- v_squished is a superset of the raw text for these words, so testing the
  -- HINGLISH list against it can only ADD matches, never remove one.
  --
  -- The Devanagari list stays raw-ONLY, and that is a bounded decision rather
  -- than an oversight. v_squished collapses ASCII letters only — the lookbehind
  -- and lookahead are [A-Za-z] — so it cannot squish a spaced Devanagari run
  -- even if asked to. A Hindi speaker evading writes Latin transliteration,
  -- which the HINGLISH list covers; `प ै स े` orphans the matras and nobody
  -- types it. Widening the class to [[:alpha:]] would make the SQL and JS
  -- squishers differ by LOCALE, i.e. trade a theoretical gap for a real
  -- divergence. chat-parity-differential.mjs carries the case marked `known`,
  -- so the gap is reported on every run instead of living in this comment.
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
    OR v_squished ~* '\y(khareed|kharid|bech|bhej|paise|paisa|nakad|nagad|nagdi|phone\s*pe)\y'
    OR NEW.text ~ 'नकद|पैसे|पैसा|यूपीआई|यूपीआय|खरीद|बेच|फोन\s*पे'
  THEN
    NEW.flagged_risky := true;
  END IF;
  RETURN NEW;
END $$;

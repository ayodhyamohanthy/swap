-- 20261006020000_chat_guard_phone_parity.sql
--
-- The database chat guard stored a phone number clean. This is migration #5,
-- and it is the first migration in this repo that MODIFIES an object the init
-- migration already defined rather than adding a new one — so the reasoning is
-- written down here rather than left to be re-derived.
--
-- WHAT WAS WRONG
-- --------------
-- `check_message_safety()` flags a row `flagged_risky`, and the receiver's
-- screen trusts that flag (`chat-sync.ts` reads it for `hidden`). The sender's
-- device runs the TypeScript guard in `lib/chat-guard.ts`, but that is not the
-- enforcement point: a sender can post straight to PostgREST, and more to the
-- point the WARNING the receiver sees is driven by the stored column. So the
-- SQL copy has to be at least as strict as the TS one.
--
-- It was not. Both wanted a mobile number; the shapes disagreed:
--
--   TS  : /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/   separator allowed mid-number
--   SQL : '(^|[^0-9])\+?91[\s-]?[6-9][0-9]{9}...'   ten CONSECUTIVE digits
--
-- `98765 43210` is five digits, a space, five digits. The TS guard flagged it;
-- the SQL guard did not. That grouping is not an exotic evasion — it is how an
-- Indian mobile number is written on every form and business card in the
-- country. Measured against a real Postgres 18.3, eight inputs diverged in the
-- dangerous direction (TS flags, row stored clean), seven of them this shape:
--
--   98765 43210 · 98765-43210 · +91 98765 43210 · 0 98765 43210 ·
--   91 98765 43210 · and the spelled-out and separator-squished forms below
--
-- WHY A BASELINE EDIT *AND* A MIGRATION (the new precedent)
-- --------------------------------------------------------
-- Migrations #2–#4 each ADDED an object, so the baseline (`schema.part*.sql` →
-- `schema.sql` → `init.sql`, one schema kept byte-identical three ways) could
-- stay frozen at the init state and the migration was the whole story.
--
-- This one MODIFIES an object the baseline already defines, and that changes
-- the answer, because `tests/chat-safety-parity.test.ts` reads the BASELINE
-- `schema.sql` to assert the guard's content. A migration-only fix would leave
-- that test green while it read a superseded copy of the function — a test
-- guarding something that is not what runs, which is the same failure class
-- this whole change is about. The baseline is therefore updated too, so the
-- file that test reads stays truthful, and this migration carries the same
-- body forward to databases that already ran init.
--
-- The body below is byte-identical to the baseline's, and
-- `tests/schema.test.ts` pins the two together. If you change one, the test
-- fails until you change the other. That is deliberate: the only reason this
-- defect existed is that two copies of one rule were allowed to differ
-- silently.
--
-- STILL OPEN (named, not hidden)
-- ------------------------------
-- The TS guard has two pieces of machinery this copy still lacks, so the gap is
-- narrowed, not closed:
--   * `squishEvasion()` — collapses single-letter runs so `s-e-l-l` reads as
--     `sell`. Divergence measured: `s-e-l-l it to me` (TS flags, SQL stores
--     clean).
--   * `digitsFromWords()` — rebuilds a number spelled out as words.
--     Divergence measured: `nine eight seven six five four three two one zero`
--     and `nine eight 200 12345`.
-- Both are portable: Postgres 18 supports lookahead and lookbehind, so the TS
-- regexes run verbatim (verified). They are not in this migration because they
-- are a different topic from the phone shape, and one topic per commit.

CREATE OR REPLACE FUNCTION public.check_message_safety()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recent int;
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
  IF NEW.text ~* '[a-z0-9._-]+@[a-z]+'
    OR NEW.text ~* '(^|[^0-9])(\+?91[\s-]?)?[6-9][0-9]{4}[\s-]?[0-9]{5}([^0-9]|$)'
    OR NEW.text ~* '\y(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|bribe|tip\s*(me|us)?|extra\s*(money|cash|charge|fee|payment)|sell|buy|charge\s*(extra|more))\y'
    OR NEW.text ~* '\y(khareed|kharid|bech|bhej|paise|paisa|nakad|nagad|nagdi|phone\s*pe)\y'
    OR NEW.text ~ 'नकद|पैसे|पैसा|यूपीआई|यूपीआय|खरीद|बेच|फोन\s*पे'
  THEN
    NEW.flagged_risky := true;
  END IF;
  RETURN NEW;
END $$;

-- `CREATE OR REPLACE FUNCTION` is enough for a database that already has the
-- trigger, since the trigger binds the function by name and its definition is
-- unchanged. Re-creating it anyway keeps this migration self-contained: it is
-- correct on a database where the trigger was dropped, and it cannot leave the
-- new body unreferenced.
DROP TRIGGER IF EXISTS messages_safety_guard ON public.messages;
CREATE TRIGGER messages_safety_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.check_message_safety();

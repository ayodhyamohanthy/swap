#!/usr/bin/env zsh
# Mutation check for the payments_target fix: plant one defect at a time, run the
# suite, and record whether a test caught it. Restores every file afterwards.
set -u
cd "$(dirname "$0")/.." || exit 1

STORE=src/lib/store.ts
ADMIN=src/lib/admin.ts
CHECKOUT=src/lib/checkout.ts
SERVER=src/server/payments.ts
HOOK=src/lib/use-store.ts
RECEIPT='src/routes/profile.payments.$id.tsx'
ROUTE=src/routes/admin.payments.tsx

FILES=("$STORE" "$ADMIN" "$CHECKOUT" "$SERVER" "$HOOK" "$RECEIPT" "$ROUTE")
BK=/tmp/mutate-payments-target
mkdir -p "$BK"

restore() {
  local f
  for f in $FILES; do cp "$BK/$(basename "$f")" "$f"; done
}
for f in $FILES; do cp "$f" "$BK/$(basename "$f")"; done
trap restore EXIT INT TERM

# run <name> <file> <sed-expr>
run() {
  local name="$1" file="$2" expr="$3"
  restore
  if ! sed -i '' "$expr" "$file" 2>/dev/null; then
    echo "PLANT-FAILED  $name (sed error)"; return
  fi
  local changed=0 f
  for f in $FILES; do cmp -s "$BK/$(basename "$f")" "$f" || changed=1; done
  if [[ $changed -eq 0 ]]; then
    echo "PLANT-FAILED  $name (nothing changed — the check would be vacuous)"; return
  fi

  local log="/tmp/mutate-payments-target/run.log"
  npx vitest run --maxWorkers=2 >"$log" 2>&1
  # The runner itself has to have worked, or "no failures" means "no tests ran".
  # `--reporter=basic` silently exited non-zero with zero tests once already, and
  # every mutation below read as MISSED. A missing summary line is never a pass.
  if ! rg -q 'Test Files +[0-9]+ (passed|failed)' "$log"; then
    echo "RUNNER-BROKEN $name  (vitest produced no summary — this is not a result)"; return
  fi
  if ! rg -q 'Tests +[0-9]+ failed' "$log"; then
    echo "MISSED        $name  (suite stayed green)"
    return
  fi
  local summary culprits
  summary=$(rg -o 'Tests +[0-9]+ failed' "$log" | head -1)
  culprits=$(rg -o 'FAIL +tests/[a-z0-9.-]+\.test\.ts' "$log" | sed 's/FAIL *//' | sort -u | tr '\n' ' ')
  echo "caught        $name  [${summary}]  by: ${culprits:-<none listed>}"
}

echo "== mutations =="

# 1. The original defect: the lookup reads one column only.
run 'paymentTargets ignores group_id' "$STORE" \
  's|return payment.request_id === targetId \|\| payment.group_id === targetId|return payment.request_id === targetId|'

# 2. The hook keeps its own copy instead of delegating to the one rule.
run 'usePaymentFor filters request_id only' "$HOOK" \
  's|return pickPaymentFor(useAppState().payments, targetId)|return useAppState().payments.find((r) => r.request_id === targetId)|'

# 3. Load-time migration removed: a pre-fix row keeps a group id in request_id.
run 'normalisePayment stops moving grp_ ids' "$STORE" \
  's|if (groupId === null \&\& requestId !== null \&\& isGroupRequestId(requestId)) {|if (requestId !== null) {|'

# 4. The runtime XOR is gone. Types still refuse both-or-neither; storage no
#    longer does, so only a runtime test can see this.
run 'paymentTargetOf XOR throw removed' "$STORE" \
  's|if ((requestId === null) === (groupId === null)) throw new StoreError|if (requestId === null \&\& groupId === null \&\& false) throw new StoreError|'

# 5. Checkout puts the group id back into request_id.
run 'beginGroupCheckout writes request_id again' "$CHECKOUT" \
  's|^      group_id: groupId,$|      request_id: groupId,|'

# 6. The receipt screen guesses from the id shape again — which is wrong for a
#    server group trip, because those ids are uuids.
run 'receipt reads the id shape, not group_id' "$RECEIPT" \
  's|const isGroup = payment.group_id !== null|const isGroup = String(payment.request_id ?? "").startsWith("grp_")|'

# 7. Admin to_credit lookup is fed the group id again: a ₹199 filed as a refund.
run 'paymentOutcome matches either column' "$ADMIN" \
  's|if (base === .paid. \&\& requestId !== null \&\& toCreditRequestIds.has(requestId)) return .to_credit.|if (base === "paid" \&\& toCreditRequestIds.has(String(requestId ?? payment.group_id))) return "to_credit"|'

# 8. The swap column renders a bare hash for a row with no target.
run 'paymentRows falls back to shortId of empty' "$ADMIN" \
  "s|swap: targetId ? shortId(targetId) : '—',|swap: shortId(targetId ?? ''),|"

# 9. The server credit hold points at the group id again.
run 'server wallet hold uses requestId' "$SERVER" \
  's|ref_request_id: target.request_id, expires_at: null,|ref_request_id: requestId, expires_at: null,|'

# 10. The admin route prints the request column instead of the target.
run 'admin route shows row.request_id' "$ROUTE" \
  "s|{shortId(row.target_id ?? '')}|{shortId(row.request_id ?? '')}|"

echo "== restoring =="
restore
for f in $FILES; do cp "$f" "$BK/$(basename "$f")"; done
if npx tsc --noEmit >/dev/null 2>&1; then echo "typecheck clean after restore"; else echo "TYPECHECK BROKEN after restore"; fi
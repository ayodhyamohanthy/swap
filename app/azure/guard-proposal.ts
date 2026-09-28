/* SeatSwap Azure-tuned guard proposal — EVAL ONLY, not wired into runtime.
 * Local eval: h04 "meri seat khareed lo" is a FN on the shipped regex.
 * Candidate tokens: khareed|kharid|paise|paisa|nakad|nagad.
 * Risk: "paise/paisa" false-positives on legit "kitne paise". Needs the
 * full corpus + Azure Content Safety comparison before touching
 * src/lib/chat-guard.ts (hot file, another agent editing). */
export const CANDIDATE_TOKENS = ['khareed', 'kharid', 'paise', 'paisa', 'nakad', 'nagad'] as const
export function candidateGuardExtra(text: unknown): string[] {
  const v = String(text ?? '').toLowerCase()
  return CANDIDATE_TOKENS.filter((t) => v.includes(t))
}

# Budget guardrails — $200 Azure credits, exp Dec 16 2026
- Subscription: `seatswap-credits`. RG: `seatswap-exp-dec16`.
- Budget $200, alerts 50/80/100%. Owner deletes RG by Dec 10 2026.
- No prod secrets in Azure. Only test keys.
- Expected burn: Translator ~$5, Safety eval <$30, Load test ~$20-40.
```bash
az account create-budget --help
az group create -n seatswap-exp-dec16 -l centralindia
az consumption budget create --budget-name seatswap-dec16 \
  --amount 200 --time-grain monthly --start-date 2026-09-28 --end-date 2026-12-16
az group delete -n seatswap-exp-dec16 --yes
```

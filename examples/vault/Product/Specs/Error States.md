---
tags: [spec, copy, checkout]
---
# Error States

Declined card copy and recovery paths for checkout.

| Code | Message | Recovery |
| --- | --- | --- |
| insufficient_funds | "Your card was declined. Try another card or payment method." | Show [[Payment Methods]] |
| expired_card | "This card has expired." | Focus expiry field |
| network | "We couldn't reach your bank. Nothing was charged." | Retry button |

Tone: calm, specific, never blame the user. ==Never say "invalid".==

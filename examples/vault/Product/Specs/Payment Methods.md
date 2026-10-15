---
tags: [spec, checkout, payments]
status: draft
---
# Payment Methods

Order of methods on the payment step, decided by device and locale.

## Rules
- Apple Pay first on iOS/Safari, Google Pay first on Android/Chrome
- Cards always available; PayPal only in US/UK/DE
- Remember last used method per account (see [[Checkout Redesign]])

## Copy
- Title: "How would you like to pay?"
- Helper: "You won't be charged until you confirm."

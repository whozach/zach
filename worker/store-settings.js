/**
 * Crypto Client store: Zach's answers. This file is the ONLY place to set them,
 * one line each. Change a line, run the tests (tests/store-unit.mjs checks the
 * address formats), then deploy. Nothing else needs editing.
 */

// Support contact. Shown on /client/buy ("Questions or a payment problem: ...") and in the
// expired-order text. An email, a https:// link, or plain text like "Discord: name". "" hides it.
export const SUPPORT_CONTACT = "support@haunted.ong";

// Where sales are paid. PUBLIC receiving addresses only: never a seed, private key or xpub.
export const SALES_ADDRESSES = {
  bitcoin: "bc1qnhxzzgv7wg8cfkhmuwydgrgzmfycn67cmccfse",   // native segwit, must start with bc1q
  solana: "4nfyHLEDszwxTgxUAz1B5t8U5ZagXxrkg59wuwrgkMrA",  // SOL and USDC on Solana (USDC goes to this wallet's token account)
  ethereum: "0xd7ee3e4725967b353ba60334cf14679ed2f7df5e", // Ethereum mainnet only: ETH and USDC
};

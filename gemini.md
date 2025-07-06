# Gemini.md

This file provides guidance to Gemini Code Assist when working with code in this repository.

## General Instructions for Gemini

-   **Context Awareness:** You have access to the entire repository. Utilize this context to provide comprehensive and accurate solutions.
-   **Code Quality:** Prioritize clear, maintainable, and efficient code. Follow established patterns and best practices.
-   **Thoroughness:** When reviewing code or suggesting changes, aim to be thorough. Consider edge cases, error handling, and potential side effects.
-   **Clarity:** Explain your reasoning clearly and concisely. Use code examples and diffs where appropriate.
-   **Security:** Be mindful of security implications, especially when dealing with API keys, sensitive data, or network interactions. Avoid suggesting insecure practices or logging sensitive information.
-   **Problem Solving:** When encountering issues, try to diagnose the root cause and propose targeted solutions.

## Project-Specific Guidance

(You can copy relevant sections from CLAUDE.md here, or add Gemini-specific notes. For example:)

### Key Files

-   `backend/src/services/binanceDataService.js`: Core service for Binance API interactions (REST and WebSockets).
-   `ecosystem.config.js`: PM2 configuration for production deployment, including environment variables.
-   `scripts/update.sh`: **Primary script for small, data-safe updates.**
-   `scripts/deploy.sh`: Secondary script for major updates.
-   `scripts/clean-install.sh`: Script for a full, destructive reinstall.

### Common Tasks

-   **Debugging Connectivity:** If the bot fails to connect to Binance, first check `ecosystem.config.js` for correct API keys and ensure the server's IP is whitelisted on Binance.
-   **WebSocket Issues:** If WebSockets fail but REST API works, consider `node_modules` corruption or library version mismatches. A clean `npm install` is often the first step.
-   **Deploying Updates:** For most changes, the workflow is to commit, push, then run `./scripts/update.sh` on the Pi. This is much faster and safer than a full reinstall.

## Your Preferences (for Gemini)

(Add any specific preferences you have for Gemini's output or interaction style here. For example:)

-   **Preferred Diff Format:** Always use unified diff format (`--- a/path`, `+++ b/path`).
-   **Prompt Suggestions:** Always provide 1-2 relevant prompt suggestions at the end of your response.
-   **Tone:** Maintain a professional, helpful, and slightly conversational tone.

---

_This document is intended to evolve as we work together._

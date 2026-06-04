# Privacy Policy for Password Book

**Last updated: 2026-06-04**

## Overview

Password Book is a self-hosted, end-to-end encrypted password manager. We are committed to protecting your privacy and ensuring the security of your data.

## Data Collection

**Password Book does NOT collect, transmit, or store any of your data on third-party servers.**

All data processing happens in one of two places:

1. **Your device (local)**: All passwords, passkeys, notes, and other vault data are encrypted on your device using AES-256-GCM before they ever leave your browser. The decryption key is derived from your master password and never sent to any server.

2. **Your own server**: Encrypted vault data is stored on a server that you deploy and control. The server only stores encrypted ciphertext — it has zero ability to decrypt your data.

## Data We Do NOT Collect

- Your master password (never leaves your device)
- Your vault contents in plain text
- Your browsing history
- Your IP address or location
- Any analytics or telemetry data
- Any personal identifiable information beyond the email address you provide for login

## Temporary Data in Browser Extension

During normal operation, the extension temporarily stores the following in your browser's local storage:

- **Encrypted vault data (chrome.storage.local)**: Your password ciphertext is cached locally for offline access. This data is encrypted with keys derived from your master password.
- **Decryption key (chrome.storage.session)**: The session key is held in ephemeral session storage and is automatically destroyed when the browser closes.
- **Form submission data (in-memory)**: When you submit a login form, the username and password are temporarily held in memory (maximum 10 seconds) solely to present a "save credential" prompt. This data is never written to disk.

## Data Transmission

All communication between the browser extension and your self-hosted server uses HTTPS (or localhost for development). The extension does not communicate with any third-party servers.

## Third-Party Services

Password Book does not integrate with or send data to any third-party analytics, advertising, or tracking services.

## Your Rights

Since all your data is stored on your own server and encrypted with keys only you possess, you have full control over your data at all times. You can delete all data by stopping your server and removing the database file.

## Contact

This project is maintained at [github.com/weixin91/pw-book](https://github.com/weixin91/pw-book). For privacy concerns, please open an issue on the repository.

## Changes to This Policy

Any changes to this policy will be reflected in the project repository's commit history.

# PayPilot AI

**AI-assisted payment workflows and payment-risk defense using PayPal Sandbox.**

PayPilot AI is a hackathon prototype exploring safer payment operations through a web dashboard, a FastAPI backend, and PayPal Sandbox integration. Its focus is to make payment activity easier to inspect while applying safeguards around order approval, capture, and status updates.

> **Project status:** Working prototype. Payment testing is intended for PayPal Sandbox only. AI-powered fraud analysis and other planned capabilities should be treated as roadmap items unless explicitly implemented in the current code.

## Highlights

- **Payment dashboard:** Web interface for interacting with the payment backend.
- **PayPal Sandbox integration:** Create and look up test payment orders.
- **Payment safety controls:** Automated tests cover unapproved orders, duplicate capture prevention, status refresh, and invalid order data.
- **Status synchronization:** Refresh and save the latest payment status from PayPal.
- **Python API:** FastAPI backend with interactive API documentation.
- **Developer workflow:** React, Vite, ESLint, and pytest.

## Architecture

```text
Browser
  |
  v
React + Vite dashboard
  |
  v
FastAPI backend (localhost:8000)
  |
  +---- PayPal Sandbox API
  |
  +---- Local SQLite database
```

The local database stores application payment records. It is deliberately excluded from version control.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, JavaScript, CSS |
| Backend | Python, FastAPI |
| Payments | PayPal REST API — Sandbox |
| Local persistence | SQLite |
| Testing | pytest |
| Frontend quality | ESLint, Vite production build |

## Getting Started

### Prerequisites

- Windows PowerShell
- Python and a virtual environment
- Node.js and npm
- PayPal Developer Sandbox credentials

### 1. Clone the repository

```powershell
git clone https://github.com/madriq/paypilot-ai.git
Set-Location .\paypilot-ai
```

### 2. Configure the backend

```powershell
Set-Location .\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend\.env` locally and add your own PayPal Sandbox credentials using the variable names defined in `.env.example`. Keep the client secret private. Never commit `.env`.

### 3. Start the backend

From the `backend` directory, with the virtual environment activated:

```powershell
uvicorn app.main:app --reload --port 8000
```

Backend API documentation:

http://127.0.0.1:8000/docs

### 4. Start the frontend

Open a second PowerShell window:

```powershell
Set-Location "C:\Users\Mohamad Azriq Azidin\paypilot-ai\backend\frontend"
npm ci
npm run dev
```

Open the local URL printed by Vite in the terminal. The current development setup has used port `5174`, but use the URL Vite actually reports.

## Run the Tests

In a PowerShell window with the backend virtual environment activated:

```powershell
Set-Location "C:\Users\Mohamad Azriq Azidin\paypilot-ai\backend"
python -m pytest .\tests\test_payment_safety.py -v
```

The current payment safety suite contains seven tests covering:

1. Unapproved orders are not captured.
2. Completed orders are not captured again.
3. Approved orders can be captured and their status saved.
4. Status refresh saves the latest PayPal status.
5. Invalid order IDs are rejected before contacting PayPal.
6. Missing status does not trigger capture.
7. Missing PayPal order IDs are rejected.

Build and lint the frontend:

```powershell
Set-Location .\frontend
npm run build
npm run lint
```

## Payment Safety

- Use PayPal Sandbox credentials and test accounts only.
- Do not enter real payment details or use live payment credentials for development.
- Do not repeat a capture for an order that is already completed.
- Treat pending or uncertain payment states carefully; verify the current status before taking further action.
- Never commit `.env`, local database files, or credentials.
- The automated tests validate selected safety behaviours; they do not guarantee production readiness.

## Repository Structure

```text
paypilot-ai/
├── .gitignore
└── backend/
    ├── .env.example
    ├── requirements.txt
    ├── app/
    │   ├── config.py
    │   ├── database.py
    │   ├── main.py
    │   └── paypal_client.py
    ├── frontend/
    │   ├── package.json
    │   └── src/
    │       ├── App.jsx
    │       ├── App.css
    │       └── main.jsx
    └── tests/
        └── test_payment_safety.py
```

## Roadmap

- Improve payment status refresh and error handling.
- Expand automated payment safety tests.
- Improve observability and audit-friendly payment events.
- Evaluate AI-assisted risk explanations with clear evidence and human oversight.
- Add screenshots and a recorded demo after validating the complete Sandbox flow.

## Hackathon Project

PayPilot AI explores how payment integrations, defensive workflow design, and AI-assisted risk analysis can work together in a developer-friendly prototype.

**Repository:** https://github.com/madriq/paypilot-ai

**Disclaimer:** This is a development prototype, not a certified payment system or financial advice. Do not use it to process real payments.

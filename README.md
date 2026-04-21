# Smart Diary — Emotion Classification Backend

A minimal Express server that classifies journal entry text into one of seven emotion labels using a locally-running Gemma 2 2B model via Ollama.

---

## Architecture

```
Frontend (Vercel)
    |
    | POST /classify  { text }
    |
Cloudflare Tunnel (public HTTPS URL)
    |
    v
Express Server  :3007  (this server, running on your local laptop)
    |
    | POST /api/generate  { model, prompt, stream: false }
    |
    v
Ollama  :11434  (local AI runtime)
    |
    v
gemma2:2b  (local LLM model)
```

---

## Prerequisites

- Node.js v18 or higher
- Windows 10/11 laptop with at least 8 GB RAM
- Ollama installed (see below)
- Cloudflare account (free tier is sufficient)

---

## Step 1 — Install Node dependencies

```bash
cd backend
npm install
```

---

## Step 2 — Install Ollama on Windows

1. Download the Ollama installer from: [https://ollama.com/download/windows](https://ollama.com/download/windows)
2. Run the `.exe` installer and follow the prompts.
3. After installation, verify it works:

```bash
ollama --version
```

---

## Step 3 — Pull the Gemma 2 2B model

```bash
ollama pull gemma2:2b
```

This downloads approximately 1.6 GB. Wait for it to complete before starting the backend.

Verify the model is available:

```bash
ollama list
```

You should see `gemma2:2b` in the list.

---

## Step 4 — Start the Ollama server on port 11435

**CRITICAL SETUP STEPS:**

### A. Kill any existing Ollama processes

```powershell
taskkill /F /IM ollama.exe /T
```

### B. Open PowerShell and set environment variable

**IMPORTANT:** Use PowerShell (not CMD). The syntax is different!

```powershell
$env:OLLAMA_HOST="127.0.0.1:11435"
ollama serve
```

You should see:

```
time=... level=INFO msg="Listening on 127.0.0.1:11435"
```

**If you see 11434, you used the wrong syntax!** Use `$env:` not `set`.

### C. Verify the model is installed

Open a NEW PowerShell window and run:

```powershell
$env:OLLAMA_HOST="127.0.0.1:11435"
ollama list
```

Should show `gemma2:2b`. If empty, pull it:

```powershell
$env:OLLAMA_HOST="127.0.0.1:11435"
ollama pull gemma2:2b
```

Leave the Ollama server terminal open while using the app.

---

## Step 5 — Start the Express server

Open a second terminal:

```bash
cd backend
npm start
```

You should see:

```
[server] Smart Diary backend running on http://localhost:3007
[server] Expecting Ollama at http://localhost:11435 with model: gemma2:2b
[server] Routes: GET /health  |  POST /classify
```

Test it is working:

```bash
curl http://localhost:3007/health
# Expected: {"status":"ok","model":"gemma2:2b"}
```

---

## Step 6 — Expose the server with Cloudflare Tunnel

Cloudflare Tunnel creates a public HTTPS URL that forwards traffic to your local server. No port-forwarding or static IP required.

### Install cloudflared (one-time setup)

Download the latest Windows binary from:  
[https://github.com/cloudflare/cloudflared/releases/latest](https://github.com/cloudflare/cloudflared/releases/latest)

Download `cloudflared-windows-amd64.exe`, rename it to `cloudflared.exe`, and place it somewhere in your PATH (e.g. `C:\Windows\System32\`).

### Start the tunnel

Open a third terminal:

```bash
cloudflared tunnel --url http://localhost:3007
```

Cloudflare will print a URL like:

```
https://random-words-here.trycloudflare.com
```

Copy that URL.

> Note: This is a temporary tunnel. The URL changes every time you restart `cloudflared`. For a persistent URL you need a paid Cloudflare account and a named tunnel.

---

## Step 7 — Set the environment variable in the frontend

Open `frontend/.env.local` and paste the tunnel URL:

```
VITE_EMOTION_API_URL=https://random-words-here.trycloudflare.com
```

If you are deploying to Vercel, add `VITE_EMOTION_API_URL` as an environment variable in the Vercel project settings with the same tunnel URL.

> Remember: Every time you restart `cloudflared`, you get a new URL and must update this variable.

---

## API Reference

### GET /health

Liveness probe. Returns:

```json
{ "status": "ok", "model": "gemma2:2b" }
```

### POST /classify

Classifies the dominant emotion of a text string.

**Request body:**

```json
{ "text": "I felt really overwhelmed today and couldn't stop thinking about everything that went wrong." }
```

**Response:**

```json
{ "emotion": "sadness", "confidence": 0.88 }
```

**Emotion labels:** `joy` | `sadness` | `anger` | `fear` | `disgust` | `surprise` | `neutral`

**Error response (Ollama unreachable):**

```json
{ "error": "Ollama connection failed: ...", "hint": "Start Ollama with: ollama serve" }
```

---

## Troubleshooting


| Symptom                    | Fix                                                                             |
| -------------------------- | ------------------------------------------------------------------------------- |
| `Ollama connection failed` | Run `ollama serve` in a separate terminal                                       |
| `model not found`          | Run `ollama pull gemma2:2b`                                                     |
| `Cannot classify emotion`  | Ensure the text is at least a few words long                                    |
| Tunnel URL not working     | Restart `cloudflared tunnel --url http://localhost:3007` and update the env var |
| Server crashes             | Check Node.js version is v18+ with `node --version`                             |



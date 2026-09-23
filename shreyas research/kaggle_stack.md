# 📊 Cloud GPU Proposal Alternative: Kaggle Notebooks

**Overview:**
As suggested by the team, Kaggle provides a viable, completely free alternative to Paperspace. By leveraging Kaggle Notebooks, we can access cloud GPUs (like NVIDIA T4x2 or P100) at zero cost. However, there are significant trade-offs regarding persistence, network access, and developer experience.

---

### 💰 Pricing & Hackathon Budget
*   **Cost:** **$0.00** 
*   **GPU Options:** NVIDIA T4 (x2), P100.
*   **Quota Limits:** 30 hours of free GPU access per week.
*   **Session Limits:** Maximum 12 hours per continuous session.

---

### ✅ Why Kaggle is a Great Option (Pros)
1.  **Completely Free:** No credit cards required, zero risk of accidentally running up a bill (unlike the "Storage Trap" in Paperspace).
2.  **Instant Setup:** Data science libraries (PyTorch, TensorFlow, Pandas) are already installed. You can literally click "New Notebook" and start training in 10 seconds.
3.  **Dataset Integration:** If our hackathon project relies on public datasets, Kaggle has them readily available and easily importable directly into the environment.

---

### ⚠️ The Catches We Must Watch Out For (Cons)
1.  **Not a Real Backend Server:** Kaggle is designed for interactive data science, not for hosting APIs. 
    *   **The Hack:** To use it as a backend for our Flutter/React app, we would have to run FastAPI/Flask inside the notebook and use `ngrok` (or `localtunnel`) to expose it to the internet.
2.  **Session Timeouts & Instability:** 
    *   If the browser tab is closed or idle for 40-60 minutes, the session will die, killing our API. 
    *   We cannot leave it running overnight reliably to serve a backend.
3.  **No SSH or VSCode Support:** We cannot SSH into a Kaggle Notebook or use VSCode Remote. All coding must be done in their browser-based Jupyter-like interface, which slows down complex multi-file project development.
4.  **No Persistent File System (Beyond Commits):** Unlike Paperspace where we get a persistent Linux drive, Kaggle resets its environment when the session ends. Any weights or files generated must be downloaded or committed as an output dataset.

---

### 🎯 The Verdict: Kaggle vs. Paperspace

| Feature | Kaggle Notebooks | Paperspace (Core/VM) |
| :--- | :--- | :--- |
| **Cost** | Free (30 hrs/wk limit) | ~$1.38 - $1.89 / hr |
| **Use Case** | Prototyping, Model Training | Production Backend, API Hosting |
| **API Hosting** | Hacky (`ngrok` required) | Native (Public IP / Domain mapping) |
| **Dev Environment** | Browser-only (Jupyter) | Full SSH, VSCode Remote |
| **Persistence** | Session-based (resets) | Full Persistent Linux Disk |

**Recommendation for the Team:**
*   **Phase 1 (Model Training):** Use **Kaggle** to prototype, experiment, and train our models for free. 
*   **Phase 2 (Deployment/Demo):** If we need a stable backend API that our frontend can reliably talk to during the demo (without dropping connection every 45 mins), we should switch to **Paperspace** for the final 5-10 hours of the hackathon. 

---

# 🛠️ Kaggle Backend Implementation Guide (Zero-Cost Hackathon Stack)

Since the team is committing to a **$0 budget** and using Kaggle exclusively, this document outlines exactly how to set it up as a backend API and the potential landmines you need to navigate during the hackathon.

---

## 🚀 How to Host an API on Kaggle (Step-by-Step)

Because Kaggle is just a Jupyter environment, it does not expose standard open ports to the internet. We have to create a "tunnel" to route traffic from your frontend application to the Kaggle notebook.

### 1. The Stack
*   **Web Framework:** `FastAPI` (Very fast, modern, easy to use)
*   **Server:** `uvicorn` (ASGI server for FastAPI)
*   **Tunneling Service:** `ngrok` (Exposes your local server to a public URL)
*   **Asynchronous Patch:** `nest_asyncio` (Required to run uvicorn inside Jupyter)

### 2. The Code (Run this in a Kaggle Notebook Cell)

```python
# Cell 1: Install dependencies
!pip install fastapi uvicorn pyngrok nest_asyncio
```

```python
# Cell 2: Run the API Server
from fastapi import FastAPI
import uvicorn
from pyngrok import ngrok
import nest_asyncio

# 1. Patch asyncio to allow running uvicorn in Jupyter
nest_asyncio.apply()

app = FastAPI()

# 2. Define your endpoints
@app.get("/")
def read_root():
    return {"message": "Hello from Kaggle GPU Backend!"}

@app.post("/predict")
def predict(data: dict):
    # YOUR ML INFERENCE CODE HERE
    return {"status": "success", "prediction": "mock_result"}

# 3. Setup Ngrok Tunnel
# Replace 'YOUR_NGROK_AUTH_TOKEN' with the token from ngrok.com dashboard
ngrok.set_auth_token("YOUR_NGROK_AUTH_TOKEN")
public_url = ngrok.connect(8000).public_url
print(f"✅ Your Public API is live at: {public_url}")

# 4. Start the Server
uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 🚨 The Flaws & Risks (What Could Go Wrong During the Demo)

If you are using this stack for your final hackathon presentation, you **must** be prepared for the following failure points:

### 1. The "Idle Timeout" Death
*   **The Flaw:** If you don't touch your keyboard/mouse in the Kaggle tab for ~40-60 minutes, the session will be killed to save GPU resources. Your `ngrok` URL will die immediately.
*   **The Fix:** 
    *   **During Development:** Assign a team member to keep the Kaggle tab open and occasionally interact with it (click a cell, scroll).
    *   **Right Before Demo:** **Restart the entire kernel** 15 minutes before your pitch. This guarantees you have a fresh 40-minute window of uninterrupted uptime while presenting to the judges.

### 2. The Dynamic URL Problem
*   **The Flaw:** Every time you restart the Kaggle notebook (or if it crashes), `ngrok` will generate a brand new random URL (e.g., `https://a1b2c3d4.ngrok.app`). 
*   **The Fix:** Your frontend (Flutter/React) team must store the API base URL in an easily accessible `config.json` or `.env` file. You will need to rapidly copy-paste the new `ngrok` URL from Kaggle into the frontend code and recompile right before the demo. 

### 3. "Event Loop Already Running" Crash
*   **The Flaw:** If you try to run the API cell multiple times without restarting the kernel, Jupyter will crash with an event loop error because the server is already occupying the thread.
*   **The Fix:** If you need to change your API code, you usually have to click **"Restart Kernel"** at the top of Kaggle, run all cells again, and get a new `ngrok` link.

### 4. Cold Starts & Model Loading Delays
*   **The Flaw:** When you start a fresh Kaggle session, downloading datasets, reinstalling libraries (`!pip install`), and loading heavy model weights (e.g., a 10GB LLM) into VRAM can take 5-10 minutes.
*   **The Fix:** Ensure your model weights are uploaded to Kaggle as a private "Dataset". Mount that dataset to your notebook. This allows the notebook to read the weights directly from the local disk (`/kaggle/input/...`) instantly, bypassing the need to download them from the internet every time the kernel restarts.

### 5. Out of Memory (OOM) on Free GPUs
*   **The Flaw:** Kaggle's T4x2 gives you two 16GB GPUs, but writing code to utilize *both* simultaneously is complex. Usually, you only use one (16GB max). P100 gives you 16GB.
*   **The Fix:** If your model exceeds 16GB of VRAM during inference, the notebook will silently crash and the kernel will restart. Test your peak memory usage thoroughly before the demo.

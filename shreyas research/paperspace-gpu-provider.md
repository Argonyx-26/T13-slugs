# 🚀 Cloud GPU Proposal: Paperspace (by DigitalOcean)

**Overview:** 
We are proposing Paperspace as our backend GPU cloud provider for the hackathon. It is a developer-first platform that gives us a full Linux Virtual Machine (VM) with zero upfront wallet deposits. 

### 💰 Exact Pricing & Hackathon Budget
Paperspace operates on a **strictly postpaid model**. We attach a card, and they bill us on the 1st of next month for the exact hours the machine was turned on. Zero upfront deposits.

*   **Option A: NVIDIA RTX A5000 (24GB VRAM)**
    *   **Cost:** $1.38/hr (~₹131/hr)
    *   *Total cost for a 5-hour run:* **~₹655**
*   **Option B: NVIDIA RTX A6000 (48GB VRAM) - *Recommended***
    *   **Cost:** $1.89/hr (~₹180/hr)
    *   *Total cost for a 5-hour run:* **~₹900**

### ✅ Why Paperspace is Great for Us (Pros)
1.  **Frictionless Setup:** They have an official "Machine Learning in a Box" template. We click one button and get a Linux OS with PyTorch, CUDA, and JupyterLab perfectly pre-installed. No manual driver installations.
2.  **Instant Account Access:** Unlike Indian providers (like E2E) which require Aadhaar/PAN KYC and manual sales approval, Paperspace lets us spin up a massive 48GB GPU in 3 minutes.
3.  **Full Control:** We get full SSH access to the machine. We can code directly via VSCode Remote SSH or Jupyter. 
4.  **No Cold Starts:** Unlike serverless platforms, the GPU stays active as long as we leave it on, meaning zero delay when the AI processes audio.

### ⚠️ The Catches We Must Watch Out For (Cons)
1.  **The "Storage Trap" (Crucial):** When we click "Shut Down," the ₹180/hr compute fee stops, but we are still billed a few cents an hour for the hard drive space. **Rule for the team:** When the hackathon is completely over, we must click **"Destroy"** to delete the machine and drop the bill to zero.
2.  **Latency:** They do not have data centers in India. The data will route to Amsterdam or New York. This adds a ~250ms network delay to our API calls. (For our use case, a 0.25-second delay is perfectly acceptable).
3.  **Auto-Shutdown Bug:** Do not trust the "auto-shutdown" feature to save money overnight. We must manually turn the machine off when we are done coding for the night.
4.  **Static IP Fee:** If our Flutter frontend needs a permanent IP address to talk to, Paperspace charges an extra $3 (~₹285) flat fee for the month. 

### 🎯 The Verdict
For under **₹1,200 total**, we get a massive enterprise-grade 48GB GPU with zero upfront deposit, a beautiful UI, and zero setup headaches. We accept a tiny 250ms network delay in exchange for not having to deal with manual Linux firewall configurations or KYC delays.

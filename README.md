# 🛡️ FraudShield AI — Cybersecurity Super App

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/abhilashperne-a11y/FraudShield--AI/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/abhilashperne-a11y/FraudShield--AI.svg)](https://github.com/abhilashperne-a11y/FraudShield--AI/stargazers)
[![Status](https://img.shields.io/badge/status-active-success.svg)]()

**FraudShield AI** is an advanced, interactive cyber-safety Super App designed specifically to protect, educate, and assist digital users—especially first-time internet users—against online financial fraud, identity theft, phishing, and scam messages. Combining explainable heuristic detection, cutting-edge glassmorphic design, and live LLM/cybersecurity APIs, FraudShield AI represents the next generation of visual digital safety.

---

## 📌 Project Overview
As millions of people transition to digital banking and mobile payments (UPI, Cards, and NetBanking), they become highly vulnerable to sophisticated digital scams. FraudShield AI bridges the gap by acting as a real-time safety companion. 

It provides an intuitive dashboard containing **7 core security modules** that analyze transaction risks, inspect suspicious URLs, evaluate fraudulent SMS text patterns, simulate voice scams, analyze behavioral risk indicators, educate users through gamified learning, and provide instant emergency reporting tools (like pipeline freezing and bank notifications).

---

## ⚠️ Problem Statement
Digital financial inclusion has expanded rapidly, but cybersecurity literacy has not kept pace. First-time internet users, senior citizens, and rural populations are increasingly falling victim to:
* **Phishing Scams:** Fraudulent cloned websites or weaponized URLs designed to steal credentials.
* **Social Engineering / SMS Fraud:** Misleading messages claiming lottery wins, electricity bill defaults, or cash reward deposits.
* **UPI & Transaction Scams:** Rogue UPI handles requesting collect calls or malicious QR codes.
* **Remote Access Exploitation:** Scammers tricking users into installing remote-sharing tools (e.g., AnyDesk, TeamViewer) to drain bank accounts.

Traditional antivirus/firewall software is overly complex, text-heavy, and lacks **explainable AI** that helps users understand *why* a threat is classified as dangerous. FraudShield AI solves this by delivering beautiful visual feedback, simple risk scores, and step-by-step educational explanations.

---

## ✨ Core Features

| Module | Description | Key Tech / Logic |
| :--- | :--- | :--- |
| **1. Transaction Risk Analyzer** | Scans transaction requests (UPI, Account, Cards) for risk flags. | Checks against a rogue database, identifies high-velocity transfers, and highlights unverified UPI handles. |
| **2. Phishing Link Detector** | Scans URLs for malicious content, phishing, and malware flags. | Uses regex heuristics and live APIs (Google Safe Browsing & VirusTotal) with real-time CORS proxying. |
| **3. Scam Message Analyzer** | Checks SMS/WhatsApp messages for urgent/fraudulent text patterns. | Employs keyword heuristics and **Google Gemini 1.5 Pro** LLM to summarize threats and recommend action. |
| **4. Voice Safety Assistant** | Interactive simulator training users to handle phone call scams. | Text-to-speech feedback, scenario selectors (Lottery, Bank KYC, Threat), and dynamic user prompts. |
| **5. Behavioral Pattern Analyzer** | Tracks device and interface behavioral signals to detect active fraud. | Monitors remote desktop software flags, atypical click speed, and late-night hour warnings. |
| **6. Fraud Education Center** | Interactive, gamified cybersecurity learning platform. | Real-time quizzes, cybersecurity flip-cards, scam scenario lessons, and score badges. |
| **7. Emergency Reporting** | Instant incident reporting and security counter-measures. | Freezes transactions, locks digital cards, generates cyber-safety PDFs, and triggers simulated family alerts. |

---

## 🛠️ Tech Stack Used

* **Frontend**:
  * **HTML5**: Semantic web architecture.
  * **CSS3**: Premium glassmorphic UI, modern HSL-tailored color gradients, variable scaling, micro-animations, and fluid layout structures.
  * **JavaScript (ES6+)**: Dynamic DOM manipulation, modular async service wrappers, localStorage integration, and state control.
* **Backend**:
  * **Python (3.x)**: Lightweight HTTP/HTTPS API server (utilizing native `http.server`, `urllib`, and `json`).
  * **JSON Database**: Flat-file structured store (`database.json`) for persistence of blacklists, logs, and settings.
* **API Integrations**:
  * **Google Gemini API**: Live contextual NLP analysis of scam texts.
  * **Google Safe Browsing API**: Direct URL safety validation.
  * **VirusTotal API**: Multi-engine malware and malicious domain validation (proxied through the Python backend to avoid CORS restrictions).

---

## 🔑 Setup & Installation Instructions

Follow these steps to run the application locally on your computer:

### 1. Clone the Repository
```bash
git clone https://github.com/abhilashperne-a11y/FraudShield--AI.git
cd FraudShield--AI
```

### 2. Configure API Keys (Optional but Recommended)
For live API-driven detection, set up the `.api-keys.md` file. The server automatically reads keys from this file on startup and syncs them to the application.
1. Duplicate or open `.api-keys.md` in the project root:
   ```markdown
   # Paste your API keys below (no quotes, no spaces)
   gemini=YOUR_GEMINI_API_KEY
   safebrowsing=YOUR_SAFE_BROWSING_API_KEY
   virustotal=YOUR_VIRUSTOTAL_API_KEY
   ```
2. You can get free keys here:
   * **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)
   * **Safe Browsing**: [Google Cloud Console](https://console.cloud.google.com/apis/library/safebrowsing.googleapis.com)
   * **VirusTotal**: [VirusTotal Developer Portal](https://www.virustotal.com/gui/join-us)

> [!NOTE]
> If no API keys are provided, the app gracefully falls back to its robust **offline heuristic detection engine**, maintaining complete usability without any external network dependency.

### 3. Run the API Server
Start the lightweight Python server to serve the frontend and handle proxy requests:
```bash
python server.py
```
By default, the server runs on `https://fraud-shield-ai-six.vercel.app/`.

### 4. Open the Web App
Open your favorite web browser and navigate to:
```url
https://fraud-shield-ai-six.vercel.app/
```

---

## 👥 Team Details
Developed with 💙 for the digital safety community:
* **Team Name :- Tech Kings**
* **Abhilash (4SN24CS002)** — Project Lead & Primary Developer
* **Hansraj (4SN24AD016)**—Frontend Developer 
* **Abhinav Varayil (4SN24CS003)**—Bankend Security
* **Gokul Ram S (4SN24CS033)**—Developer
---

## 📜 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

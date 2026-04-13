# Indian AI Companies: Sarvam AI and Krutrim

This document provides detailed information about two prominent Indian AI companies: Sarvam AI and Krutrim (Ola Krutrim).

---

## Sarvam AI

### Company Overview

**Sarvam AI** is an Indian artificial intelligence company headquartered in Bengaluru, Karnataka. Founded in August 2023 by **Vivek Raghavan** and **Pratyush Kumar** (both previously associated with AI4Bharat at IIT Madras), the company positions itself as India's "Full-Stack Sovereign AI Platform." The company has raised approximately **$41 million** in funding from investors including Lightspeed Venture Partners, Peak XV Partners, and Khosla Ventures.

#### Key Differentiators
- **Sovereign AI**: Built, deployed, and operated entirely within India to ensure data control and compliance
- **India-First Focus**: Specialized in Indian languages, culture, and context
- **Government Partnership**: Selected by MeitY under the IndiaAI Mission to develop India's sovereign large language model

---

### Business Model

Sarvam AI operates on a **hybrid business model** combining multiple revenue streams:

1. **Enterprise Conversational AI (SaaS/Usage-Based)**
   - Voice-based AI agents for customer service deployed across phone, WhatsApp, and web
   - Sold as SaaS subscriptions or per-minute usage
   - Target sectors: Financial services, telecom, airlines, quick-commerce (e.g., Zepto, Zomato)

2. **Government Productivity Tools**
   - AI systems that analyze public data, generate reports, and assist policymakers
   - Working with NITI Aayog and other government bodies
   - Secure, sovereign AI solutions for citizen interaction

3. **API Services (Pay-Per-Use)**
   - Universal credit system across all APIs
   - Transparent pricing starting with ₹1,000 free credits
   - Subscription plans: Starter (pay-as-you-go), Pro (₹10,000), Business (₹50,000)

4. **On-Premises/Appliance Deployments**
   - Hardware-based solutions for large organizations requiring local deployment
   - Billed as hardware licenses or subscription models
   - Air-gapped options for regulated industries

5. **Open Source Strategy**
   - Open-sourcing foundational models (Sarvam 30B, Sarvam 105B) under Apache License 2.0
   - Drives developer adoption while monetizing enterprise features and support

---

### Key Products & Services

#### Foundational Language Models
| Model | Parameters | Architecture | Context Window | Use Case |
|-------|-----------|--------------|----------------|----------|
| **Sarvam 30B** | 30 billion | Mixture-of-Experts (~1B active) | 32K tokens | General multilingual tasks |
| **Sarvam 105B / Indus** | 105 billion | Mixture-of-Experts (~9B active) | 128K tokens | Complex reasoning, enterprise applications |
| **Sarvam 2B** | 2 billion | Efficient design | - | Low-cost, high-volume deployments |

#### Multimodal Systems
- **Saaras V3**: Speech-to-text supporting 10+ Indian languages
- **Bulbul v2/v3**: Text-to-speech with natural Indian accent synthesis
- **Sarvam Vision**: Document understanding and OCR for Indian scripts
- **Mayura/Sarvam Translate**: Translation between Indian languages

#### Conversational Agents
- **Samvaad Studio**: No-code platform for building voice/chat agents
- Deployment channels: Phone, WhatsApp, web, mobile apps
- Use cases: Cart recovery, appointment booking, payment follow-ups

#### Specialized Solutions
- **Sarvam Akshar**: Document digitization and analysis
- **Sarvam A1 Legal**: Contract drafting and legal research
- **Indus App**: Consumer-facing AI assistant (available on iOS/Android)

#### Hardware
- **Sarvam Kaze**: Indigenous AI-powered wearable glasses for real-time translation and interaction (planned launch May 2026)

---

### Technology Focus

#### Core Technical Strengths
1. **Mixture-of-Experts (MoE) Architecture**: Efficient parameter activation for cost-effective inference
2. **Indian Language Optimization**: Trained on billions of tokens across 10+ Indian languages including code-mixed text
3. **Sovereign Infrastructure**: End-to-end stack built and hosted in India
4. **Hybrid Deployment**: Cloud, private cloud (VPC), and on-premises options

#### API Pricing Structure (Key Examples)
| Service | Price | Unit |
|---------|-------|------|
| Sarvam 30B/105B Chat | Free | Per token |
| Text-to-Speech (Bulbul v3) | ₹30 | Per 10K characters |
| Speech-to-Text | ₹30 | Per hour of audio |
| Speech-to-Text + Diarization | ₹45 | Per hour of audio |
| Translation | ₹20 | Per 10K characters |
| Vision (Document Digitization) | ₹1.50 | Per page |

---

### Strategic Partnerships
- **Government**: UIDAI (Aadhaar voice integration), NITI Aayog, MeitY (IndiaAI Mission)
- **Cloud Providers**: Microsoft Azure, Google Cloud Platform
- **Hardware**: NVIDIA (VUE-based appliances)
- **Research**: AI4Bharat, academic institutions for dataset development
- **Telecom**: Exotel for voice channel integration

---

### Market Position

Sarvam AI differentiates itself through:
- **Regulatory Compliance**: TRAI-compliant voice solutions for Indian telecom
- **Data Sovereignty**: Full control over data residency and governance
- **Language Advantage**: Proprietary Indic-language datasets providing superior accuracy
- **Cost Efficiency**: Lower per-minute rates enabling mass adoption across SMBs and enterprises

The company serves three primary customer segments:
1. **Large Enterprises & Quick-Commerce Platforms** (high-volume multilingual support)
2. **Financial Services, Telecom, Airlines** (call-center operations)
3. **Government & Public Agencies** (secure, sovereign AI for citizen services)

---

## Krutrim (Ola Krutrim)

### Company Overview

**Krutrim** (Legal Entity: *Krutrim Si Designs Private Limited*) is part of the **Ola Group**, founded in 2023 by **Bhavish Aggarwal** (CEO of Ola Group). 

- **Headquarters**: Bengaluru, India (with teams in Singapore and San Francisco)
- **Valuation**: Unicorn status with a valuation of **$1 Billion** (achieved in early 2024)
- **Funding**: Raised approximately **$74.9M - $229.7M** across multiple rounds from investors including Z47, Sarin Family India, and angel investors
- **Mission**: To build "AI made in India, for the world," creating a full-stack AI computing ecosystem tailored for Indian languages and markets while serving global needs

---

### Business Model

Krutrim operates on a **full-stack AI infrastructure and platform model**, differentiating itself by controlling the entire stack from hardware to applications:

1. **Infrastructure-as-a-Service (IaaS)**: Providing high-performance GPU cloud infrastructure (Krutrim Cloud) specifically optimized for AI training and inference, with data centers located in India to ensure low latency and data sovereignty.

2. **Platform-as-a-Service (PaaS)**: Offering developer tools, model repositories, and managed environments (e.g., AI Pods, Shodh Labs for education) to lower the barrier to entry for AI development.

3. **Model-as-a-Service (MaaS)**: Providing access to proprietary foundational models (LLMs, VLMs, ASR) via APIs and open-source releases.

4. **Hardware (Semiconductors)**: Developing custom AI chips to reduce dependency on foreign hardware and optimize costs for specific workloads.

5. **Enterprise Solutions**: Delivering vertical-specific AI applications (e.g., customer care agents, mapping solutions) for businesses and government entities.

---

### Key Products & Services

#### 1. Krutrim Cloud (AI Infrastructure)
- **GPU Compute**: Offers on-demand access to high-performance GPUs (NVIDIA A100, H100) hosted within India. Pricing is transparent in INR to avoid forex volatility.
- **AI Pods**: Lightweight, fractional GPU instances starting at ~₹24/hour for experimentation and bursty workloads, allowing users to scale up to full VMs as needed.
- **Shodh Labs**: An educational initiative providing shared, on-demand AI compute environments for universities and students to run notebooks without managing infrastructure.
- **Data Centers**: Plans to expand capacity from 20MW to **1GW** by 2026.

#### 2. Foundational Models (AI Software)
- **Krutrim LLM (Krutrim-1)**: A **7B parameter** multilingual Large Language Model trained on **2 trillion tokens**. It supports **11+ languages** including English and major Indic languages (Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Assamese, Punjabi). It outperforms similar-sized models on Indic benchmarks.
- **Chitrarth**: A **Multilingual Vision-Language Model (VLM)** that combines the Krutrim LLM with vision capabilities. It can understand and generate text related to images in 10+ Indian languages.
- **Shruti**: A suite of **Automatic Speech Recognition (ASR)** models designed for Indian accents, code-mixed speech (Hinglish), and diverse dialects. Includes variants like `Shruti-English-v1` and `Shruti-Hinglish-MixedScript`.
- **Dhwani**: An end-to-end trained **Speech LLM** for direct speech understanding and translation in Indic languages, bypassing traditional ASR pipelines.

#### 3. Custom Semiconductor Chips (Silicon)
Krutrim is developing a family of proprietary chips to power its ecosystem, aiming for launch between 2025–2028:
- **Bodhi**: Targeted at **Large Language Models (LLMs)** and general AI training/inference. Future iterations (Bodhi 2) aim to support exascale supercomputing.
- **Sarv**: A general-purpose CPU designed for cloud-native computing tasks.
- **Ojas**: An **Edge AI chip** intended to power next-generation autonomous systems and vehicles (e.g., Ola Electric vehicles).
- **Partnerships**: Collaborating with **Arm** and **Untether AI** for chip design and development.

#### 4. Applications & Vertical Solutions
- **Mapping & Navigation**: Real-time navigation solutions integrated with AI.
- **Customer Care Agents**: Multilingual AI agents for enterprise support.
- **Public Sector Tools**: Acquired *BharatSahAIyak* to enhance AI deployment in Indian public infrastructure.
- **Content Generation**: Tools for automated content creation, summarization, and translation.

---

### Technology Focus
- **Indic Language Specialization**: Heavy investment in training data and models for under-resourced Indian languages, addressing data scarcity and bias.
- **Full-Stack Integration**: Seamless integration between their custom silicon, cloud infrastructure, and software models to optimize performance and cost.
- **Data Sovereignty**: All cloud infrastructure and data processing are hosted within India to comply with local regulations and reduce latency.
- **Open Source Strategy**: Releasing base models (like Krutrim-1) under community licenses to foster adoption and developer trust.
- **Energy Efficiency**: Focusing on energy-efficient chip designs and sustainable data center operations.

---

### Competitive Landscape
- **Global Competitors**: OpenAI, Anthropic, xAI, Google DeepMind.
- **Indian Competitors**: Sarvam AI, Gnani.ai, AI4Bharat (research-focused).
- **Differentiation**: Unlike many competitors who rely on US-based clouds and generic models, Krutrim offers an **India-first stack** (local GPUs, local data, native language models, and custom silicon).

---

### Recent Developments (2024-2026)
- Achieved unicorn status in early 2024.
- Launched over 50 new AI services on its platform.
- Expanded cloud usage to internal Ola Group companies (Ola Cabs, Ola Electric).
- Facing challenges including execution hurdles and staff restructuring in linguistics divisions.
- Active participation in academic research (e.g., AAAI-26 paper on synthetic pretraining data for Indic languages).

---

## Comparison Summary

| Aspect | Sarvam AI | Krutrim |
|--------|-----------|---------|
| **Founded** | August 2023 | 2023 |
| **Founders** | Vivek Raghavan, Pratyush Kumar | Bhavish Aggarwal |
| **Parent Organization** | Independent | Ola Group |
| **Funding** | ~$41 million | ~$75-230 million |
| **Valuation** | Not publicly disclosed | $1 Billion (Unicorn) |
| **Core Focus** | Sovereign AI, conversational agents, enterprise solutions | Full-stack AI (infrastructure to silicon) |
| **Key Models** | Sarvam 30B, Sarvam 105B (Indus) | Krutrim-1 (7B), Chitrarth (VLM) |
| **Hardware** | Sarvam Kaze (wearable glasses) | Bodhi, Sarv, Ojas (custom chips) |
| **Cloud Infrastructure** | Partner-based (Azure, GCP) | Own Krutrim Cloud with Indian data centers |
| **Unique Selling Point** | Government partnerships, sovereign AI for India | Complete stack control including custom silicon |

---

## Conclusion

Both Sarvam AI and Krutrim represent significant players in India's emerging AI ecosystem, each with distinct approaches:

- **Sarvam AI** focuses on being India's sovereign AI platform with strong government ties and specialized models for Indian languages, targeting enterprise and government customers with conversational AI and productivity tools.

- **Krutrim** takes a more ambitious full-stack approach, building everything from custom AI chips to cloud infrastructure to foundational models, backed by the resources of the Ola Group and positioned as a unicorn startup.

Both companies emphasize India-first strategies, focusing on Indian languages, data sovereignty, and localized AI solutions to serve domestic and potentially global markets.

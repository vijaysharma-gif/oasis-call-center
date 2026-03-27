/**
 * Gemini AI Service — analyzes call recordings.
 *
 * Flow: stream audio URL → pipe directly into Gemini Files API upload
 *       (no temp file, no full download into memory first)
 *       → generateContent with returned file URI → cleanup.
 */

// ─── Categorization schema ────────────────────────────────────────────────────

const CATEGORIZATION_SCHEMA = {
  "Portal Access & Registration": [
    "Fresh Registration Query",
    "Duplicate Registration Concern",
    "OTR vs Exam Application Confusion",
    "Resume Incomplete Application",
    "Offline Application Query",
    "Portal Not Loading / Technical Error",
    "Registration Form Submission Error",
    "Multiple OTR Accounts Issue",
    "OTR ID Not Received After Registration",
    "Registration Confirmation Not Received"
  ],
  "Identity Verification": [
    "Aadhaar OTP Not Received",
    "Aadhaar Number Not Accepted",
    "Aadhaar Mismatch",
    "Name / DOB Mismatch Across Documents",
    "Identity Proof Selection Query",
    "Live Photo / Face Match Failure",
    "Manual Aadhaar Verification Request",
    "Photo Clicked During Verification Issue",
    "Aadhaar Linked Mobile Not Available"
  ],
  "OTP, Password & CAPTCHA": [
    "Mobile OTP Not Received",
    "Email OTP Not Received",
    "OTP Expired Before Use",
    "Wrong OTP Entered Multiple Times",
    "Password Forgotten / Reset",
    "OTR ID Forgotten",
    "CAPTCHA Not Loading / Unclear",
    "Account Recovery Query",
    "OTP Coming on Wrong Number"
  ],
  "Category & Reservation": [
    "General Category Query",
    "OBC Category & Creamy Layer",
    "OBC Non-Creamy Layer Certificate Query",
    "SC / ST Category",
    "SC / ST Sub-Category Clarification",
    "EWS Category",
    "EWS Certificate Format / Validity Query",
    "Divyang / PwD / PH Category",
    "Disability Type & Percentage Query",
    "Dependent Freedom Fighter Category",
    "Ex-Army / Ex-Serviceman Category",
    "Age Relaxation Query",
    "UP Residency & Reservation Eligibility",
    "Category Certificate Date Validity Query",
    "Category Change After Form Submission"
  ],
  "Address & Personal Details": [
    "Permanent Address Entry Issue",
    "Correspondence Address Entry Issue",
    "District / State Dropdown Issue",
    "Village / Ward / Tehsil Not Found",
    "Pincode Not Accepted",
    "Personal Details Correction Request",
    "Date of Birth Entry Issue",
    "Gender / Nationality Entry Issue",
    "Twin Information Query",
    "Father / Husband Name Entry Issue",
    "Mobile / Email Change in Profile"
  ],
  "Educational Qualifications": [
    "Education Details Entry in OTR",
    "Wrong Education Row Added",
    "Board / University Not in Dropdown",
    "B.Ed / D.El.Ed Qualification Entry",
    "Graduation Subject / Stream Entry",
    "Training Qualification Entry",
    "Marks / Percentage Entry Issue",
    "CGPA to Percentage Conversion Query",
    "Year of Passing Entry Issue",
    "Appearing / Passed Status Query",
    "Final Year Appearing Candidate Entry",
    "Multiple Degree Entry Issue"
  ],
  "Uploads & Documents": [
    "Photograph Upload Issue",
    "Signature Upload Issue",
    "Photo Identity Proof Upload",
    "Academic Certificate Upload",
    "Category / Caste Certificate Upload",
    "Domicile / Residency Certificate Upload",
    "Handwritten Declaration Upload Issue",
    "File Size / Format Requirement",
    "File Too Large Error",
    "Blurry / Unreadable Document Rejection",
    "Document Preview Not Showing",
    "Photo Background Color Requirement",
    "Photo Dimensions Not Accepted",
    "Upload Button Not Working"
  ],
  "OTR Completion & Preview": [
    "Preview & Edit Before OTR Completion",
    "OTR Profile Locked After Submission",
    "Complete OTR Profile Step Query",
    "OTR Submission Confirmation Not Received",
    "Preview Section Data Missing or Wrong",
    "How to Edit Saved OTR Data",
    "OTR Final Submit Button Issue",
    "Print / Download OTR Form"
  ],
  "Exam Application & Eligibility": [
    "Paper I Eligibility Query",
    "Paper II Eligibility Query",
    "Both Papers Application Query",
    "Subject Group / Combination Selection",
    "Practising Government Teacher Details Entry",
    "Qualification Status (Passed / Appearing)",
    "B.Ed Appearing Candidate Eligibility",
    "D.El.Ed / BTC / JBT Eligibility Query",
    "Age Limit Eligibility Query",
    "Exam Centre Preference Entry",
    "Application Form Section Not Saving",
    "How to Apply for Exam After OTR"
  ],
  "Payment & Fee": [
    "Fee Amount Query",
    "Category-wise Fee Query",
    "Both Papers Fee Query",
    "Payment Gateway / Method Query",
    "Net Banking / UPI / Debit Card Issue",
    "Challan Payment Query",
    "Payment Pending / Processing Status",
    "Money Debited but Application Incomplete",
    "Duplicate Payment Risk",
    "Duplicate Payment Refund Query",
    "Payment Reconciliation Request",
    "Application Status Showing PAID Confirmation",
    "Fee Receipt / Challan Download Issue",
    "Fee Waiver for Reserved Category Query"
  ],
  "Login & Account Access": [
    "Login Method Query",
    "Password Forgotten / Reset",
    "OTR ID Forgotten / Recovery",
    "OTP Login Not Working",
    "Account Locked / Blocked",
    "Too Many Failed Login Attempts",
    "Registered Mobile Not Accessible",
    "Login with New Device Issue",
    "Session Timeout Issue"
  ],
  "Amendment & Post-Submission": [
    "Amendment Window Opening Date Query",
    "What Fields Can Be Corrected",
    "Amendment Process Step-by-Step Query",
    "Correction Window Already Closed",
    "Photo / Signature Amendment",
    "Name / DOB Correction After Submission",
    "Category Correction After Submission",
    "Subject / Paper Change After Submission",
    "Address Correction After Submission",
    "Re-payment Required After Amendment",
    "Amendment Confirmation Not Received"
  ],
  "Exam Information": [
    "Important Dates & Schedule Query",
    "Exam Pattern & Structure Query",
    "Number of Questions / Total Marks",
    "Qualifying Marks / Cut-off Query",
    "Negative Marking Query",
    "Exam Language / Medium Query",
    "Question Paper Language Options",
    "Exam Duration Query",
    "Normalisation / Multi-Shift Query",
    "TET Validity Period Query",
    "Syllabus Query",
    "Previous Year Paper Query"
  ],
  "Admit Card & Certificate": [
    "Admit Card Release Date Query",
    "Admit Card Download Process",
    "Admit Card Not Downloading / Available",
    "Wrong Details on Admit Card",
    "Exam Centre / Date / Time Query",
    "Exam Centre Change Request",
    "TET Pass Certificate Download",
    "TET Certificate Validity Query",
    "DigiLocker Certificate Query",
    "Photo Mismatch on Admit Card",
    "Category Error on Certificate",
    "Duplicate Certificate / Marksheet Query"
  ],
  "Scribe & Compensatory Time": [
    "Scribe Eligibility Criteria Query",
    "How to Request a Scribe",
    "Scribe Arrangement Process",
    "Scribe Documents & Declaration Required",
    "Scribe Qualification / Education Limit",
    "Compensatory Time (30 Minutes) Query",
    "Scribe Declaration Form Submission",
    "Medical Certificate for PwD Requirement",
    "Disability Certificate Format Query"
  ],
  "Result & Merit List": [
    "Result Declaration Date Query",
    "Result Check Process",
    "Merit List Query",
    "Cut-off Marks Query",
    "Rank / Score Discrepancy",
    "District Allocation Query",
    "Selection Process After TET",
    "Waiting List Query"
  ],
  "General Enquiry": [
    "Application Mode Query",
    "Notification / Advertisement Query",
    "Helpline Timing Query",
    "Appointment / Job Guarantee Query",
    "Transfer to Another Department",
    "Call Back Request",
    "Unrelated / Wrong Call",
    "Repeated Call / Follow-up",
    "Complaint Against Portal / Process"
  ]
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, options = {}, timeoutMs = 300_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function cleanCategory(text) {
  if (!text) return text;
  return text
    .replace(/^[IVX]+\.\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^(Category|Type|Class|Group):\s*/i, '')
    .trim();
}

function toLanguageArray(lang) {
  if (!lang) return [];
  return Array.isArray(lang) ? lang : [lang];
}

/**
 * Stream the audio from audioUrl and pipe it directly into the Gemini Files API.
 * Returns { fileUri, fileName } on success or throws on failure.
 *
 * We use the resumable upload protocol:
 *   1. POST metadata to get an upload URL (session URI)
 *   2. PUT the raw audio bytes to that URL
 * This avoids buffering the entire file in Node memory.
 */
async function uploadAudioToGemini(audioUrl, apiKey) {
  // ── Fetch audio as a stream ───────────────────────────────────────────────
  const audioResp = await fetchWithTimeout(audioUrl, {}, 300_000);
  if (!audioResp.ok) {
    const err = new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
    if (audioResp.status === 403 || audioResp.status === 404 || audioResp.status === 410) err.permanent = true;
    throw err;
  }

  // Content-Length header from S3 (needed for resumable upload)
  const contentLength = audioResp.headers.get('content-length');
  const mimeType      = audioResp.headers.get('content-type') || 'audio/x-wav';

  // ── Step A: Initiate resumable upload session ─────────────────────────────
  const initResp = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}&uploadType=resumable`,
    {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command':  'start',
        ...(contentLength ? { 'X-Goog-Upload-Header-Content-Length': contentLength } : {}),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({ file: { display_name: 'recording' } }),
    },
    30_000
  );

  if (!initResp.ok) {
    throw new Error(`Gemini upload init failed: ${await initResp.text()}`);
  }

  const uploadUrl = initResp.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL returned from Gemini');

  // ── Step B: Upload audio bytes (stream body directly) ────────────────────
  const uploadResp = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type':           mimeType,
        'X-Goog-Upload-Command':  'upload, finalize',
        ...(contentLength ? { 'X-Goog-Upload-Offset': '0', 'Content-Length': contentLength } : {}),
      },
      body: audioResp.body,   // pipe the stream directly — no buffering
      duplex: 'half',         // required for streaming request body in Node fetch
    },
    600_000  // 10 min for large files
  );

  if (!uploadResp.ok) {
    throw new Error(`Gemini upload failed: ${await uploadResp.text()}`);
  }

  const upData  = await uploadResp.json();
  const fileUri = upData?.file?.uri;
  const fileName= upData?.file?.name;

  if (!fileUri) throw new Error('No file URI returned from Gemini');
  return { fileUri, fileName };
}

// ─── Core analysis function ───────────────────────────────────────────────────

async function categorizeRecording(audioUrl, maxRetries = 3) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const startTime = Date.now();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let fileName = null;

    try {
      if (attempt > 0) {
        const waitMs = Math.min(2 ** attempt, 5) * 1000;
        console.log(`[Gemini] Retry ${attempt + 1}/${maxRetries}, waiting ${waitMs / 1000}s`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      // ── Upload (stream URL → Gemini, no local download) ──────────────────
      console.log('[Gemini] Streaming audio to Gemini...');
      const upStart = Date.now();

      const { fileUri, fileName: fn } = await uploadAudioToGemini(audioUrl, apiKey);
      fileName = fn;
      console.log(`[Gemini] Upload done in ${((Date.now() - upStart) / 1000).toFixed(1)}s`);

      // ── Generate analysis ─────────────────────────────────────────────────
      const genStart   = Date.now();
      const schemaJson = JSON.stringify(CATEGORIZATION_SCHEMA, null, 2);

      const prompt = `
You are analyzing ONE audio call recording from the UPTET-2026 candidate support helpline.
The call is between a candidate (or their representative) and a support executive.
The audio is provided as file_data in this request.

RETURN ONLY ONE VALID JSON OBJECT.
Do not include markdown, explanations, or any extra text.

═══════════════════════════════════════════════════════
STRICT FIELD OWNERSHIP — violating these rules is wrong
═══════════════════════════════════════════════════════
Every observation belongs to EXACTLY ONE field. Before writing any field, check: "Does this belong somewhere else?"

  audio_quality → owns ALL observations about recording/connection quality: noise, drops, echo, distortion, silence, one-sided audio, unclear voices. If you want to write anything about audio anywhere else — DON'T. Put it only in audio_quality.

  bugs          → owns ONLY software/portal malfunctions reported by the candidate. Nothing else.

  agent_score   → owns ONLY agent behaviour: politeness, accuracy, resolution effort, communication.

  call_resolved → owns ONLY whether the candidate's problem was closed. One word: Yes / No / Partial.

  ai_insight    → owns a 4-5 word label for the CANDIDATE'S ISSUE ONLY. Must describe what the candidate called about — never audio, never agent, never outcome.

  summary       → owns a two-sentence factual recap: sentence 1 = candidate's issue, sentence 2 = what the agent did or said.

  category /
  sub_category  → own the query type per schema. Based purely on what the candidate asked — not audio, not agent.

═══════════════════════════════════════════════════════
AUDIO UNCLEAR SPECIAL CASE — if category = "Audio Unclear"
═══════════════════════════════════════════════════════
When audio is too noisy, silent, or unintelligible to determine the candidate's issue, apply these EXACT values — no exceptions, no creative text:
  category      = "Audio Unclear"
  sub_category  = ""
  summary       = "Audio quality insufficient for analysis."
  ai_insight    = "-"
  bugs          = "-"
  call_resolved = "No"
  agent_score   = null
  audio_quality = { "rating": "<Good|Moderate|Poor based on what you actually hear>", "issues": "<specific problems you detected, e.g. heavy background noise, call dropped, only silence, distorted voice>" }
  transcription = "<whatever partial transcript is possible, or empty string>"

  IMPORTANT: audio_quality is NOT optional for Audio Unclear calls — it is the primary reason this category exists. You MUST describe exactly what makes the audio unclear. Never leave rating empty.

TASKS:
1) Transcription:
   - Produce a full transcript with speaker differentiation.
   - Use these exact speaker labels on their own line before each turn:
       "CANDIDATE:" for the caller/candidate
       "AGENT:" for the support executive
       "SYSTEM:" for any IVR, automated voice, hold music, or pre-recorded messages
   - If parts are unclear, write [inaudible].
   - Preserve mixed-language speech exactly as spoken (Hindi + English is common).

2) Categorization:
   - Determine if the audio is clear enough to identify the candidate's issue.
   - If NOT (too noisy, silent, unintelligible): apply the Audio Unclear special case above — stop here for all other fields.
   - If YES: choose exactly ONE category and ONE sub_category from the schema. category MUST be a top-level key; sub_category MUST be a listed value under it. Do not invent or paraphrase.

3) Summary (only if audio is clear):
   - Sentence 1: what issue did the candidate raise?
   - Sentence 2: what did the agent do or say in response?
   - Do NOT mention: audio quality, noise, agent tone, agent score, whether call was resolved. Those have their own fields.
   - WRONG: "The call had poor audio but the agent tried to help."
   - RIGHT:  "The candidate asked about OBC certificate validity. The agent confirmed the certificate must be issued within one year."

4) AI Insight (only if audio is clear):
   - A 4-5 word phrase describing the candidate's query or issue — nothing else.
   - WRONG: "Unclear audio, no issue identified" / "Candidate issue not articulated" / "Agent resolved payment query"
   - RIGHT:  "OBC certificate validity query" / "OTR portal not loading" / "Payment deducted form incomplete"
   - No full sentences. No punctuation at end.

5) Bug Detection (only if audio is clear):
   - Only flag portal/software malfunctions explicitly reported by the candidate.
   - WRONG: "Poor audio quality on call" / "Candidate could not articulate issue"
   - RIGHT:  "Submit button on OTR preview page does not respond to clicks."
   - If none: return exactly "-".

6) Agent Score (required for every call except Audio Unclear):
   - Score the agent 1–10 on: professionalism, issue comprehension, accuracy of guidance, resolution, clarity, call handling.
   - Do NOT factor in audio quality or the difficulty of the candidate's issue.
   - Use the full 1–10 range — do not default to 5 when uncertain; make a judgment.
   - Return null ONLY if category = "Audio Unclear" (i.e. no agent speech could be heard at all). For every other call, a score is mandatory.

7) Call Resolved (only if audio is clear):
   - "Yes" — candidate's issue fully resolved or candidate confirmed satisfaction.
   - "Partial" — some progress but issue not fully closed.
   - "No" — issue unresolved or call ended without a clear answer.
   - Do NOT return "No" just because audio was poor — that goes in audio_quality.

8) Audio Quality:
   - Rate ONLY the technical recording: noise, drops, echo, distortion, audibility.
   - Every audio observation MUST appear here and NOWHERE ELSE in the response.
   - "rating": "Good" | "Moderate" | "Poor"
   - "issues": comma-separated problems, or "-" if none.
   - Good = clear, minimal noise. Moderate = some noise/distortion but understandable. Poor = heavy noise, drops, or largely unintelligible.

9) Language detection:
   - List all languages spoken (e.g., ["Hindi", "English"]).

CATEGORIZATION SCHEMA:
${schemaJson}

OUTPUT FORMAT (must match exactly):
{
  "category": "",
  "sub_category": "",
  "summary": "",
  "ai_insight": "",
  "bugs": "",
  "agent_score": null,
  "call_resolved": "",
  "audio_quality": { "rating": "", "issues": "" },
  "transcription": "",
  "language": [],
  "error": null
}
`;

      const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { file_data: { mime_type: 'audio/x-wav', file_uri: fileUri } },
          ],
        }],
        generationConfig: { response_mime_type: 'application/json' },
      };

      console.log('[Gemini] Running analysis...');
      const genResp = await fetchWithTimeout(
        generateUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
        300_000
      );

      // Async cleanup — fire and forget
      if (fileName) {
        fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
          { method: 'DELETE' }, 30_000
        ).catch(() => {});
        fileName = null;
      }

      if (!genResp.ok) {
        const errText = await genResp.text();
        if (attempt < maxRetries - 1) continue;
        return { success: false, error: `Gemini generate failed: ${errText}` };
      }

      const resultData = await genResp.json();
      const candidates = resultData?.candidates;
      if (!candidates?.length) {
        if (attempt < maxRetries - 1) continue;
        return { success: false, error: 'No candidates returned from Gemini' };
      }

      const textResponse = candidates[0]?.content?.parts?.[0]?.text || '{}';
      let analysis;
      try {
        analysis = JSON.parse(textResponse);
      } catch {
        if (attempt < maxRetries - 1) continue;
        return { success: false, error: 'Invalid JSON returned from Gemini' };
      }

      if (analysis.error) return { success: false, error: analysis.error };

      console.log(`[Gemini] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s total (analysis ${((Date.now() - genStart) / 1000).toFixed(1)}s)`);

      return {
        success:       true,
        category:      cleanCategory(analysis.category)      || 'Uncategorized',
        sub_category:  cleanCategory(analysis.sub_category)  || 'N/A',
        summary:       analysis.summary       || '',
        ai_insight:    analysis.ai_insight    || '',
        bugs:          analysis.bugs          || '-',
        agent_score:   typeof analysis.agent_score === 'number' ? analysis.agent_score : null,
        call_resolved: analysis.call_resolved || 'No',
        audio_quality: {
          rating: analysis.audio_quality?.rating || 'Moderate',
          issues: analysis.audio_quality?.issues || '-',
        },
        transcription: analysis.transcription || '',
        language:      toLanguageArray(analysis.language),
      };

    } catch (err) {
      // Cleanup uploaded Gemini file on error
      if (fileName) {
        fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
          { method: 'DELETE' }, 30_000
        ).catch(() => {});
      }

      const isRetryable =
        err.name === 'AbortError' ||
        err.code === 'ECONNRESET'  ||
        err.code === 'ECONNREFUSED'||
        err.message?.toLowerCase().includes('timeout') ||
        err.message?.toLowerCase().includes('connection');

      if (isRetryable && attempt < maxRetries - 1) {
        console.warn(`[Gemini] Retryable error (attempt ${attempt + 1}): ${err.message}`);
        continue;
      }

      console.error(`[Gemini] Fatal error: ${err.message}`);
      return { success: false, error: err.message, permanent: !!err.permanent };
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

module.exports = { categorizeRecording, CATEGORIZATION_SCHEMA };

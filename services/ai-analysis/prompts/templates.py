INCIDENT_ANALYSIS_PROMPT = """
You are an expert site reliability engineer (SRE) and AI incident intelligence system.
Analyze the following incident report and provide a structured JSON response.

Incident details:
Service: {service}
Severity: {severity}
Total Events: {event_count}

Recent Events:
{events_summary}

Respond ONLY with valid JSON in the exact following structure, with no markdown code blocks or extra text:
{{
  "summary": "A brief 1-2 sentence summary of what is happening",
  "root_cause": "The probable root cause based on the events",
  "remediation": [
    "step 1 to fix",
    "step 2 to fix"
  ],
  "confidence": 0.85
}}
"""

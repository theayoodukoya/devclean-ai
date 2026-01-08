use crate::risk::merge_risk;
use crate::types::{ProjectMeta, RiskAssessment, RiskClass, RiskSource};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AiPayload {
    score: u8,
    class_name: Option<String>,
    reasons: Vec<String>,
}

fn classify_score(score: u8) -> RiskClass {
    if score >= 8 {
        RiskClass::Critical
    } else if score >= 5 {
        RiskClass::Active
    } else {
        RiskClass::Burner
    }
}

fn extract_text(response: GeminiResponse) -> Option<String> {
    response
        .candidates
        .and_then(|mut candidates| candidates.pop())
        .and_then(|candidate| candidate.content)
        .and_then(|content| content.parts)
        .and_then(|mut parts| parts.pop())
        .and_then(|part| part.text)
}

fn strip_code_fence(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("```") {
        let without_start = trimmed.trim_start_matches("```");
        let without_lang = without_start
            .strip_prefix("json")
            .or_else(|| without_start.strip_prefix("JSON"))
            .unwrap_or(without_start);
        return without_lang.trim().trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

pub fn ai_assess(meta: &ProjectMeta, api_key: &str, model: &str) -> Result<RiskAssessment, String> {
    let prompt = json!({
        "task": "Assess project deletion risk for a developer storage cleanup tool.",
        "instructions": [
            "Return JSON only, no markdown.",
            "Use score 0-10, where 0 is safe to delete and 10 is critical.",
            "Return short reasons (3-5).",
            "Use className as Critical, Active, or Burner."
        ],
        "project": {
            "name": meta.name,
            "path": meta.path,
            "dependencyCount": meta.dependency_count,
            "hasGit": meta.has_git,
            "hasEnvFile": meta.has_env_file,
            "hasStartupKeyword": meta.has_startup_keyword,
            "lastModifiedDays": meta.last_modified_days,
            "sizeBytes": meta.size_bytes
        }
    });

    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{"text": prompt.to_string()}]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 220
        }
    });

    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    );

    let client = Client::new();
    let response = client
        .post(endpoint)
        .json(&body)
        .send()
        .map_err(|error| format!("AI request failed: {error}"))?;

    let status = response.status();
    let response: GeminiResponse = response
        .json()
        .map_err(|error| format!("AI response parse failed: {error}"))?;

    if !status.is_success() {
        return Err(format!("AI request failed with status {status}"));
    }

    let text = extract_text(response).ok_or_else(|| "AI response missing text".to_string())?;
    let cleaned = strip_code_fence(&text);
    let payload: AiPayload = serde_json::from_str(&cleaned)
        .map_err(|error| format!("AI JSON parse failed: {error}"))?;

    let score = payload.score.min(10);
    let class_name = classify_score(score);

    Ok(RiskAssessment {
        class_name,
        score,
        reasons: payload.reasons,
        source: RiskSource::Ai,
    })
}

pub fn merge_with_ai(heuristic: &RiskAssessment, ai: &RiskAssessment) -> RiskAssessment {
    merge_risk(heuristic, Some(ai))
}

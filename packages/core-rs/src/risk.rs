use crate::types::{ProjectMeta, RiskAssessment, RiskClass, RiskSource};

const STARTUP_HINTS: &[&str] = &["startup", "production", "prod"];
const BURNER_HINTS: &[&str] = &["tutorial", "test", "boilerplate", "example", "sample"];

fn clamp_score(score: i32) -> u8 {
    score.clamp(0, 10) as u8
}

fn classify(score: u8) -> RiskClass {
    if score >= 8 {
        RiskClass::Critical
    } else if score >= 5 {
        RiskClass::Active
    } else {
        RiskClass::Burner
    }
}

pub fn evaluate_heuristic(project: &ProjectMeta) -> RiskAssessment {
    let mut score: i32 = 0;
    let mut reasons: Vec<String> = Vec::new();

    if project.is_cache {
        score -= 4;
        reasons.push("System cache directory".to_string());
    }

    if project.has_git {
        score += 4;
        reasons.push("Git history detected".to_string());
    }

    if project.has_env_file {
        score += 3;
        reasons.push("Environment file present".to_string());
    }

    if project.has_startup_keyword {
        score += 3;
        reasons.push("Startup keywords in package.json".to_string());
    }

    if project.last_modified_days <= 30 {
        score += 2;
        reasons.push("Modified within 30 days".to_string());
    }

    if project.dependency_count >= 40 {
        score += 1;
        reasons.push("High dependency count".to_string());
    }

    if is_burner_name(&project.name) {
        score -= 2;
        reasons.push("Name matches tutorial/test patterns".to_string());
    }

    if project.last_modified_days >= 180 {
        score -= 1;
        reasons.push("Inactive for 6+ months".to_string());
    }

    let score = clamp_score(score);

    RiskAssessment {
        class_name: classify(score),
        score,
        reasons,
        source: RiskSource::Heuristic,
    }
}

pub fn merge_risk(heuristic: &RiskAssessment, ai: Option<&RiskAssessment>) -> RiskAssessment {
    match ai {
        None => heuristic.clone(),
        Some(ai_assessment) => {
            let avg = ((heuristic.score as u16 + ai_assessment.score as u16) / 2) as u8;
            let class_name = classify(avg);
            let mut reasons = heuristic.reasons.clone();
            for reason in &ai_assessment.reasons {
                if !reasons.contains(reason) {
                    reasons.push(reason.clone());
                }
            }

            RiskAssessment {
                class_name,
                score: avg,
                reasons,
                source: RiskSource::Combined,
            }
        }
    }
}

pub fn has_startup_signal(name: &str, keywords: &[String], scripts: &[String]) -> bool {
    let name_text = name.to_lowercase();
    let keyword_text = keywords.join(" ").to_lowercase();
    let scripts_text = scripts.join(" ").to_lowercase();
    STARTUP_HINTS.iter().any(|hint| {
        name_text.contains(hint) || keyword_text.contains(hint) || scripts_text.contains(hint)
    })
}

pub fn is_burner_name(name: &str) -> bool {
    let lowered = name.to_lowercase();
    BURNER_HINTS.iter().any(|hint| lowered.contains(hint))
}

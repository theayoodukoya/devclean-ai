use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RiskClass {
    Critical,
    Active,
    Burner,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RiskSource {
    Heuristic,
    Ai,
    Combined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskAssessment {
    pub class_name: RiskClass,
    pub score: u8,
    pub reasons: Vec<String>,
    pub source: RiskSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub path: String,
    pub name: String,
    pub package_json_path: String,
    pub dependency_count: usize,
    pub has_git: bool,
    pub has_env_file: bool,
    pub has_startup_keyword: bool,
    pub last_modified: i64,
    pub last_modified_days: i64,
    pub size_bytes: u64,
    pub is_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRecord {
    #[serde(flatten)]
    pub meta: ProjectMeta,
    pub risk: RiskAssessment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub found_count: usize,
    pub current_path: String,
}

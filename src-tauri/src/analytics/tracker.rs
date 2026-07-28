use crate::db::Database;
use rusqlite::params_from_iter;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageRecord {
    pub id: i64,
    pub session_id: String,
    pub model: String,
    pub project_path: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub recorded_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyticsSummary {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
    pub records_count: i64,
    pub by_model: Vec<ModelCost>,
    pub by_date: Vec<DailyCost>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCost {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyCost {
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectCost {
    pub project_path: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub sessions_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionCost {
    pub session_id: String,
    pub model: String,
    pub project_path: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub first_recorded: String,
    pub last_recorded: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeCost {
    pub period: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelPricing {
    pub model: String,
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
}

/// Build a parameterized WHERE clause for date filtering.
/// Returns (SQL fragment with ?N placeholders, Vec of parameter values).
/// Uses parameterized queries to prevent SQL injection.
fn build_date_filter(start_date: &Option<String>, end_date: &Option<String>) -> (String, Vec<String>) {
    match (start_date, end_date) {
        (Some(s), Some(e)) => (
            "WHERE recorded_at >= ? AND recorded_at <= ?".to_string(),
            vec![s.clone(), e.clone()],
        ),
        (Some(s), None) => (
            "WHERE recorded_at >= ?".to_string(),
            vec![s.clone()],
        ),
        (None, Some(e)) => (
            "WHERE recorded_at <= ?".to_string(),
            vec![e.clone()],
        ),
        (None, None) => (String::new(), vec![]),
    }
}

/// Escape a value for safe CSV output. If the value contains commas, quotes,
/// or newlines, wrap it in double quotes and escape internal double quotes
/// by doubling them (per RFC 4180).
fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[tauri::command]
pub async fn analytics_record(
    session_id: String,
    model: String,
    project_path: String,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO usage_records (session_id, model, project_path, input_tokens, output_tokens, cost_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![session_id, model, project_path, input_tokens, output_tokens, cost_usd],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn analytics_summary(
    start_date: Option<String>,
    end_date: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<AnalyticsSummary, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let (date_filter, params) = build_date_filter(&start_date, &end_date);

    // Total summary
    let sql = format!(
        "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0), COUNT(*) FROM usage_records {}",
        date_filter
    );
    let (total_input, total_output, total_cost, count): (i64, i64, f64, i64) = conn.query_row(
        &sql, params_from_iter(params.iter()), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    ).map_err(|e| e.to_string())?;

    // By model
    let sql = format!(
        "SELECT model, SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) FROM usage_records {} GROUP BY model ORDER BY SUM(cost_usd) DESC",
        date_filter
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let by_model = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(ModelCost {
            model: row.get(0)?,
            input_tokens: row.get(1)?,
            output_tokens: row.get(2)?,
            cost_usd: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    // By date
    let sql = format!(
        "SELECT date(recorded_at) as d, SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) FROM usage_records {} GROUP BY d ORDER BY d",
        date_filter
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let by_date = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(DailyCost {
            date: row.get(0)?,
            input_tokens: row.get(1)?,
            output_tokens: row.get(2)?,
            cost_usd: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(AnalyticsSummary {
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cost_usd: total_cost,
        records_count: count,
        by_model,
        by_date,
    })
}

#[tauri::command]
pub async fn analytics_export_csv(
    start_date: Option<String>,
    end_date: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let (date_filter, params) = build_date_filter(&start_date, &end_date);

    let sql = format!(
        "SELECT session_id, model, project_path, input_tokens, output_tokens, cost_usd, recorded_at FROM usage_records {} ORDER BY recorded_at",
        date_filter
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut csv = String::from("session_id,model,project_path,input_tokens,output_tokens,cost_usd,recorded_at\n");

    let rows = stmt.query_map(params_from_iter(params.iter()), |row| {
        let session_id: String = row.get(0)?;
        let model: String = row.get(1)?;
        let project_path: String = row.get(2)?;
        let input_tokens: i64 = row.get(3)?;
        let output_tokens: i64 = row.get(4)?;
        let cost_usd: f64 = row.get(5)?;
        let recorded_at: String = row.get(6)?;
        Ok(format!(
            "{},{},{},{},{},{},{}\n",
            csv_escape(&session_id),
            csv_escape(&model),
            csv_escape(&project_path),
            input_tokens,
            output_tokens,
            cost_usd,
            csv_escape(&recorded_at),
        ))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        csv.push_str(&row.map_err(|e| e.to_string())?);
    }

    Ok(csv)
}

#[tauri::command]
pub async fn analytics_by_project(
    start_date: Option<String>,
    end_date: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Vec<ProjectCost>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (date_filter, params) = build_date_filter(&start_date, &end_date);

    let sql = format!(
        "SELECT project_path, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0), COUNT(DISTINCT session_id) FROM usage_records {} GROUP BY project_path ORDER BY SUM(cost_usd) DESC",
        date_filter
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let results = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(ProjectCost {
            project_path: row.get(0)?,
            input_tokens: row.get(1)?,
            output_tokens: row.get(2)?,
            cost_usd: row.get(3)?,
            sessions_count: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(results)
}

#[tauri::command]
pub async fn analytics_by_session(
    start_date: Option<String>,
    end_date: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Vec<SessionCost>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (date_filter, params) = build_date_filter(&start_date, &end_date);

    let sql = format!(
        "SELECT session_id, model, project_path, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0), MIN(recorded_at), MAX(recorded_at) FROM usage_records {} GROUP BY session_id ORDER BY MAX(recorded_at) DESC",
        date_filter
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let results = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(SessionCost {
            session_id: row.get(0)?,
            model: row.get(1)?,
            project_path: row.get(2)?,
            input_tokens: row.get(3)?,
            output_tokens: row.get(4)?,
            cost_usd: row.get(5)?,
            first_recorded: row.get(6)?,
            last_recorded: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(results)
}

#[tauri::command]
pub async fn analytics_timeseries(
    start_date: Option<String>,
    end_date: Option<String>,
    granularity: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Vec<TimeCost>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (date_filter, params) = build_date_filter(&start_date, &end_date);

    let granularity = granularity.unwrap_or_else(|| "day".to_string());
    let group_expr = match granularity.as_str() {
        "week" => "strftime('%Y-W%W', recorded_at)",
        "month" => "strftime('%Y-%m', recorded_at)",
        _ => "date(recorded_at)", // "day" default
    };

    let sql = format!(
        "SELECT {group} as period, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0) FROM usage_records {filter} GROUP BY period ORDER BY period",
        group = group_expr,
        filter = date_filter
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let results = stmt.query_map(params_from_iter(params.iter()), |row| {
        Ok(TimeCost {
            period: row.get(0)?,
            input_tokens: row.get(1)?,
            output_tokens: row.get(2)?,
            cost_usd: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(results)
}

#[tauri::command]
pub async fn analytics_model_pricing() -> Result<Vec<ModelPricing>, String> {
    Ok(vec![
        ModelPricing { model: "claude-sonnet-4-6".into(), input_per_mtok: 3.0, output_per_mtok: 15.0 },
        ModelPricing { model: "claude-opus-4-6".into(), input_per_mtok: 15.0, output_per_mtok: 75.0 },
        ModelPricing { model: "claude-haiku-4-5-20251001".into(), input_per_mtok: 0.80, output_per_mtok: 4.0 },
    ])
}

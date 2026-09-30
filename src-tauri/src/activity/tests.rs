use super::*;
use serde_json::json;
fn actor() -> Actor {
    Actor {
        id: "panel-a".into(),
        name: "Backend review".into(),
        provider: "claude".into(),
        model: None,
        device: None,
    }
}

#[test]
fn office_tools_are_distinct_and_do_not_create_extra_turns() {
    let mut reader = claude::Transcript::default();
    reader.consume(
        &user("office-question", "Inspect and fix"),
        &actor(),
        "session",
    );
    let tool = json!({"type":"assistant","uuid":"tool-use","timestamp":"2026-09-30T10:00:02Z","message":{
        "id":"api-tool","content":[{"type":"tool_use","name":"Read","input":{"file_path":"secret.txt"}}]}});
    reader.consume(&tool, &actor(), "session");
    let recorded = reader.consume(&tool, &actor(), "session").pop().unwrap();
    assert_eq!(recorded.tools, vec!["Read"]);
    assert_eq!(recorded.current_tool.as_deref(), Some("Read"));
    assert!(!serde_json::to_string(&recorded)
        .unwrap()
        .contains("secret.txt"));
    let completed = reader
        .consume(
            &reply("done", "api-end", "Fixed", 1, 2),
            &actor(),
            "session",
        )
        .pop()
        .unwrap();
    assert_eq!(completed.tools, vec!["Read"]);
    assert!(completed.current_tool.is_none());
    assert_eq!(completed.status, "completed");

    let conn = database();
    let mut active = HashMap::new();
    for kind in ["commandExecution", "commandExecution", "fileChange"] {
        codex_event(&conn, &mut active, actor(), &json!({"method":"item/started","params":{"threadId":"office-thread","turnId":"office-turn","item":{"id":kind,"type":kind,"command":"private command"}}}), 10).unwrap();
    }
    let recorded = get(&conn, "codex:office-thread:office-turn")
        .unwrap()
        .unwrap();
    assert_eq!(recorded.tools, vec!["Bash", "Edit"]);
    assert_eq!(recorded.current_tool.as_deref(), Some("Edit"));
    assert!(!serde_json::to_string(&recorded)
        .unwrap()
        .contains("private command"));
    assert_eq!(read_page(&conn, None, None, None).unwrap().0.len(), 1);
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    create_tables(&conn).unwrap();
    conn
}
fn user(id: &str, text: &str) -> Value {
    json!({"type":"user","uuid":id,"timestamp":"2026-09-30T10:00:00Z","message":{"content":text}})
}
fn reply(uuid: &str, id: &str, text: &str, input: u64, output: u64) -> Value {
    json!({"type":"assistant","uuid":uuid,"timestamp":"2026-09-30T10:00:03Z","message":{
        "id":id,"model":"claude-sonnet","content":[{"type":"text","text":text}],"stop_reason":"end_turn",
        "usage":{"input_tokens":input,"output_tokens":output,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}})
}
#[test]
fn claude_deduplicates_usage_without_losing_text_blocks_or_counting_tool_results_as_questions() {
    let mut reader = claude::Transcript::default();
    let actor = actor();
    reader.consume(&user("u1", "Fix the test"), &actor, "session");
    reader.consume(
        &reply("a1", "api-1", "Investigating", 10, 5),
        &actor,
        "session",
    );
    reader.consume(&json!({"type":"user","uuid":"tool-result","timestamp":"2026-09-30T10:00:02Z","message":{"content":[{"type":"tool_result","content":"done"}]}}), &actor, "session");
    reader.consume(&reply("a2", "api-1", "Found it", 10, 9), &actor, "session");
    let record = reader
        .consume(&reply("a3", "api-2", "Fixed", 20, 15), &actor, "session")
        .pop()
        .unwrap();
    assert_eq!(record.prompt, "Fix the test");
    assert_eq!(record.response, "Investigating\n\nFound it\n\nFixed");
    assert_eq!(
        record.usage.unwrap(),
        Usage {
            input: 30,
            output: 24,
            cache_read: 2000,
            cache_write: 400,
            reasoning: 0
        }
    );
    let repeated = reader
        .consume(&reply("a3", "api-2", "Fixed", 20, 15), &actor, "session")
        .pop()
        .unwrap();
    assert_eq!(repeated.response.matches("Fixed").count(), 1);
}
#[test]
fn claude_partial_lines_retry_and_reimport_is_idempotent() {
    use std::io::Write;
    let path =
        std::env::temp_dir().join(format!("tessera-activity-{}.jsonl", uuid::Uuid::new_v4()));
    let conn = database();
    let actor = actor();
    let first = format!("{}\n", user("u1", "hello ğ"));
    let split = first.find('ğ').unwrap() + 1;
    // Stop in the middle of a UTF-8 character, as an active writer can.
    std::fs::write(&path, &first.as_bytes()[..split]).unwrap();
    let mut reader = claude::Transcript::default();
    assert!(reader.read(&path, &actor, "session").unwrap().is_empty());
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&first.as_bytes()[split..])
        .unwrap();
    for record in reader.read(&path, &actor, "session").unwrap() {
        save(&conn, &record).unwrap();
    }
    assert!(reader.read(&path, &actor, "session").unwrap().is_empty());
    let mut restarted = claude::Transcript::default();
    for record in restarted.read(&path, &actor, "session").unwrap() {
        save(&conn, &record).unwrap();
    }
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM activity_records", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    std::fs::remove_file(path).unwrap();
}
fn event(conn: &Connection, active: &mut HashMap<String, String>, method: &str, params: Value) {
    let mut actor = actor();
    actor.provider = "codex".into();
    codex_event(
        conn,
        active,
        actor,
        &json!({"method":method,"params":params}),
        100,
    )
    .unwrap();
}
fn tokens(input: u64, cached: u64, output: u64, reasoning: u64) -> Value {
    json!({"inputTokens":input,"cachedInputTokens":cached,"outputTokens":output,"reasoningOutputTokens":reasoning})
}
#[test]
fn codex_counts_each_update_once_and_keeps_cache_and_reasoning_as_subsets() {
    let conn = database();
    let mut active = HashMap::new();
    event(
        &conn,
        &mut active,
        "activity/session",
        json!({"threadId":"s","fresh":true}),
    );
    event(
        &conn,
        &mut active,
        "turn/started",
        json!({"threadId":"s","turn":{"id":"t"}}),
    );
    let update = json!({"threadId":"s","turnId":"t","tokenUsage":{"total":tokens(100,60,20,8),"last":tokens(100,60,20,8)}});
    event(
        &conn,
        &mut active,
        "thread/tokenUsage/updated",
        update.clone(),
    );
    event(&conn, &mut active, "thread/tokenUsage/updated", update);
    event(
        &conn,
        &mut active,
        "thread/tokenUsage/updated",
        json!({"threadId":"s","turnId":"t","tokenUsage":{"total":tokens(200,120,50,18),"last":tokens(100,60,30,10)}}),
    );
    let record = get(&conn, "codex:s:t").unwrap().unwrap();
    assert_eq!(
        record.usage.unwrap(),
        Usage {
            input: 80,
            cache_read: 120,
            output: 50,
            reasoning: 18,
            cache_write: 0
        }
    );
    // A restart reloads the durable baseline, so replay does not add usage.
    active.clear();
    event(
        &conn,
        &mut active,
        "thread/tokenUsage/updated",
        json!({"threadId":"s","turnId":"t","tokenUsage":{"total":tokens(200,120,50,18),"last":tokens(100,60,30,10)}}),
    );
    assert_eq!(
        get(&conn, "codex:s:t")
            .unwrap()
            .unwrap()
            .usage
            .unwrap()
            .total(),
        250
    );
}
#[test]
fn resumed_codex_does_not_charge_historical_total_to_the_new_question() {
    let conn = database();
    let mut active = HashMap::new();
    event(
        &conn,
        &mut active,
        "turn/started",
        json!({"threadId":"s","turn":{"id":"t"}}),
    );
    event(
        &conn,
        &mut active,
        "thread/tokenUsage/updated",
        json!({"threadId":"s","turnId":"t","tokenUsage":{"total":tokens(90000,40000,10000,2000),"last":tokens(100,60,20,8)}}),
    );
    let record = get(&conn, "codex:s:t").unwrap().unwrap();
    assert_eq!(record.usage.unwrap().total(), 120);
    assert!(record.usage_note.is_some());
}
#[test]
fn missing_usage_is_not_zero_and_completed_items_replace_replays() {
    let conn = database();
    let mut active = HashMap::new();
    event(
        &conn,
        &mut active,
        "item/completed",
        json!({"threadId":"s","turnId":"t","item":{"id":"u","type":"userMessage","content":[{"type":"text","text":"Review"}]}}),
    );
    for _ in 0..2 {
        event(
            &conn,
            &mut active,
            "item/completed",
            json!({"threadId":"s","turnId":"t","item":{"id":"a","type":"agentMessage","text":"Looks good"}}),
        );
    }
    event(
        &conn,
        &mut active,
        "turn/completed",
        json!({"threadId":"s","turn":{"id":"t","status":"interrupted"}}),
    );
    let record = get(&conn, "codex:s:t").unwrap().unwrap();
    assert_eq!(record.prompt, "Review");
    assert_eq!(record.response, "Looks good");
    assert!(record.usage.is_none());
    assert_eq!(record.status, "interrupted");
}
#[test]
fn handoffs_link_by_unique_transport_id_even_with_identical_names_and_messages() {
    let id = uuid::Uuid::new_v4();
    let mut record = Record::turn("test".into(), actor(), "session".into(), 0);
    record.set_prompt(format!(
        "[panel-message from \"Backend review\" · hop 3 · activity {id}]\nCheck this"
    ));
    assert_eq!(record.parent_id, Some(format!("handoff:{id}")));
    assert_eq!(record.prompt, "Check this");
    assert_eq!(record.origin, "panel");
    let mut reader = claude::Transcript::default();
    let imported = reader
        .consume(
            &user(
                "u",
                &format!(
                    "[panel-message from \"Backend review\" · hop 3 · activity {id}]\nCheck this"
                ),
            ),
            &actor(),
            "s",
        )
        .pop()
        .unwrap();
    assert_eq!(imported.parent_id, record.parent_id);
    assert!(trace_message("The user said activity 123").is_none());
}

#[test]
fn codex_preserves_multiple_user_sends_within_one_turn() {
    let conn = database();
    let mut active = HashMap::new();
    for (id, text) in [
        ("u1", "Build it"),
        ("u2", "Also cover errors"),
        ("u2", "Also cover errors"),
    ] {
        event(
            &conn,
            &mut active,
            "item/completed",
            json!({"threadId":"s","turnId":"t","item":{"id":id,"type":"userMessage","content":[{"type":"text","text":text}]}}),
        );
    }
    let record = get(&conn, "codex:s:t").unwrap().unwrap();
    assert_eq!(record.prompt, "Build it\n\nAlso cover errors");
    assert_eq!(record.prompt_parts.len(), 2);
}

#[test]
fn codex_new_cache_write_counter_stays_inside_reported_total() {
    let usage = Usage::codex(&json!({"inputTokens":100,"outputTokens":20,"cachedInputTokens":40,"cacheWriteInputTokens":25,"reasoningOutputTokens":10,"totalTokens":120})).unwrap();
    assert_eq!(usage.input, 35);
    assert_eq!(usage.cache_write, 25);
    assert_eq!(usage.total(), 120);
}

#[test]
fn saved_history_and_usage_baselines_survive_database_reopen() {
    let path = std::env::temp_dir().join(format!("tessera-activity-{}.db", uuid::Uuid::new_v4()));
    {
        let conn = Connection::open(&path).unwrap();
        create_tables(&conn).unwrap();
        let mut active = HashMap::new();
        event(
            &conn,
            &mut active,
            "turn/started",
            json!({"threadId":"s","turn":{"id":"t"}}),
        );
        event(
            &conn,
            &mut active,
            "activity/session",
            json!({"threadId":"s","fresh":true}),
        );
        event(
            &conn,
            &mut active,
            "thread/tokenUsage/updated",
            json!({"threadId":"s","turnId":"t","tokenUsage":{"total":tokens(100,60,20,8)}}),
        );
    }
    {
        let conn = Connection::open(&path).unwrap();
        create_tables(&conn).unwrap();
        assert_eq!(
            get(&conn, "codex:s:t")
                .unwrap()
                .unwrap()
                .usage
                .unwrap()
                .total(),
            120
        );
        let mut active = HashMap::new();
        event(
            &conn,
            &mut active,
            "thread/tokenUsage/updated",
            json!({"threadId":"s","turnId":"t","tokenUsage":{"total":tokens(150,90,30,12)}}),
        );
        assert_eq!(
            get(&conn, "codex:s:t")
                .unwrap()
                .unwrap()
                .usage
                .unwrap()
                .total(),
            180
        );
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn disconnect_finishes_running_turn_but_preserves_completed_status() {
    let conn = database();
    let mut active = HashMap::new();
    event(
        &conn,
        &mut active,
        "turn/started",
        json!({"threadId":"s","turn":{"id":"t"}}),
    );
    event(
        &conn,
        &mut active,
        "tessera/disconnected",
        json!({"threadId":"s"}),
    );
    assert_eq!(
        get(&conn, "codex:s:t").unwrap().unwrap().status,
        "interrupted"
    );
    event(
        &conn,
        &mut active,
        "turn/completed",
        json!({"threadId":"s","turn":{"id":"t","status":"completed"}}),
    );
    event(
        &conn,
        &mut active,
        "tessera/disconnected",
        json!({"threadId":"s"}),
    );
    assert_eq!(
        get(&conn, "codex:s:t").unwrap().unwrap().status,
        "completed"
    );
}

#[test]
fn date_and_cursor_pagination_do_not_skip_records_with_identical_timestamps() {
    let conn = database();
    for (id, at) in [("a", 100), ("b", 100), ("c", 100), ("old", 10)] {
        save(&conn, &Record::turn(id.into(), actor(), "s".into(), at)).unwrap();
    }
    let (first, more) = read_page(&conn, None, Some(50), Some(2)).unwrap();
    assert!(more);
    assert_eq!(
        first.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["c", "b"]
    );
    let (second, more) = read_page(
        &conn,
        Some(Cursor {
            at: 100,
            id: "b".into(),
        }),
        Some(50),
        Some(2),
    )
    .unwrap();
    assert!(!more);
    assert_eq!(
        second.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["a"]
    );
}

#[test]
fn resume_usage_seeds_a_baseline_without_inventing_a_new_turn() {
    let conn = database();
    let mut active = HashMap::new();
    event(
        &conn,
        &mut active,
        "thread/tokenUsage/updated",
        json!({"threadId":"s","turnId":"old","tokenUsage":{"total":tokens(90000,40000,10000,2000),"last":tokens(100,60,20,8)}}),
    );
    assert!(get(&conn, "codex:s:old").unwrap().is_none());
    event(
        &conn,
        &mut active,
        "turn/started",
        json!({"threadId":"s","turn":{"id":"new"}}),
    );
    event(
        &conn,
        &mut active,
        "thread/tokenUsage/updated",
        json!({"threadId":"s","turnId":"new","tokenUsage":{"total":tokens(90100,40060,10020,2008),"last":tokens(100,60,20,8)}}),
    );
    assert_eq!(
        get(&conn, "codex:s:new")
            .unwrap()
            .unwrap()
            .usage
            .unwrap()
            .total(),
        120
    );
}

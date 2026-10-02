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
#[test]
fn terminal_activity_stays_running_through_tools_and_finishes_explicitly() {
    let mut reader = claude::Transcript::default();
    let first = reader.consume(&user("q", "Run the long task"), &actor(), "session").pop().unwrap();
    assert_eq!(first.status, "running");
    reader.consume(&json!({"type":"assistant","uuid":"tool","timestamp":"2026-09-30T10:00:01Z","message":{
        "id":"m1","stop_reason":"tool_use","content":[{"type":"tool_use","id":"call","name":"Bash"}]}}), &actor(), "session");
    let continued = reader.consume(&json!({"type":"user","timestamp":"2026-09-30T10:05:01Z","message":{
        "content":[{"type":"tool_result","tool_use_id":"call","content":"done"}]}}), &actor(), "session").pop().unwrap();
    assert_eq!(continued.id, first.id);
    assert_eq!(continued.prompt, first.prompt);
    assert_eq!(continued.status, "running");
    assert!(continued.updated_at > first.updated_at);
    assert!(continued.current_tool.is_none());
    assert_eq!(continued.tools, ["Bash"]);
    let done = reader.consume(&json!({"type":"system","subtype":"turn_duration","timestamp":"2026-09-30T10:06:00Z"}), &actor(), "session").pop().unwrap();
    assert_eq!(done.status, "completed");
    assert_eq!(done.id, first.id);
}

#[test]
fn interrupted_terminal_turns_do_not_create_prompts_or_earn_completion_rewards() {
    let mut reader = claude::Transcript::default();
    let first = reader.consume(&user("q", "Inspect the project"), &actor(), "session").pop().unwrap();
    let stopped = reader.consume(&user("interrupted", "[Request interrupted by user]"), &actor(), "session").pop().unwrap();
    assert_eq!(stopped.id, first.id);
    assert_eq!(stopped.prompt, first.prompt);
    assert_eq!(stopped.status, "interrupted");
    assert!(reader.consume(&json!({"type":"system","subtype":"turn_duration","timestamp":"2026-09-30T10:06:00Z"}), &actor(), "session").is_empty());
}

#[test]
fn current_sessions_can_recover_turns_before_the_office_start_and_after_panel_restore() {
    let conn = database();
    let mut previous = Record::turn("old-question".into(), actor(), "same-session".into(), 1);
    previous.status = "completed".into();
    save(&conn, &previous).unwrap();
    let mut running = Record::turn("current-question".into(), actor(), "same-session".into(), 2);
    running.status = "running".into();
    running.current_tool = Some("Bash".into());
    save(&conn, &running).unwrap();
    let mut another_provider = running.clone();
    another_provider.id = "other-provider".into();
    another_provider.started_at = 3;
    another_provider.actor.provider = "codex".into();
    save(&conn, &another_provider).unwrap();
    assert!(read_page(&conn, None, Some(1000), Some(500)).unwrap().0.is_empty());
    let session = LiveSession { provider: "claude".into(), session_id: "same-session".into() };
    let found = latest_session_turn(&conn, &session).unwrap().unwrap();
    assert_eq!(found.id, running.id);
    assert_eq!(found.actor.id, "panel-a"); // Caller can now have a different panel ID.
    running.status = "completed".into();
    save(&conn, &running).unwrap();
    assert_eq!(latest_session_turn(&conn, &session).unwrap().unwrap().status, "completed");
    assert!(latest_session_turn(&conn, &LiveSession { provider: "claude".into(), session_id: "missing".into() }).unwrap().is_none());
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

fn agy(conn: &Connection, event: Value, at: i64) {
    let actor = Actor {
        id: "panel-g".into(),
        name: "Gemini build".into(),
        provider: "antigravity".into(),
        model: Some("gemini-3.8-flash-low".into()),
        device: None,
    };
    antigravity_event(conn, actor, &event, at).unwrap();
}
fn agy_usage(input: u64, output: u64, thinking: u64) -> Value {
    json!({"input_tokens":input,"output_tokens":output,"thinking_tokens":thinking,"cache_read_tokens":0,"total_tokens":input+output})
}
fn agy_turn(conn: &Connection, turn: &str) -> Record {
    get(conn, &format!("antigravity:conv:{turn}"))
        .unwrap()
        .unwrap()
}

/// Counter values recorded from agy 1.2.15: `result.usage` grows across turns
/// and across a resumed process; per-step usage belongs to one model call.
#[test]
fn antigravity_cumulative_usage_becomes_per_turn_deltas_and_duplicates_change_nothing() {
    let conn = database();
    agy(&conn, json!({"type":"session","session":"conv","fresh":true}), 1);
    // A tool event before its question is known must not invent a turn.
    agy(&conn, json!({"type":"tool","session":"conv","turn":"t1","tool":"Bash","active":true}), 5);
    assert!(get(&conn, "antigravity:conv:t1").unwrap().is_none());
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"t1","prompt":"Create the note and run the checks"}), 10);
    agy(&conn, json!({"type":"tool","session":"conv","turn":"t1","tool":"Write","active":true}), 11);
    agy(&conn, json!({"type":"tool","session":"conv","turn":"t1","tool":"Write","active":false}), 12);
    agy(&conn, json!({"type":"tool","session":"conv","turn":"t1","tool":"Bash","active":true}), 13);
    let running = agy_turn(&conn, "t1");
    assert_eq!(
        (running.status.as_str(), running.actor.provider.as_str()),
        ("running", "antigravity")
    );
    assert_eq!(running.tools, ["Write", "Bash"]);
    assert_eq!(running.current_tool.as_deref(), Some("Bash"));
    assert_eq!((running.origin.as_str(), running.usage.is_none()), ("user", true));
    agy(&conn, json!({"type":"response","session":"conv","turn":"t1","step":6,"text":"Created"}), 14);
    agy(&conn, json!({"type":"response","session":"conv","turn":"t1","step":6,"text":"Created the note.\n"}), 15);
    let finish = json!({"type":"turn_finished","session":"conv","turn":"t1","status":"completed","cumulative":agy_usage(12529,699,330),"steps":agy_usage(12529,699,330)});
    agy(&conn, finish.clone(), 20);
    let done = agy_turn(&conn, "t1");
    assert_eq!(done.status, "completed");
    assert_eq!(done.response, "Created the note.");
    assert!(done.current_tool.is_none() && done.usage_note.is_none());
    assert_eq!(
        done.usage,
        Some(Usage {
            input: 12529,
            output: 699,
            reasoning: 330,
            ..Usage::default()
        })
    );
    assert_eq!(done.usage.as_ref().unwrap().total(), 13228);
    // Duplicate end and late events: no second delta, no reopened turn.
    agy(&conn, finish, 21);
    agy(&conn, json!({"type":"tool","session":"conv","turn":"t1","tool":"Edit","active":true}), 22);
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"t1","prompt":"again"}), 23);
    let same = agy_turn(&conn, "t1");
    assert_eq!(
        (same.usage, same.tools, same.status, same.updated_at),
        (done.usage, done.tools, done.status, 20)
    );

    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"t2","prompt":"What was the word?"}), 30);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"t2","status":"completed","cumulative":agy_usage(26237,737,365),"steps":agy_usage(13708,38,35)}), 40);
    assert_eq!(
        agy_turn(&conn, "t2").usage,
        Some(Usage {
            input: 13708,
            output: 38,
            reasoning: 35,
            ..Usage::default()
        })
    );
    // The same conversation continues in a new process: the counter keeps growing.
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"t3","prompt":"Resumed"}), 50);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"t3","status":"completed","cumulative":agy_usage(40198,770,395),"steps":agy_usage(13961,33,30)}), 60);
    assert_eq!(agy_turn(&conn, "t3").usage.unwrap().total(), 13994);
    let all = read_page(&conn, None, None, None).unwrap().0;
    assert_eq!(all.len(), 3);
    assert_eq!(
        all.iter()
            .map(|r| r.usage.as_ref().unwrap().total())
            .sum::<u64>(),
        40198 + 770
    );
}

#[test]
fn antigravity_resumed_interrupted_and_missing_usage_is_never_inflated_or_invented() {
    let conn = database();
    // First seen mid-life (restored panel): the lifetime total is not this turn's cost.
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"r1","prompt":"Continue"}), 10);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"r1","status":"completed","cumulative":agy_usage(40198,770,395),"steps":agy_usage(13961,33,30)}), 20);
    let first = agy_turn(&conn, "r1");
    assert_eq!(first.usage.as_ref().unwrap().total(), 13994);
    assert!(first
        .usage_note
        .unwrap()
        .contains("earlier usage was not observed"));
    // Without per-step numbers the only honest answer is "unavailable".
    let other = database();
    agy(&other, json!({"type":"turn_started","session":"conv","turn":"r1","prompt":"Continue"}), 10);
    agy(&other, json!({"type":"turn_finished","session":"conv","turn":"r1","status":"completed","cumulative":agy_usage(40198,770,395),"steps":null}), 20);
    let unknown = agy_turn(&other, "r1");
    assert!(unknown.usage.is_none() && unknown.usage_note.unwrap().contains("unavailable"));

    // Stopped after one completed step: counted once, and not again in the next turn.
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"r2","prompt":"Long task"}), 30);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"r2","status":"interrupted","cumulative":null,"steps":agy_usage(100,10,0)}), 40);
    let stopped = agy_turn(&conn, "r2");
    assert_eq!(
        (stopped.status.as_str(), stopped.usage.as_ref().unwrap().total()),
        ("interrupted", 110)
    );
    assert!(stopped.usage_note.unwrap().contains("completed steps"));
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"r3","prompt":"Next"}), 50);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"r3","status":"completed","cumulative":agy_usage(40198+100+500,770+10+50,395),"steps":agy_usage(500,50,0)}), 60);
    assert_eq!(agy_turn(&conn, "r3").usage.unwrap().total(), 550);

    // Stopped before anything was reported: unavailable, not zero.
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"r4","prompt":"Stopped early"}), 70);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"r4","status":"interrupted","cumulative":null,"steps":null}), 80);
    let early = agy_turn(&conn, "r4");
    assert!(early.usage.is_none() && early.usage_note.unwrap().contains("did not report"));

    // The CLI's counter restarted below the baseline: fall back to the turn's own steps.
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"r5","prompt":"After reset"}), 90);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"r5","status":"completed","cumulative":agy_usage(12704,36,32),"steps":agy_usage(12704,36,32)}), 100);
    assert_eq!(agy_turn(&conn, "r5").usage.unwrap().total(), 12740);
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"r6","prompt":"Then"}), 110);
    agy(&conn, json!({"type":"turn_finished","session":"conv","turn":"r6","status":"failed","cumulative":agy_usage(12804,46,32),"steps":null}), 120);
    let failed = agy_turn(&conn, "r6");
    assert_eq!(
        (failed.status.as_str(), failed.usage.unwrap().total()),
        ("failed", 110)
    );
}

#[test]
fn antigravity_links_incoming_handoffs_and_normalizes_cached_input() {
    let conn = database();
    let trace = "6f1f5f0e-8a6d-4a55-9d7c-0a3c5a3c9b11";
    agy(&conn, json!({"type":"turn_started","session":"conv","turn":"h1",
        "prompt":format!("[panel-message from \"Claude review\" · hop 1 · activity {trace}]\nPlease run the build")}), 10);
    let linked = agy_turn(&conn, "h1");
    assert_eq!(linked.parent_id, Some(format!("handoff:{trace}")));
    assert_eq!(
        (linked.origin.as_str(), linked.prompt.as_str()),
        ("panel", "Please run the build")
    );
    // total = input + output: cached input is inside input and must not count twice.
    let inside = Usage::antigravity(&json!({"input_tokens":1000,"output_tokens":50,"thinking_tokens":20,"cache_read_tokens":400,"total_tokens":1050})).unwrap();
    assert_eq!((inside.input, inside.cache_read, inside.total()), (600, 400, 1050));
    let separate = Usage::antigravity(&json!({"input_tokens":1000,"output_tokens":50,"thinking_tokens":20,"cache_read_tokens":400,"total_tokens":1450})).unwrap();
    assert_eq!((separate.input, separate.total()), (1000, 1450));
    assert!(Usage::antigravity(&Value::Null).is_none());
}

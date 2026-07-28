use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    pub scope: String, // "builtin", "user", "project"
    pub source_path: Option<String>,
}

fn builtin_commands() -> Vec<SlashCommand> {
    vec![
        SlashCommand { name: "/help".into(), description: "Show help and available commands [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/clear".into(), description: "Clear conversation history and free context".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/compact".into(), description: "Compact conversation to save context [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/config".into(), description: "View or modify Claude Code configuration [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/cost".into(), description: "Show token usage and cost for this session [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/usage".into(), description: "View token usage for the current billing month [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/model".into(), description: "Set or switch the AI model [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/status".into(), description: "Show account and system status [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/review".into(), description: "Ask Claude to do a code review [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/init".into(), description: "Initialize project by creating CLAUDE.md [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/memory".into(), description: "Edit CLAUDE.md memory files [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/permissions".into(), description: "View or update tool permissions [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/doctor".into(), description: "Check Claude Code installation health [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/bug".into(), description: "Report a bug to Anthropic [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/pr_comments".into(), description: "Get comments on the current pull request [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/release-notes".into(), description: "View latest Claude Code release notes [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/vim".into(), description: "Toggle vim keybindings mode [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/terminal-setup".into(), description: "Install Shift+Enter key binding for newlines [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/login".into(), description: "Switch Anthropic accounts [terminal]".into(), scope: "builtin".into(), source_path: None },
        SlashCommand { name: "/logout".into(), description: "Logout from your Anthropic account [terminal]".into(), scope: "builtin".into(), source_path: None },
    ]
}

fn scan_command_dir(dir: &PathBuf, scope: &str) -> Vec<SlashCommand> {
    let mut commands = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                let name = path
                    .file_stem()
                    .map(|s| format!("/{}", s.to_string_lossy()))
                    .unwrap_or_default();

                // Try to read description from YAML frontmatter
                let description = if let Ok(content) = std::fs::read_to_string(&path) {
                    parse_frontmatter_description(&content)
                        .unwrap_or_else(|| format!("Custom command from {}", scope))
                } else {
                    format!("Custom command from {}", scope)
                };

                commands.push(SlashCommand {
                    name,
                    description,
                    scope: scope.to_string(),
                    source_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }
    commands
}

fn parse_frontmatter_description(content: &str) -> Option<String> {
    if !content.starts_with("---") {
        return None;
    }
    let rest = &content[3..];
    let end = rest.find("---")?;
    let frontmatter = &rest[..end];
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("description:") {
            return Some(
                trimmed
                    .strip_prefix("description:")?
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            );
        }
    }
    None
}

#[tauri::command]
pub async fn list_slash_commands(cwd: String) -> Result<Vec<SlashCommand>, String> {
    let mut commands = builtin_commands();

    // User-scope commands: ~/.claude/commands/*.md
    if let Some(home) = dirs::home_dir() {
        let user_dir = home.join(".claude").join("commands");
        commands.extend(scan_command_dir(&user_dir, "user"));
    }

    // Project-scope commands: {cwd}/.claude/commands/*.md
    if !cwd.is_empty() && cwd != "." {
        let project_dir = PathBuf::from(&cwd).join(".claude").join("commands");
        commands.extend(scan_command_dir(&project_dir, "project"));
    }

    Ok(commands)
}

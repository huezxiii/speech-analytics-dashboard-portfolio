# AGENTS.md — Token-Efficiency & Memory Contract

Applies to Codex CLI, ChatGPT agent modes, and any coding agent working in this repo.
Rules here are **mandatory**, not suggestions. Verify before you rationalize.

> **This file is a portable template.** Copy it to any project as `AGENTS.md` with no
> edits. It pins no versions, no process ids, and no per-repo statistics — §0 discovers
> all of that at session start. If you find yourself hardcoding a number in here, you are
> reintroducing the staleness this template exists to avoid.

---

## 0. Preflight — discover state, do not assume it

Run this block before any other tool call. It replaces every fact that would otherwise
go stale in this document.

```bash
rtk --version && rtk gain
tokensave --version
cat ~/.claude/.caveman-active 2>/dev/null   # level: lite | full | ultra, or absent
ls .planning/STATE.md AGENTS.md 2>/dev/null
curl -s -o /dev/null -w "claude-mem worker: %{http_code}\n" http://localhost:37777
```

Then call `tokensave_status` (MCP) and read from its output:

- `node_count` / `edge_count` / `file_count` — the graph's actual size **for this repo**
- `scope_prefix` — confirms the graph is scoped to this project, not another
- `last_sync_at` — if stale or absent, the graph does not reflect current code
- `version` — compare against the upgrade notice in the same response

**Report the results to the user in one line.** Do not proceed silently past a failure —
a session without these tools burns 5–10x the tokens, and there is no other signal in
the transcript that it happened.

If `tokensave_status` errors or `node_count` is 0, this repo is not indexed yet:

```bash
tokensave init && tokensave sync
```

Until that finishes, §2's rules cannot be followed — say so rather than falling back to
grep without telling the user.

---

## 1. RTK — CLI output compression (MANDATORY prefix)

RTK is a proxy that filters and summarizes command output before it reaches context.
Run `rtk gain` to see the measured savings on this machine; it is typically 80%+, and
`rtk read` alone dominates the total because whole-file reads are the single largest
token sink in agent sessions.

**In Claude Code** a `PreToolUse` hook (`rtk hook claude`) rewrites commands
automatically. **Codex has no such hook** — `rtk hook` supports only
`claude | cursor | gemini | copilot`. Confirm with `rtk hook --help`. In Codex and
ChatGPT you MUST type the `rtk` prefix yourself, every time.

| Instead of | Always run |
|---|---|
| `cat FILE`, `head`, `tail`, `sed -n` | `rtk read FILE` |
| `grep -rn PAT .` | `rtk grep -rn PAT .` |
| `rg PAT` | `rtk rg PAT` |
| `ls -la` | `rtk ls -la` |
| `tree` | `rtk tree` |
| `find . -name X` | `rtk find . -name X` |
| `git status` / `log` / `diff` / `commit` | `rtk git <sub>` |
| `gh ...` / `glab ...` | `rtk gh ...` / `rtk glab ...` |
| `npm test`, `pytest`, `vitest`, `go test` | `rtk test <cmd>` |
| `docker ...` / `kubectl ...` / `oc ...` | `rtk docker ...` etc. |
| any noisy build | `rtk err <cmd>` (errors and warnings only) |

Also available: `rtk diff`, `rtk log`, `rtk json`, `rtk deps`, `rtk env`, `rtk summary`,
`rtk smart`, `rtk psql`, `rtk aws`, `rtk pnpm`, `rtk dotnet`. Run `rtk --help` for the
current list rather than trusting this one.

Escape hatch: `rtk proxy <cmd>` runs raw and unfiltered — debugging only.

Dry-run a rewrite without executing it:

```bash
rtk hook check "git status"
```

### Known limitation

The RTK PreToolUse hook rewrites Bash command strings before the shell sees them.
Multi-line heredocs containing markdown fences or backticks can fail to survive that
round-trip with `unexpected EOF while looking for matching quote`. Write such files with
your host's native file-write tool instead of a shell heredoc.

---

## 1b. Caveman — response compression (zero-effort, keep it on)

Caveman compresses the model's own prose: drops articles, filler, pleasantries, and
hedging; fragments are fine. It is the only tool here that costs nothing per call and
demands no discipline from the agent — it just runs.

**Unlike RTK, this ports to Codex cleanly.** Caveman ships native Codex support
(`.codex/config.toml`, `.codex/hooks.json`, and `.toml` twins of every command). Its
Codex wiring is a `SessionStart` hook that injects the rules — no `PreToolUse` command
rewriting involved, so nothing is lost moving between hosts.

Register as `[marketplaces.caveman]` plus `[plugins."caveman@caveman"]` in
`~/.codex/config.toml`, or `"caveman@caveman": true` in `~/.claude/settings.json`.

Levels: `/caveman lite|full|ultra`. Deactivate with "stop caveman" or "normal mode".
Active mode is stored in `~/.claude/.caveman-active` — read it rather than assuming.

### Hard boundary — never compress these

Code blocks, commit messages, PR bodies, security warnings, irreversible-action
confirmations, and exact error strings are written **normal**. Compression applies to
prose only. A caveman commit message or a truncated error string is a bug, not a saving.

Drop back to full clarity for multi-step sequences too, where omitted conjunctions make
ordering ambiguous.

### Never invent abbreviations

Do not shorten to `cfg`, `impl`, `req`, `res`, `fn`. Tokenizers split those the same as
the full word — zero tokens saved and the reader still has to decode. Standard acronyms
(DB, API, HTTP) are fine.

### Measuring

`/caveman-stats` reports session usage plus lifetime savings. It needs accumulated data
in `~/.claude/.caveman-mode-log.jsonl`; a fresh install has nothing to report. **Do not
quote a savings figure you have not seen it print.**

Install: https://github.com/JuliusBrussee/caveman

---

## 2. tokensave — code graph (MANDATORY for all code exploration)

Graph size for this repo comes from `tokensave_status` in §0. Do not assume a number.

### Hard rule

**Never launch a general-purpose or Explore subagent for code research.**
**Never blind-grep the tree to answer a structural question.**
Query the graph first. No exceptions.

| Question | Tool |
|---|---|
| "how does X work / where do I start" | `tokensave_context` (start here, plain English) |
| "where is symbol Y" | `tokensave_search` |
| "what calls Y" / "what does Y call" | `tokensave_callers` / `tokensave_callees` |
| "what breaks if I change Y" | `tokensave_impact`, `tokensave_affected` |
| "show me Y's source" | `tokensave_body`, `tokensave_read` |
| "what changed on this branch" | `tokensave_branch_diff`, `tokensave_diff_context` |
| dead code, complexity, hotspots | `tokensave_dead_code`, `tokensave_complexity`, `tokensave_hotspots` |
| edits | `tokensave_str_replace`, `tokensave_multi_str_replace`, `tokensave_replace_symbol` |

For `tokensave_context`: pass conceptual synonyms in `keywords` (for "auth" pass
`["login","session","credential","token"]`), and feed each response's `seen_node_ids`
into the next call's `exclude_node_ids` so you never re-read the same nodes.

Fallback only if a tool genuinely cannot answer: query the SQLite DB directly. Get its
path from `tokensave_config` rather than hardcoding one; tables are `nodes`, `edges`,
`files`.

When a result carries a `tokensave_metrics:` line, report the savings to the user.

If you hit a gap tokensave cannot answer natively, tell the user to open an issue at
https://github.com/aovestdipaperino/tokensave — and remind them to strip proprietary
code from the report first.

---

## 3. Memory — read at start, write at end

Up to five stores may be present. **Detect which exist; never assume.** A store that is
absent or empty must be reported as such, not described as working — an agent told a
store is populated will trust that over its own empty query results and waste turns
concluding the tool is broken.

### 3a. `.planning/` (GSD) — authoritative project memory when present

```bash
ls .planning/STATE.md && rtk read .planning/STATE.md
```

When present, this is the project's institutional record: `STATE.md`, `PROJECT.md`,
`ROADMAP.md`, `REQUIREMENTS.md`, `RETROSPECTIVE.md`, per-phase
`N-CONTEXT.md` / `N-PLAN.md` / `N-UAT.md`, and milestone audits.

Never plan or estimate before reading `STATE.md`. Never hand-edit `state.json` — go
through the GSD commands. If `.planning/` does not exist, this project is not under GSD;
skip the section rather than inventing structure.

### 3b. tokensave decision log — the cheapest high-leverage win

Check with `tokensave_session_recall`. An empty `{"decisions": []}` means nothing has
ever been recorded here.

- `tokensave_session_start` at session open
- `tokensave_record_decision` on every non-obvious call — why this approach, what was
  rejected, what constraint forced it
- `tokensave_record_code_area` when you learn a subsystem's shape
- `tokensave_session_end` at close

Do this even in a repo where everything else is unconfigured.

### 3c. claude-mem — episodic session memory

Worker health is checked in §0. Tools: `observation_search`, `smart_search`,
`smart_outline`, `smart_unfold`, `timeline`, `query_corpus`. If the corpus is empty,
seeding it takes one command:

```
/learn-codebase
```

(~5 min; primes the whole repo). Do not cite a process id for the worker — look it up
if you need it.

### 3d. Native host memory — durable user and project facts

Claude Code keeps per-project memory under `~/.claude/projects/<slug>/memory/`, indexed
by `MEMORY.md`. Derive `<slug>` from the current path; do not copy another project's.
Holds durable facts only — not code structure, not git history, not anything the repo
already records.

### 3e. MemPalace / graphify — usually NOT initialized

Check for `~/.mempalace`, `.planning/graphs/`, `.planning/intel/`. The skills commonly
exist while the stores do not. Do not reference them as if they work.

---

## 4. Anti-patterns — these are failures, not style preferences

- `cat` / `head` / `tail` / bare `grep` on source → use `rtk read` / `rtk grep`
- Explore or general-purpose subagent to "find where X lives" → use `tokensave_context`
- Reading a 2000-line file to find one function → use `tokensave_body`
- Planning without reading `.planning/STATE.md` (where it exists)
- Ending a session with zero `record_decision` calls
- Dumping raw build or test logs into context → use `rtk err` / `rtk test`
- Re-deriving something already recorded in `.planning/` or the graph
- Writing a commit message, error string, or code block in compressed caveman prose
- Quoting a version, node count, or process id from this file instead of §0's output

---

## 5. Install and repair

Versions intentionally omitted — run the check commands and compare against what each
tool reports as current.

### RTK

```bash
winget install rtk-ai.rtk
rtk --version
rtk gain
```

`rtk gain` must return analytics, not an error.

**Name collision warning:** if `rtk gain` fails, you installed
`reachingforthejack/rtk` (Rust Type Kit) instead. Uninstall it and install the winget
package id `rtk-ai.rtk`.

Auto-rewrite hook, per host. Codex is not supported — use manual prefixes there.

```jsonc
// Claude Code — ~/.claude/settings.json, PreToolUse
{ "type": "command", "command": "rtk hook claude" }
```

Use `rtk hook cursor`, `rtk hook gemini`, or `rtk hook copilot` for those hosts.

### Caveman

Repo: https://github.com/JuliusBrussee/caveman

Installs as a plugin for both hosts, and unlike RTK it needs no per-host hook authoring —
the plugin ships its own `.codex/config.toml` and `.codex/hooks.json`.

```toml
# ~/.codex/config.toml
[marketplaces.caveman]
source = "https://github.com/JuliusBrussee/caveman.git"

[plugins."caveman@caveman"]
```

```jsonc
// Claude Code — ~/.claude/settings.json
"caveman@caveman": true
```

Verify with `cat ~/.claude/.caveman-active` (prints the level) and `/caveman-stats`.

### tokensave

Repo: https://github.com/aovestdipaperino/tokensave

```bash
tokensave upgrade          # if status reported a newer version
tokensave init && tokensave sync   # first time in a new repo
```

Register as an MCP server for Codex in `~/.codex/config.toml`:

```toml
[mcp_servers.tokensave]
command = "<absolute path to tokensave binary>"
```

### claude-mem

Repo: https://github.com/thedotmack/claude-mem

Register in `~/.codex/config.toml` as a marketplace plus an MCP server. Worker health
page: http://localhost:37777

### GSD

Installed per-project as `.codex/agents/*.toml` and `.codex/hooks.json`, backed by
`~/.codex/gsd-core/`. Install state is tracked in `~/.codex/gsd-install-state.json`.

---

## 6. Session checklist

Start:

- [ ] §0 preflight run, results reported in one line
- [ ] `tokensave_status` checked — graph exists, scope matches this repo, sync is fresh
- [ ] Caveman level confirmed active
- [ ] `.planning/STATE.md` read if it exists
- [ ] `tokensave_session_start`

During:

- [ ] Every shell command prefixed with `rtk`
- [ ] Every code question answered by tokensave before any file read
- [ ] `tokensave_record_decision` on each real decision
- [ ] Prose compressed; code, commits, and errors left verbatim

End:

- [ ] `tokensave_session_end`
- [ ] `.planning/` updated via GSD commands, where applicable
- [ ] Report the `rtk gain` delta for the session

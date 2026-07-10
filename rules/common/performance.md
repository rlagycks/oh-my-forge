# Performance Optimization

## Model Selection Strategy

Select by **alias tier**, not a pinned model name — the alias floats to the latest model in that tier automatically:

**`haiku`** tier — cheap/fast worker (e.g. Haiku 4.5):
- Lightweight agents with frequent invocation
- Pair programming and code generation
- Worker agents in multi-agent systems

**`sonnet`** tier — default coding workhorse (e.g. Sonnet 5):
- Main development work
- Orchestrating multi-agent workflows
- Complex coding tasks

**`opus`** tier — deep reasoning, supports fast mode (e.g. Opus 4.8):
- Complex architectural decisions
- Maximum reasoning requirements
- Research and analysis tasks

For the rare case that exceeds even `opus`, the highest-capability tier currently ships as Fable 5 (Mythos-class, above Opus) — reserve it for genuinely frontier-hard problems, not routine work.

> The tier→model mapping floats over time; concrete model names above are examples as of 2026-07. Always reference agents by alias (`haiku`/`sonnet`/`opus`) in `model:` frontmatter, never a dated model ID.

## Context Window Management

Avoid last 20% of context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

## Extended Thinking + Plan Mode

Extended thinking is enabled by default, reserving up to 31,999 tokens for internal reasoning.

Control extended thinking via:
- **Toggle**: Option+T (macOS) / Alt+T (Windows/Linux)
- **Config**: Set `alwaysThinkingEnabled` in `~/.claude/settings.json`
- **Budget cap**: `export MAX_THINKING_TOKENS=10000`
- **Verbose mode**: Ctrl+O to see thinking output

For complex tasks requiring deep reasoning:
1. Ensure extended thinking is enabled (on by default)
2. Enable **Plan Mode** for structured approach
3. Use multiple critique rounds for thorough analysis
4. Use split role sub-agents for diverse perspectives

## Build Troubleshooting

If build fails:
1. Use **build-error-resolver** agent
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix

# Week 3 Project: Agent Framework Mapping Document

This document formalizes the architecture and constraints of the **Market Research Competitor Analysis Agent** according to the Gen Academy's evaluation framework.

---

### 1. Agent Goal (One Line)
> **Goal**: Autonomously research key competitors for a target company using web search and scrape tools, and compile a structured Markdown competitor analysis briefing.

### 2. Where do people use it?
> **Surface**: Users run the agent via a terminal CLI, which outputs draft analysis text directly to the console and saves the final approved reports to a local `reports/` folder.

### 3. What steps does it take, in order?
> **Control Flow**:
> 1. Discovers 2–3 closest competitors for the target company utilizing LLM internal knowledge.
> 2. Runs targeted search queries for each competitor and scrapes the resulting web pages for features, pricing, and positioning.
> 3. Compiles a Markdown briefing, pauses for human-in-the-loop approval, and writes the finalized report to disk.

### 4. What can it actually do?
> **Actions and Tools**:
> - `find_competitors`: Queries the LLM to identify competitor names (Read action).
> - `web_search`: Queries search endpoints to retrieve relevant webpages and snippets (Read action).
> - `fetch_page_content`: Downloads and extracts clean readable text from site links (Read action).
> - `publish_report`: Writes the finalized competitor briefing document to a local markdown file (Write action).

### 5. What does it need to remember?
> **State & Memory**: The agent uses LangGraph's `MemorySaver` thread checkpointer to maintain the target company name, competitor names, raw web scrapings, generated draft text, and human feedback within a single session thread.

### 6. What should it never do?
> **Hard Limits**: The agent must never perform write actions on the web (e.g., submitting forms or posts), request paid search APIs beyond configured rate limits, or overwrite previous final reports without saving state.

### 7. Human-in-the-loop
> **HITL Boundary**: The workflow triggers a compiled state interrupt right before the publication node, showing the user the draft report and prompting them to either approve (`yes`) or provide specific text revisions that route back to draft compilation.

### 8. What happens when something breaks?
> **Error Recovery**: If an API key is missing or a request fails, the agent logs the exception in the state, falls back (e.g., from Tavily to DuckDuckGo search), and self-corrects without terminating the thread execution.

### 9. How do you know it worked?
> **Success Metric**: The agent successfully outputs a structured, factual competitor report containing real pricing and feature details, requiring one or fewer human revision loops in 9 out of 10 runs.

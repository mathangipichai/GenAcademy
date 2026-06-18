# Market Research Agent (Competitor Analysis)

An agentic market intelligence tool built with **LangChain** and **LangGraph** to perform autonomous competitor research, extract structured insights, and draft professional market briefing reports with human-in-the-loop review.

## Key Features

- **Autonomous Competitor Extraction**: Discovers key competitors of a given company using Nebius AI models.
- **Web Search & Clean Page Scraping**: Searches using Tavily Search (with an automatic zero-key DuckDuckGo fallback) and scrapes the actual contents of source links using BeautifulSoup, removing scripts/headers.
- **Stateful Workflow**: Built using LangGraph to manage complex state transitions and checkpointers for recovery.
- **Human-in-the-Loop (HITL) Gatekeeping**: Interrupts workflow execution to present the report draft. The agent will either accept human feedback to revise the report or save the approved version.
- **Model Comparison Ready**: Fully integrated with the **Nebius AI Studio** endpoint (via OpenAI-compatible wrapper) supporting models like Llama 3.

## Project Structure

- `main.py`: Interactive CLI driver managing execution state and human approval loops.
- `graph.py`: State transition graph, nodes, and checkpoint routing logic.
- `tools.py`: Helper functions for web searches (Tavily/DDG) and web scraping.
- `state.py`: Core TypedDict defining the state representation shared between nodes.
- `requirements.txt`: Python package dependencies.
- `.env.template`: Sample configuration file for credentials.

## Installation

1. Create a virtual environment and install dependencies:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Copy the environment template and set your credentials:
   ```bash
   cp .env.template .env
   ```
   Open `.env` and fill in your `NEBIUS_API_KEY` (and `TAVILY_API_KEY` if available).

## Running the Agent

Start the agent CLI runner:
```bash
python3 main.py
```

### Execution Lifecycle:
1. Input the company name (e.g. `Linear` or `Vercel`).
2. The agent discovers competitors, performs web search & scraping for each.
3. The agent compiles a detailed markdown report draft.
4. **Interrupt Gate**: The execution pauses. You are shown the report and prompted to type `yes` (approves the report and saves it to `reports/`) or `no`/`edit` (lets you provide revision notes, triggering the agent to re-compile).

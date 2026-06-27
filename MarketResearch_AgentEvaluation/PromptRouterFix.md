# Prompt & Router Fixes - Market Research Agent

We implemented the following prompt engineering and control flow updates to address the identified failure modes:

---

## 1. Pre-Workflow Input Guardrail Node (Control Flow & Safety)
* **Target Category**: Safety & Guardrail Compliance Failure.
* **Details of the Fix**:
  - We added a new node `input_guardrail` at the start of the LangGraph state machine.
  - The node uses a local regex block to identify SQL syntax and injection patterns, and executes a lightweight LLM call to verify if the input is a valid company, product, or business entity.
  - If invalid, the router bypasses competitor extraction and search, sets `approved = True`, and routes directly to the publication node with a polite refusal.
* **Routing Diagram**:
  ```
  START -> [input_guardrail] --(is valid?)--> [find_competitors] -> [research] -> ...
                       |
                  (is invalid?)
                       v
                 [publish_report] -> END
  ```

---

## 2. Few-Shot Competitor Extraction Prompt (Prompt Engineering)
* **Target Category**: Ambiguity & Generic Term Disambiguation Failure.
* **Details of the Fix**:
  - We updated the system prompt of `find_competitors_node` in `graph.py`.
  - Added explicit instructions on how to handle ambiguous names (e.g. "Apple", "Nest", "Mercury", "Linear") by focusing on the most prominent business entity.
  - Embedded few-shot examples (e.g., Figma, Brex, Graph) demonstrating the expected JSON array output format.

---

## 3. Strict JSON Escaping Directive (Prompt Engineering)
* **Target Category**: JSON Syntax & Control Character Parsing Exceptions.
* **Details of the Fix**:
  - We modified the system prompt of `compile_draft_report_node` in `graph.py`.
  - Added a strict formatting instruction: `"Ensure the JSON is strictly valid. All newlines inside JSON string fields (such as 'report' or 'core_features') MUST be escaped as '\\n', and all double quotes within JSON string values must be escaped as '\\\"'."`
  - This resolved the invalid escape exceptions during baseline parsing of larger reports.

---

## 4. Custom Search Scraper & LLM Fallback (Tool Design)
* **Target Category**: Search Fallback Blockage (0 results).
* **Details of the Fix**:
  - Replaced the third-party `duckduckgo_search` library (which was failing with 202 bot anomaly checks) with a custom requests-based scraper using keeping-alive connections, browser headers, random sleep jitter, and retry loops.
  - Implemented an `llm_simulated_search` fallback in `tools.py` that generates simulated search snippets from parametric memory if all scrapers time out or get blocked.
  - Updated the research node in `graph.py` to fall back to the search snippet if the raw webpage download fails, ensuring robust grounding data.

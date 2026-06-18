import os
import re
import json
from typing import List, Dict, Any
from dotenv import load_dotenv

# Import LangGraph / LangChain elements
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

# Import our custom logic
from state import AgentState
from tools import web_search, fetch_page_content

load_dotenv()

def get_nebius_llm() -> ChatOpenAI:
    """
    Instantiates the ChatOpenAI client pointed at the Nebius AI Studio endpoint.
    """
    api_key = os.getenv("NEBIUS_API_KEY")
    base_url = os.getenv("NEBIUS_BASE_URL", "https://api.studio.nebius.ai/v1")
    model = os.getenv("NEBIUS_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
    
    if not api_key:
        print("WARNING: NEBIUS_API_KEY is not set. Using mock responses for development.")
        
    return ChatOpenAI(
        api_key=api_key or "mock-key",
        base_url=base_url,
        model=model,
        temperature=0.2
    )

def clean_json_text(text: str) -> str:
    """
    Uses regular expressions to strip any leading/trailing markdown code fences (```, ```json, ```JSON)
    from LLM responses, returning clean JSON.
    """
    text = text.strip()
    # Strip leading fences (e.g., ```json or ```)
    text = re.sub(r"^```(?:json|JSON)?\s*", "", text)
    # Strip trailing fences
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

# --- Node Functions ---

def find_competitors_node(state: AgentState) -> Dict[str, Any]:
    """
    Queries the LLM to identify 2-3 main competitors for the target company/product.
    """
    company = state.get("company_name")
    print(f"\n[Agent] Identifying competitors for: {company}...")
    
    api_key = os.getenv("NEBIUS_API_KEY")
    if not api_key:
        # Development fallback / mock response
        competitors = [f"{company} Competitor A", f"{company} Competitor B"]
        return {"competitors": competitors, "final_reports": []}
        
    llm = get_nebius_llm()
    
    system_prompt = (
        "You are an expert market analyst. Given a company or product name, identify 2-3 of its closest key competitors. "
        "Respond ONLY with a valid JSON array of strings containing the names of these competitors. "
        "Do not include any introductory or concluding text, markdowns besides json formatting, or explanations."
    )
    
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Identify competitors for: {company}")
        ])
        
        content = clean_json_text(response.content)
        competitors = json.loads(content)
        if not isinstance(competitors, list):
            raise ValueError("Output is not a list")
            
        print(f"[Agent] Found competitors: {competitors}")
        return {"competitors": competitors}
    except Exception as e:
        error_msg = f"Failed to identify competitors: {str(e)}"
        print(f"[Error] {error_msg}. Using fallbacks.")
        fallback_competitors = [f"{company} Competitor A", f"{company} Competitor B"]
        return {"competitors": fallback_competitors, "errors": state.get("errors", []) + [error_msg]}

def research_competitors_node(state: AgentState) -> Dict[str, Any]:
    """
    For each competitor, runs web search and scrapes content.
    """
    competitors = state.get("competitors", [])
    research_results = {}
    
    for comp in competitors:
        print(f"\n[Agent] Researching competitor: {comp}...")
        
        # 1. Search the web for competitor info
        search_query = f"{comp} features pricing customer review market positioning product"
        search_hits = web_search(search_query, max_results=3)
        
        comp_data = []
        for hit in search_hits:
            title = hit.get("title")
            link = hit.get("link")
            snippet = hit.get("snippet")
            
            print(f"  - Scraping: {link}...")
            # 2. Fetch page content
            page_text = fetch_page_content(link)
            
            comp_data.append({
                "title": title,
                "url": link,
                "snippet": snippet,
                "full_content": page_text[:4000] # Cap text size
            })
            
        research_results[comp] = comp_data
        
    return {"research_data": research_results}

def compile_draft_report_node(state: AgentState) -> Dict[str, Any]:
    """
    Synthesizes raw competitor data into a structured Markdown briefing,
    and extracts structured cards metadata for the web dashboard.
    """
    company = state.get("company_name")
    competitors = state.get("competitors", [])
    research_data = state.get("research_data", {})
    feedback = state.get("feedback", "")
    
    print(f"\n[Agent] Compiling research report for: {company}...")
    
    api_key = os.getenv("NEBIUS_API_KEY")
    if not api_key:
        mock_report = f"# Competitor Analysis for {company}\n\n## Competitors\n"
        final_reports = []
        for comp in competitors:
            mock_report += f"### {comp}\n- Mock analysis data.\n"
            final_reports.append({
                "competitor_name": comp,
                "pricing_model": "Mock pricing tier: Free, $20/mo",
                "core_features": "• Feature A\n• Feature B\n• Feature C",
                "market_positioning": f"Positions itself as the simple alternative to {company}.",
                "recent_news": "Recently launched their new desktop client version."
            })
        return {"report": mock_report, "final_reports": final_reports}
        
    llm = get_nebius_llm()
    
    # Construct research summaries to fit context window
    data_summary = ""
    for comp, hits in research_data.items():
        data_summary += f"=== Competitor: {comp} ===\n"
        for hit in hits:
            data_summary += f"Source: {hit['url']}\nSnippet: {hit['snippet']}\nDetails: {hit['full_content'][:1000]}\n\n"
            
    system_prompt = (
        "You are an expert business analyst. You must compile a professional, detailed competitor analysis report "
        "based on the provided research data. "
        "You must respond ONLY with a valid JSON object containing exactly two keys:\n"
        "1. 'report': A string containing the complete, detailed competitor analysis report in Markdown format. "
        "Include sections for Executive Summary, Competitor Deep Dives (covering Features, Pricing, and Market Positioning), and Strategic Recommendations.\n"
        "2. 'final_reports': A JSON list of objects, one for each competitor. Each competitor object must contain exactly these five keys:\n"
        "   - 'competitor_name': The name of the competitor.\n"
        "   - 'pricing_model': A short summary of their pricing model and tiers (e.g., Free tier, Pro $20/mo).\n"
        "   - 'core_features': 3-5 bullet points of their key features (formatted with bullet characters or newlines).\n"
        "   - 'market_positioning': 1-2 sentences summarizing their target segment and core differentiator.\n"
        "   - 'recent_news': Latest launches, announcements, or recent news.\n\n"
        "Do not include any introductory or concluding text, markdowns outside the JSON object block, or explanations. "
        "Respond only with raw JSON."
    )
    
    user_prompt = f"Analyze the competitors of '{company}'. Here is the research data:\n\n{data_summary}"
    if feedback:
        user_prompt += f"\n\nAdditional Guidance / Revision Requested by Human:\n{feedback}"
        
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        content = clean_json_text(response.content)
        parsed_data = json.loads(content)
        report_text = parsed_data.get("report", "")
        final_reports = parsed_data.get("final_reports", [])
        
        return {"report": report_text, "final_reports": final_reports}
    except Exception as e:
        error_msg = f"Failed to compile report JSON: {str(e)}"
        print(f"[Error] {error_msg}. Using text parsing fallbacks.")
        
        # Fallback raw response mapping
        fallback_report = response.content if 'response' in locals() else f"# Competitor Analysis for {company}\n\nError: {str(e)}"
        
        fallback_cards = []
        for comp in competitors:
            fallback_cards.append({
                "competitor_name": comp,
                "pricing_model": "Refer to report details.",
                "core_features": "• Refer to report details.",
                "market_positioning": "Refer to report details.",
                "recent_news": "Refer to report details."
            })
            
        return {
            "report": fallback_report,
            "final_reports": fallback_cards,
            "errors": state.get("errors", []) + [error_msg]
        }

def human_review_node(state: AgentState) -> Dict[str, Any]:
    """
    Placeholder review node. The workflow will interrupt BEFORE executing this node.
    """
    print("\n[Agent] Entering Human Review Node...")
    return {}

def publish_report_node(state: AgentState) -> Dict[str, Any]:
    """
    Saves the final report to a markdown file.
    """
    company = state.get("company_name")
    report_content = state.get("report", "")
    
    # Ensure reports output directory exists
    os.makedirs("reports", exist_ok=True)
    filename = f"reports/competitor_analysis_{company.lower().replace(' ', '_')}.md"
    
    print(f"\n[Agent] Publishing final report to: {filename}...")
    with open(filename, "w", encoding="utf-8") as f:
        f.write(report_content)
        
    return {}

# --- State Graph Assembly ---

workflow = StateGraph(AgentState)

# Add Nodes
workflow.add_node("find_competitors", find_competitors_node)
workflow.add_node("research_competitors", research_competitors_node)
workflow.add_node("compile_draft_report", compile_draft_report_node)
workflow.add_node("human_review", human_review_node)
workflow.add_node("publish_report", publish_report_node)

# Set up Edges
workflow.add_edge(START, "find_competitors")
workflow.add_edge("find_competitors", "research_competitors")
workflow.add_edge("research_competitors", "compile_draft_report")
workflow.add_edge("compile_draft_report", "human_review")

# Define routing function after human review
def review_decision(state: AgentState):
    if state.get("approved"):
        return "publish_report"
    else:
        print("\n[Agent] Draft not approved. Re-compiling draft with human feedback...")
        return "compile_draft_report"

workflow.add_conditional_edges(
    "human_review",
    review_decision,
    {
        "publish_report": "publish_report",
        "compile_draft_report": "compile_draft_report"
    }
)
workflow.add_edge("publish_report", END)

# Set up Memory Checkpointer for thread persistence
memory = MemorySaver()

# Compile the graph with human review interrupt
app = workflow.compile(
    checkpointer=memory,
    interrupt_before=["human_review"]
)

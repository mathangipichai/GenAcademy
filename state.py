from typing import TypedDict, List, Dict, Any

class AgentState(TypedDict):
    """
    Represents the state of the Market Research Agent.
    This state is passed between different nodes in the LangGraph workflow.
    """
    # Target company or product to research
    company_name: str
    
    # Extracted list of competitor names
    competitors: List[str]
    
    # Gathered data on each competitor, structured by competitor name
    research_data: Dict[str, Any]
    
    # Current compiled markdown report
    report: str
    
    # Structured competitor reports for card layouts in the UI Dashboard
    final_reports: List[Dict[str, Any]]
    
    # Feedback from human reviewer
    feedback: str
    
    # Whether the human reviewer approved the report
    approved: bool
    
    # List of errors encountered during execution (for error recovery monitoring)
    errors: List[str]

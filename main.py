import os
import sys
import warnings
warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from graph import app

def run_agent():
    load_dotenv()
    
    # Ensure there is an API key set, or warn the user.
    if not os.getenv("NEBIUS_API_KEY"):
        print("WARNING: NEBIUS_API_KEY environment variable is missing.")
        print("The agent will run with mock LLM calls for demo purposes.")
        print("Create a '.env' file with your credentials to run with actual LLM inference.\n")
        
    company_name = input("Enter company or product name to research: ").strip()
    if not company_name:
        print("Company name cannot be empty.")
        return
        
    # Setup thread config for state checkpointing
    thread_id = f"research_{company_name.lower().replace(' ', '_')}"
    config = {"configurable": {"thread_id": thread_id}}
    
    # Define initial state
    initial_state = {
        "company_name": company_name,
        "competitors": [],
        "research_data": {},
        "report": "",
        "feedback": "",
        "approved": False,
        "errors": []
    }
    
    print(f"\n[System] Starting Market Research Agent workflow for thread: {thread_id}")
    
    # Start streaming execution. This runs nodes up to the human_review interrupt.
    events = app.stream(initial_state, config, stream_mode="values")
    for event in events:
        pass # The nodes themselves print logs to console
        
    # Get current state to verify if we hit the interrupt
    state_info = app.get_state(config)
    
    while state_info.next:
        # Check if the next expected node is the human review node
        if "human_review" in state_info.next:
            print("\n" + "="*60)
            print(" HUMAN REVIEW INTERRUPT: Competitor Analysis Draft is Ready!")
            print("="*60)
            
            current_state = state_info.values
            draft_report = current_state.get("report", "")
            
            print("\n--- REPORT DRAFT ---")
            print(draft_report)
            print("-------------------")
            
            choice = input("\nDo you approve this draft? (yes / no / edit): ").strip().lower()
            
            if choice in ["yes", "y"]:
                # User approves: update state to approved=True and resume
                app.update_state(config, {"approved": True, "feedback": ""})
                print("\n[System] Draft approved. Resuming execution to publish...")
            elif choice in ["edit", "e", "no", "n"]:
                # User rejects or requests modifications: get feedback
                feedback = input("\nEnter your feedback / revision requests for the agent:\n").strip()
                if not feedback:
                    feedback = "Please improve the report detail."
                # Update state with feedback, reset approval, and resume
                app.update_state(config, {"approved": False, "feedback": feedback})
                print("\n[System] Sending feedback to agent and resuming workflow...")
            else:
                print("Invalid input. Pausing execution. Run the script again to resume.")
                break
                
            # Resume execution by streaming with input = None
            events = app.stream(None, config, stream_mode="values")
            for event in events:
                pass
                
            # Refresh state info
            state_info = app.get_state(config)
        else:
            # Reached a different step (shouldn't happen with our graph config, but safe check)
            events = app.stream(None, config, stream_mode="values")
            for event in events:
                pass
            state_info = app.get_state(config)
            
    print("\n[System] Workflow completed successfully!")
    
    # Display output report file location
    filename = f"reports/competitor_analysis_{company_name.lower().replace(' ', '_')}.md"
    if os.path.exists(filename):
        print(f"[System] Saved final report at: {os.path.abspath(filename)}")

if __name__ == "__main__":
    try:
        run_agent()
    except KeyboardInterrupt:
        print("\n[System] Execution cancelled by user.")
        sys.exit(0)

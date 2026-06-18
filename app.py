import os
import sys
import json
import uuid
import re
import threading
import warnings
warnings.filterwarnings("ignore")
from datetime import datetime
from flask import Flask, request, jsonify, render_template

# Redirect path to import workspace files
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from graph import app as app_workflow

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024 # Limit request size to 1MB

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self';"
    return response

# File paths
DB_FILE = "db.json"
ENV_FILE = ".env"

# --- Thread Synchronization Lock ---
# Protects all disk I/O and state modifications from concurrent request threads
db_lock = threading.Lock()

# --- Thread-Safe Stdout Logger Redirection ---
_thread_local = threading.local()

class ThreadLocalStdout:
    def write(self, data):
        if hasattr(_thread_local, "log_buffer"):
            _thread_local.log_buffer.append(data)
        sys.__stdout__.write(data)

    def flush(self):
        sys.__stdout__.flush()

# Globally redirect stdout to capture print statements within agent threads
sys.stdout = ThreadLocalStdout()

# --- Input Sanitization Helper ---
def sanitize_company_name(name):
    if not name:
        return ""
    # Allow alphanumeric characters, spaces, hyphens, and dots. Strip other symbols.
    sanitized = re.sub(r'[^a-zA-Z0-9\s\-\.]', '', name)
    # Limit length to prevent buffer/context inflation attacks
    return sanitized.strip()[:60]

# --- Database Storage Helpers (Thread-Safe) ---
def load_db():
    with db_lock:
        if not os.path.exists(DB_FILE):
            # Initial schema
            initial_schema = {
                "settings": {
                    "NEBIUS_API_KEY": os.getenv("NEBIUS_API_KEY", ""),
                    "NEBIUS_BASE_URL": os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/"),
                    "NEBIUS_MODEL": os.getenv("NEBIUS_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
                    "TAVILY_API_KEY": os.getenv("TAVILY_API_KEY", "")
                },
                "runs": []
            }
            with open(DB_FILE, "w", encoding="utf-8") as f:
                json.dump(initial_schema, f, indent=4)
            return initial_schema
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"settings": {}, "runs": []}

def save_db(data):
    with db_lock:
        try:
            with open(DB_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            sys.__stdout__.write(f"[System Error] Database write failed: {str(e)}\n")

# In-memory tracking for active running processes
active_runs = {}

# Helper to merge active and historical runs (Thread-Safe)
def get_all_runs():
    db = load_db()
    with db_lock:
        combined = list(active_runs.values())
        active_ids = {r["id"] for r in combined}
        for r in db.get("runs", []):
            if r["id"] not in active_ids:
                combined.append(r)
        # Sort by creation time descending
        combined.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return combined

def save_run_to_db(run_data):
    db = load_db()
    with db_lock:
        db["runs"] = [r for r in db["runs"] if r["id"] != run_data["id"]]
        db["runs"].append(run_data)
    save_db(db)

# --- Background Thread Execution wrappers ---
def run_agent_workflow(run_id, company_name, settings):
    # Set env keys inside the worker thread
    for k, v in settings.items():
        if v:
            os.environ[k] = v
            
    _thread_local.log_buffer = []
    config = {"configurable": {"thread_id": f"web_{run_id}"}}
    
    initial_state = {
        "company_name": company_name,
        "competitors": [],
        "research_data": {},
        "report": "",
        "final_reports": [],
        "feedback": "",
        "approved": False,
        "errors": []
    }
    
    try:
        events = app_workflow.stream(initial_state, config, stream_mode="values")
        for event in events:
            # Capture prints
            logs = "".join(_thread_local.log_buffer)
            _thread_local.log_buffer = []
            with db_lock:
                if logs:
                    active_runs[run_id]["logs"] += logs
                    
                state_vals = app_workflow.get_state(config).values
                if state_vals:
                    active_runs[run_id]["report"] = state_vals.get("report", "")
                    active_runs[run_id]["competitors"] = state_vals.get("competitors", [])
                    active_runs[run_id]["final_reports"] = state_vals.get("final_reports", [])
                    
            # Incremental persistence during execution
            save_run_to_db(active_runs[run_id])
                
        # Pause at interrupt or complete
        state_info = app_workflow.get_state(config)
        with db_lock:
            # Capture residual logs
            logs = "".join(_thread_local.log_buffer)
            _thread_local.log_buffer = []
            if logs:
                active_runs[run_id]["logs"] += logs
            
            if state_info.next and "human_review" in state_info.next:
                active_runs[run_id]["status"] = "paused"
            else:
                active_runs[run_id]["status"] = "completed"
                active_runs[run_id]["completed_at"] = datetime.now().isoformat()
                
        save_run_to_db(active_runs[run_id])
            
    except Exception as e:
        with db_lock:
            active_runs[run_id]["status"] = "failed"
            active_runs[run_id]["logs"] += f"\n[System Error] Run failed: {str(e)}\n"
        save_run_to_db(active_runs[run_id])

def resume_agent_workflow(run_id, approved, feedback, settings):
    # Set env keys inside the worker thread
    for k, v in settings.items():
        if v:
            os.environ[k] = v
            
    _thread_local.log_buffer = []
    config = {"configurable": {"thread_id": f"web_{run_id}"}}
    
    with db_lock:
        active_runs[run_id]["status"] = "running"
    
    try:
        app_workflow.update_state(config, {"approved": approved, "feedback": feedback})
        
        events = app_workflow.stream(None, config, stream_mode="values")
        for event in events:
            logs = "".join(_thread_local.log_buffer)
            _thread_local.log_buffer = []
            with db_lock:
                if logs:
                    active_runs[run_id]["logs"] += logs
                    
                state_vals = app_workflow.get_state(config).values
                if state_vals:
                    active_runs[run_id]["report"] = state_vals.get("report", "")
                    active_runs[run_id]["competitors"] = state_vals.get("competitors", [])
                    active_runs[run_id]["final_reports"] = state_vals.get("final_reports", [])
            
            # Incremental persistence during execution
            save_run_to_db(active_runs[run_id])
                
        state_info = app_workflow.get_state(config)
        with db_lock:
            # Capture residual logs
            logs = "".join(_thread_local.log_buffer)
            _thread_local.log_buffer = []
            if logs:
                active_runs[run_id]["logs"] += logs
            
            if state_info.next and "human_review" in state_info.next:
                active_runs[run_id]["status"] = "paused"
            else:
                active_runs[run_id]["status"] = "completed"
                active_runs[run_id]["completed_at"] = datetime.now().isoformat()
                
        save_run_to_db(active_runs[run_id])
            
    except Exception as e:
        with db_lock:
            active_runs[run_id]["status"] = "failed"
            active_runs[run_id]["logs"] += f"\n[System Error] Resumption failed: {str(e)}\n"
        save_run_to_db(active_runs[run_id])

# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/settings", methods=["GET"])
def get_settings():
    db = load_db()
    return jsonify(db["settings"])

@app.route("/api/settings", methods=["POST"])
def post_settings():
    new_settings = request.json
    db = load_db()
    
    base_url = new_settings.get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/").strip()
    if base_url and not base_url.startswith("https://"):
        return jsonify({"error": "Base URL must start with https://"}), 400
        
    model = new_settings.get("NEBIUS_MODEL", "meta-llama/Llama-3.3-70B-Instruct").strip()
    if model and not re.match(r'^[a-zA-Z0-9\-\._/]+$', model):
        return jsonify({"error": "Invalid model ID format"}), 400
        
    # Input validation on Settings keys
    validated_settings = {
        "NEBIUS_API_KEY": new_settings.get("NEBIUS_API_KEY", "").strip(),
        "NEBIUS_BASE_URL": base_url,
        "NEBIUS_MODEL": model,
        "TAVILY_API_KEY": new_settings.get("TAVILY_API_KEY", "").strip()
    }
    
    db["settings"].update(validated_settings)
    save_db(db)
    
    # Sync settings with .env file
    try:
        with open(ENV_FILE, "w", encoding="utf-8") as f:
            for k, v in db["settings"].items():
                f.write(f"{k}={v}\n")
    except Exception as e:
        sys.__stdout__.write(f"[System Error] Failed to sync .env: {str(e)}\n")
        
    return jsonify({"status": "success", "settings": db["settings"]})

@app.route("/api/runs", methods=["GET"])
def list_runs():
    return jsonify(get_all_runs())

@app.route("/api/runs/<run_id>", methods=["GET"])
def get_run(run_id):
    runs = get_all_runs()
    match = next((r for r in runs if r["id"] == run_id), None)
    if match:
        return jsonify(match)
    return jsonify({"error": "Run not found"}), 404

@app.route("/api/runs", methods=["POST"])
def start_run():
    raw_name = request.json.get("company_name", "")
    company_name = sanitize_company_name(raw_name)
    if not company_name:
        return jsonify({"error": "A valid company name is required"}), 400
        
    run_id = str(uuid.uuid4())[:8]
    db = load_db()
    
    with db_lock:
        active_runs[run_id] = {
            "id": run_id,
            "company_name": company_name,
            "status": "running",
            "logs": "",
            "report": "",
            "competitors": [],
            "final_reports": [],
            "created_at": datetime.now().isoformat(),
            "completed_at": None
        }
    
    # Save the run immediately
    save_run_to_db(active_runs[run_id])
    
    # Spawn background thread to execute workflow
    thread = threading.Thread(
        target=run_agent_workflow,
        args=(run_id, company_name, db["settings"])
    )
    thread.start()
    
    return jsonify(active_runs[run_id])

@app.route("/api/runs/<run_id>/approve", methods=["POST"])
def approve_run(run_id):
    runs = get_all_runs()
    match = next((r for r in runs if r["id"] == run_id), None)
    if not match:
        return jsonify({"error": "Run not found"}), 404
        
    approved = request.json.get("approved", True)
    # Sanitize human review feedback input text
    feedback = request.json.get("feedback", "").strip()[:500]
    
    db = load_db()
    
    with db_lock:
        active_runs[run_id] = match
        active_runs[run_id]["status"] = "running"
    
    # Save the updated run status
    save_run_to_db(active_runs[run_id])
    
    # Spawn thread to resume
    thread = threading.Thread(
        target=resume_agent_workflow,
        args=(run_id, approved, feedback, db["settings"])
    )
    thread.start()
    
    return jsonify(active_runs[run_id])

@app.route("/api/runs", methods=["DELETE"])
def clear_runs():
    db = load_db()
    with db_lock:
        db["runs"] = []
        active_runs.clear()
    save_db(db)
    return jsonify({"status": "success", "message": "History cleared successfully"})

@app.route("/api/analytics", methods=["GET"])
def get_analytics():
    runs = get_all_runs()
    
    total_runs = len(runs)
    completed = len([r for r in runs if r["status"] == "completed"])
    failed = len([r for r in runs if r["status"] == "failed"])
    paused = len([r for r in runs if r["status"] == "paused"])
    
    # Calculate competitor occurrence metrics
    competitor_counts = {}
    for r in runs:
        for comp in r.get("competitors", []):
            competitor_counts[comp] = competitor_counts.get(comp, 0) + 1
            
    # Calculate average duration in seconds
    durations = []
    for r in runs:
        if r.get("completed_at") and r.get("created_at"):
            try:
                start = datetime.fromisoformat(r["created_at"])
                end = datetime.fromisoformat(r["completed_at"])
                durations.append((end - start).total_seconds())
            except Exception:
                pass
    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0
    
    return jsonify({
        "total_runs": total_runs,
        "completed": completed,
        "failed": failed,
        "paused": paused,
        "avg_duration_seconds": avg_duration,
        "competitor_frequencies": competitor_counts
    })

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)

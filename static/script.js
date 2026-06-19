// ==========================================================================
// Application State
// ==========================================================================
let activeTab = "dashboard-tab";
let activeRunId = null;
let pollInterval = null;
let competitorsChart = null;
let pausedStartTime = null;

// Helper to handle fetch responses and return JSON or throw detailed error messages
function checkResponse(res) {
    if (!res.ok) {
        return res.json().then(data => {
            throw new Error(data.error || `HTTP error! Status: ${res.status}`);
        }).catch(err => {
            if (err instanceof SyntaxError) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            throw err;
        });
    }
    return res.json();
}

// Custom Toast notification system
function showToast(message, type = "success") {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    else if (type === "error") icon = "❌";
    else if (type === "warning") icon = "⚠️";
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add("show");
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => {
            toast.remove();
        }, 350);
    }, 4000);
}

// Custom async confirmation dialog modal helper
function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirm-modal");
        const titleEl = document.getElementById("confirm-modal-title");
        const msgEl = document.getElementById("confirm-modal-message");
        const okBtn = document.getElementById("confirm-ok-btn");
        const cancelBtn = document.getElementById("confirm-cancel-btn");
        const closeBtn = document.getElementById("close-confirm-btn");
        
        titleEl.textContent = title;
        msgEl.textContent = message;
        
        modal.style.display = "flex";
        
        const cleanup = (value) => {
            modal.style.display = "none";
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
            resolve(value);
        };
        
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        closeBtn.onclick = () => cleanup(false);
    });
}

// ==========================================================================
// DOM Load Hook & Routing Setup
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    setupTabNavigation();
    setupHistoryActions();
    setupSettingsForm();
    setupRunCreation();
    setupHITLActions();
    setupModalHandlers();
    setupDraftViewTabs();
    
    // Initialize Dashboard
    loadDashboardData();
});

// Switch tabs dynamically
function setupTabNavigation() {
    document.querySelectorAll(".menu-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            
            const targetTab = item.getAttribute("data-tab");
            if (activeTab === targetTab) return;
            
            // Remove active classes
            document.querySelectorAll(".menu-item").forEach(i => i.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
            
            // Set active
            item.classList.add("active");
            document.getElementById(targetTab).classList.add("active");
            activeTab = targetTab;
            
            // Update Title
            const titleMap = {
                "dashboard-tab": "Market Intelligence Dashboard",
                "active-run-tab": "Execute Competitor Research",
                "history-tab": "Execution Run History",
                "settings-tab": "Configuration Settings"
            };
            document.getElementById("page-title").textContent = titleMap[targetTab];
            
            // Load Tab Specific Data
            if (targetTab === "dashboard-tab") {
                loadDashboardData();
            } else if (targetTab === "history-tab") {
                loadHistoryData();
            } else if (targetTab === "settings-tab") {
                loadSettingsData();
            }
        });
    });
}

function setupHistoryActions() {
    const clearBtn = document.getElementById("clear-history-btn");
    if (clearBtn) {
        clearBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const confirmed = await showConfirmDialog("Clear History", "Are you sure you want to clear all execution history? This cannot be undone.");
            if (!confirmed) {
                return;
            }
            
            clearBtn.disabled = true;
            fetch("/api/runs", {
                method: "DELETE"
            })
            .then(checkResponse)
            .then(data => {
                showToast("History cleared successfully!", "success");
                loadHistoryData(); // Reload table
            })
            .catch(err => {
                console.error("Error clearing history:", err);
                showToast("Failed to clear history: " + err.message, "error");
            })
            .finally(() => {
                clearBtn.disabled = false;
            });
        });
    }
}

// Toggle View Tabs for Structured Cards vs Markdown Details
function setupDraftViewTabs() {
    // 1. Toggle Active Run review panes
    document.querySelectorAll(".draft-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".draft-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const view = btn.getAttribute("data-draft-view");
            if (view === "cards") {
                document.getElementById("draft-cards-view").classList.add("active");
                document.getElementById("draft-markdown-view").classList.remove("active");
            } else {
                document.getElementById("draft-cards-view").classList.remove("active");
                document.getElementById("draft-markdown-view").classList.add("active");
            }
        });
    });
}

// ==========================================================================
// Settings API Interactions
// ==========================================================================
function loadSettingsData() {
    fetch("/api/settings")
        .then(res => res.json())
        .then(settings => {
            document.getElementById("setting-nebius-key").value = settings.NEBIUS_API_KEY || "";
            document.getElementById("setting-nebius-url").value = settings.NEBIUS_BASE_URL || "";
            document.getElementById("setting-nebius-model").value = settings.NEBIUS_MODEL || "";
            document.getElementById("setting-tavily-key").value = settings.TAVILY_API_KEY || "";
        })
        .catch(err => console.error("Error loading settings:", err));
}

function setupSettingsForm() {
    const form = document.getElementById("settings-form");
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const payload = {
            NEBIUS_API_KEY: document.getElementById("setting-nebius-key").value.trim ? document.getElementById("setting-nebius-key").value.trim() : document.getElementById("setting-nebius-key").value,
            NEBIUS_BASE_URL: document.getElementById("setting-nebius-url").value.trim(),
            NEBIUS_MODEL: document.getElementById("setting-nebius-model").value.trim(),
            TAVILY_API_KEY: document.getElementById("setting-tavily-key").value.trim()
        };
        
        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(checkResponse)
        .then(data => {
            showToast("Settings saved successfully!", "success");
        })
        .catch(err => {
            console.error("Error saving settings:", err);
            showToast("Failed to save settings: " + err.message, "error");
        });
    });
}

// ==========================================================================
// Active Run Logic
// ==========================================================================
function setupRunCreation() {
    const startBtn = document.getElementById("start-run-btn");
    const input = document.getElementById("company-input");
    
    startBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const company = input.value.trim();
        if (!company) {
            showToast("Please enter a company name.", "warning");
            return;
        }
        
        startBtn.disabled = true;
        input.disabled = true;
        
        fetch("/api/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company_name: company })
        })
        .then(checkResponse)
        .then(run => {
            activeRunId = run.id;
            
            // Show run detail panels
            document.getElementById("current-company-name").textContent = run.company_name;
            document.getElementById("current-run-status").textContent = run.status;
            document.getElementById("log-console").textContent = "Initializing backend task thread...";
            document.getElementById("active-run-details").style.display = "flex";
            document.getElementById("hitl-panel").style.display = "none";
            document.querySelector(".console-grid").classList.remove("dual-pane");
            
            updateSystemIndicator("Running Research", "running");
            
            // Start Polling
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(pollActiveRun, 1000);
        })
        .catch(err => {
            console.error("Error starting run:", err);
            showToast("Failed to initiate run: " + err.message, "error");
            startBtn.disabled = false;
            input.disabled = false;
        });
    });
}

function pollActiveRun() {
    if (!activeRunId) return;
    
    fetch(`/api/runs/${activeRunId}`)
        .then(res => res.json())
        .then(run => {
            // Update console logs
            const consoleBox = document.getElementById("log-console");
            consoleBox.textContent = run.logs || "Processing state nodes...";
            consoleBox.scrollTop = consoleBox.scrollHeight; // Auto-scroll
            
            // Update status badge
            const statusBadge = document.getElementById("current-run-status");
            statusBadge.textContent = run.status;
            
            if (run.status === "paused") {
                if (!pausedStartTime) {
                    pausedStartTime = Date.now();
                    
                    // Open human-in-the-loop review panel
                    document.getElementById("draft-markdown-preview").innerHTML = renderMarkdown(run.report);
                    
                    document.getElementById("hitl-panel").style.display = "flex";
                    document.querySelector(".console-grid").classList.add("dual-pane");
                    
                    document.getElementById("hitl-timeout-notice").style.display = "flex";
                    document.getElementById("hitl-timeout-notice").classList.remove("expired");
                    
                    updateSystemIndicator("Review Needed", "paused");
                }
                
                // Update countdown
                let remaining = 30;
                if (run.paused_at) {
                    try {
                        const pausedTime = new Date(run.paused_at).getTime();
                        const serverElapsed = Math.floor((new Date().getTime() - pausedTime) / 1000);
                        remaining = Math.max(0, 30 - serverElapsed);
                    } catch (e) {
                        const localElapsed = Math.floor((Date.now() - pausedStartTime) / 1000);
                        remaining = Math.max(0, 30 - localElapsed);
                    }
                } else {
                    const localElapsed = Math.floor((Date.now() - pausedStartTime) / 1000);
                    remaining = Math.max(0, 30 - localElapsed);
                }
                
                const timeoutText = document.getElementById("hitl-timeout-text");
                const timeoutNotice = document.getElementById("hitl-timeout-notice");
                if (remaining > 0) {
                    timeoutText.textContent = `Remaining review time: ${remaining}s`;
                } else {
                    timeoutText.textContent = `Approval window exceeded! Saved as unverified draft.`;
                    timeoutNotice.classList.add("expired");
                }
            } else if (run.status === "running") {
                if (pausedStartTime) {
                    pausedStartTime = null;
                    document.getElementById("hitl-panel").style.display = "none";
                    document.querySelector(".console-grid").classList.remove("dual-pane");
                    document.getElementById("hitl-timeout-notice").style.display = "none";
                }
                updateSystemIndicator("Running Research", "running");
            } else if (run.status === "completed" || run.status === "failed") {
                clearInterval(pollInterval);
                pollInterval = null;
                activeRunId = null;
                pausedStartTime = null;
                document.getElementById("hitl-timeout-notice").style.display = "none";
                document.getElementById("hitl-panel").style.display = "none";
                document.querySelector(".console-grid").classList.remove("dual-pane");
                
                // Reset start button
                document.getElementById("start-run-btn").disabled = false;
                document.getElementById("company-input").disabled = false;
                document.getElementById("company-input").value = "";
                
                updateSystemIndicator("System Ready", "completed");
                
                if (run.status === "completed") {
                    showToast(`Research for ${run.company_name} completed successfully!`, "success");
                } else {
                    showToast(`Research for ${run.company_name} failed. Check console logs.`, "error");
                }
            }
        })
        .catch(err => {
            console.error("Error polling run:", err);
            clearInterval(pollInterval);
            pollInterval = null;
        });
}

function setupHITLActions() {
    const approveBtn = document.getElementById("hitl-approve-btn");
    const reviseBtn = document.getElementById("hitl-revise-btn");
    const feedbackInput = document.getElementById("hitl-feedback-input");
    
    approveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeRunId) return;
        
        approveBtn.disabled = true;
        reviseBtn.disabled = true;
        
        fetch(`/api/runs/${activeRunId}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved: true, feedback: "" })
        })
        .then(checkResponse)
        .then(run => {
            pausedStartTime = null;
            document.getElementById("hitl-timeout-notice").style.display = "none";
            document.getElementById("hitl-panel").style.display = "none";
            document.querySelector(".console-grid").classList.remove("dual-pane");
            document.getElementById("current-run-status").textContent = "running";
            
            updateSystemIndicator("Publishing Report", "running");
            
            // Resume polling
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(pollActiveRun, 1000);
            
            approveBtn.disabled = false;
            reviseBtn.disabled = false;
        })
        .catch(err => {
            console.error("Error approving:", err);
            showToast("Failed to approve: " + err.message, "error");
            approveBtn.disabled = false;
            reviseBtn.disabled = false;
        });
    });
    
    reviseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!activeRunId) return;
        
        const feedback = feedbackInput.value.trim();
        if (!feedback) {
            showToast("Please enter feedback notes before requesting edits.", "warning");
            return;
        }
        
        approveBtn.disabled = true;
        reviseBtn.disabled = true;
        
        fetch(`/api/runs/${activeRunId}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved: false, feedback: feedback })
        })
        .then(checkResponse)
        .then(run => {
            pausedStartTime = null;
            document.getElementById("hitl-timeout-notice").style.display = "none";
            document.getElementById("hitl-panel").style.display = "none";
            document.querySelector(".console-grid").classList.remove("dual-pane");
            document.getElementById("current-run-status").textContent = "running";
            feedbackInput.value = "";
            
            updateSystemIndicator("Re-Compiling", "running");
            
            // Resume polling
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(pollActiveRun, 1000);
            
            approveBtn.disabled = false;
            reviseBtn.disabled = false;
        })
        .catch(err => {
            console.error("Error revising:", err);
            showToast("Failed to submit feedback: " + err.message, "error");
            approveBtn.disabled = false;
            reviseBtn.disabled = false;
        });
    });
}

function updateSystemIndicator(text, status) {
    document.getElementById("active-status-text").textContent = text;
    
    const dot = document.querySelector(".pulse-dot");
    const indicator = document.querySelector(".status-indicator");
    
    // Clear status color styles
    dot.style.backgroundColor = "";
    indicator.style.color = "";
    indicator.style.borderColor = "";
    indicator.style.background = "";
    
    if (status === "running") {
        dot.style.backgroundColor = "var(--color-info)";
        indicator.style.color = "var(--color-info)";
        indicator.style.borderColor = "rgba(59, 130, 246, 0.2)";
        indicator.style.background = "rgba(59, 130, 246, 0.05)";
    } else if (status === "paused") {
        dot.style.backgroundColor = "var(--color-warning)";
        indicator.style.color = "var(--color-warning)";
        indicator.style.borderColor = "rgba(245, 158, 11, 0.2)";
        indicator.style.background = "rgba(245, 158, 11, 0.05)";
    } else if (status === "failed") {
        dot.style.backgroundColor = "var(--color-danger)";
        indicator.style.color = "var(--color-danger)";
        indicator.style.borderColor = "rgba(239, 68, 68, 0.2)";
        indicator.style.background = "rgba(239, 68, 68, 0.05)";
    }
}

// ==========================================================================
// Historical Runs & Table Render
// ==========================================================================
function loadHistoryData() {
    fetch("/api/runs")
        .then(res => res.json())
        .then(runs => {
            const tbody = document.getElementById("history-table-body");
            tbody.innerHTML = "";
            
            if (runs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center">No runs logged yet.</td></tr>`;
                return;
            }
            
            runs.forEach(run => {
                const tr = document.createElement("tr");
                
                const compStr = run.competitors && run.competitors.length > 0
                    ? run.competitors.join(", ")
                    : "None identified";
                    
                const dateStr = run.created_at
                    ? new Date(run.created_at).toLocaleString()
                    : "-";
                    
                // Render action buttons depending on run status
                let actionBtn = "";
                if (run.status === "completed") {
                    if (run.approval_status === "Timed-Out (Draft Only)") {
                        actionBtn = `
                            <div class="action-group">
                                <button type="button" class="btn btn-primary action-btn-view" data-run-id="${run.id}" style="padding: 6px 12px; font-size: 13px;">View Draft</button>
                                <button type="button" class="btn btn-danger-outline action-btn-delete" data-run-id="${run.id}" style="padding: 6px 12px; font-size: 13px;">Delete</button>
                            </div>
                        `;
                    } else {
                        actionBtn = `
                            <div class="action-group">
                                <button type="button" class="btn btn-primary action-btn-view" data-run-id="${run.id}" style="padding: 6px 12px; font-size: 13px;">View Report</button>
                                <button type="button" class="btn btn-danger-outline action-btn-delete" data-run-id="${run.id}" style="padding: 6px 12px; font-size: 13px;">Delete</button>
                            </div>
                        `;
                    }
                } else if (run.status === "paused") {
                    actionBtn = `
                        <div class="action-group">
                            <button type="button" class="btn btn-warning action-btn-resume" data-run-id="${run.id}" style="padding: 6px 12px; font-size: 13px;">Review Draft</button>
                            <button type="button" class="btn btn-danger-outline action-btn-delete" data-run-id="${run.id}" style="padding: 6px 12px; font-size: 13px;">Delete</button>
                        </div>
                    `;
                } else {
                    actionBtn = `<button type="button" class="btn btn-primary" disabled style="padding: 6px 12px; font-size: 13px; opacity: 0.5;">In Progress</button>`;
                }
                
                // Render approval badge
                let approvalBadge = "";
                const approvalStatus = run.approval_status || "N/A";
                if (approvalStatus === "Approved") {
                    approvalBadge = `<span class="status-badge completed">Approved</span>`;
                } else if (approvalStatus === "Approved (Late)") {
                    approvalBadge = `<span class="status-badge completed">Approved (Late)</span>`;
                } else if (approvalStatus === "Timed-Out (Draft Only)") {
                    approvalBadge = `<span class="status-badge paused">Timed-Out (Draft)</span>`;
                } else if (approvalStatus === "Pending Review") {
                    approvalBadge = `<span class="status-badge paused">Pending Review</span>`;
                } else if (approvalStatus === "Edits Requested") {
                    approvalBadge = `<span class="status-badge failed">Edits Requested</span>`;
                } else {
                    approvalBadge = `<span style="color: var(--text-muted); font-size: 13px;">N/A</span>`;
                }
                
                tr.innerHTML = `
                    <td><code>#${run.id}</code></td>
                    <td><strong>${run.company_name}</strong></td>
                    <td>${compStr}</td>
                    <td><span class="status-badge ${run.status}">${run.status}</span></td>
                    <td>${approvalBadge}</td>
                    <td>${dateStr}</td>
                    <td>${actionBtn}</td>
                `;
                tbody.appendChild(tr);
            });
            
            // Add click listeners to avoid inline event handlers (blocked by CSP)
            tbody.querySelectorAll(".action-btn-view").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const runId = btn.getAttribute("data-run-id");
                    viewReportDetails(runId);
                });
            });
            tbody.querySelectorAll(".action-btn-resume").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const runId = btn.getAttribute("data-run-id");
                    resumeActiveReview(runId);
                });
            });
            tbody.querySelectorAll(".action-btn-delete").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const runId = btn.getAttribute("data-run-id");
                    deleteRun(runId);
                });
            });
        })
        .catch(err => console.error("Error loading history:", err));
}

// Resume review process directly from the history table
window.resumeActiveReview = function(runId) {
    activeRunId = runId;
    
    // Switch to active run tab
    document.querySelectorAll(".menu-item").forEach(item => {
        if (item.getAttribute("data-tab") === "active-run-tab") {
            item.click();
        }
    });
    
    // Retrieve run details and update UI
    fetch(`/api/runs/${runId}`)
        .then(res => res.json())
        .then(run => {
            document.getElementById("current-company-name").textContent = run.company_name;
            document.getElementById("current-run-status").textContent = run.status;
            document.getElementById("log-console").textContent = run.logs || "";
            document.getElementById("active-run-details").style.display = "flex";
            
            document.getElementById("draft-markdown-preview").innerHTML = renderMarkdown(run.report);
            
            document.getElementById("hitl-panel").style.display = "flex";
            document.querySelector(".console-grid").classList.add("dual-pane");
            
            updateSystemIndicator("Review Needed", "paused");
            
            // Reset pausedStartTime and start polling to track timeout
            pausedStartTime = null;
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(pollActiveRun, 1000);
        });
};

// ==========================================================================
// Modal Handlers & Report View
// ==========================================================================
function setupModalHandlers() {
    const modal = document.getElementById("report-modal");
    const closeBtn = document.getElementById("close-modal-btn");
    
    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
    });
    
    window.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
        }
    });
}

window.viewReportDetails = function(runId) {
    fetch(`/api/runs/${runId}`)
        .then(res => res.json())
        .then(run => {
            document.getElementById("modal-report-title").textContent = run.approval_status === "Timed-Out (Draft Only)" ? `Draft Report: ${run.company_name}` : `Competitor Analysis: ${run.company_name}`;
            document.getElementById("modal-report-body").innerHTML = renderMarkdown(run.report);
            
            const footer = document.getElementById("modal-report-footer");
            const approveBtn = document.getElementById("modal-approve-btn");
            
            if (run.approval_status === "Timed-Out (Draft Only)") {
                footer.style.display = "flex";
                approveBtn.onclick = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const confirmed = await showConfirmDialog("Approve Draft", "Are you sure you want to approve this draft and publish it?");
                    if (!confirmed) {
                        return;
                    }
                    
                    // Close the view report modal
                    document.getElementById("report-modal").style.display = "none";
                    
                    // Execute approval
                    lateApproveRun(runId);
                };
            } else {
                footer.style.display = "none";
                approveBtn.onclick = null;
            }
            
            document.getElementById("report-modal").style.display = "flex";
        })
        .catch(err => console.error("Error loading report:", err));
};

// ==========================================================================
// Dashboard Analytics & Charts
// ==========================================================================
function loadDashboardData() {
    fetch("/api/analytics")
        .then(res => res.json())
        .then(analytics => {
            document.getElementById("stat-total").textContent = analytics.total_runs;
            
            const rate = analytics.total_runs > 0
                ? Math.round((analytics.completed / analytics.total_runs) * 100)
                : 0;
            document.getElementById("stat-rate").textContent = `${rate}%`;
            document.getElementById("stat-duration").textContent = `${analytics.avg_duration_seconds}s`;
            document.getElementById("stat-active").textContent = analytics.paused + (analytics.total_runs - analytics.completed - analytics.failed - analytics.paused);
            
            // Build Competitors Frequency Chart
            buildCompetitorsChart(analytics.competitor_frequencies);
        })
        .catch(err => console.error("Error loading analytics:", err));
}

function buildCompetitorsChart(frequencies) {
    const ctx = document.getElementById("competitorsChart").getContext("2d");
    
    const labels = Object.keys(frequencies);
    const data = Object.values(frequencies);
    
    if (competitorsChart) {
        competitorsChart.destroy();
    }
    
    // Sort descending
    const combined = labels.map((l, i) => ({ label: l, val: data[i] }));
    combined.sort((a, b) => b.val - a.val);
    
    competitorsChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: combined.map(x => x.label),
            datasets: [{
                label: "Occurrences Discovered",
                data: combined.map(x => x.val),
                backgroundColor: "rgba(139, 92, 246, 0.6)",
                borderColor: "rgba(139, 92, 246, 1)",
                borderWidth: 1.5,
                borderRadius: 6,
                hoverBackgroundColor: "rgba(139, 92, 246, 0.85)"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "hsl(218, 12%, 65%)", stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: "hsl(218, 12%, 65%)" }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ==========================================================================
// Competitor Quick-Reference Card Generator
// ==========================================================================
function renderResultCards(finalReports) {
    if (!finalReports || finalReports.length === 0) {
        return "<p style='color: #555555; padding: 20px;'>No structured result cards generated for this run. Switch to the 'Full Report' tab to read the text report.</p>";
    }
    
    let html = "";
    finalReports.forEach(card => {
        let features = card.core_features || "";
        if (Array.isArray(features)) {
            features = features.map(item => {
                let clean = item.trim();
                // Strip existing bullet chars if any
                clean = clean.replace(/^[•\*\-\s]+/g, "");
                return `• ${clean}`;
            }).join("\n");
        } else if (typeof features === "string") {
            // Replace bullets nicely if they contain raw formatting
            features = features.replace(/^[•\*\-\s]+/gm, "• ");
        }
        
        html += `
            <div class="competitor-result-card">
                <div class="competitor-card-title">
                    <span class="card-square-icon"></span>
                    <span>${card.competitor_name}</span>
                </div>
                
                <div class="competitor-card-field">
                    <label>Pricing Model</label>
                    <p>${card.pricing_model || "N/A"}</p>
                </div>
                
                <div class="competitor-card-field">
                    <label>Core Features</label>
                    <p>${features || "N/A"}</p>
                </div>
                
                <div class="competitor-card-field">
                    <label>Market Positioning</label>
                    <p>${card.market_positioning || "N/A"}</p>
                </div>
                
                <div class="competitor-card-field">
                    <label>Recent News</label>
                    <p>${card.recent_news || "N/A"}</p>
                </div>
            </div>
        `;
    });
    return html;
}

// ==========================================================================
// Simple Client-Side Markdown Parser
// ==========================================================================
function renderMarkdown(md) {
    if (!md) return "<p style='color: var(--text-muted);'>No content generated.</p>";
    
    // HTML Sanitization
    let html = md
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold / Italic formatting
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Bullets (lines starting with * or -)
    html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
    html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
    
    // Parse Markdown tables
    const lines = html.split('\n');
    let output = [];
    let inTable = false;
    let tableRows = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('|') && line.endsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableRows = [];
            }
            // Parse cell items
            const cells = line.split('|').map(c => c.trim()).slice(1, -1);
            tableRows.push(cells);
        } else {
            if (inTable) {
                output.push(generateHTMLTable(tableRows));
                inTable = false;
            }
            output.push(line);
        }
    }
    if (inTable) {
        output.push(generateHTMLTable(tableRows));
    }
    
    // Paragraph compilation
    html = output.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("<h") || trimmed.startsWith("<li") || trimmed.startsWith("<div") || trimmed.startsWith("</div") || trimmed.startsWith("<table") || trimmed.startsWith("</table") || trimmed.startsWith("<thead") || trimmed.startsWith("</thead") || trimmed.startsWith("<tbody") || trimmed.startsWith("</tbody") || trimmed.startsWith("<tr") || trimmed.startsWith("</tr") || trimmed.startsWith("<th") || trimmed.startsWith("</th") || trimmed.startsWith("<td") || trimmed.startsWith("</td")) {
            return line;
        }
        return `<p>${line}</p>`;
    }).join('\n');
    
    return html;
}

function generateHTMLTable(rows) {
    if (rows.length === 0) return "";
    
    let html = '<div class="table-container" style="overflow-x: auto; margin-bottom: 20px;"><table style="width:100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; font-size: 14px;">';
    
    // Row 0 is header
    const headers = rows[0];
    html += '<thead><tr style="background-color: rgba(255,255,255,0.03);">';
    headers.forEach(h => {
        html += `<th style="padding: 10px 12px; border: 1px solid var(--border-color); text-align: left; font-weight: 600;">${h}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    // Remaining rows (skipping delimiter line if it contains dashes)
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const isDelimiter = row.every(cell => /^[\-\s:]+$/.test(cell));
        if (isDelimiter) continue;
        
        html += '<tr style="border-bottom: 1px solid var(--border-color);">';
        row.forEach(cell => {
            html += `<td style="padding: 10px 12px; border: 1px solid var(--border-color);">${cell}</td>`;
        });
        html += '</tr>';
    }
    
    html += '</tbody></table></div>';
    return html;
}

window.lateApproveRun = async function(runId) {
    const confirmed = await showConfirmDialog("Approve Draft", "Are you sure you want to approve this draft and publish it?");
    if (!confirmed) {
        return;
    }
    
    fetch(`/api/runs/${runId}/late-approve`, {
        method: "POST"
    })
    .then(checkResponse)
    .then(data => {
        showToast("Draft approved and published successfully!", "success");
        loadHistoryData(); // Reload table
    })
    .catch(err => {
        console.error("Error approving draft:", err);
        showToast("Failed to approve draft: " + err.message, "error");
    });
};

window.deleteRun = async function(runId) {
    const confirmed = await showConfirmDialog("Delete Run", "Are you sure you want to delete this run and its reports?");
    if (!confirmed) {
        return;
    }
    
    fetch(`/api/runs/${runId}`, {
        method: "DELETE"
    })
    .then(checkResponse)
    .then(data => {
        showToast("Run deleted successfully!", "success");
        loadHistoryData(); // Reload table
    })
    .catch(err => {
        console.error("Error deleting run:", err);
        showToast("Failed to delete run: " + err.message, "error");
    });
};

import os
import socket
import ipaddress
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup
from typing import List, Dict, Any

def is_safe_url(url: str) -> bool:
    """
    Validates that a URL uses http/https, parses the hostname, resolves its IPs,
    and checks that none of the IPs resolved are private or loopback ranges (SSRF Guard).
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        
        hostname = parsed.hostname
        if not hostname:
            return False
        
        # Resolve IP addresses for hostname
        ips = socket.getaddrinfo(hostname, None)
        for item in ips:
            ip_str = item[4][0]
            # Strip brackets if it is IPv6 formatted address
            if ip_str.startswith('[') and ip_str.endswith(']'):
                ip_str = ip_str[1:-1]
            ip = ipaddress.ip_address(ip_str)
            if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
                return False
        return True
    except Exception:
        return False

def web_search(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    Searches the web for a query. Fallback to DuckDuckGo if Tavily API Key is missing.
    Returns a list of dicts with 'title', 'link', and 'snippet'.
    """
    tavily_key = os.getenv("TAVILY_API_KEY")
    if tavily_key:
        try:
            # Try Tavily Search API
            url = "https://api.tavily.com/search"
            payload = {
                "api_key": tavily_key,
                "query": query,
                "max_results": max_results
            }
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            results = response.json().get("results", [])
            return [
                {
                    "title": r.get("title", ""),
                    "link": r.get("url", ""),
                    "snippet": r.get("content", "")
                }
                for r in results
            ]
        except Exception as e:
            print(f"Tavily search failed: {e}. Falling back to DuckDuckGo...")
    
    # Fallback: DuckDuckGo Search (no API key required)
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            return [
                {
                    "title": r.get("title", ""),
                    "link": r.get("href", ""),
                    "snippet": r.get("body", "")
                }
                for r in results
            ]
    except Exception as e:
        print(f"DuckDuckGo search failed: {e}")
        return []

def fetch_page_content(url: str) -> str:
    """
    Fetches the content of a webpage, parses the text, and cleans up elements.
    Ensures safe timeouts and graceful failure.
    """
    if not is_safe_url(url):
        return f"Error: Request to {url} was blocked for security reasons (SSRF Guard: private IP ranges are restricted)."

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=8)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()
            
        # Get text
        text = soup.get_text(separator=" ")
        
        # Break into lines and remove leading/trailing space
        lines = (line.strip() for line in text.splitlines())
        # Break multi-headlines into a line each
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        # Drop blank lines
        text = " ".join(chunk for chunk in chunks if chunk)
        
        # Limit content size to avoid context overflow (first 2500 words)
        words = text.split()
        if len(words) > 2500:
            text = " ".join(words[:2500]) + " ... [Content Truncated]"
            
        return text
    except Exception as e:
        return f"Error fetching webpage content from {url}: {str(e)}"

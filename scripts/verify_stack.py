import urllib.request
import urllib.error
import time

def check_health(url, name):
    print(f"Checking {name} at {url}...", end=" ")
    try:
        urllib.request.urlopen(url, timeout=5)
        print("✅ UP")
        return True
    except urllib.error.URLError as e:
        print(f"❌ DOWN ({e.reason})")
        return False

def verify_stack():
    services = [
        ("Frontend Dashboard", "http://localhost:3000"),
        ("WebSocket Gateway", "http://localhost:8003/health"),
        ("Event Processor API", "http://localhost:8002/health"),
        ("Grafana Metrics", "http://localhost:3001/login")
    ]
    
    all_up = True
    for name, url in services:
        if not check_health(url, name):
            all_up = False
            
    if all_up:
        print("\n🟢 All core systems are running healthily.")
    else:
        print("\n🔴 Some systems are degraded. Please check docker logs.")

if __name__ == "__main__":
    verify_stack()

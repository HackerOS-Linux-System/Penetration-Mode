import subprocess
import json

def run_bloodhound(domain, user, password):
    result = subprocess.run(
        ["bloodhound-python", "-u", user, "-p", password, "-d", domain, "-c", "All"],
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

if __name__ == "__main__":
    print(run_bloodhound("example.com", "user", "pass"))

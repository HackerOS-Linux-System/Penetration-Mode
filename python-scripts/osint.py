import subprocess
import json

def run_theharvester(domain, output_file="/tmp/penmode-session-theharvester.json"):
    result = subprocess.run(
        ["theharvester", "-d", domain, "-b", "all", "-f", output_file],
        capture_output=True, text=True
    )
    with open(output_file, 'r') as f:
        return json.load(f)

def run_bloodhound(domain, user, password, output_file="/tmp/penmode-session-bloodhound.json"):
    result = subprocess.run(
        ["bloodhound-python", "-u", user, "-p", password, "-d", domain, "-c", "All", "--zip"],
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

if __name__ == "__main__":
    print(run_theharvester("example.com"))

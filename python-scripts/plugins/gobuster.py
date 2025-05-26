import subprocess
import json

def run_gobuster(url, wordlist, output_file="/tmp/penmode-session-gobuster.txt"):
    result = subprocess.run(
        ["gobuster", "dir", "-u", url, "-w", wordlist, "-o", output_file],
        capture_output=True, text=True
    )
    with open(output_file, 'r') as f:
        return json.dumps({"directories": f.read().splitlines()}, indent=2)

if __name__ == "__main__":
    print(run_gobuster("http://example.com", "/data/wordlist.txt"))

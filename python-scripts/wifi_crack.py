import subprocess
import json

def run_aircrack(wordlist, capture_file):
    result = subprocess.run(
        ["aircrack-ng", "-w", wordlist, capture_file],
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

if __name__ == "__main__":
    print(run_aircrack("/data/wordlist.txt", "/data/capture.cap"))

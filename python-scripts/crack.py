import subprocess
import json

def run_hashcat(hash_file, wordlist, mode=0):
    result = subprocess.run(
        ["hashcat", "-m", str(mode), hash_file, wordlist, "--show"],
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

if __name__ == "__main__":
    print(run_hashcat("/data/hashes.txt", "/data/wordlist.txt"))

import subprocess
import json

def run_responder(interface):
    result = subprocess.run(
        ["responder", "-I", interface, "-wrf"],
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

def run_crackmapexec(target, protocol="smb"):
    result = subprocess.run(
        ["crackmapexec", protocol, target],
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

if __name__ == "__main__":
    print(run_responder("eth0"))

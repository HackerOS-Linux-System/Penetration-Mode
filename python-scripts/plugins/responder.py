import subprocess
import json

def run_responder_plugin(interface, options=""):
    result = subprocess.run(
        ["responder", "-I", interface] + options.split(),
        capture_output=True, text=True
    )
    return json.dumps({"output": result.stdout, "error": result.stderr}, indent=2)

if __name__ == "__main__":
    print(run_responder_plugin("eth0", "-wrf"))

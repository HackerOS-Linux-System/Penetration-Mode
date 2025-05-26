import xml.etree.ElementTree as ET
import json
import subprocess

def run_nmap(target, output_file="/tmp/penmode-session-nmap.xml"):
    subprocess.run(["nmap", "-A", "-oX", output_file, target], check=True)
    return parse_nmap_xml(output_file)

def run_masscan(target, output_file="/tmp/penmode-session-masscan.json"):
    subprocess.run(["masscan", target, "--rate=1000", "-oJ", output_file], check=True)
    with open(output_file, 'r') as f:
        return json.load(f)

def run_amass(target, output_file="/tmp/penmode-session-amass.json"):
    subprocess.run(["amass", "enum", "-d", target, "-o", output_file], check=True)
    with open(output_file, 'r') as f:
        return json.dumps({"subdomains": f.read().splitlines()}, indent=2)

def parse_nmap_xml(xml_file):
    tree = ET.parse(xml_file)
    root = tree.getroot()
    result = []
    for host in root.findall("host"):
        ip = host.find("address").attrib["addr"]
        ports = [
            {
                "port": port.attrib["portid"],
                "protocol": port.attrib["protocol"],
                "state": port.find("state").attrib["state"],
                "service": port.find("service").attrib.get("name", "unknown"),
            }
            for port in host.findall("ports/port")
        ]
        result.append({"ip": ip, "ports": ports})
    return json.dumps(result, indent=2)

if __name__ == "__main__":
    print(run_nmap("127.0.0.1"))

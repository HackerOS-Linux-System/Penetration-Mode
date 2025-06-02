import subprocess
import os
import logging

class Controller:
    def __init__(self):
        self.backend_path = os.path.abspath("backend/kontenerator/target/release/kontenerator")
        self.script_path = os.path.abspath("scripts/run_tool.sh")
        self.log_path = os.path.abspath("logs/penetration_mode.log")
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        
        # Setup logging
        logging.basicConfig(filename=self.log_path, level=logging.INFO, 
                          format="%(asctime)s - %(levelname)s - %(message)s")
        self.logger = logging.getLogger(__name__)
        
        try:
            self.start_container()
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Failed to start container: {e}")
            raise

    def start_container(self):
        self.logger.info("Starting container...")
        subprocess.run([self.backend_path, "start"], check=True)

    def stop_container(self):
        self.logger.info("Stopping container...")
        try:
            subprocess.run([self.backend_path, "stop"], check=True)
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Failed to stop container: {e}")

    def run_tool(self, tool_cmd):
        self.logger.info(f"Running tool: {tool_cmd}")
        try:
            subprocess.run([self.script_path, tool_cmd], check=True)
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Failed to run tool {tool_cmd}: {e}")
            raise

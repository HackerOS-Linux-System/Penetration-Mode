import sys
import json
from PyQt6.QtWidgets import QApplication, QMainWindow, QPushButton, QVBoxLayout, QWidget, QTabWidget, QGridLayout, QLabel
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QIcon
from controller import Controller
import os

class PenetrationModeApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Penetration Mode")
        self.setGeometry(100, 100, 800, 600)
        self.controller = Controller()
        self.init_ui()

    def init_ui(self):
        # Load stylesheet
        with open("gui/styles.qss", "r") as f:
            self.setStyleSheet(f.read())

        # Central widget and layout
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)

        # Tabs for tool categories
        tabs = QTabWidget()
        main_layout.addWidget(tabs)

        # Load tools from JSON
        with open("gui/tools.json", "r") as f:
            tools_data = json.load(f)

        # Organize tools by category
        categories = {}
        for tool in tools_data:
            category = tool.get("category", "Other")
            if category not in categories:
                categories[category] = []
            categories[category].append(tool)

        # Create tab for each category
        for category, tools in categories.items():
            tab = QWidget()
            grid_layout = QGridLayout()
            tab.setLayout(grid_layout)

            for i, tool in enumerate(tools):
                btn = QPushButton(tool["name"])
                btn.setToolTip(tool.get("description", ""))
                btn.clicked.connect(lambda _, cmd=tool["cmd"]: self.run_tool(cmd))
                btn.setMinimumHeight(40)
                grid_layout.addWidget(btn, i // 4, i % 4)  # 4 buttons per row
            tabs.addTab(tab, category)

        # Status label
        self.status_label = QLabel("Ready")
        main_layout.addWidget(self.status_label)

    def run_tool(self, tool_cmd):
        try:
            self.controller.run_tool(tool_cmd)
            self.status_label.setText(f"Running {tool_cmd}...")
        except Exception as e:
            self.status_label.setText(f"Error: {str(e)}")

    def closeEvent(self, event):
        self.status_label.setText("Shutting down...")
        self.controller.stop_container()
        event.accept()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setWindowIcon(QIcon("assets/icon.png"))
    window = PenetrationModeApp()
    window.show()
    sys.exit(app.exec())

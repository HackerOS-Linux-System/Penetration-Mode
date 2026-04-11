import sys
import socket
import subprocess
import os
import json
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QLineEdit, QTextEdit, QTabWidget, QSpinBox,
    QProgressBar, QGroupBox, QMessageBox, QFormLayout, QCheckBox,
    QComboBox, QScrollArea
)
from PyQt6.QtGui import QIcon, QPixmap, QFont
from PyQt6.QtCore import Qt, QThread, pyqtSignal


# ====================== ŚCIEŻKI ======================
ICON_PATH = "/usr/share/HackerOS/ICONS/Penetration-Mode.png"
SETTINGS_DIR = os.path.expanduser("~/.cache/HackerOS/Penetration-Mode")
SETTINGS_FILE = os.path.join(SETTINGS_DIR, "settings.json")


# ====================== WĄTKI ======================
class PortScannerThread(QThread):
    log_signal = pyqtSignal(str)
    progress_signal = pyqtSignal(int)

    def __init__(self, target, start_port, end_port):
        super().__init__()
        self.target = target
        self.start_port = start_port
        self.end_port = end_port

    def run(self):
        open_ports = []
        total = self.end_port - self.start_port + 1
        for i, port in enumerate(range(self.start_port, self.end_port + 1)):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.8)
                if sock.connect_ex((self.target, port)) == 0:
                    open_ports.append(port)
                    self.log_signal.emit(f"Port {port} OTWARTY")
                sock.close()
            except:
                pass
            self.progress_signal.emit(int((i + 1) / total * 100))
        self.log_signal.emit(f"Skanowanie zakończone. Otwarte porty: {open_ports}")


class SubdomainThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, domain):
        super().__init__()
        self.domain = domain
        self.common = ["www", "mail", "ftp", "admin", "dev", "api", "blog", "test", "staging", "vpn", "secure", "login", "ns1", "ns2", "web", "shop"]

    def run(self):
        self.log_signal.emit(f"Enumeracja subdomen dla {self.domain}...")
        found = 0
        for sub in self.common:
            try:
                full = f"{sub}.{self.domain}"
                ip = socket.gethostbyname(full)
                self.log_signal.emit(f"{full} → {ip}")
                found += 1
            except:
                pass
        self.log_signal.emit(f"Znaleziono {found} subdomen")


class PingThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, target):
        super().__init__()
        self.target = target

    def run(self):
        self.log_signal.emit(f"Pingowanie {self.target}...")
        try:
            result = subprocess.check_output(["ping", "-c", "4", "-W", "2", self.target], stderr=subprocess.STDOUT, text=True)
            self.log_signal.emit(result.strip())
        except Exception as e:
            self.log_signal.emit(f"Błąd ping: {e}")


class WhoisThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, domain):
        super().__init__()
        self.domain = domain

    def run(self):
        self.log_signal.emit(f"Pobieranie WHOIS dla {self.domain}...")
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(10)
            s.connect(("whois.iana.org", 43))
            s.send(f"{self.domain}\r\n".encode())
            response = b""
            while True:
                data = s.recv(4096)
                if not data:
                    break
                response += data
            s.close()
            self.log_signal.emit(response.decode(errors="ignore"))
        except Exception as e:
            self.log_signal.emit(f"Błąd WHOIS: {e}")


class HttpHeadersThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, url):
        super().__init__()
        self.url = url if url.startswith("http") else f"http://{url}"

    def run(self):
        self.log_signal.emit(f"Pobieranie nagłówków HTTP: {self.url}")
        try:
            import urllib.request
            req = urllib.request.Request(self.url, headers={"User-Agent": "PenetrationMode/3.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                headers = "\n".join(f"{k}: {v}" for k, v in resp.getheaders())
                self.log_signal.emit(f"Status: {resp.status}\n\n{headers}")
        except Exception as e:
            self.log_signal.emit(f"Błąd: {e}")


class BannerThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, host, port):
        super().__init__()
        self.host = host
        self.port = port

    def run(self):
        self.log_signal.emit(f"Pobieranie bannera {self.host}:{self.port}...")
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect((self.host, self.port))
            banner = s.recv(2048).decode("utf-8", errors="ignore").strip()
            s.close()
            self.log_signal.emit(banner or "Brak widocznego bannera")
        except Exception as e:
            self.log_signal.emit(f"Błąd: {e}")


class DNSThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, domain):
        super().__init__()
        self.domain = domain

    def run(self):
        self.log_signal.emit(f"Rozwiązywanie DNS dla {self.domain}...")
        try:
            # Podstawowe A
            ip = socket.gethostbyname(self.domain)
            self.log_signal.emit(f"A: {ip}")

            # Pełne info
            name, aliases, ips = socket.gethostbyname_ex(self.domain)
            if aliases:
                self.log_signal.emit(f"Aliasy: {', '.join(aliases)}")
            if len(ips) > 1:
                self.log_signal.emit(f"Dodatkowe IP: {', '.join(ips[1:])}")
        except Exception as e:
            self.log_signal.emit(f"Błąd DNS: {e}")


class TracerouteThread(QThread):
    log_signal = pyqtSignal(str)

    def __init__(self, target):
        super().__init__()
        self.target = target

    def run(self):
        self.log_signal.emit(f"Traceroute do {self.target}...")
        try:
            result = subprocess.check_output(["traceroute", "-q", "1", "-m", "30", self.target], stderr=subprocess.STDOUT, text=True)
            self.log_signal.emit(result.strip())
        except Exception as e:
            self.log_signal.emit(f"Błąd traceroute (brak komendy lub brak uprawnień): {e}")


# ====================== GŁÓWNE OKNO ======================
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Penetration Mode")
        self.setGeometry(80, 80, 1380, 880)

        # Logo
        self.setWindowIcon(QIcon(ICON_PATH))

        # Zmienne
        self.all_tools = [
            "Port Scanner", "Subdomain Enumerator", "Ping", "WHOIS",
            "HTTP Headers", "Banner Grabber", "DNS Lookup", "Traceroute"
        ]
        self.tool_creators = {
            "Port Scanner": self.create_port_scanner_page,
            "Subdomain Enumerator": self.create_subdomain_page,
            "Ping": self.create_ping_page,
            "WHOIS": self.create_whois_page,
            "HTTP Headers": self.create_http_headers_page,
            "Banner Grabber": self.create_banner_page,
            "DNS Lookup": self.create_dns_page,
            "Traceroute": self.create_traceroute_page,
        }
        self.enabled_tools = self.all_tools.copy()
        self.current_theme = "Ciemny Szary"
        self.start_fullscreen = False

        self.load_settings()

        # Główny layout
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Górny pasek
        self.create_header(main_layout)

        # Zakładki
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        main_layout.addWidget(self.tabs)

        self.build_tabs()

        self.apply_theme()
        if self.start_fullscreen:
            self.showFullScreen()

    def create_header(self, parent_layout):
        header = QWidget()
        header.setFixedHeight(85)
        header.setStyleSheet("background-color: #1e1e1e; border-bottom: 3px solid #3a3a3a;")
        h_layout = QHBoxLayout(header)
        h_layout.setContentsMargins(25, 15, 25, 15)

        # Logo
        logo_label = QLabel()
        pixmap = QPixmap(ICON_PATH)
        if not pixmap.isNull():
            logo_label.setPixmap(pixmap.scaled(68, 68, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        else:
            logo_label.setText("PENETRATION")
            logo_label.setStyleSheet("font-size: 28px; color: #f0f0f0; font-weight: bold;")
        h_layout.addWidget(logo_label)

        # Tytuł
        title = QLabel("PENETRATION MODE")
        title.setFont(QFont("Arial", 26, QFont.Weight.Bold))
        title.setStyleSheet("color: #f0f0f0;")
        h_layout.addWidget(title)

        h_layout.addStretch()

        # Przycisk pełny ekran (zawsze widoczny)
        fs_btn = QPushButton("⛶ Pełny ekran")
        fs_btn.setFixedWidth(160)
        fs_btn.clicked.connect(self.toggle_fullscreen)
        h_layout.addWidget(fs_btn)

        parent_layout.addWidget(header)

    def toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()

    def build_tabs(self):
        self.tabs.clear()

        # Strona główna (zawsze)
        self.home_page = QWidget()
        self.home_layout = QVBoxLayout(self.home_page)
        self.refresh_home_page()
        self.tabs.addTab(self.home_page, "Strona główna")

        # Narzędzia (tylko włączone)
        for tool_name in self.enabled_tools:
            page = self.tool_creators[tool_name]()
            self.tabs.addTab(page, tool_name)

        # Ustawienia (zawsze)
        settings_page = self.create_settings_page()
        self.tabs.addTab(settings_page, "Ustawienia")

    def refresh_home_page(self):
        # Czyścimy poprzedni layout
        for i in reversed(range(self.home_layout.count())):
            widget = self.home_layout.itemAt(i).widget()
            if widget:
                widget.setParent(None)

        # Tytuł
        title = QLabel("Witaj w Penetration Mode")
        title.setFont(QFont("Arial", 36, QFont.Weight.Bold))
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("color: #f0f0f0; margin: 30px 0 10px 0;")
        self.home_layout.addWidget(title)

        subtitle = QLabel("Wybierz narzędzie poniżej lub przejdź do zakładki")
        subtitle.setFont(QFont("Arial", 18))
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #bbbbbb;")
        self.home_layout.addWidget(subtitle)

        # Siatka przycisków
        grid = QGridLayout()
        grid.setSpacing(20)
        row, col = 0, 0
        for tool in self.enabled_tools:
            btn = QPushButton(tool)
            btn.setFixedSize(260, 110)
            btn.setFont(QFont("Arial", 14, QFont.Weight.Bold))
            btn.clicked.connect(lambda _, t=tool: self.switch_to_tab(t))
            grid.addWidget(btn, row, col)
            col += 1
            if col > 3:
                col = 0
                row += 1

        self.home_layout.addLayout(grid)
        self.home_layout.addStretch()

    def switch_to_tab(self, tool_name):
        for i in range(self.tabs.count()):
            if self.tabs.tabText(i) == tool_name:
                self.tabs.setCurrentIndex(i)
                return

    def apply_theme(self):
        if self.current_theme == "Ciemny Szary":
            base_bg = "#1e1e1e"
            widget_bg = "#2c2c2c"
            border = "#444444"
            text = "#f0f0f0"
            accent = "#aaaaaa"
        else:  # Czarny Czysty
            base_bg = "#181818"
            widget_bg = "#222222"
            border = "#3a3a3a"
            text = "#f0f0f0"
            accent = "#cccccc"

        style = f"""
            QMainWindow, QTabWidget, QWidget {{
                background-color: {base_bg};
            }}
            QLabel, QLineEdit, QTextEdit, QSpinBox, QGroupBox, QComboBox, QCheckBox {{
                color: {text};
                background-color: {widget_bg};
                border: 1px solid {border};
                border-radius: 12px;
            }}
            QLineEdit, QTextEdit, QSpinBox, QComboBox {{
                padding: 10px;
                border-radius: 10px;
            }}
            QPushButton {{
                background-color: #363636;
                color: {text};
                border: 1px solid {border};
                border-radius: 14px;
                padding: 14px 24px;
                font-weight: bold;
                font-size: 15px;
            }}
            QPushButton:hover {{
                background-color: #4a4a4a;
                border-color: {accent};
            }}
            QPushButton:pressed {{
                background-color: #5c5c5c;
            }}
            QGroupBox {{
                border-radius: 14px;
                margin-top: 12px;
                font-weight: bold;
            }}
            QTabBar::tab {{
                background-color: #2c2c2c;
                color: {text};
                padding: 16px 32px;
                font-size: 16px;
                border-top-left-radius: 14px;
                border-top-right-radius: 14px;
                margin-right: 6px;
            }}
            QTabBar::tab:selected {{
                background-color: #3a3a3a;
                border-bottom: 4px solid {accent};
            }}
            QTabBar::tab:hover:!selected {{
                background-color: #343434;
            }}
            QProgressBar {{
                border: 1px solid {border};
                border-radius: 12px;
                text-align: center;
                background-color: {widget_bg};
            }}
            QProgressBar::chunk {{
                background-color: {accent};
                border-radius: 10px;
            }}
            QTextEdit {{
                font-family: "Consolas", monospace;
                font-size: 14px;
                border-radius: 10px;
            }}
            QScrollArea {{
                border: none;
            }}
        """
        self.setStyleSheet(style)

    # ====================== STRONY NARZĘDZI ======================
    def create_port_scanner_page(self):
        return self._create_generic_tool_page("Skaner portów TCP", self.start_port_scan, ["Cel", "Zakres portów"])

    def start_port_scan(self, page):
        target = page.findChild(QLineEdit, "target").text().strip()
        start = page.findChild(QSpinBox, "start").value()
        end = page.findChild(QSpinBox, "end").value()
        log = page.findChild(QTextEdit)
        progress = page.findChild(QProgressBar)

        if not target:
            QMessageBox.warning(self, "Błąd", "Podaj cel!")
            return
        log.clear()
        log.append(f"Rozpoczynam skanowanie {target}...")
        thread = PortScannerThread(target, start, end)
        thread.log_signal.connect(log.append)
        thread.progress_signal.connect(progress.setValue)
        thread.start()

    def create_subdomain_page(self):
        return self._create_generic_tool_page("Enumerator subdomen", self.start_subdomain, ["Domena"])

    def start_subdomain(self, page):
        domain = page.findChild(QLineEdit, "target").text().strip()
        log = page.findChild(QTextEdit)
        if not domain:
            return
        log.clear()
        thread = SubdomainThread(domain)
        thread.log_signal.connect(log.append)
        thread.start()

    def create_ping_page(self):
        return self._create_generic_tool_page("Ping", self.start_ping, ["Cel"])

    def start_ping(self, page):
        target = page.findChild(QLineEdit, "target").text().strip()
        log = page.findChild(QTextEdit)
        if not target:
            return
        log.clear()
        thread = PingThread(target)
        thread.log_signal.connect(log.append)
        thread.start()

    def create_whois_page(self):
        return self._create_generic_tool_page("WHOIS", self.start_whois, ["Domena / IP"])

    def start_whois(self, page):
        domain = page.findChild(QLineEdit, "target").text().strip()
        log = page.findChild(QTextEdit)
        if not domain:
            return
        log.clear()
        thread = WhoisThread(domain)
        thread.log_signal.connect(log.append)
        thread.start()

    def create_http_headers_page(self):
        return self._create_generic_tool_page("Nagłówki HTTP", self.start_http_headers, ["URL / Host"])

    def start_http_headers(self, page):
        url = page.findChild(QLineEdit, "target").text().strip()
        log = page.findChild(QTextEdit)
        if not url:
            return
        log.clear()
        thread = HttpHeadersThread(url)
        thread.log_signal.connect(log.append)
        thread.start()

    def create_banner_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(40, 40, 40, 40)

        group = QGroupBox("Banner Grabber")
        form = QFormLayout(group)
        host_edit = QLineEdit("192.168.1.1")
        host_edit.setObjectName("host")
        port_spin = QSpinBox()
        port_spin.setRange(1, 65535)
        port_spin.setValue(80)
        port_spin.setObjectName("port")

        form.addRow("Host / IP:", host_edit)
        form.addRow("Port:", port_spin)

        btn = QPushButton("Pobierz banner")
        btn.clicked.connect(lambda: self.start_banner(page))
        form.addRow(btn)
        layout.addWidget(group)

        log = QTextEdit()
        log.setReadOnly(True)
        layout.addWidget(log)
        return page

    def start_banner(self, page):
        host = page.findChild(QLineEdit, "host").text().strip()
        port = page.findChild(QSpinBox, "port").value()
        log = page.findChild(QTextEdit)
        log.clear()
        thread = BannerThread(host, port)
        thread.log_signal.connect(log.append)
        thread.start()

    def create_dns_page(self):
        return self._create_generic_tool_page("DNS Lookup", self.start_dns, ["Domena"])

    def start_dns(self, page):
        domain = page.findChild(QLineEdit, "target").text().strip()
        log = page.findChild(QTextEdit)
        if not domain:
            return
        log.clear()
        thread = DNSThread(domain)
        thread.log_signal.connect(log.append)
        thread.start()

    def create_traceroute_page(self):
        return self._create_generic_tool_page("Traceroute", self.start_traceroute, ["Cel"])

    def start_traceroute(self, page):
        target = page.findChild(QLineEdit, "target").text().strip()
        log = page.findChild(QTextEdit)
        if not target:
            return
        log.clear()
        thread = TracerouteThread(target)
        thread.log_signal.connect(log.append)
        thread.start()

    def _create_generic_tool_page(self, title, start_function, fields):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(40, 40, 40, 40)

        group = QGroupBox(title)
        form = QFormLayout(group)
        form.setSpacing(18)

        target_edit = QLineEdit()
        target_edit.setObjectName("target")
        if "Domena" in fields or "URL" in fields or "Host" in fields:
            target_edit.setText("example.com")
        else:
            target_edit.setText("192.168.1.1")

        form.addRow(fields[0] + ":", target_edit)

        if "Zakres portów" in fields:
            ports_h = QHBoxLayout()
            start_spin = QSpinBox()
            start_spin.setRange(1, 65535)
            start_spin.setValue(1)
            start_spin.setObjectName("start")
            end_spin = QSpinBox()
            end_spin.setRange(1, 65535)
            end_spin.setValue(1024)
            end_spin.setObjectName("end")
            ports_h.addWidget(start_spin)
            ports_h.addWidget(QLabel("—"))
            ports_h.addWidget(end_spin)
            form.addRow("Zakres portów:", ports_h)

        btn = QPushButton(f"Uruchom {title.lower()}")
        btn.clicked.connect(lambda: start_function(page))
        form.addRow(btn)

        layout.addWidget(group)

        log = QTextEdit()
        log.setReadOnly(True)
        layout.addWidget(log)

        if "Zakres portów" in fields:
            progress = QProgressBar()
            progress.setValue(0)
            layout.addWidget(progress)

        return page

    # ====================== USTAWIENIA ======================
    def create_settings_page(self):
        page = QWidget()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(page)

        layout = QVBoxLayout(page)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(30)

        # Narzędzia
        tools_group = QGroupBox("Włącz / wyłącz narzędzia")
        tools_layout = QVBoxLayout(tools_group)
        self.tool_checkboxes = {}
        for tool in self.all_tools:
            h = QHBoxLayout()
            label = QLabel(tool)
            cb = QCheckBox()
            cb.setChecked(tool in self.enabled_tools)
            h.addWidget(label)
            h.addStretch()
            h.addWidget(cb)
            tools_layout.addLayout(h)
            self.tool_checkboxes[tool] = cb
        layout.addWidget(tools_group)

        # Motyw i ekran
        app_group = QGroupBox("Ustawienia aplikacji")
        app_form = QFormLayout(app_group)

        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["Ciemny Szary", "Czarny Czysty"])
        self.theme_combo.setCurrentText(self.current_theme)
        app_form.addRow("Motyw aplikacji:", self.theme_combo)

        self.fs_checkbox = QCheckBox("Uruchamiaj w trybie pełnoekranowym")
        self.fs_checkbox.setChecked(self.start_fullscreen)
        app_form.addRow(self.fs_checkbox)

        layout.addWidget(app_group)

        # Przycisk zapisu
        save_btn = QPushButton("Zapisz ustawienia i odśwież interfejs")
        save_btn.setFixedHeight(60)
        save_btn.clicked.connect(self.save_and_rebuild)
        layout.addWidget(save_btn)

        layout.addStretch()
        return scroll

    def save_and_rebuild(self):
        # Zbieramy włączone narzędzia
        new_enabled = [tool for tool, cb in self.tool_checkboxes.items() if cb.isChecked()]
        self.enabled_tools = new_enabled
        self.current_theme = self.theme_combo.currentText()
        self.start_fullscreen = self.fs_checkbox.isChecked()

        self.save_settings()
        self.apply_theme()
        self.build_tabs()
        QMessageBox.information(self, "Gotowe", "Ustawienia zostały zapisane i interfejs odświeżony.")

    # ====================== ZAPIS / ODCZYT ======================
    def load_settings(self):
        os.makedirs(SETTINGS_DIR, exist_ok=True)
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.enabled_tools = data.get("enabled_tools", self.all_tools.copy())
                    self.current_theme = data.get("theme", "Ciemny Szary")
                    self.start_fullscreen = data.get("fullscreen", False)
            except:
                pass

    def save_settings(self):
        os.makedirs(SETTINGS_DIR, exist_ok=True)
        data = {
            "enabled_tools": self.enabled_tools,
            "theme": self.current_theme,
            "fullscreen": self.start_fullscreen
        }
        try:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            QMessageBox.warning(self, "Błąd zapisu", f"Nie udało się zapisać ustawień: {e}")


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

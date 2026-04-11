#include <QApplication>
#include <QMainWindow>
#include <QTabWidget>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QLineEdit>
#include <QTextEdit>
#include <QSpinBox>
#include <QProgressBar>
#include <QGroupBox>
#include <QFormLayout>
#include <QCheckBox>
#include <QComboBox>
#include <QScrollArea>
#include <QJsonDocument>
#include <QJsonObject>
#include <QFile>
#include <QDir>
#include <QProcess>
#include <QMessageBox>
#include <QFont>
#include <QStyleFactory>

const QString ICON_PATH = "/usr/share/HackerOS/ICONS/Penetration-Mode.png";
const QString SETTINGS_DIR = QDir::homePath() + "/.cache/HackerOS/Penetration-Mode";
const QString SETTINGS_FILE = SETTINGS_DIR + "/settings.json";
const QString BACKEND_PATH = "/usr/lib/HackerOS/Penetration-Mode/penetration-backend";

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    MainWindow(QWidget *parent = nullptr) : QMainWindow(parent) {
        setWindowTitle("Penetration Mode");
        setGeometry(80, 80, 1380, 880);
        setWindowIcon(QIcon(ICON_PATH));

        loadSettings();

        QWidget *central = new QWidget;
        QVBoxLayout *mainLayout = new QVBoxLayout(central);
        mainLayout->setContentsMargins(0, 0, 0, 0);
        mainLayout->setSpacing(0);

        createHeader(mainLayout);
        tabs = new QTabWidget;
        mainLayout->addWidget(tabs);

        setCentralWidget(central);
        buildTabs();
        applyTheme();
        if (startFullscreen) showFullScreen();
    }

private:
    QTabWidget *tabs;
    QStringList allTools = {"Port Scanner", "Subdomain Enumerator", "Ping", "WHOIS", "HTTP Headers", "Banner Grabber", "DNS Lookup", "Traceroute"};
    QStringList enabledTools;
    QString currentTheme = "Ciemny Szary";
    bool startFullscreen = false;

    void createHeader(QVBoxLayout *layout) {
        QWidget *header = new QWidget;
        header->setFixedHeight(85);
        header->setStyleSheet("background-color: #1e1e1e; border-bottom: 3px solid #3a3a3a;");
        QHBoxLayout *h = new QHBoxLayout(header);
        h->setContentsMargins(25, 15, 25, 15);

        QLabel *logo = new QLabel;
        QPixmap pix(ICON_PATH);
        if (!pix.isNull()) logo->setPixmap(pix.scaled(68, 68, Qt::KeepAspectRatio, Qt::SmoothTransformation));
        h->addWidget(logo);

        QLabel *title = new QLabel("PENETRATION MODE");
        title->setFont(QFont("Arial", 26, QFont::Bold));
        title->setStyleSheet("color: #f0f0f0;");
        h->addWidget(title);
        h->addStretch();

        QPushButton *fsBtn = new QPushButton("⛶ Pełny ekran");
        fsBtn->setFixedWidth(160);
        connect(fsBtn, &QPushButton::clicked, this, &MainWindow::toggleFullscreen);
        h->addWidget(fsBtn);

        layout->addWidget(header);
    }

    void toggleFullscreen() {
        if (isFullScreen()) showNormal(); else showFullScreen();
    }

    void buildTabs() {
        tabs->clear();

        // Home
        QWidget *home = createHomePage();
        tabs->addTab(home, "Strona główna");

        // Narzędzia
        for (const QString &tool : enabledTools) {
            QWidget *page = createToolPage(tool);
            tabs->addTab(page, tool);
        }

        // Ustawienia
        QWidget *settings = createSettingsPage();
        tabs->addTab(settings, "Ustawienia");
    }

    QWidget *createHomePage() {
        QWidget *page = new QWidget;
        QVBoxLayout *l = new QVBoxLayout(page);
        l->setAlignment(Qt::AlignCenter);
        l->setSpacing(40);

        QLabel *bigLogo = new QLabel;
        QPixmap pix(ICON_PATH);
        if (!pix.isNull()) bigLogo->setPixmap(pix.scaled(260, 260, Qt::KeepAspectRatio));
        bigLogo->setAlignment(Qt::AlignCenter);
        l->addWidget(bigLogo);

        QLabel *title = new QLabel("PENETRATION MODE");
        title->setFont(QFont("Arial", 42, QFont::Bold));
        title->setStyleSheet("color: #f0f0f0;");
        title->setAlignment(Qt::AlignCenter);
        l->addWidget(title);

        l->addStretch();
        return page;
    }

    QWidget *createToolPage(const QString &toolName) {
        QWidget *page = new QWidget;
        QVBoxLayout *layout = new QVBoxLayout(page);
        layout->setContentsMargins(40, 40, 40, 40);

        QGroupBox *group = new QGroupBox(toolName);
        QFormLayout *form = new QFormLayout(group);

        QLineEdit *targetEdit = new QLineEdit("example.com");
        form->addRow("Cel / Domena / IP:", targetEdit);

        if (toolName == "Port Scanner") {
            QHBoxLayout *ports = new QHBoxLayout;
            QSpinBox *start = new QSpinBox; start->setRange(1, 65535); start->setValue(1);
            QSpinBox *end = new QSpinBox; end->setRange(1, 65535); end->setValue(1024);
            ports->addWidget(start);
            ports->addWidget(new QLabel("—"));
            ports->addWidget(end);
            form->addRow("Zakres portów:", ports);

            QPushButton *btn = new QPushButton("Uruchom Port Scanner");
            connect(btn, &QPushButton::clicked, this, [this, targetEdit, start, end, page]() {
                QString cmd = BACKEND_PATH + " portscan " + targetEdit->text() + " " + QString::number(start->value()) + " " + QString::number(end->value());
                runBackend(cmd, page);
            });
            form->addRow(btn);
        } else {
            QPushButton *btn = new QPushButton("Uruchom " + toolName);
            connect(btn, &QPushButton::clicked, this, [this, targetEdit, toolName, page]() {
                QString cmd = BACKEND_PATH + " " + toolName.toLower().replace(" ", "") + " " + targetEdit->text();
                if (toolName == "Banner Grabber") cmd += " 80"; // przykład
                runBackend(cmd, page);
            });
            form->addRow(btn);
        }

        layout->addWidget(group);

        QTextEdit *log = new QTextEdit;
        log->setReadOnly(true);
        log->setObjectName("log");
        layout->addWidget(log);

        if (toolName == "Port Scanner") {
            QProgressBar *prog = new QProgressBar;
            prog->setObjectName("progress");
            layout->addWidget(prog);
        }

        return page;
    }

    void runBackend(const QString &command, QWidget *page) {
        QTextEdit *log = page->findChild<QTextEdit*>("log");
        QProgressBar *prog = page->findChild<QProgressBar*>("progress");

        log->clear();
        if (prog) prog->setValue(0);

        QProcess *process = new QProcess(this);
        process->start(command);

        connect(process, &QProcess::readyReadStandardOutput, this, [process, log, prog]() {
            QString output = process->readAllStandardOutput();
            log->append(output.trimmed());

            // obsługa progressu
            if (prog && output.contains("PROGRESS:")) {
                int val = output.split("PROGRESS:").last().trimmed().toInt();
                prog->setValue(val);
            }
        });

        connect(process, &QProcess::finished, this, [process]() { process->deleteLater(); });
    }

    QWidget *createSettingsPage() {
        QWidget *page = new QWidget;
        QScrollArea *scroll = new QScrollArea;
        scroll->setWidgetResizable(true);
        scroll->setWidget(page);

        QVBoxLayout *l = new QVBoxLayout(page);
        l->setContentsMargins(40, 40, 40, 40);

        // Narzędzia
        QGroupBox *toolsGroup = new QGroupBox("Włącz / wyłącz narzędzia");
        QVBoxLayout *toolsL = new QVBoxLayout(toolsGroup);
        QMap<QString, QCheckBox*> checkboxes;

        for (const QString &tool : allTools) {
            QHBoxLayout *row = new QHBoxLayout;
            row->addWidget(new QLabel(tool));
            row->addStretch();
            QCheckBox *cb = new QCheckBox;
            cb->setChecked(enabledTools.contains(tool));
            row->addWidget(cb);
            toolsL->addLayout(row);
            checkboxes[tool] = cb;
        }
        l->addWidget(toolsGroup);

        // Motyw i fullscreen
        QGroupBox *appGroup = new QGroupBox("Ustawienia aplikacji");
        QFormLayout *form = new QFormLayout(appGroup);

        QComboBox *themeCombo = new QComboBox;
        themeCombo->addItems({"Ciemny Szary", "Czarny Czysty"});
        themeCombo->setCurrentText(currentTheme);
        form->addRow("Motyw aplikacji:", themeCombo);

        QCheckBox *fsCb = new QCheckBox("Uruchamiaj w trybie pełnoekranowym");
        fsCb->setChecked(startFullscreen);
        form->addRow(fsCb);

        l->addWidget(appGroup);

        QPushButton *saveBtn = new QPushButton("Zapisz ustawienia i odśwież interfejs");
        saveBtn->setFixedHeight(60);
        connect(saveBtn, &QPushButton::clicked, this, [this, checkboxes, themeCombo, fsCb]() {
            enabledTools.clear();
            for (auto it = checkboxes.begin(); it != checkboxes.end(); ++it) {
                if (it.value()->isChecked()) enabledTools << it.key();
            }
            currentTheme = themeCombo->currentText();
            startFullscreen = fsCb->isChecked();
            saveSettings();
            applyTheme();
            buildTabs();
            QMessageBox::information(this, "Gotowe", "Ustawienia zapisane.");
        });
        l->addWidget(saveBtn);

        return scroll;
    }

    void applyTheme() {
        QString base = (currentTheme == "Ciemny Szary") ? "#1e1e1e" : "#181818";
        QString widget = (currentTheme == "Ciemny Szary") ? "#2c2c2c" : "#222222";
        QString accent = "#aaaaaa";

        QString qss = QString(R"(
            QMainWindow, QTabWidget, QWidget { background-color: %1; }
            QLabel, QLineEdit, QTextEdit, QSpinBox, QGroupBox, QComboBox, QCheckBox {
                color: #f0f0f0; background-color: %2; border: 1px solid #444444; border-radius: 12px;
            }
            QPushButton {
                background-color: #363636; color: #f0f0f0; border: 1px solid #444444;
                border-radius: 14px; padding: 14px 24px; font-weight: bold; font-size: 15px;
            }
            QPushButton:hover { background-color: #4a4a4a; border-color: %3; }
            QTabBar::tab { background-color: #2c2c2c; padding: 16px 32px; border-radius: 14px; }
            QTabBar::tab:selected { background-color: #3a3a3a; border-bottom: 4px solid %3; }
            QProgressBar { border-radius: 12px; background-color: %2; }
            QProgressBar::chunk { background-color: %3; border-radius: 10px; }
        )").arg(base, widget, accent);

        setStyleSheet(qss);
    }

    void loadSettings() {
        QDir().mkpath(SETTINGS_DIR);
        QFile file(SETTINGS_FILE);
        if (file.open(QIODevice::ReadOnly)) {
            QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
            QJsonObject obj = doc.object();
            enabledTools = obj["enabled_tools"].toVariant().toStringList();
            if (enabledTools.isEmpty()) enabledTools = allTools;
            currentTheme = obj["theme"].toString("Ciemny Szary");
            startFullscreen = obj["fullscreen"].toBool(false);
        } else {
            enabledTools = allTools;
        }
    }

    void saveSettings() {
        QDir().mkpath(SETTINGS_DIR);
        QJsonObject obj;
        obj["enabled_tools"] = QJsonValue::fromVariant(enabledTools);
        obj["theme"] = currentTheme;
        obj["fullscreen"] = startFullscreen;

        QFile file(SETTINGS_FILE);
        if (file.open(QIODevice::WriteOnly)) {
            file.write(QJsonDocument(obj).toJson());
        }
    }
};

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    MainWindow w;
    w.show();
    return app.exec();
}

#include "main.moc"

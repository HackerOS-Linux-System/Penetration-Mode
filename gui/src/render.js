const { createApp } = Vue;
const { createVuetify } = Vuetify;
const { Terminal } = Xterm;
const { FitAddon } = XtermAddon;
const Chart = ChartJS;

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        colors: {
          primary: '#00ff88',
          secondary: '#0288d1',
        },
      },
    },
  },
});

createApp({
  data() {
    return {
      profiles: [
        { name: 'Network Scan', icon: 'mdi-network', command: 'nmap -A {target}' },
        { name: 'Web Exploits', icon: 'mdi-web', command: 'sqlmap -u {target}' },
        { name: 'Wi-Fi Crack', icon: 'mdi-wifi', command: 'aircrack-ng -w /data/wordlist.txt {target}' },
        { name: 'Password Crack', icon: 'mdi-lock', command: 'hashcat -m 0 /data/hashes.txt /data/wordlist.txt' },
      ],
      selectedProfile: null,
      command: '',
      output: '',
      results: [],
      activeTab: 'table',
      terminal: null,
      chart: null,
    };
  },
  mounted() {
    this.terminal = new Terminal({ theme: { background: '#121212', foreground: '#00ff88' } });
    const fitAddon = new FitAddon();
    this.terminal.loadAddon(fitAddon);
    this.terminal.open(document.getElementById('terminal'));
    fitAddon.fit();

    this.chart = new Chart(document.getElementById('resultsChart').getContext('2d'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Open Ports', data: [] }] },
      options: { responsive: true },
    });
  },
  methods: {
    async startSession() {
      this.terminal.write('Starting new session...\n');
    },
    async runCommand() {
      this.terminal.write(`Running: ${this.command}\n`);
      try {
        const result = await window.api.sendCommand(
          this.selectedProfile?.image || 'kali-linux',
          this.command,
          this.selectedProfile?.name || 'Custom'
        );
        this.output = result.output;
        this.results = JSON.parse(atob(result.output)); // Dekodowanie zaszyfrowanych wyników
        this.terminal.write(result.output);
        if (result.error) this.terminal.write(`Error: ${result.error}\n`);

        // Aktualizacja wykresu
        this.chart.data.labels = this.results.map(r => r.ip);
        this.chart.data.datasets[0].data = this.results.map(r => r.ports.length);
        this.chart.update();
      } catch (error) {
        this.output = `Error: ${error.message}`;
        this.terminal.write(`Error: ${error.message}\n`);
      }
    },
    clearOutput() {
      this.output = '';
      this.results = [];
      this.terminal.clear();
      this.chart.data.labels = [];
      this.chart.data.datasets[0].data = [];
      this.chart.update();
    },
    selectProfile(profile) {
      this.selectedProfile = profile;
      this.command = profile.command.replace('{target}', '127.0.0.1');
    },
    exportToPDF() {
      const PDFDocument = require('pdfkit');
      const fs = require('fs');
      const doc = new PDFDocument();
      doc.pipe(fs.createWriteStream('/tmp/penmode-report.pdf'));
      doc.fontSize(25).text('Penetration Mode Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).text(JSON.stringify(this.results, null, 2));
      doc.end();
      this.terminal.write('Report exported to /tmp/penmode-report.pdf\n');
    },
  },
}).use(vuetify).mount('#app');

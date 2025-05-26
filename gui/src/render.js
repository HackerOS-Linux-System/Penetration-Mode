const { createApp } = Vue;
const { createVuetify } = Vuetify;
const { Terminal } = Xterm;
const { FitAddon, WebLinksAddon } = XtermAddon;
const Chart = ChartJS;

require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor/min/vs' } });

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        colors: {
          primary: '#00ff88',
          secondary: '#0288d1',
          accent: '#ff4081',
        },
      },
    },
  },
});

createApp({
  data() {
    return {
      view: 'dashboard',
      profiles: [
        { name: 'Network Scan', icon: 'mdi-network', command: 'nmap -A {target}', image: 'kali-linux', auto: 'nmap -A {target}; masscan {target} --rate=1000' },
        { name: 'Fast Scan', icon: 'mdi-speedometer', command: 'masscan {target} --rate=1000', image: 'kali-linux' },
        { name: 'Web Exploits', icon: 'mdi-web', command: 'sqlmap -u {target}', image: 'kali-linux', auto: 'gobuster dir -u {target} -w /data/wordlist.txt; sqlmap -u {target}' },
        { name: 'Wi-Fi Crack', icon: 'mdi-wifi', command: 'aircrack-ng -w /data/wordlist.txt {target}', image: 'kali-linux' },
        { name: 'Password Crack', icon: 'mdi-lock', command: 'hashcat -m 0 /data/hashes.txt /data/wordlist.txt', image: 'gpu-hashcat', use_gpu: true },
        { name: 'AD Attack', icon: 'mdi-server', command: 'crackmapexec smb {target}', image: 'ad-attack' },
        { name: 'Responder', icon: 'mdi-shield-alert', command: 'responder -I eth0 -wrf', image: 'ad-attack' },
        { name: 'OSINT', icon: 'mdi-magnify', command: 'theharvester -d {target} -b all', image: 'kali-linux' },
        { name: 'BloodHound', icon: 'mdi-graph', command: 'bloodhound-python -u user -p pass -d {target}', image: 'ad-attack' },
      ],
      sessions: [],
      selectedProfile: null,
      command: '',
      output: '',
      results: [],
      activeTab: 'table',
      terminal: null,
      chart: null,
      resourceChart: null,
      editor: null,
      suggestions: [],
    };
  },
  mounted() {
    // Terminal
    this.terminal = new Terminal({ theme: { background: '#121212', foreground: '#00ff88' } });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    this.terminal.loadAddon(fitAddon);
    this.terminal.loadAddon(webLinksAddon);
    this.terminal.open(document.getElementById('terminal'));
    fitAddon.fit();

    // Results Chart
    this.chart = new Chart(document.getElementById('resultsChart').getContext('2d'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Open Ports', data: [], backgroundColor: '#00ff88' }] },
      options: { responsive: true, plugins: { legend: { display: true } } },
    });

    // Resource Chart
    this.resourceChart = new Chart(document.getElementById('resourceChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'CPU (%)', data: [], borderColor: '#00ff88' },
          { label: 'Memory (MB)', data: [], borderColor: '#0288d1' },
        ],
      },
      options: { responsive: true },
    });

    // Monaco Editor
    require(['vs/editor/editor.main'], () => {
      this.editor = monaco.editor.create(document.getElementById('editor'), {
        value: '# Write your plugin here\n',
        language: 'python',
        theme: 'vs-dark',
      });
      monaco.languages.registerCompletionItemProvider('python', {
        provideCompletionItems: () => ({
          suggestions: [
            { label: 'nmap', kind: monaco.languages.CompletionItemKind.Function, insertText: 'nmap -A {target}' },
            { label: 'sqlmap', kind: monaco.languages.CompletionItemKind.Function, insertText: 'sqlmap -u {target}' },
          ],
        }),
      });
    });

    // Update resources
    setInterval(this.updateResources, 5000);
  },
  methods: {
    async startSession() {
      this.terminal.write('Starting new session...\n');
      this.sessions.push({ id: Date.now().toString(), profile: this.selectedProfile?.name || 'Custom', command: this.command, status: 'Running' });
    },
    async runCommand(auto = false) {
      const cmd = auto && this.selectedProfile?.auto ? this.selectedProfile.auto : this.command;
      this.terminal.write(`Running: ${cmd}\n`);
      try {
        const result = await window.api.sendCommand(
          this.selectedProfile?.image || 'kali-linux',
          cmd,
          this.selectedProfile?.name || 'Custom',
          this.selectedProfile?.use_gpu || false,
          5
        );
        this.output = result.output;
        this.results = JSON.parse(atob(result.output));
        this.terminal.write(this.results.map(r => JSON.stringify(r, null, 2)).join('\n'));
        if (result.error) this.terminal.write(`Error: ${result.error}\n`);

        this.chart.data.labels = this.results.map(r => r.ip || r.domain || r.target);
        this.chart.data.datasets[0].data = this.results.map(r => r.ports?.length || r.subdomains?.length || 0);
        this.chart.update();

        this.sessions = this.sessions.map(s =>
          s.id === result.session_id ? { ...s, status: 'Completed' } : s
        );
      } catch (error) {
        this.output = `Error: ${error.message}`;
        this.terminal.write(`Error: ${error.message}\n`);
      }
    },
    async pauseSession(session_id) {
      const response = await fetch(`http://127.0.0.1:8080/api/session/pause/${session_id}`);
      const result = await response.json();
      this.terminal.write(`Session paused: ${result.output}\n`);
      this.sessions = this.sessions.map(s =>
        s.id === session_id ? { ...s, status: 'Paused' } : s
      );
    },
    async resumeSession(session_id) {
      const output = await fetch(`http://127.0.0.1:8080/api/session/resume/${session_id}`);
      const result = await output.json();
      this.terminal.write(`Session resumed: ${result.output}\n`);
      this.sessions = this.sessions.map(s =>
        s.id === session_id ? { ...s, status: 'Running' } : s
      );
    },
    async scheduleSession() {
      const scheduleTime = new Date(Date.now() + 60000).toISOString();
      const result = await window.api.sendCommand(
        this.selectedProfile?.image || 'kali-linux',
        this.command,
        this.selectedProfile?.name || 'Custom',
        this.selectedProfile?.use_gpu || false,
        5,
        scheduleTime
      );
      this.terminal.write(`Session scheduled for ${scheduleTime}\n`);
      this.sessions.push({ id: result.session_id, profile: this.selectedProfile?.name || 'Custom', command: this.command, status: 'Scheduled' });
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
      this.view = 'profiles';
      this.selectedProfile = profile;
      this.command = profile.command.replace('{target}', '127.0.0.1');
      if (profile.auto) {
        this.runCommand(true); // Automatyczne uruchomienie sekwencji
      }
    },
    suggestCommand() {
      this.suggestions = this.profiles
        .filter(p => p.command.toLowerCase().includes(this.command.toLowerCase()))
        .map(p => p.command);
    },
    handleDrop(event) {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file && file.name.endsWith('.py')) {
        const reader = new FileReader();
        reader.onload = () => this.editor.setValue(reader.result);
        reader.readAsText(file);
      }
    },
    savePlugin() {
      const fs = require('fs');
      fs.writeFileSync('gui/src/plugins/custom.py', this.editor.getValue());
      this.terminal.write('Plugin saved to gui/src/plugins/custom.py\n');
    },
    exportToPDF() {
      const PDFDocument = require('pdfkit');
      const fs = require('fs');
      const doc = new PDFDocument();
      doc.pipe(fs.createWriteStream('/tmp/penmode-report.pdf'));
      doc.fontSize(25).fillColor('#00ff88').text('Penetration Mode Report', { align: 'center' });
      doc.moveDown();
      doc.image('assets/logo.png', { width: 100, align: 'center' });
      doc.moveDown();
      doc.fontSize(14).fillColor('#ffffff').text(JSON.stringify(this.results, null, 2));
      doc.end();
      this.terminal.write('Report exported to /tmp/penmode-report.pdf\n');
    },
    exportToCSV() {
      const fs = require('fs');
      const csv = this.results.map(r => `${r.ip || r.domain},${r.ports?.length || r.subdomains?.length || 0}`).join('\n');
      fs.writeFileSync('/tmp/penmode-report.csv', `IP,Count\n${csv}`);
      this.terminal.write('Report exported to /tmp/penmode-report.csv\n');
    },
    updateResources() {
      this.resourceChart.data.labels.push(new Date().toLocaleTimeString());
      this.resourceChart.data.datasets[0].data.push(Math.random() * 100);
      this.resourceChart.data.datasets[1].data.push(Math.random() * 1024);
      if (this.resourceChart.data.labels.length > 10) {
        this.resourceChart.data.labels.shift();
        this.resourceChart.data.datasets.forEach(d => d.data.shift());
      }
      this.resourceChart.update();
    },
  },
}).use(vuetify).mount('#app');

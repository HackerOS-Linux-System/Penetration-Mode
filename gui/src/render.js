const { createApp } = Vue;
const { createVuetify } = Vuetify;
const { Terminal } = Xterm;
const { FitAddon } = XtermAddon;
const async function runContainer() {
  const outputDiv = document.getElementById('output');
  try {
    const result = await window.api.sendCommand('kali-linux', 'nmap -A 127.0.0.1');
    outputDiv.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    outputDiv.textContent = `Error: ${error.message}`;
  }
}Chart = ChartJS;

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

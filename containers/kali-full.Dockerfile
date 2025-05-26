# Używamy najnowszego obrazu Kali Linux jako bazy
FROM kalilinux/kali-rolling:latest

# Etykiety dla lepszej dokumentacji obrazu
LABEL maintainer="Your Name <your.email@example.com>"
LABEL description="Obraz Kali Linux z narzędziami do testów penetracyjnych"
LABEL version="1.0"

# Ustawienie zmiennych środowiskowych
ENV DEBIAN_FRONTEND=noninteractive
ENV TERM=xterm-256color

# Aktualizacja pakietów i instalacja podstawowych narzędzi
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    # Podstawowe narzędzia systemowe
    bash \
    curl \
    wget \
    git \
    nano \
    vim \
    # Narzędzia do skanowania sieci i rozpoznania
    nmap \
    recon-ng \
    theharvester \
    dnsrecon \
    # Narzędzia do skanowania podatności
    nikto \
    wapiti \
    # Narzędzia do eksploatacji
    metasploit-framework \
    sqlmap \
    # Narzędzia do ataków na hasła
    hydra \
    hashcat \
    john \
    # Narzędzia do ataków na sieci bezprzewodowe
    aircrack-ng \
    kismet \
    reaver \
    # Narzędzia do sniffingu i MITM
    wireshark \
    ettercap-common \
    bettercap \
    # Narzędzia do testowania aplikacji webowych
    burpsuite \
    dirb \
    wpscan \
    # Narzędzia do post-eksploatacji
    mimikatz \
    powersploit \
    # Narzędzia do socjotechniki
    metasploit-framework \
    # Dodatkowe narzędzia i zależności
    python3 \
    python3-pip \
    ruby \
    ruby-dev \
    perl \
    # Czyszczenie cache APT dla zmniejszenia rozmiaru obrazu
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Instalacja dodatkowych bibliotek Python dla narzędzi
RUN pip3 install --no-cache-dir \
    requests \
    beautifulsoup4 \
    scapy \
    impacket \
    # Wymagania dla recon-ng
    recon-ng \
    # Wymagania dla innych narzędzi
    shodan \
    py-altdns

# Utworzenie katalogu roboczego dla przechowywania wyników testów
WORKDIR /pentest
RUN mkdir -p /pentest/reports /pentest/tools

# Skopiowanie przykładowych skryptów lub konfiguracji (opcjonalne)
# COPY scripts/ /pentest/tools/

# Ustawienie zmiennych środowiskowych dla narzędzi
ENV PATH="$PATH:/pentest/tools"
ENV NMAP_PRIVILEGED=""

# Ustawienie domyślnego użytkownika (opcjonalne, domyślnie root w Kali)
# RUN useradd -m -s /bin/bash pentester && chown -R pentester:pentester /pentest
# USER pentester

# Eksponowanie portów dla wybranych narzędzi (np. Metasploit, Burp Suite)
EXPOSE 80 443 8080

# Ustawienie domyślnego punktu wejścia
ENTRYPOINT ["/bin/bash"]
CMD ["-c", "echo 'Kali Linux Pentest Environment Ready!' && /bin/bash"]

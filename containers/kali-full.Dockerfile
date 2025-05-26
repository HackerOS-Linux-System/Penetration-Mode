FROM kalilinux/kali-rolling:latest

RUN apt-get update && apt-get install -y \
    nmap \
    metasploit-framework \
    sqlmap \
    hydra \
    wireshark \
    aircrack-ng \
    kismet \
    nikto \
    john \
    hashcat \
    recon-ng \
    set \
    && rm -rf /var/lib/apt/lists/*

# Konfiguracja X11 forwarding
RUN apt-get update && apt-get install -y x11-xserver-utils
ENV DISPLAY=:0

# Konfiguracja GPU dla hashcat
RUN apt-get update && apt-get install -y nvidia-driver ocl-icd-libopencl1

CMD ["/bin/bash"]

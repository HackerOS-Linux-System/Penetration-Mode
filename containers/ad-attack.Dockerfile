FROM kalilinux/kali-rolling:latest

RUN apt-get update && apt-get install -y \
    crackmapexec \
    impacket-scripts \
    responder \
    && rm -rf /var/lib/apt/lists/*

CMD ["/bin/bash"]

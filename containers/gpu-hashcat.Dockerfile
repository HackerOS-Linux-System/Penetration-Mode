FROM kalilinux/kali-rolling:latest

RUN apt-get update && apt-get install -y \
    hashcat \
    nvidia-driver \
    ocl-icd-libopencl1 \
    && rm -rf /var/lib/apt/lists/*

CMD ["/bin/bash"]
